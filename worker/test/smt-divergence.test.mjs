import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmtDivergenceConfig, evaluateSmtDivergence } from '../src/trading-intelligence/smt-divergence.js';
import { buildTradingIntelligenceSnapshot } from '../src/trading-intelligence/gauge-adapter.js';

function pairedBars({ type = 'BULLISH', inverse = false } = {}) {
  const primary = [];
  const comparison = [];
  const start = Date.parse('2026-07-24T13:30:00.000Z');
  for (let index = 0; index < 50; index += 1) {
    const base = 100 + index * 0.12 + Math.sin(index / 3) * 0.2;
    const comparisonBase = inverse ? 220 - index * 0.24 : 200 + index * 0.24 + Math.sin(index / 3) * 0.4;
    primary.push({
      t: start + index * 300_000,
      o: base - 0.05,
      h: base + 0.25,
      l: base - 0.25,
      c: base,
      v: 1000 + index,
    });
    comparison.push({
      t: start + index * 300_000,
      o: comparisonBase - 0.1,
      h: comparisonBase + 0.5,
      l: comparisonBase - 0.5,
      c: comparisonBase,
      v: 2000 + index,
    });
  }

  if (type === 'BULLISH') {
    primary[30].l = 92;
    primary[45].l = 90;
    comparison[30].l = 184;
    comparison[45].l = 185;
  } else {
    primary[30].h = 112;
    primary[45].h = 115;
    comparison[30].h = 224;
    comparison[45].h = 223;
  }
  return { primary, comparison };
}

function config(overrides = {}) {
  return createSmtDivergenceConfig({
    SMT_MINIMUM_BARS: '30',
    SMT_CORRELATION_LOOKBACK: '50',
    SMT_MINIMUM_CORRELATION: '0.4',
    SMT_SWING_WINDOW: '2',
    SMT_MAXIMUM_EVENT_AGE_BARS: '8',
    SMT_MINIMUM_PRIMARY_BREAK_PERCENT: '0.05',
    SMT_COMPARISON_TOLERANCE_PERCENT: '0.02',
    SMT_MINIMUM_DIVERGENCE_MAGNITUDE_PERCENT: '0.08',
    ...overrides,
  });
}

function gaugeItem(smtDivergence) {
  return {
    symbol: 'AAPL',
    timeframe: '5m',
    evaluatedAt: '2026-07-26T15:00:00.000Z',
    direction: 'BULLISH',
    pipelineScore: 72,
    pipelinePassed: false,
    failedStage: 'ABSORPTION',
    reason: 'ABSORPTION_STAGE_REJECTED',
    dataMode: 'PROXY_ABSORPTION',
    diagnostics: { smtDivergence },
    stages: {
      STOP_RUN: { passed: true, status: 'PASSED', score: 82, direction: 'BULLISH', failedConditions: [] },
      ABSORPTION: { passed: false, status: 'REJECTED', score: 60, direction: 'BULLISH', failedConditions: ['ABSORPTION_SCORE_BELOW_MINIMUM'] },
      IMBALANCE: { passed: false, status: 'BLOCKED', score: 0, failedConditions: ['BLOCKED_BY_ABSORPTION_STAGE'] },
      STRUCTURE_CONFIRMATION: { passed: false, status: 'BLOCKED', score: 0, failedConditions: ['BLOCKED_BY_IMBALANCE_STAGE'] },
      RISK_ENGINE: { passed: false, status: 'BLOCKED', score: 0, failedConditions: ['BLOCKED_BY_STRUCTURE_CONFIRMATION_STAGE'] },
    },
  };
}

test('detects bullish SMT when primary makes a lower low and comparison does not', () => {
  const bars = pairedBars({ type: 'BULLISH' });
  const result = evaluateSmtDivergence({
    primarySymbol: 'AAPL',
    comparisonSymbol: 'SPY',
    primaryBars: bars.primary,
    comparisonBars: bars.comparison,
    timeframe: '5m',
    config: config(),
  });
  assert.equal(result.classification, 'BULLISH_SMT_DIVERGENCE');
  assert.equal(result.status, 'CONFIRMED');
  assert.equal(result.direction, 'LONG');
  assert.equal(result.detected, true);
  assert.ok(result.correlation >= 0.4);
  assert.ok(result.score > 0);
  assert.equal(result.executionAllowed, false);
});

test('detects bearish SMT when primary makes a higher high and comparison does not', () => {
  const bars = pairedBars({ type: 'BEARISH' });
  const result = evaluateSmtDivergence({
    primarySymbol: 'MSFT',
    comparisonSymbol: 'QQQ',
    primaryBars: bars.primary,
    comparisonBars: bars.comparison,
    timeframe: '5m',
    config: config(),
  });
  assert.equal(result.classification, 'BEARISH_SMT_DIVERGENCE');
  assert.equal(result.direction, 'SHORT');
  assert.equal(result.detected, true);
});

test('rejects SMT interpretation when pair correlation breaks down', () => {
  const bars = pairedBars({ type: 'BULLISH', inverse: true });
  const result = evaluateSmtDivergence({
    primarySymbol: 'AAPL',
    comparisonSymbol: 'SPY',
    primaryBars: bars.primary,
    comparisonBars: bars.comparison,
    timeframe: '5m',
    config: config(),
  });
  assert.equal(result.classification, 'CORRELATION_BREAKDOWN');
  assert.equal(result.status, 'CONFLICTING');
  assert.equal(result.detected, false);
  assert.ok(result.failedConditions.includes('PAIR_CORRELATION_BELOW_MINIMUM'));
});

test('returns unavailable instead of inventing divergence with insufficient aligned bars', () => {
  const bars = pairedBars();
  const result = evaluateSmtDivergence({
    primarySymbol: 'AAPL',
    comparisonSymbol: 'SPY',
    primaryBars: bars.primary.slice(0, 10),
    comparisonBars: bars.comparison.slice(0, 10),
    timeframe: '5m',
    config: config(),
  });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.score, null);
  assert.equal(result.detected, false);
});

test('maps confirmed SMT into an optional scored gauge without changing execution permission', () => {
  const bars = pairedBars({ type: 'BULLISH' });
  const smt = evaluateSmtDivergence({
    primarySymbol: 'AAPL',
    comparisonSymbol: 'SPY',
    primaryBars: bars.primary,
    comparisonBars: bars.comparison,
    timeframe: '5m',
    config: config(),
  });
  const snapshot = buildTradingIntelligenceSnapshot(gaugeItem(smt));
  const gauge = snapshot.gauges.find((item) => item.id === 'smt-divergence');
  assert.equal(gauge.status, 'CONFIRMED');
  assert.equal(gauge.direction, 'LONG');
  assert.ok(gauge.score > 0);
  assert.equal(gauge.mandatory, false);
  assert.equal(gauge.blocksExecution, false);
  assert.equal(snapshot.executionAllowed, false);
  assert.equal(snapshot.tradeReadiness.executionPermission, false);
});
