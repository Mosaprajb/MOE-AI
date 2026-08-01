// Simulation-only strategy registry.
//
// The registry is intentionally separate from every global/live toggle. A run receives an
// immutable list of strategies and each strategy evaluates the same historical candle stream
// independently. Nothing in this module imports a broker client or grants execution authority.

import { MOE_CONFIG, createMoeState, evaluateMoe } from '../../../lib/moeEngine.js';
import { createFusionEngineV2 } from '../core/fusion-engine-v2.js';
import { createMarketSnapshot } from '../market-data/market-snapshot.js';
import { evaluateBrainCandidate } from '../moe-ai-brain.js';
import { createAnalysisPipelineV2 } from '../scanner/analysis-pipeline-v2.js';

export const SIMULATION_STRATEGIES = Object.freeze({
  FUSION_V2: 'FUSION_V2',
  MOERAND_SIMPLE_INTERNAL: 'MOERAND_SIMPLE_INTERNAL',
});

const STRATEGY_VALUES = Object.freeze(Object.values(SIMULATION_STRATEGIES));
const FIVE_MINUTES_MS = 5 * 60_000;

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function roundPrice(value) {
  return Number(finite(value).toFixed(4));
}

function normalizedBar(bar = {}) {
  return {
    t: Number(bar.t),
    o: Number(bar.o),
    h: Number(bar.h),
    l: Number(bar.l),
    c: Number(bar.c),
    v: Number(bar.v || 0),
  };
}

function marketSnapshot(symbol, bars, now) {
  const current = bars.at(-1);
  return createMarketSnapshot({
    symbol,
    timeframe: '5m',
    bars: bars.map((bar) => ({
      timestamp: bar.t,
      open: bar.o,
      high: bar.h,
      low: bar.l,
      close: bar.c,
      volume: bar.v,
    })),
    quote: {
      bid: current.c,
      ask: current.c,
      last: current.c,
      volume: current.v,
      timestamp: current.t + FIVE_MINUTES_MS,
    },
    dataTimestamp: current.t + FIVE_MINUTES_MS,
    session: 'CORE',
    profile: { sector: 'SIMULATION', industry: 'HISTORICAL_REPLAY' },
    news: [],
    options: null,
  }, { now });
}

export function normalizeSimulationStrategies(value) {
  const source = Array.isArray(value) ? value : [value];
  const selected = [...new Set(source
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item) => STRATEGY_VALUES.includes(item)))];
  if (!selected.length) throw new Error('Select at least one supported simulation strategy.');
  return Object.freeze(selected);
}

function fusionCandidate(symbol, event, snapshot, fusion, now) {
  return {
    id: `SIM-FUSION-${symbol}-${event.barTime}`,
    symbol,
    direction: 'LONG',
    timeframe: '5m',
    score: clamp(fusion.score || event.score),
    confidence: { value: clamp(fusion.confidence || event.score), source: SIMULATION_STRATEGIES.FUSION_V2 },
    entry: roundPrice(event.entry ?? event.price),
    stopLoss: roundPrice(event.stop),
    takeProfit: roundPrice(event.target),
    createdAt: iso(now),
    validForMs: 30 * 60_000,
    reasons: [...(fusion.reasons || []), event.reason].filter(Boolean),
    metadata: {
      setupFamily: 'FUSION_V2',
      grade: fusion.grade,
      sourceStrategy: SIMULATION_STRATEGIES.FUSION_V2,
      simulation: true,
      notRealMarketData: true,
      historicalBarTime: iso(event.barTime),
      relativeVolume: finite(snapshot.relativeVolume),
      atr: finite(snapshot.atr),
    },
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
    liveExecutionAllowed: false,
  };
}

async function runFusionV2({ symbol, bars, previousState, env, simulatedAt }) {
  const moe = evaluateMoe(bars, createMoeState(previousState?.moe), {
    ...MOE_CONFIG,
    primaryTimeframeMinutes: 5,
    preferredTimeframeMinutes: 60,
    allowRepeatedBuys: false,
    baseBuyScore: Number(env.AUTO_SCANNER_ENGINE_MIN_SCORE || 68),
    initialTargetRR: Number(env.MOE_AI_MIN_RISK_REWARD || 2),
  });

  const nextState = { moe: moe.state };
  const event = moe.event;
  const closeInstruction = event?.type === 'SELL NOW'
    ? { strategy: SIMULATION_STRATEGIES.FUSION_V2, symbol, price: event.price, reason: event.reason || 'STRATEGY_EXIT' }
    : null;

  if (!event || event.type !== 'BUY NOW') {
    return {
      strategy: SIMULATION_STRATEGIES.FUSION_V2,
      detected: false,
      accepted: false,
      opportunity: null,
      rejection: null,
      closeInstruction,
      nextState,
      diagnostics: { signal: moe.snapshot?.signal || 'WAIT', score: moe.snapshot?.score ?? null },
    };
  }

  // The existing MOE engine remains the source signal. Analysis Pipeline V2 and Fusion V2
  // consume that observation without changing the engine's decision logic.
  const snapshot = marketSnapshot(symbol, bars, simulatedAt);
  const sourceOpportunity = {
    symbol,
    direction: 'LONG',
    timeframe: '5m',
    score: event.score,
    confidence: event.score,
    entry: event.entry,
    stopLoss: event.stop,
    takeProfit: event.target,
    reasons: [event.reason],
    createdAt: iso(simulatedAt),
    metadata: { setupFamily: event.reason || 'MOE_CORE', sourceStrategy: SIMULATION_STRATEGIES.FUSION_V2 },
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
  };
  const pipeline = createAnalysisPipelineV2({
    analyzers: {
      moeCore: async () => ({
        available: true,
        score: event.score,
        confidence: event.score,
        direction: 'LONG',
        dataQuality: snapshot.quality?.score ?? 100,
        observedAt: iso(simulatedAt),
        completedAt: iso(simulatedAt),
        reasons: [event.reason || 'MOE_CORE_BUY'],
        opportunity: sourceOpportunity,
        observationOnly: true,
        executionEnabled: false,
        executionAllowed: false,
      }),
    },
    definitions: {
      moeCore: { engine: 'MOE_CORE', required: true, weight: 1 },
    },
    minimumScore: Number(env.AUTO_SCANNER_ENGINE_MIN_SCORE || 68),
    minimumCoverage: 1,
    longOnly: true,
    now: () => new Date(simulatedAt),
  });
  const analyzed = await pipeline.analyze(snapshot, {
    simulation: true,
    historicalReplay: true,
    sourceStrategy: SIMULATION_STRATEGIES.FUSION_V2,
  });
  const fusion = createFusionEngineV2({
    requiredEngines: ['MOE_CORE'],
    minimumCoverage: 1,
    minimumAgreement: 55,
    maximumConflict: 45,
    minimumConfidence: 55,
    minimumDataQuality: 45,
    minimumScore: 55,
    longOnly: true,
    now: () => new Date(simulatedAt),
  }).fuse(analyzed, { symbol, evaluatedAt: simulatedAt });

  const candidate = fusionCandidate(symbol, event, moe.snapshot || {}, fusion, simulatedAt);
  // This is the same MOE AI acceptance function used by the normal auto-scanner.
  const brain = evaluateBrainCandidate({
    ...candidate,
    score: candidate.score,
    relativeVolume: moe.snapshot?.relativeVolume,
    atr: moe.snapshot?.atr,
    spreadPercent: 0,
    driftPercent: 0,
    marketScore: 70,
    sectorScore: 50,
    marketRegime: 'NEUTRAL',
    sector: 'SIMULATION',
  }, { session: 'CORE', label: 'CORE' }, env);

  const accepted = fusion.accepted === true && brain.accepted === true;
  return {
    strategy: SIMULATION_STRATEGIES.FUSION_V2,
    detected: true,
    accepted,
    opportunity: accepted ? { ...candidate, brain, fusion } : null,
    rejection: accepted ? null : {
      strategy: SIMULATION_STRATEGIES.FUSION_V2,
      symbol,
      simulatedAt: iso(simulatedAt),
      reasons: [...(fusion.blockers || []), ...(brain.rejectionReasons || [])],
      score: candidate.score,
    },
    closeInstruction,
    nextState,
    diagnostics: { moe: moe.snapshot, fusion, brain },
  };
}

function trueRange(current, previous) {
  if (!previous) return current.h - current.l;
  return Math.max(
    current.h - current.l,
    Math.abs(current.h - previous.c),
    Math.abs(current.l - previous.c),
  );
}

function updateAtr(previous = {}, current, priorBar, period = 10) {
  const tr = trueRange(current, priorBar);
  const seed = Array.isArray(previous.atrSeed) ? [...previous.atrSeed] : [];
  let atr = Number.isFinite(Number(previous.atr)) ? Number(previous.atr) : null;
  if (atr == null) {
    seed.push(tr);
    if (seed.length >= period) atr = seed.slice(-period).reduce((sum, value) => sum + value, 0) / period;
  } else {
    atr = ((atr * (period - 1)) + tr) / period;
  }
  return { atr, atrSeed: seed.slice(-period) };
}

function runMoerandSimple({ symbol, bars, previousState, simulatedAt }) {
  const current = bars.at(-1);
  const priorBar = bars.at(-2);
  const state = {
    atr: previousState?.atr ?? null,
    atrSeed: previousState?.atrSeed ?? [],
    previousSrc: previousState?.previousSrc ?? null,
    previousStop: previousState?.previousStop ?? 0,
    trailingStop: previousState?.trailingStop ?? 0,
    inPosition: previousState?.inPosition === true,
  };
  const atrState = updateAtr(state, current, priorBar, 10);
  state.atr = atrState.atr;
  state.atrSeed = atrState.atrSeed;

  if (!Number.isFinite(state.atr)) {
    state.previousSrc = current.c;
    return {
      strategy: SIMULATION_STRATEGIES.MOERAND_SIMPLE_INTERNAL,
      detected: false,
      accepted: false,
      opportunity: null,
      rejection: null,
      closeInstruction: null,
      nextState: state,
      diagnostics: { signal: 'WARMING_UP' },
    };
  }

  const src = current.c;
  const previousSrc = Number.isFinite(Number(state.previousSrc)) ? Number(state.previousSrc) : src;
  const previousStop = Number.isFinite(Number(state.trailingStop)) ? Number(state.trailingStop) : 0;
  const loss = state.atr;
  let trailingStop;
  if (src > previousStop && previousSrc > previousStop) trailingStop = Math.max(previousStop, src - loss);
  else if (src < previousStop && previousSrc < previousStop) trailingStop = Math.min(previousStop, src + loss);
  else trailingStop = src > previousStop ? src - loss : src + loss;

  const crossedAbove = previousSrc <= previousStop && src > trailingStop;
  const crossedBelow = previousSrc >= previousStop && src < trailingStop;
  const buySignal = !state.inPosition && src > trailingStop && crossedAbove;
  const sellSignal = state.inPosition && src < trailingStop && crossedBelow;
  state.trailingStop = trailingStop;
  state.previousStop = previousStop;
  state.previousSrc = src;

  let opportunity = null;
  let closeInstruction = null;
  if (buySignal) {
    state.inPosition = true;
    const risk = Math.max(src - trailingStop, 0.01);
    opportunity = {
      id: `SIM-MOERAND-${symbol}-${current.t}`,
      symbol,
      direction: 'LONG',
      timeframe: '5m',
      score: 75,
      confidence: { value: 75, source: SIMULATION_STRATEGIES.MOERAND_SIMPLE_INTERNAL },
      entry: roundPrice(src),
      stopLoss: roundPrice(trailingStop),
      takeProfit: roundPrice(src + risk * 2),
      createdAt: iso(simulatedAt),
      validForMs: 30 * 60_000,
      reasons: ['UT_BOT_ATR_CROSSOVER'],
      metadata: {
        setupFamily: 'UT_BOT_ATR',
        sourceStrategy: SIMULATION_STRATEGIES.MOERAND_SIMPLE_INTERNAL,
        simulation: true,
        notRealMarketData: true,
        historicalBarTime: iso(current.t),
        dynamicTrailingStop: true,
      },
      observationOnly: true,
      executionEnabled: false,
      executionAllowed: false,
      liveExecutionAllowed: false,
    };
  }
  if (sellSignal) {
    state.inPosition = false;
    closeInstruction = {
      strategy: SIMULATION_STRATEGIES.MOERAND_SIMPLE_INTERNAL,
      symbol,
      price: src,
      reason: 'ATR_TRAILING_STOP_SIGNAL',
    };
  }

  return {
    strategy: SIMULATION_STRATEGIES.MOERAND_SIMPLE_INTERNAL,
    detected: buySignal,
    accepted: buySignal,
    opportunity,
    rejection: null,
    closeInstruction,
    nextState: state,
    diagnostics: {
      signal: buySignal ? 'BUY' : sellSignal ? 'SELL' : 'WAIT',
      atr: state.atr,
      trailingStop,
    },
  };
}

export async function runSimulationStrategies({
  selectedStrategies,
  symbol,
  bars,
  strategyState = {},
  env = {},
  simulatedAt = Date.now(),
} = {}) {
  const selected = normalizeSimulationStrategies(selectedStrategies);
  const normalizedBars = (Array.isArray(bars) ? bars : []).map(normalizedBar)
    .filter((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
  if (!normalizedBars.length) return { results: [], strategyState };

  const results = [];
  const nextState = { ...strategyState };
  for (const strategy of selected) {
    const key = `${strategy}:${symbol}`;
    const result = strategy === SIMULATION_STRATEGIES.FUSION_V2
      ? await runFusionV2({ symbol, bars: normalizedBars, previousState: strategyState[key], env, simulatedAt })
      : runMoerandSimple({ symbol, bars: normalizedBars, previousState: strategyState[key], simulatedAt });
    nextState[key] = result.nextState;
    results.push(result);
  }
  return { results, strategyState: nextState };
}
