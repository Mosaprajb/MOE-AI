import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTradingIntelligenceSnapshot } from '../src/trading-intelligence/gauge-adapter.js';
import { TRADING_GAUGE_REGISTRY } from '../src/trading-intelligence/gauge-registry.js';

function sample(overrides = {}) {
  return {
    symbol: 'AAPL',
    timeframe: '5m',
    evaluatedAt: '2026-07-26T15:00:00.000Z',
    direction: 'BULLISH',
    pipelineScore: 82,
    pipelinePassed: false,
    failedStage: 'STRUCTURE_CONFIRMATION',
    reason: 'STRUCTURE_CONFIRMATION_STAGE_REJECTED',
    dataMode: 'PROXY_ABSORPTION',
    diagnostics: { liquiditySweepScore: 88, liquiditySweepReason: 'SELL_SIDE_SWEEP_RECLAIMED', smartMoneyScore: 76, smartMoneyReason: 'OBSERVATION_ONLY' },
    stages: {
      STOP_RUN: { passed: true, status: 'PASSED', score: 90, direction: 'BULLISH', classification: 'STOP_RUN_REVERSAL', failedConditions: [] },
      ABSORPTION: { passed: true, status: 'PASSED', score: 78, direction: 'BULLISH', classification: 'PROBABLE_ABSORPTION', absorptionMode: 'PROXY_ABSORPTION', failedConditions: [] },
      IMBALANCE: { passed: true, status: 'PASSED', score: 83, direction: 'BULLISH', classification: 'PRICE_IMBALANCE', failedConditions: [] },
      STRUCTURE_CONFIRMATION: { passed: false, status: 'REJECTED', score: 48, direction: 'BULLISH', classification: 'WAITING_FOR_MSS', failedConditions: ['NO_CONFIRMED_STRUCTURE_EVENT'] },
      RISK_ENGINE: { passed: false, status: 'BLOCKED', score: 0, failedConditions: ['BLOCKED_BY_STRUCTURE_CONFIRMATION_STAGE'] },
    },
    ...overrides,
  };
}

test('registry keeps unique extensible gauge definitions', () => {
  const ids = TRADING_GAUGE_REGISTRY.map((item) => item.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('trade-readiness') === false);
  assert.ok(ids.includes('data-quality'));
  assert.ok(ids.includes('execution-quality'));
});

test('adapter maps real stages and preserves unavailable engines honestly', () => {
  const snapshot = buildTradingIntelligenceSnapshot(sample());
  assert.equal(snapshot.symbol, 'AAPL');
  assert.equal(snapshot.direction, 'LONG');
  assert.equal(snapshot.tradeReadiness.score, 82);
  assert.equal(snapshot.tradeReadiness.status, 'WAITING_FOR_CONFIRMATION');
  assert.equal(snapshot.executionAllowed, false);
  assert.equal(snapshot.liveExecutionAllowed, false);

  const stopRun = snapshot.gauges.find((gauge) => gauge.id === 'stop-run');
  assert.equal(stopRun.status, 'CONFIRMED');
  assert.equal(stopRun.score, 90);
  assert.equal(stopRun.direction, 'LONG');
  assert.equal(stopRun.contribution, 18);

  const structure = snapshot.gauges.find((gauge) => gauge.id === 'market-structure');
  assert.equal(structure.status, 'REJECTED');
  assert.deepEqual(structure.blockers, ['NO_CONFIRMED_STRUCTURE_EVENT']);
  assert.equal(structure.blocksExecution, true);

  const smt = snapshot.gauges.find((gauge) => gauge.id === 'smt-divergence');
  assert.equal(smt.status, 'UNAVAILABLE');
  assert.equal(smt.score, null);
  assert.equal(smt.blocksExecution, false);

  const execution = snapshot.gauges.find((gauge) => gauge.id === 'execution-quality');
  assert.equal(execution.status, 'UNAVAILABLE');
  assert.equal(execution.blocksExecution, true);
});

test('mandatory blockers override a high score', () => {
  const snapshot = buildTradingIntelligenceSnapshot(sample({ pipelineScore: 97 }));
  assert.equal(snapshot.tradeReadiness.score, 97);
  assert.equal(snapshot.tradeReadiness.status, 'WAITING_FOR_CONFIRMATION');
  assert.equal(snapshot.tradeReadiness.executionPermission, false);
  assert.ok(snapshot.tradeReadiness.blockers.includes('market-structure'));
  assert.ok(snapshot.tradeReadiness.blockers.includes('risk-quality'));
  assert.ok(snapshot.tradeReadiness.blockers.includes('execution-quality'));
});

test('true order flow maps to full data quality while proxy remains labeled', () => {
  const trueFlow = buildTradingIntelligenceSnapshot(sample({ dataMode: 'TRUE_ORDER_FLOW' }));
  const trueData = trueFlow.gauges.find((gauge) => gauge.id === 'data-quality');
  assert.equal(trueData.score, 100);
  assert.match(trueData.summary, /True trade-level/);

  const proxy = buildTradingIntelligenceSnapshot(sample());
  const proxyData = proxy.gauges.find((gauge) => gauge.id === 'data-quality');
  assert.equal(proxyData.score, 65);
  assert.match(proxyData.summary, /proxy mode/i);
});
