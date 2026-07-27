import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ORDER_FLOW_ENGINE_ID,
  adaptOrderFlowResult,
} from '../src/core/order-flow-adapter.js';

function observation(overrides = {}) {
  return {
    tradeDecision: 'SIGNAL',
    direction: 'BULLISH',
    orderFlowScore: 86,
    confidence: 82,
    observedAt: '2026-07-27T16:00:00.000Z',
    evaluatedAt: '2026-07-27T16:00:01.000Z',
    reasons: ['AGGRESSIVE_BUYERS_DOMINANT'],
    delta: { value: 245000, evidence: ['POSITIVE_DELTA'] },
    cumulativeDelta: 530000,
    imbalance: { stacked: [201.1, 201.2], evidence: ['STACKED_ASK_IMBALANCE'] },
    absorption: { classification: 'BUYER_ABSORPTION' },
    aggression: { buyers: 74, sellers: 26 },
    footprint: { classifiedVolumeShare: 0.91 },
    volumeClusters: [{ price: 201.15, volume: 120000 }],
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    mode: 'PAPER_TRADING',
    ...overrides,
  };
}

test('adapts bullish Order Flow signal into accepted EngineResult', () => {
  const adapted = adaptOrderFlowResult(observation(), { latencyMs: 7 });

  assert.equal(adapted.engineResult.engine, ORDER_FLOW_ENGINE_ID);
  assert.equal(adapted.engineResult.status, 'ACCEPTED');
  assert.equal(adapted.engineResult.latencyMs, 7);
  assert.equal(adapted.engineResult.signal.direction, 'LONG');
  assert.equal(adapted.engineResult.signal.score, 86);
  assert.equal(adapted.engineResult.signal.confidence.value, 82);
  assert.equal(adapted.engineResult.diagnostics.cumulativeDelta, 530000);
  assert.equal(adapted.opportunity, null);
});

test('normalizes bearish observations to SHORT', () => {
  const adapted = adaptOrderFlowResult(observation({
    tradeDecision: 'OBSERVATION',
    direction: 'BEARISH',
    orderFlowScore: 79,
  }));

  assert.equal(adapted.engineResult.status, 'ACCEPTED');
  assert.equal(adapted.engineResult.signal.direction, 'SHORT');
  assert.equal(adapted.engineResult.signal.score, 79);
});

test('keeps balanced observations neutral without signal', () => {
  const adapted = adaptOrderFlowResult(observation({
    direction: 'BALANCED',
    orderFlowScore: 44,
  }));

  assert.equal(adapted.engineResult.status, 'NEUTRAL');
  assert.equal(adapted.engineResult.signal, null);
  assert.equal(adapted.opportunity, null);
});

test('maps ordinary NO_TRADE to neutral and rejected data to rejected', () => {
  const neutral = adaptOrderFlowResult({
    tradeDecision: 'NO_TRADE',
    reason: 'NO_ORDER_FLOW_CONFIRMATION',
    executionAllowed: false,
    mode: 'PAPER_TRADING',
  });
  assert.equal(neutral.engineResult.status, 'NEUTRAL');

  const rejected = adaptOrderFlowResult({
    tradeDecision: 'NO_TRADE',
    reason: 'ORDER_FLOW_DATA_REJECTED',
    executionAllowed: false,
    mode: 'PAPER_TRADING',
  });
  assert.equal(rejected.engineResult.status, 'REJECTED');
});

test('rejects execution-enabled and non-paper Order Flow results', () => {
  assert.throws(
    () => adaptOrderFlowResult(observation({ executionAllowed: true })),
    /rejects execution-enabled results/,
  );
  assert.throws(
    () => adaptOrderFlowResult(observation({ automaticSubmissionAllowed: true })),
    /rejects execution-enabled results/,
  );
  assert.throws(
    () => adaptOrderFlowResult(observation({ mode: 'LIVE_TRADING' })),
    /PAPER_TRADING results only/,
  );
});

test('rejects unsupported decisions and directions', () => {
  assert.throws(
    () => adaptOrderFlowResult(observation({ tradeDecision: 'ENTER_NOW' })),
    /Unsupported order flow tradeDecision/,
  );
  assert.throws(
    () => adaptOrderFlowResult(observation({ direction: 'UP_ONLY' })),
    /Unsupported order flow direction/,
  );
});
