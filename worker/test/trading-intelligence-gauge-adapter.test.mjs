import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTradingIntelligenceSnapshot } from '../src/trading-intelligence/gauge-adapter.js';
import { TRADING_GAUGE_REGISTRY } from '../src/trading-intelligence/gauge-registry.js';

function sample(overrides = {}) {
  return {
    symbol: 'AAPL',
    timeframe: '5m',
    contextTimeframe: '1h',
    evaluatedAt: '2026-07-26T15:00:00.000Z',
    direction: 'BULLISH',
    pipelineScore: 82,
    pipelinePassed: false,
    failedStage: 'STRUCTURE_CONFIRMATION',
    reason: 'STRUCTURE_CONFIRMATION_STAGE_REJECTED',
    dataMode: 'PROXY_ABSORPTION',
    diagnostics: {
      liquiditySweepScore: 88,
      liquiditySweepReason: 'SELL_SIDE_SWEEP_RECLAIMED',
      smartMoneyScore: 76,
      smartMoneyReason: 'OBSERVATION_ONLY',
      higherTimeframe: {
        timeframe: '1h',
        direction: 'LONG',
        bias: 'BULLISH',
        aligned: true,
        countertrend: false,
        structure: 'BULLISH',
        marketRegime: 'TRENDING_BULLISH',
        score: 84,
        rangeLocation: 0.41,
        atrPercent: 1.2,
        realizedVolatilityPercent: 1.8,
        evidence: ['HIGHER_TIMEFRAME_TREND_ALIGNED'],
        penalties: [],
      },
      marketRegime: 'TRENDING_BULLISH',
      dataQuality: {
        accepted: true,
        score: 91,
        source: 'ALPACA_IEX',
        session: 'REGULAR',
        normalizedAt: '2026-07-26T15:00:00.000Z',
        dataDelaySeconds: 2,
        missingBars: 0,
        zeroVolumeBars: 0,
        excludedIncompleteBars: 1,
        completedBars: 180,
        spreadPercent: 0.03,
        relativeVolume: 1.42,
        relativeVolumeMethod: 'RECENT_COMPLETED_CANDLE_LOOKBACK',
      },
    },
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

test('adapter exposes higher-timeframe regime RVOL and market-data quality', () => {
  const snapshot = buildTradingIntelligenceSnapshot(sample());
  const htf = snapshot.gauges.find((gauge) => gauge.id === 'higher-timeframe-bias');
  const regime = snapshot.gauges.find((gauge) => gauge.id === 'market-regime');
  const rvol = snapshot.gauges.find((gauge) => gauge.id === 'relative-volume');
  const data = snapshot.gauges.find((gauge) => gauge.id === 'data-quality');

  assert.equal(htf.status, 'CONFIRMED');
  assert.equal(htf.score, 84);
  assert.equal(htf.direction, 'LONG');
  assert.equal(htf.timeframe, '1h');
  assert.match(htf.summary, /BULLISH/);

  assert.equal(regime.status, 'CONFIRMED');
  assert.match(regime.summary, /TRENDING BULLISH/);

  assert.equal(rvol.status, 'CONFIRMED');
  assert.equal(rvol.score, 71);
  assert.match(rvol.summary, /1\.42/);

  assert.equal(data.status, 'CONFIRMED');
  assert.equal(data.score, 91);
  assert.equal(data.metadata.source, 'ALPACA_IEX');
  assert.equal(data.metadata.absorptionMode, 'PROXY_ABSORPTION');
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

test('missing context remains unavailable rather than fabricated', () => {
  const snapshot = buildTradingIntelligenceSnapshot(sample({ diagnostics: { smartMoneyScore: 70 } }));
  assert.equal(snapshot.gauges.find((gauge) => gauge.id === 'higher-timeframe-bias').status, 'UNAVAILABLE');
  assert.equal(snapshot.gauges.find((gauge) => gauge.id === 'market-regime').score, null);
  assert.equal(snapshot.gauges.find((gauge) => gauge.id === 'relative-volume').score, null);
  assert.equal(snapshot.gauges.find((gauge) => gauge.id === 'data-quality').status, 'UNAVAILABLE');
});
