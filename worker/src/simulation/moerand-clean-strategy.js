import { getStrategyDefinition } from '../strategy/strategy-registry.js';
import {
  MOERAND_CLEAN_STRATEGY_ID,
  evaluateMoerandClean,
} from '../strategies/moerand-clean.js';

export { MOERAND_CLEAN_STRATEGY_ID };

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function roundPrice(value) {
  return Number(finite(value).toFixed(4));
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

export function runMoerandCleanStrategy({
  symbol,
  bars,
  previousState = {},
  env = {},
  settings = null,
  simulatedAt = Date.now(),
} = {}) {
  const definition = getStrategyDefinition(MOERAND_CLEAN_STRATEGY_ID, env);
  const configuration = settings && typeof settings === 'object'
    ? { ...definition.settings, ...settings }
    : definition.settings;
  const evaluated = evaluateMoerandClean(bars, configuration, {
    previousState,
    now: simulatedAt + configuration.timeframeMinutes * 60_000,
    allCandlesClosed: true,
  });

  const buySignal = evaluated.signal === 'BUY';
  const sellSignal = evaluated.signal === 'SELL';
  const entry = evaluated.entryPrice;
  const opportunity = buySignal
    ? {
      id: `SIM-MOERAND-CLEAN-${symbol}-${evaluated.signalBarTime}`,
      symbol,
      direction: 'LONG',
      timeframe: `${configuration.timeframeMinutes}m`,
      score: 80,
      confidence: { value: 80, source: MOERAND_CLEAN_STRATEGY_ID },
      entry: roundPrice(entry),
      stopLoss: roundPrice(evaluated.stopLevel),
      // The common simulator schema requires a target. UT Bot exits from its closed-bar
      // SELL instruction, so the generic target remains unreachable.
      takeProfit: Number.MAX_SAFE_INTEGER,
      createdAt: iso(simulatedAt),
      validForMs: Math.max(60_000, configuration.timeframeMinutes * 60_000),
      reasons: ['UT_BOT_ATR_CLOSED_BAR_CROSSOVER'],
      metadata: {
        setupFamily: 'MOERAND_CLEAN_UT_BOT_ATR',
        strategyId: MOERAND_CLEAN_STRATEGY_ID,
        sourceStrategy: MOERAND_CLEAN_STRATEGY_ID,
        sourceType: definition.sourceType,
        strategyBadge: definition.badgeColor,
        simulation: true,
        notRealMarketData: true,
        historicalBarTime: iso(evaluated.signalBarTime),
        fullyClosedBarOnly: true,
        signalTiming: 'CANDLE_CLOSE_ONLY',
        candleSource: configuration.useHeikinAshi ? 'HEIKIN_ASHI_CLOSE' : 'REGULAR_CLOSE',
        timeframeMinutes: configuration.timeframeMinutes,
        keyValue: configuration.keyValue,
        atrPeriod: configuration.atrPeriod,
        dynamicTrailingStop: true,
        fixedTargetEnabled: false,
        initialRisk: evaluated.initialRisk,
        initialStopLevel: evaluated.stopLevel,
        configuration,
      },
      observationOnly: true,
      executionEnabled: false,
      executionAllowed: false,
      liveExecutionAllowed: false,
    }
    : null;

  const closeInstruction = sellSignal
    ? {
      strategy: MOERAND_CLEAN_STRATEGY_ID,
      symbol,
      price: roundPrice(evaluated.exitPrice),
      reason: evaluated.exitReason,
      simulatedAt: iso(evaluated.signalBarTime),
      immediate: false,
      closeBased: true,
      executeAfterBarClose: true,
    }
    : null;

  return {
    strategy: MOERAND_CLEAN_STRATEGY_ID,
    sourceType: definition.sourceType,
    detected: buySignal,
    accepted: buySignal,
    opportunity,
    rejection: null,
    closeInstruction,
    stopLevel: evaluated.stopLevel,
    entryPrice: evaluated.entryPrice,
    breakevenLocked: false,
    exitReason: evaluated.exitReason,
    nextState: evaluated.state,
    diagnostics: {
      ...evaluated.diagnostics,
      signal: evaluated.signal,
      stopLevel: evaluated.stopLevel,
      entryPrice: evaluated.entryPrice,
      initialRisk: evaluated.initialRisk,
      breakevenLocked: false,
      exitReason: evaluated.exitReason,
      sourceType: definition.sourceType,
      strategyBadge: definition.badgeColor,
    },
  };
}
