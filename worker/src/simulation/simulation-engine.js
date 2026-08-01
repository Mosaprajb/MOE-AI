// Durable Object backed historical replay engine.
//
// Safety invariants:
// - Historical Alpaca bars are the only external input.
// - No Webull module is imported and no broker request is made.
// - Strategy results create local simulated orders only.
// - Every persisted/exported record is permanently labelled SIMULATION.

import {
  SIMULATION_STRATEGIES,
  normalizeSimulationStrategies,
  runSimulationStrategies,
} from './simulation-strategies.js';

export const SIMULATION_STATE_KEY = 'sandbox-simulation:state:v1';
export const SIMULATION_REPORT_KEY = 'sandbox-simulation:last-report:v1';
export const SIMULATION_SCHEMA = 'MOE.SandboxHistoricalSimulation';
export const SIMULATION_VERSION = '1.0.0';

const FIVE_MINUTES_MS = 5 * 60_000;
const DEFAULT_SYMBOLS = Object.freeze(['SPY', 'QQQ', 'NVDA', 'AAPL', 'MSFT', 'AMD', 'TSLA', 'AMZN', 'META', 'GOOGL']);
const MAX_SYMBOLS = 20;
const MAX_TIMELINE_EVENTS = 500;
const MAX_OPPORTUNITIES = 200;

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function round(value, digits = 4) {
  return Number(finite(value).toFixed(digits));
}

function simulationSymbols(env = {}) {
  const raw = text(env.MOE_SIMULATION_SYMBOLS);
  const source = raw ? raw.split(',') : DEFAULT_SYMBOLS;
  const normalized = [...new Set(source
    .map((symbol) => text(symbol).toUpperCase())
    .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)))];
  return normalized.slice(0, MAX_SYMBOLS);
}

function normalizeRange(value) {
  const normalized = text(value, 'LAST_SESSION').toUpperCase();
  if (normalized === 'LAST_3_DAYS') return { id: normalized, sessions: 3 };
  return { id: 'LAST_SESSION', sessions: 1 };
}

function normalizeSpeed(value) {
  const parsed = Math.floor(Number(value));
  const speedMultiplier = parsed === 300 ? 300 : 60;
  return {
    speedMultiplier,
    tickIntervalMs: Math.max(1_000, Math.round(FIVE_MINUTES_MS / speedMultiplier)),
  };
}

function nyParts(value) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(value instanceof Date ? value : new Date(value));
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function nySessionKey(value) {
  const parts = nyParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function isCoreSessionBar(bar) {
  const parts = nyParts(bar.t);
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}

function datasetKey(runId, symbol) {
  return `sandbox-simulation:data:${runId}:${symbol}`;
}

function normalizeHistoricalBar(bar = {}) {
  const output = {
    t: new Date(bar.t).getTime(),
    o: Number(bar.o),
    h: Number(bar.h),
    l: Number(bar.l),
    c: Number(bar.c),
    v: Number(bar.v || 0),
  };
  return [output.t, output.o, output.h, output.l, output.c].every(Number.isFinite) ? output : null;
}

async function fetchHistoricalBars(symbol, env, capturedAt) {
  const end = new Date(capturedAt);
  const start = new Date(end.getTime() - 20 * 24 * 60 * 60_000);
  const query = new URLSearchParams({
    timeframe: '5Min',
    start: start.toISOString(),
    end: end.toISOString(),
    limit: '10000',
    adjustment: 'raw',
    feed: 'iex',
    sort: 'asc',
  });
  const response = await fetch(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/bars?${query}`, {
    headers: {
      'APCA-API-KEY-ID': text(env.ALPACA_KEY_ID),
      'APCA-API-SECRET-KEY': text(env.ALPACA_SECRET_KEY),
    },
  });
  if (!response.ok) throw new Error(`ALPACA_HISTORICAL_${symbol}_${response.status}`);
  const payload = await response.json();
  return (Array.isArray(payload?.bars) ? payload.bars : [])
    .map(normalizeHistoricalBar)
    .filter(Boolean)
    .filter((bar) => bar.t + FIVE_MINUTES_MS <= capturedAt)
    .filter(isCoreSessionBar);
}

async function buildHistoricalDataset(env, { range, capturedAt }) {
  if (!text(env.ALPACA_KEY_ID) || !text(env.ALPACA_SECRET_KEY)) {
    throw new Error('Alpaca historical credentials are not configured.');
  }
  const symbols = simulationSymbols(env);
  const entries = await Promise.all(symbols.map(async (symbol) => {
    try {
      return [symbol, await fetchHistoricalBars(symbol, env, capturedAt)];
    } catch (error) {
      return [symbol, [], error instanceof Error ? error.message : 'Historical fetch failed'];
    }
  }));

  // Exclude the current New York date even when bars exist. Simulation must never consume an
  // in-progress real session; only fully recorded prior sessions are eligible.
  const currentNyDate = nySessionKey(capturedAt);
  const availableDates = [...new Set(entries.flatMap(([, bars]) => bars.map((bar) => nySessionKey(bar.t))))]
    .filter((date) => date < currentNyDate)
    .sort();
  const selectedSessions = availableDates.slice(-range.sessions);
  if (selectedSessions.length < range.sessions) {
    throw new Error(`Only ${selectedSessions.length} completed historical session(s) are available.`);
  }
  const selectedSet = new Set(selectedSessions);
  const barsBySymbol = Object.fromEntries(entries
    .map(([symbol, bars]) => [symbol, bars.filter((bar) => selectedSet.has(nySessionKey(bar.t)))])
    .filter(([, bars]) => bars.length >= 10));
  const selectedSymbols = Object.keys(barsBySymbol);
  if (!selectedSymbols.length) throw new Error('No completed Alpaca historical bars were returned.');
  const timeline = [...new Set(Object.values(barsBySymbol).flatMap((bars) => bars.map((bar) => bar.t)))].sort((a, b) => a - b);
  if (!timeline.length) throw new Error('Historical replay timeline is empty.');

  return {
    symbols: selectedSymbols,
    sessions: selectedSessions,
    timeline,
    barsBySymbol,
    historicalSource: 'ALPACA_HISTORICAL_BARS',
    capturedAt: iso(capturedAt),
    currentSessionExcluded: true,
  };
}

function blankMetrics() {
  return {
    detected: 0,
    accepted: 0,
    rejected: 0,
    executed: 0,
    closed: 0,
    wins: 0,
    losses: 0,
    flat: 0,
    realizedR: 0,
    averageR: 0,
    winRate: 0,
  };
}

function initialReport(run) {
  return {
    schema: 'MOE.SandboxSimulationReport',
    schemaVersion: SIMULATION_VERSION,
    mode: 'SIMULATION',
    simulation: true,
    notRealMarketData: true,
    historicalDataOnly: true,
    broker: 'LOCAL_SIMULATOR_NO_WEBULL',
    webullRequestsMade: 0,
    runId: run.runId,
    selectedStrategies: [...run.selectedStrategies],
    historicalRange: run.range,
    historicalSessions: [...run.sessions],
    symbols: [...run.symbols],
    speedMultiplier: run.speedMultiplier,
    startedAt: run.startedAt,
    completedAt: null,
    stoppedAt: null,
    status: run.status,
    byStrategy: Object.fromEntries(run.selectedStrategies.map((strategy) => [strategy, blankMetrics()])),
    trades: [],
  };
}

function event(state, type, details = {}) {
  return {
    id: crypto.randomUUID(),
    type,
    mode: 'SIMULATION',
    simulation: true,
    notRealMarketData: true,
    simulatedAt: state.simulatedAt,
    recordedAt: iso(),
    ...details,
  };
}

function pushEvent(state, type, details = {}) {
  state.timelineEvents = [event(state, type, details), ...(state.timelineEvents || [])]
    .slice(0, MAX_TIMELINE_EVENTS);
}

function activeTradeKey(strategy, symbol) {
  return `${strategy}:${symbol}`;
}

function createSimulatedOrder(state, opportunity) {
  const strategy = opportunity.metadata?.sourceStrategy;
  const trade = {
    id: `SIM-TRADE-${crypto.randomUUID()}`,
    orderId: `SIM-ORDER-${crypto.randomUUID()}`,
    runId: state.runId,
    mode: 'SIMULATION',
    simulation: true,
    notRealMarketData: true,
    broker: 'LOCAL_SIMULATOR_NO_WEBULL',
    webullRequestMade: false,
    sourceStrategy: strategy,
    symbol: opportunity.symbol,
    status: 'SUBMITTED',
    side: 'BUY',
    quantity: 1,
    submittedAt: state.simulatedAt,
    submittedBarTime: Date.parse(state.simulatedAt),
    filledAt: null,
    closedAt: null,
    entry: finite(opportunity.entry),
    stopLoss: finite(opportunity.stopLoss),
    takeProfit: finite(opportunity.takeProfit),
    exitPrice: null,
    outcome: null,
    realizedR: null,
    closeReason: null,
    opportunityId: opportunity.id,
  };
  state.activeTrades[activeTradeKey(strategy, opportunity.symbol)] = trade;
  pushEvent(state, 'SIMULATED_ORDER_SUBMITTED', {
    strategy,
    symbol: opportunity.symbol,
    tradeId: trade.id,
    orderId: trade.orderId,
    webullRequestMade: false,
  });
  return trade;
}

function updateMetricRollups(metrics) {
  const decided = metrics.wins + metrics.losses;
  metrics.winRate = decided ? round((metrics.wins / decided) * 100, 2) : 0;
  metrics.averageR = metrics.closed ? round(metrics.realizedR / metrics.closed, 3) : 0;
}

function closeTrade(state, key, trade, exitPrice, reason, simulatedAt) {
  const risk = Math.max(trade.entry - trade.stopLoss, 0.01);
  const realizedR = round((exitPrice - trade.entry) / risk, 3);
  const outcome = realizedR > 0.01 ? 'WIN' : realizedR < -0.01 ? 'LOSS' : 'FLAT';
  const closed = {
    ...trade,
    status: 'CLOSED',
    closedAt: iso(simulatedAt),
    exitPrice: round(exitPrice),
    closeReason: reason,
    outcome,
    realizedR,
  };
  delete state.activeTrades[key];
  state.completedTrades.unshift(closed);
  state.report.trades.unshift(closed);
  const metrics = state.report.byStrategy[trade.sourceStrategy];
  metrics.closed += 1;
  metrics.realizedR = round(metrics.realizedR + realizedR, 3);
  if (outcome === 'WIN') metrics.wins += 1;
  else if (outcome === 'LOSS') metrics.losses += 1;
  else metrics.flat += 1;
  updateMetricRollups(metrics);
  pushEvent(state, 'SIMULATED_TRADE_CLOSED', {
    strategy: trade.sourceStrategy,
    symbol: trade.symbol,
    tradeId: trade.id,
    outcome,
    realizedR,
    exitPrice: closed.exitPrice,
    reason,
  });
  return closed;
}

function processExistingTrades(state, symbol, bar, closeInstructions) {
  for (const [key, trade] of Object.entries({ ...state.activeTrades })) {
    if (trade.symbol !== symbol) continue;
    if (trade.status === 'SUBMITTED' && bar.t > trade.submittedBarTime) {
      trade.status = 'FILLED';
      trade.filledAt = iso(bar.t);
      trade.entry = round(bar.o);
      state.activeTrades[key] = trade;
      state.report.byStrategy[trade.sourceStrategy].executed += 1;
      pushEvent(state, 'SIMULATED_ORDER_FILLED', {
        strategy: trade.sourceStrategy,
        symbol,
        tradeId: trade.id,
        fillPrice: trade.entry,
        webullRequestMade: false,
      });
    }
    if (trade.status !== 'FILLED') continue;

    const stopTouched = bar.l <= trade.stopLoss;
    const targetTouched = bar.h >= trade.takeProfit;
    // Conservative historical fill policy: when both levels occur inside one OHLC candle,
    // the stop is applied first because the intrabar path is unknown.
    if (stopTouched) {
      closeTrade(state, key, trade, trade.stopLoss, targetTouched ? 'STOP_AND_TARGET_SAME_BAR_STOP_FIRST' : 'STOP_LOSS_HIT', bar.t);
      continue;
    }
    if (targetTouched) {
      closeTrade(state, key, trade, trade.takeProfit, 'TAKE_PROFIT_HIT', bar.t);
      continue;
    }
    const instruction = closeInstructions.find((item) => item.strategy === trade.sourceStrategy && item.symbol === symbol);
    if (instruction) closeTrade(state, key, trade, finite(instruction.price, bar.c), instruction.reason, bar.t);
  }
}

function publicOpportunity(result, state) {
  const opportunity = result.opportunity;
  return {
    ...opportunity,
    sourceStrategy: result.strategy,
    strategyBadge: result.strategy === SIMULATION_STRATEGIES.FUSION_V2 ? 'BLUE' : 'ORANGE',
    simulatedAt: state.simulatedAt,
    mode: 'SIMULATION',
    simulation: true,
    notRealMarketData: true,
    status: result.accepted ? 'ACTIVE' : 'REJECTED',
    expiresAt: iso(Date.now() + 15 * 60_000),
  };
}

function simulationLiveScanner(state) {
  const rows = (state.opportunities || [])
    .filter((item) => item.status === 'ACTIVE')
    .slice(0, 20)
    .map((item, index) => ({
      id: item.id,
      dedupeKey: `${item.sourceStrategy}|${item.symbol}|${item.id}`,
      symbol: item.symbol,
      grade: item.metadata?.grade || (item.score >= 84 ? 'AA' : item.score >= 76 ? 'A' : item.score >= 68 ? 'BBB' : 'BB'),
      score: item.score,
      confidence: typeof item.confidence === 'object' ? item.confidence.value : item.confidence,
      status: 'ACTIVE',
      expiresAt: item.expiresAt,
      expiry: item.expiresAt,
      rank: index + 1,
      rankScore: item.score,
      direction: 'LONG',
      timeframe: '5m',
      family: item.metadata?.setupFamily || item.sourceStrategy,
      sourceStrategy: item.sourceStrategy,
      strategyBadge: item.strategyBadge,
      simulatedAt: item.simulatedAt,
      simulation: true,
      notRealMarketData: true,
      observationOnly: true,
      executionEnabled: false,
      executionAllowed: false,
    }));
  return {
    schema: 'MOE.DashboardLiveScannerSnapshot',
    schemaVersion: '1.0.0',
    updatedAt: iso(),
    topN: 20,
    rows,
    opportunities: rows,
    summary: { active: rows.length, displayed: rows.length, duplicatesHidden: 0, expiredHidden: 0 },
    mode: 'SIMULATION',
    simulation: true,
    notRealMarketData: true,
    selectedStrategies: [...state.selectedStrategies],
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
  };
}

function publicState(state) {
  if (!state) {
    return {
      schema: SIMULATION_SCHEMA,
      schemaVersion: SIMULATION_VERSION,
      status: 'IDLE',
      active: false,
      mode: 'SANDBOX_DISARMED',
      simulation: false,
      liveLocked: true,
    };
  }
  return {
    schema: state.schema,
    schemaVersion: state.schemaVersion,
    runId: state.runId,
    status: state.status,
    active: state.status === 'RUNNING',
    mode: state.status === 'RUNNING' ? 'SIMULATION' : 'SANDBOX_DISARMED',
    simulation: state.status === 'RUNNING',
    notRealMarketData: true,
    selectedStrategies: [...state.selectedStrategies],
    selectedStrategyLabel: state.selectedStrategies.join(' + '),
    range: state.range,
    sessions: [...state.sessions],
    symbols: [...state.symbols],
    speedMultiplier: state.speedMultiplier,
    tickIntervalMs: state.tickIntervalMs,
    cursor: state.cursor,
    totalCandles: state.timeline.length,
    progressPercent: state.timeline.length ? round((state.cursor / state.timeline.length) * 100, 2) : 0,
    simulatedAt: state.simulatedAt,
    startedAt: state.startedAt,
    completedAt: state.completedAt,
    stoppedAt: state.stoppedAt,
    opportunities: state.opportunities.slice(0, 50),
    activeTrades: Object.values(state.activeTrades),
    completedTrades: state.completedTrades.slice(0, 100),
    timeline: state.timelineEvents.slice(0, 200),
    report: state.report,
    liveScanner: simulationLiveScanner(state),
    broker: 'LOCAL_SIMULATOR_NO_WEBULL',
    webullRequestsMade: 0,
    liveLocked: true,
    liveFundsAllowed: false,
  };
}

async function loadDatasets(storage, state) {
  const entries = await Promise.all(state.symbols.map(async (symbol) => [
    symbol,
    (await storage.get(datasetKey(state.runId, symbol))) || [],
  ]));
  return Object.fromEntries(entries);
}

function latestPriceFor(state, symbol, fallback = 0) {
  return finite(state.lastPrices?.[symbol], fallback);
}

function finalizeOpenTrades(state, reason) {
  for (const [key, trade] of Object.entries({ ...state.activeTrades })) {
    if (trade.status === 'SUBMITTED') {
      delete state.activeTrades[key];
      pushEvent(state, 'SIMULATED_ORDER_CANCELLED', {
        strategy: trade.sourceStrategy,
        symbol: trade.symbol,
        tradeId: trade.id,
        reason,
      });
      continue;
    }
    const price = latestPriceFor(state, trade.symbol, trade.entry);
    closeTrade(state, key, trade, price, reason, Date.parse(state.simulatedAt || iso()));
  }
}

export async function startHistoricalSimulation(storage, env, options = {}) {
  const previous = await storage.get(SIMULATION_STATE_KEY);
  if (previous?.status === 'RUNNING') throw new Error('A simulation is already running.');

  const selectedStrategies = normalizeSimulationStrategies(options.strategies);
  const range = normalizeRange(options.range);
  const speed = normalizeSpeed(options.speedMultiplier);
  const capturedAt = Date.now();
  const dataset = await buildHistoricalDataset(env, { range, capturedAt });
  const runId = crypto.randomUUID();

  for (const [symbol, bars] of Object.entries(dataset.barsBySymbol)) {
    await storage.put(datasetKey(runId, symbol), bars);
  }

  const state = {
    schema: SIMULATION_SCHEMA,
    schemaVersion: SIMULATION_VERSION,
    runId,
    status: 'RUNNING',
    mode: 'SIMULATION',
    simulation: true,
    notRealMarketData: true,
    historicalDataOnly: true,
    historicalSource: dataset.historicalSource,
    currentSessionExcluded: dataset.currentSessionExcluded,
    selectedStrategies,
    range: range.id,
    sessions: dataset.sessions,
    symbols: dataset.symbols,
    speedMultiplier: speed.speedMultiplier,
    tickIntervalMs: speed.tickIntervalMs,
    timeline: dataset.timeline,
    cursor: 0,
    simulatedAt: iso(dataset.timeline[0]),
    startedAt: iso(),
    completedAt: null,
    stoppedAt: null,
    lastTickAt: null,
    strategyState: {},
    opportunities: [],
    activeTrades: {},
    completedTrades: [],
    timelineEvents: [],
    lastPrices: {},
    report: null,
  };
  state.report = initialReport(state);
  pushEvent(state, 'SIMULATION_STARTED', {
    selectedStrategies: [...selectedStrategies],
    range: range.id,
    sessions: [...dataset.sessions],
    symbols: [...dataset.symbols],
    speedMultiplier: speed.speedMultiplier,
  });
  await storage.put(SIMULATION_STATE_KEY, state);
  return publicState(state);
}

export async function tickHistoricalSimulation(storage, env) {
  const state = await storage.get(SIMULATION_STATE_KEY);
  if (!state || state.status !== 'RUNNING') return publicState(state);
  if (state.cursor >= state.timeline.length) return completeHistoricalSimulation(storage, env);

  const datasets = await loadDatasets(storage, state);
  const barTime = state.timeline[state.cursor];
  state.simulatedAt = iso(barTime);
  const closeInstructionsBySymbol = {};

  for (const symbol of state.symbols) {
    const allBars = datasets[symbol] || [];
    const current = allBars.find((bar) => bar.t === barTime);
    if (!current) continue;
    state.lastPrices[symbol] = current.c;
    const history = allBars.filter((bar) => bar.t <= barTime);
    const execution = await runSimulationStrategies({
      selectedStrategies: state.selectedStrategies,
      symbol,
      bars: history,
      strategyState: state.strategyState,
      env,
      simulatedAt: barTime,
    });
    state.strategyState = execution.strategyState;
    const closeInstructions = execution.results.map((result) => result.closeInstruction).filter(Boolean);
    closeInstructionsBySymbol[symbol] = closeInstructions;

    for (const result of execution.results) {
      if (!result.detected) continue;
      const metrics = state.report.byStrategy[result.strategy];
      metrics.detected += 1;
      if (result.accepted) metrics.accepted += 1;
      else metrics.rejected += 1;

      const opportunity = result.accepted
        ? publicOpportunity(result, state)
        : {
          id: `SIM-REJECT-${crypto.randomUUID()}`,
          symbol,
          sourceStrategy: result.strategy,
          strategyBadge: result.strategy === SIMULATION_STRATEGIES.FUSION_V2 ? 'BLUE' : 'ORANGE',
          status: 'REJECTED',
          score: result.rejection?.score ?? 0,
          reasons: result.rejection?.reasons || ['STRATEGY_REJECTED'],
          simulatedAt: state.simulatedAt,
          mode: 'SIMULATION',
          simulation: true,
          notRealMarketData: true,
        };
      state.opportunities = [opportunity, ...state.opportunities].slice(0, MAX_OPPORTUNITIES);
      pushEvent(state, result.accepted ? 'SIMULATION_OPPORTUNITY_ACCEPTED' : 'SIMULATION_OPPORTUNITY_REJECTED', {
        strategy: result.strategy,
        symbol,
        opportunityId: opportunity.id,
        reasons: opportunity.reasons,
      });

      const key = activeTradeKey(result.strategy, symbol);
      if (result.accepted && !state.activeTrades[key]) createSimulatedOrder(state, result.opportunity);
    }

    processExistingTrades(state, symbol, current, closeInstructionsBySymbol[symbol]);
  }

  state.cursor += 1;
  state.lastTickAt = iso();
  if (state.cursor >= state.timeline.length) {
    finalizeOpenTrades(state, 'END_OF_HISTORICAL_DATA');
    state.status = 'COMPLETED';
    state.completedAt = iso();
    state.report.status = state.status;
    state.report.completedAt = state.completedAt;
    pushEvent(state, 'SIMULATION_COMPLETED', {});
    await storage.put(SIMULATION_REPORT_KEY, state.report);
  }
  await storage.put(SIMULATION_STATE_KEY, state);
  return publicState(state);
}

export async function completeHistoricalSimulation(storage) {
  const state = await storage.get(SIMULATION_STATE_KEY);
  if (!state) return publicState(null);
  if (state.status === 'RUNNING') {
    finalizeOpenTrades(state, 'END_OF_HISTORICAL_DATA');
    state.status = 'COMPLETED';
    state.completedAt = iso();
    state.report.status = state.status;
    state.report.completedAt = state.completedAt;
    pushEvent(state, 'SIMULATION_COMPLETED', {});
    await storage.put(SIMULATION_REPORT_KEY, state.report);
    await storage.put(SIMULATION_STATE_KEY, state);
  }
  return publicState(state);
}

export async function stopHistoricalSimulation(storage) {
  const state = await storage.get(SIMULATION_STATE_KEY);
  if (!state) return publicState(null);
  if (state.status === 'RUNNING') {
    finalizeOpenTrades(state, 'SIMULATION_STOPPED_BY_USER');
    state.status = 'STOPPED';
    state.stoppedAt = iso();
    state.report.status = state.status;
    state.report.stoppedAt = state.stoppedAt;
    pushEvent(state, 'SIMULATION_STOPPED', {});
    await storage.put(SIMULATION_REPORT_KEY, state.report);
    await storage.put(SIMULATION_STATE_KEY, state);
  }
  return publicState(state);
}

export async function readHistoricalSimulation(storage) {
  return publicState(await storage.get(SIMULATION_STATE_KEY));
}

export async function readHistoricalSimulationReport(storage) {
  const state = await storage.get(SIMULATION_STATE_KEY);
  const report = state?.report || await storage.get(SIMULATION_REPORT_KEY);
  return report || {
    schema: 'MOE.SandboxSimulationReport',
    schemaVersion: SIMULATION_VERSION,
    mode: 'SIMULATION',
    simulation: true,
    notRealMarketData: true,
    historicalDataOnly: true,
    broker: 'LOCAL_SIMULATOR_NO_WEBULL',
    webullRequestsMade: 0,
    status: 'NOT_AVAILABLE',
    selectedStrategies: [],
    byStrategy: {},
    trades: [],
  };
}
