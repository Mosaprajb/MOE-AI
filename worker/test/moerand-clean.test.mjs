import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOERAND_CLEAN_STRATEGY_ID,
  evaluateMoerandClean,
  normalizeMoerandCleanSettings,
} from '../src/strategies/moerand-clean.js';
import { getStrategyDefinition, STRATEGY_IDS } from '../src/strategy/strategy-registry.js';
import { runMoerandCleanStrategy } from '../src/simulation/moerand-clean-strategy.js';

const FIVE_MINUTES = 5 * 60_000;
const SETTINGS = Object.freeze({
  keyValue: 1,
  atrPeriod: 1,
  useHeikinAshi: false,
  sessionWindow: '0930-1600',
  sessionTimezone: 'America/New_York',
  timeframeMinutes: 5,
});

function at(time, { o, h, l, c, v = 100, closed = true }) {
  return {
    t: Date.parse(`2026-08-03T${time}:00.000Z`),
    o,
    h,
    l,
    c,
    v,
    closed,
  };
}

function signalBars() {
  return [
    at('13:30', { o: 99, h: 101, l: 99, c: 100 }),
    at('13:35', { o: 100, h: 100, l: 96, c: 97 }),
    at('13:40', { o: 97, h: 103, l: 97, c: 102 }),
    at('13:45', { o: 102, h: 102, l: 94, c: 95 }),
  ];
}

function evaluateAll(bars, previousState = {}, settings = SETTINGS, context = {}) {
  return evaluateMoerandClean(bars, settings, {
    previousState,
    allCandlesClosed: true,
    now: bars.at(-1).t + settings.timeframeMinutes * 60_000,
    ...context,
  });
}

test('registry exposes UT Bot style Clean settings with a 1 to 15 minute timeframe', () => {
  const definition = getStrategyDefinition(STRATEGY_IDS.MOERAND_CLEAN_INTERNAL, {
    MOERAND_CLEAN_KEY_VALUE: '1.7',
    MOERAND_CLEAN_ATR_PERIOD: '4',
    MOERAND_CLEAN_USE_HEIKIN_ASHI: 'true',
    MOERAND_CLEAN_TIMEFRAME_MINUTES: '15',
    MOE_STRATEGY_MOERAND_CLEAN_INTERNAL_MAX_DAILY_TRADES: '3',
  });
  assert.equal(definition.id, MOERAND_CLEAN_STRATEGY_ID);
  assert.equal(definition.sourceType, 'INTERNAL_PIPELINE');
  assert.equal(definition.badgeColor, 'PURPLE');
  assert.equal(definition.independentPipeline, true);
  assert.equal(definition.fusionInteraction, 'NONE');
  assert.equal(definition.settings.keyValue, 1.7);
  assert.equal(definition.settings.atrPeriod, 4);
  assert.equal(definition.settings.useHeikinAshi, true);
  assert.equal(definition.settings.timeframeMinutes, 15);
  assert.equal(definition.maxDailyTrades, 3);
});

test('settings normalize legacy ATR multiplier and clamp the selectable timeframe to 1 through 15', () => {
  const normalized = normalizeMoerandCleanSettings({
    atrMult: 2.5,
    atrPeriod: 0,
    timeframeMinutes: 99,
    signalsFromHeikinAshi: 'true',
  });
  assert.equal(normalized.keyValue, 2.5);
  assert.equal(normalized.atrMult, 2.5);
  assert.equal(normalized.atrPeriod, 1);
  assert.equal(normalized.timeframeMinutes, 15);
  assert.equal(normalized.useHeikinAshi, true);
});

test('BUY and SELL are emitted from UT Bot crossovers only on completed candles', () => {
  const bars = signalBars();
  const beforeClose = evaluateMoerandClean(bars.slice(0, 3), SETTINGS, {
    now: bars[2].t + FIVE_MINUTES - 1,
  });
  assert.equal(beforeClose.signal, 'NONE');
  assert.notEqual(beforeClose.state.lastEvaluatedBarTime, bars[2].t);

  const buy = evaluateAll(bars.slice(0, 3));
  assert.equal(buy.signal, 'BUY');
  assert.equal(buy.signalBarTime, bars[2].t);
  assert.equal(buy.entryPrice, 102);
  assert.equal(buy.diagnostics.crossedAbove, true);
  assert.equal(buy.diagnostics.signalTiming, 'CANDLE_CLOSE_ONLY');
  assert.equal(buy.diagnostics.fullyClosedOnly, true);

  const sell = evaluateAll(bars, buy.state);
  assert.equal(sell.signal, 'SELL');
  assert.equal(sell.signalBarTime, bars[3].t);
  assert.equal(sell.exitReason, 'UT_BOT_CLOSED_BAR_SELL');
  assert.equal(sell.exitPrice, 95);
  assert.equal(sell.diagnostics.crossedBelow, true);
  assert.equal(sell.state.inPosition, false);
});

test('the same closed candle is never evaluated twice', () => {
  const bars = signalBars().slice(0, 3);
  const first = evaluateAll(bars);
  assert.equal(first.signal, 'BUY');
  const repeated = evaluateAll(bars, first.state);
  assert.equal(repeated.signal, 'NONE');
  assert.equal(repeated.diagnostics.status, 'NO_NEW_CLOSED_BAR');
});

test('Heikin Ashi option changes the signal source while ATR remains available', () => {
  const bars = [
    at('13:30', { o: 100, h: 104, l: 96, c: 101 }),
    at('13:35', { o: 101, h: 105, l: 98, c: 99 }),
    at('13:40', { o: 99, h: 108, l: 98, c: 107 }),
  ];
  const result = evaluateAll(bars, {}, { ...SETTINGS, useHeikinAshi: true });
  assert.equal(result.diagnostics.candleSource, 'HEIKIN_ASHI_CLOSE');
  assert.notEqual(result.diagnostics.sourcePrice, result.diagnostics.close);
  assert.ok(Number.isFinite(result.diagnostics.atr));
});

test('one-minute source bars aggregate to the selected timeframe and wait for the full candle close', () => {
  const start = Date.parse('2026-08-03T13:30:00.000Z');
  const oneMinuteBars = Array.from({ length: 6 }, (_, index) => ({
    t: start + index * 60_000,
    o: 100 + index,
    h: 101 + index,
    l: 99 + index,
    c: 100.5 + index,
    v: 100,
    closed: true,
  }));
  const settings = { ...SETTINGS, timeframeMinutes: 3 };
  const beforeSecondClose = evaluateMoerandClean(oneMinuteBars, settings, {
    now: start + 6 * 60_000 - 1,
  });
  assert.equal(beforeSecondClose.state.sessionBarsCompleted, 1);
  assert.equal(beforeSecondClose.diagnostics.timeframeMinutes, 3);
  assert.equal(beforeSecondClose.diagnostics.sourceResolutionMinutes, 1);

  const afterSecondClose = evaluateMoerandClean(oneMinuteBars, settings, {
    previousState: beforeSecondClose.state,
    now: start + 6 * 60_000,
  });
  assert.equal(afterSecondClose.state.sessionBarsCompleted, 2);
  assert.equal(afterSecondClose.state.lastEvaluatedBarTime, start + 3 * 60_000);
});

test('a coarser input feed is rejected instead of pretending it is a faster timeframe', () => {
  const result = evaluateAll(signalBars().slice(0, 3), {}, { ...SETTINGS, timeframeMinutes: 1 });
  assert.equal(result.signal, 'NONE');
  assert.equal(result.diagnostics.status, 'SOURCE_RESOLUTION_TOO_COARSE');
  assert.equal(result.diagnostics.sourceResolutionMinutes, 5);
});

test('the final regular-session candle closes an open position after that candle closes', () => {
  const finalBar = at('19:55', { o: 102, h: 103, l: 101, c: 102.5 });
  const result = evaluateAll([finalBar], {
    inPosition: true,
    entryPrice: 100,
    stopLevel: 98,
    initialRisk: 2,
    sessionKey: '2026-08-03',
    sessionBarsCompleted: 20,
    lastEvaluatedBarTime: Date.parse('2026-08-03T19:50:00.000Z'),
  });
  assert.equal(result.signal, 'SELL');
  assert.equal(result.exitReason, 'SESSION_END_FORCED_CLOSE');
  assert.equal(result.exitPrice, 102.5);
});

test('simulation adapter identifies UT Bot close-only behavior and never enables real execution', () => {
  const bars = signalBars().slice(0, 3);
  const simulated = runMoerandCleanStrategy({
    symbol: 'TEST',
    bars,
    previousState: {},
    env: {
      MOERAND_CLEAN_KEY_VALUE: '1',
      MOERAND_CLEAN_ATR_PERIOD: '1',
      MOERAND_CLEAN_USE_HEIKIN_ASHI: 'false',
      MOERAND_CLEAN_TIMEFRAME_MINUTES: '5',
    },
    simulatedAt: bars.at(-1).t,
  });
  assert.equal(simulated.strategy, MOERAND_CLEAN_STRATEGY_ID);
  assert.equal(simulated.sourceType, 'INTERNAL_PIPELINE');
  assert.equal(simulated.opportunity.metadata.sourceStrategy, MOERAND_CLEAN_STRATEGY_ID);
  assert.equal(simulated.opportunity.metadata.setupFamily, 'MOERAND_CLEAN_UT_BOT_ATR');
  assert.equal(simulated.opportunity.metadata.signalTiming, 'CANDLE_CLOSE_ONLY');
  assert.equal(simulated.opportunity.executionEnabled, false);
  assert.equal(simulated.opportunity.liveExecutionAllowed, false);
});
