import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExecutionQualitySnapshot } from '../src/trading-intelligence/execution-quality.js';
import { buildTradingIntelligenceSnapshot } from '../src/trading-intelligence/gauge-adapter.js';

function dataQuality(overrides = {}) {
  return {
    accepted: true,
    score: 94,
    source: 'ALPACA_IEX',
    dataDelaySeconds: 2,
    spreadPercent: 0.04,
    ...overrides,
  };
}

function orderFlow(overrides = {}) {
  return {
    dataMode: 'TRUE_ORDER_FLOW',
    quality: {
      classifiedVolumeShare: 0.88,
      classificationConfidence: 0.91,
      tradeIntensity: 125,
      latestQuoteAgeMs: 250,
      latestSpreadPercent: 0.04,
      averageTradeReportDelayMs: 180,
      maximumTradeReportDelayMs: 420,
      quoteCount: 40,
      tradeCount: 125,
      rejectedQuoteCount: 0,
      rejectedTradeCount: 1,
      ...overrides,
    },
  };
}

function gaugeItem(executionQuality) {
  return {
    symbol: 'AAPL',
    timeframe: '5m',
    evaluatedAt: '2026-07-26T16:00:00.000Z',
    direction: 'BULLISH',
    pipelineScore: 80,
    pipelinePassed: false,
    failedStage: 'STOP_RUN',
    reason: 'STOP_RUN_STAGE_REJECTED',
    diagnostics: {
      executionQuality,
    },
    stages: {
      STOP_RUN: { passed: false, status: 'REJECTED', score: 40, direction: 'BULLISH', failedConditions: ['NO_STOP_RUN'] },
      ABSORPTION: { passed: false, status: 'BLOCKED', score: 0, failedConditions: ['BLOCKED_BY_STOP_RUN_STAGE'] },
      IMBALANCE: { passed: false, status: 'BLOCKED', score: 0, failedConditions: ['BLOCKED_BY_ABSORPTION_STAGE'] },
      STRUCTURE_CONFIRMATION: { passed: false, status: 'BLOCKED', score: 0, failedConditions: ['BLOCKED_BY_IMBALANCE_STAGE'] },
      RISK_ENGINE: { passed: false, status: 'BLOCKED', score: 0, failedConditions: ['BLOCKED_BY_STRUCTURE_CONFIRMATION_STAGE'] },
    },
  };
}

test('scores strong execution conditions while preserving observation-only safety locks', () => {
  const result = buildExecutionQualitySnapshot({
    dataQuality: dataQuality(),
    orderFlow: orderFlow(),
    tradingMode: 'PAPER_TRADING',
    brokerConnectivity: 'CONNECTED',
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });

  assert.ok(result.score >= 80);
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.classification, 'HIGH_QUALITY');
  assert.equal(result.coveragePercent, 100);
  assert.ok(result.safetyBlockers.includes('OBSERVATION_ONLY'));
  assert.ok(result.safetyBlockers.includes('EXECUTION_PERMISSION_FALSE'));
  assert.equal(result.executionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
});

test('rejects unsafe spread stale quote and excessive slippage as market blockers', () => {
  const result = buildExecutionQualitySnapshot({
    dataQuality: dataQuality({ spreadPercent: 1.2 }),
    orderFlow: orderFlow({ latestSpreadPercent: 1.2, latestQuoteAgeMs: 5_000 }),
    brokerConnectivity: 'CONNECTED',
    observationOnly: false,
    executionAllowed: true,
    automaticSubmissionAllowed: true,
    liveExecutionAllowed: true,
    tradingMode: 'LIVE',
  });

  assert.equal(result.status, 'REJECTED');
  assert.ok(result.marketBlockers.includes('SPREAD_TOO_WIDE'));
  assert.ok(result.marketBlockers.includes('QUOTE_STALE'));
  assert.ok(result.marketBlockers.includes('ESTIMATED_SLIPPAGE_HIGH'));
});

test('keeps missing inputs explicit and does not fabricate unavailable components', () => {
  const result = buildExecutionQualitySnapshot({
    dataQuality: null,
    orderFlow: null,
    brokerConnectivity: 'UNAVAILABLE',
  });

  assert.equal(result.score, null);
  assert.equal(result.coveragePercent, 0);
  assert.equal(result.classification, 'INSUFFICIENT_COVERAGE');
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.components.every((component) => component.available === false), true);
});

test('execution gauge exposes score coverage and blockers without granting permission', () => {
  const executionQuality = buildExecutionQualitySnapshot({
    dataQuality: dataQuality(),
    orderFlow: orderFlow(),
    brokerConnectivity: 'UNAVAILABLE',
  });
  const snapshot = buildTradingIntelligenceSnapshot(gaugeItem(executionQuality));
  const gauge = snapshot.gauges.find((item) => item.id === 'execution-quality');

  assert.equal(gauge.status, 'BLOCKED');
  assert.ok(Number.isFinite(gauge.score));
  assert.equal(gauge.confidence, executionQuality.coveragePercent);
  assert.equal(gauge.blocksExecution, true);
  assert.match(gauge.summary, /coverage/i);
  assert.ok(gauge.blockers.includes('EXECUTION_PERMISSION_FALSE'));
  assert.equal(snapshot.tradeReadiness.executionPermission, false);
  assert.equal(snapshot.executionAllowed, false);
});
