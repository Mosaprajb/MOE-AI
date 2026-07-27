import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIQUIDITY_SWEEP_ENGINE_ID,
  adaptLiquiditySweepResult,
} from '../src/core/liquidity-sweep-adapter.js';

function paperCandidate(overrides = {}) {
  return {
    tradeDecision: 'PAPER_CANDIDATE',
    symbol: 'AAPL',
    strategyVersion: '1.0.0',
    executionTimeframe: '5m',
    contextTimeframe: '1h',
    evaluatedAt: '2026-07-27T15:00:00.000Z',
    setup: {
      setupId: 'setup_test_001',
      symbol: 'AAPL',
      direction: 'LONG',
      executionTimeframe: '5m',
      contextTimeframe: '1h',
      createdAt: 1785164400000,
      updatedAt: 1785164400000,
      tradePlan: {
        entry: 200,
        stopLoss: 198,
        takeProfit: 204,
        rewardToRisk: 2,
      },
    },
    liquiditySweep: {
      sweepId: 'sweep_test_001',
      direction: 'LONG',
      classification: 'CONFIRMED_LIQUIDITY_SWEEP',
      acceptanceScore: 15,
      rejectionScore: 85,
      evidence: ['SELL_SIDE_LIQUIDITY_RECLAIMED'],
    },
    sweepClassification: 'CONFIRMED_LIQUIDITY_SWEEP',
    acceptanceScore: 15,
    rejectionScore: 85,
    tradePlan: {
      entry: 200,
      stopLoss: 198,
      takeProfit: 204,
      rewardToRisk: 2,
    },
    liquiditySweepScore: 88,
    quality: {
      total: 88,
      approved: true,
      reasons: ['QUALITY_THRESHOLD_PASSED'],
    },
    explanation: {
      acceptanceReasons: ['RECLAIM_CONFIRMED'],
      supportingReasons: ['HIGHER_TIMEFRAME_ALIGNED'],
    },
    confirmation: { passed: true },
    higherTimeframe: { aligned: true },
    diagnostics: [],
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    mode: 'PAPER_TRADING',
    ...overrides,
  };
}

test('adapts PAPER_CANDIDATE into accepted engine result and opportunity', () => {
  const adapted = adaptLiquiditySweepResult(paperCandidate(), { latencyMs: 12 });

  assert.equal(adapted.engineResult.engine, LIQUIDITY_SWEEP_ENGINE_ID);
  assert.equal(adapted.engineResult.status, 'ACCEPTED');
  assert.equal(adapted.engineResult.latencyMs, 12);
  assert.equal(adapted.engineResult.signal.direction, 'LONG');
  assert.equal(adapted.engineResult.signal.score, 88);

  assert.equal(adapted.opportunity.id, 'setup_test_001');
  assert.equal(adapted.opportunity.symbol, 'AAPL');
  assert.equal(adapted.opportunity.direction, 'LONG');
  assert.equal(adapted.opportunity.entry, 200);
  assert.equal(adapted.opportunity.stopLoss, 198);
  assert.equal(adapted.opportunity.takeProfit, 204);
  assert.equal(adapted.opportunity.metadata.rewardToRisk, 2);
  assert.equal(adapted.opportunity.metadata.executionAllowed, false);
  assert.equal(adapted.opportunity.metadata.automaticSubmissionAllowed, false);
  assert.equal(adapted.opportunity.metadata.mode, 'PAPER_TRADING');
});

test('adapts ordinary NO_TRADE into neutral engine result without opportunity', () => {
  const adapted = adaptLiquiditySweepResult({
    tradeDecision: 'NO_TRADE',
    reason: 'NO_CONFIRMED_LIQUIDITY_SWEEP_SETUP',
    details: { symbol: 'MSFT', timeframe: '5m' },
    executionAllowed: false,
    mode: 'PAPER_TRADING',
    createdAt: '2026-07-27T15:00:00.000Z',
  });

  assert.equal(adapted.engineResult.status, 'NEUTRAL');
  assert.equal(adapted.engineResult.signal, null);
  assert.equal(adapted.opportunity, null);
  assert.deepEqual(adapted.engineResult.reasons, ['NO_CONFIRMED_LIQUIDITY_SWEEP_SETUP']);
});

test('maps MARKET_DATA_REJECTED to rejected engine status', () => {
  const adapted = adaptLiquiditySweepResult({
    tradeDecision: 'NO_TRADE',
    reason: 'MARKET_DATA_REJECTED',
    details: { symbol: 'NVDA', error: 'Delayed market data' },
    executionAllowed: false,
    mode: 'PAPER_TRADING',
    createdAt: '2026-07-27T15:00:00.000Z',
  });

  assert.equal(adapted.engineResult.status, 'REJECTED');
  assert.equal(adapted.opportunity, null);
});

test('rejects execution-enabled liquidity sweep results', () => {
  assert.throws(
    () => adaptLiquiditySweepResult(paperCandidate({ executionAllowed: true })),
    /rejects execution-enabled results/,
  );

  assert.throws(
    () => adaptLiquiditySweepResult(paperCandidate({ automaticSubmissionAllowed: true })),
    /rejects execution-enabled results/,
  );
});

test('rejects non-paper modes and unknown trade decisions', () => {
  assert.throws(
    () => adaptLiquiditySweepResult(paperCandidate({ mode: 'LIVE_TRADING' })),
    /PAPER_TRADING results only/,
  );

  assert.throws(
    () => adaptLiquiditySweepResult({
      tradeDecision: 'ENTER_NOW',
      executionAllowed: false,
      mode: 'PAPER_TRADING',
    }),
    /Unsupported liquidity sweep tradeDecision/,
  );
});
