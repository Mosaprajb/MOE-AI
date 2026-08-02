import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MOERAND_CLEAN_STRATEGY_ID,
  evaluateMoerandClean,
} from '../src/strategies/moerand-clean.js';
import { getStrategyDefinition, STRATEGY_IDS } from '../src/strategy/strategy-registry.js';
import { runMoerandCleanStrategy } from '../src/simulation/moerand-clean-strategy.js';

const FIVE_MINUTES = 5 * 60_000;
const SETTINGS = Object.freeze({
  trendLen: 2,
  breakoutLen: 2,
  minRvol: 1.2,
  rvolPeriod: 2,
  atrPeriod: 2,
  atrMult: 1,
  enableBreakeven: true,
  sessionWindow: '0930-1000',
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

function nextDay(time, values) {
  return { ...at(time, values), t: Date.parse(`2026-08-04T${time}:00.000Z`) };
}

function baseBars() {
  return [
    at('13:30', { o: 99.8, h: 100.5, l: 99.5, c: 100, v: 100 }),
    at('13:35', { o: 100, h: 101.5, l: 99.9, c: 101, v: 100 }),
  ];
}

function evaluateAll(bars, previousState = {}, settings = SETTINGS) {
  return evaluateMoerandClean(bars, settings, {
    previousState,
    allCandlesClosed: true,
    now: bars.at(-1).t + FIVE_MINUTES,
  });
}

function warmState(bars = baseBars()) {
  const first = evaluateAll([bars[0]]);
  return evaluateAll(bars, first.state).state;
}

test('registry exposes MOERAND_CLEAN_INTERNAL as an independent configurable INTERNAL_PIPELINE strategy', () => {
  const definition = getStrategyDefinition(STRATEGY_IDS.MOERAND_CLEAN_INTERNAL, {
    MOERAND_CLEAN_TREND_LEN: '60',
    MOERAND_CLEAN_MIN_RVOL: '1.5',
    MOE_STRATEGY_MOERAND_CLEAN_INTERNAL_MAX_DAILY_TRADES: '3',
  });
  assert.equal(definition.id, MOERAND_CLEAN_STRATEGY_ID);
  assert.equal(definition.sourceType, 'INTERNAL_PIPELINE');
  assert.equal(definition.badgeColor, 'PURPLE');
  assert.equal(definition.independentPipeline, true);
  assert.equal(definition.fusionInteraction, 'NONE');
  assert.equal(definition.settings.trendLen, 60);
  assert.equal(definition.settings.minRvol, 1.5);
  assert.equal(definition.maxDailyTrades, 3);
});

test('entry requires trend, prior-window breakout, and relative-volume gates together', () => {
  const history = baseBars();
  const state = warmState(history);

  const passing = evaluateAll([
    ...history,
    at('13:40', { o: 101, h: 102.5, l: 100.9, c: 102, v: 300 }),
  ], state);
  assert.equal(passing.signal, 'BUY');
  assert.equal(passing.diagnostics.trendPassed, true);
  assert.equal(passing.diagnostics.breakoutPassed, true);
  assert.equal(passing.diagnostics.rvolPassed, true);

  const breakoutFail = evaluateAll([
    ...history,
    at('13:40', { o: 101, h: 101.6, l: 100.9, c: 101.4, v: 300 }),
  ], state);
  assert.equal(breakoutFail.signal, 'NONE');
  assert.equal(breakoutFail.diagnostics.trendPassed, true);
  assert.equal(breakoutFail.diagnostics.breakoutPassed, false);
  assert.equal(breakoutFail.diagnostics.rvolPassed, true);

  const rvolFail = evaluateAll([
    ...history,
    at('13:40', { o: 101, h: 102.5, l: 100.9, c: 102, v: 100 }),
  ], state);
  assert.equal(rvolFail.signal, 'NONE');
  assert.equal(rvolFail.diagnostics.trendPassed, true);
  assert.equal(rvolFail.diagnostics.breakoutPassed, true);
  assert.equal(rvolFail.diagnostics.rvolPassed, false);

  const longTrendHistory = [
    at('13:30', { o: 199, h: 201, l: 198, c: 200, v: 100 }),
    at('13:35', { o: 189, h: 191, l: 188, c: 190, v: 100 }),
    at('13:40', { o: 99, h: 100, l: 98, c: 99, v: 100 }),
    at('13:45', { o: 100, h: 101, l: 99, c: 100, v: 100 }),
  ];
  const trendSettings = { ...SETTINGS, trendLen: 5, sessionWindow: '0930-1030' };
  const trendState = warmState(longTrendHistory, trendSettings);
  const trendFail = evaluateAll([
    ...longTrendHistory,
    at('13:50', { o: 100, h: 103, l: 99.8, c: 102, v: 300 }),
  ], trendState, trendSettings);
  assert.equal(trendFail.signal, 'NONE');
  assert.equal(trendFail.diagnostics.trendPassed, false);
  assert.equal(trendFail.diagnostics.breakoutPassed, true);
  assert.equal(trendFail.diagnostics.rvolPassed, true);
});

test('trailing stop only moves upward', () => {
  const history = baseBars();
  const entered = evaluateAll([
    ...history,
    at('13:40', { o: 101, h: 102.5, l: 100.9, c: 102, v: 300 }),
  ], warmState(history));
  assert.equal(entered.signal, 'BUY');

  const raised = evaluateAll([
    ...history,
    at('13:40', { o: 101, h: 102.5, l: 100.9, c: 102, v: 300 }),
    at('13:45', { o: 102, h: 104.2, l: 101.9, c: 104, v: 150 }),
  ], entered.state);
  assert.equal(raised.signal, 'NONE');
  assert.ok(raised.stopLevel > entered.stopLevel);

  const held = evaluateAll([
    ...history,
    at('13:40', { o: 101, h: 102.5, l: 100.9, c: 102, v: 300 }),
    at('13:45', { o: 102, h: 104.2, l: 101.9, c: 104, v: 150 }),
    at('13:50', { o: 104, h: 108, l: 101.8, c: 103.9, v: 150 }),
  ], raised.state);
  assert.equal(held.signal, 'NONE');
  assert.ok(held.stopLevel >= raised.stopLevel);
});

test('breakeven lock is permanent and the stop never falls below entry afterward', () => {
  const bars = [
    ...baseBars(),
    at('13:40', { o: 101, h: 103, l: 100.8, c: 102.5, v: 200 }),
  ];
  const previousState = {
    inPosition: true,
    entryPrice: 100,
    stopLevel: 98,
    initialRisk: 2,
    breakevenLocked: false,
    sessionKey: '2026-08-03',
    sessionBarsCompleted: 2,
    lastEvaluatedBarTime: bars[1].t,
  };
  const locked = evaluateAll(bars, previousState);
  assert.equal(locked.breakevenLocked, true);
  assert.ok(locked.stopLevel >= 100);

  const later = evaluateAll([
    ...bars,
    at('13:45', { o: 102.5, h: 107, l: 100.5, c: 101.5, v: 100 }),
  ], locked.state);
  assert.equal(later.breakevenLocked, true);
  assert.ok(later.stopLevel >= 100);
});

test('new regular session hard-resets all position and breakeven state', () => {
  const previousState = {
    inPosition: true,
    entryPrice: 100,
    stopLevel: 101,
    initialRisk: 2,
    breakevenLocked: true,
    sessionKey: '2026-08-03',
    sessionBarsCompleted: 5,
    lastEvaluatedBarTime: Date.parse('2026-08-03T13:55:00.000Z'),
  };
  const firstBar = nextDay('13:30', { o: 120, h: 125, l: 119, c: 124, v: 1000 });
  const result = evaluateAll([firstBar], previousState);
  assert.equal(result.signal, 'NONE');
  assert.equal(result.state.inPosition, false);
  assert.equal(result.entryPrice, null);
  assert.equal(result.stopLevel, null);
  assert.equal(result.state.initialRisk, null);
  assert.equal(result.breakevenLocked, false);
  assert.equal(result.state.sessionBarsCompleted, 1);
});

test('the first bar of a session can never generate an entry', () => {
  const firstBar = at('13:30', { o: 100, h: 110, l: 99, c: 109, v: 1000 });
  const result = evaluateAll([firstBar], {});
  assert.equal(result.signal, 'NONE');
  assert.equal(result.diagnostics.firstSessionBar, true);
});

test('the final regular-session bar forces a distinctly tagged close', () => {
  const history = [
    ...baseBars(),
    at('13:40', { o: 101, h: 102, l: 100, c: 101.5, v: 100 }),
    at('13:45', { o: 101.5, h: 103, l: 101, c: 102.5, v: 100 }),
    at('13:50', { o: 102.5, h: 104, l: 102, c: 103.5, v: 100 }),
  ];
  const finalBar = at('13:55', { o: 103.5, h: 104, l: 103, c: 103.8, v: 100 });
  const result = evaluateAll([...history, finalBar], {
    inPosition: true,
    entryPrice: 100,
    stopLevel: 98,
    initialRisk: 2,
    breakevenLocked: false,
    sessionKey: '2026-08-03',
    sessionBarsCompleted: 5,
    lastEvaluatedBarTime: history.at(-1).t,
  });
  assert.equal(result.signal, 'SELL');
  assert.equal(result.exitReason, 'SESSION_END_FORCED_CLOSE');
  assert.equal(result.exitPrice, finalBar.c);
  assert.equal(result.state.inPosition, false);
});

test('still-forming candle is excluded and simulation adapter remains independently tagged', () => {
  const history = baseBars();
  const forming = at('13:40', { o: 101, h: 103, l: 100.8, c: 102.5, v: 300 });
  const state = warmState(history);
  const live = evaluateMoerandClean([...history, forming], SETTINGS, {
    previousState: state,
    now: forming.t + FIVE_MINUTES - 1,
  });
  assert.equal(live.signal, 'NONE');
  assert.notEqual(live.state.lastEvaluatedBarTime, forming.t);

  const simulated = runMoerandCleanStrategy({
    symbol: 'TEST',
    bars: [...history, forming],
    previousState: state,
    env: {
      MOERAND_CLEAN_TREND_LEN: '2',
      MOERAND_CLEAN_BREAKOUT_LEN: '2',
      MOERAND_CLEAN_RVOL_PERIOD: '2',
      MOERAND_CLEAN_MIN_RVOL: '1.2',
      MOERAND_CLEAN_ATR_PERIOD: '2',
      MOERAND_CLEAN_SESSION_WINDOW: '0930-1000',
    },
    simulatedAt: forming.t,
  });
  assert.equal(simulated.strategy, MOERAND_CLEAN_STRATEGY_ID);
  assert.equal(simulated.sourceType, 'INTERNAL_PIPELINE');
  assert.equal(simulated.opportunity.metadata.sourceStrategy, MOERAND_CLEAN_STRATEGY_ID);
  assert.equal(simulated.opportunity.metadata.strategyBadge, 'PURPLE');
});
