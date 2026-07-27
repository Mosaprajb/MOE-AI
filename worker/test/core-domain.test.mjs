import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DecisionAction,
  Direction,
  EngineStatus,
  clampScore,
  createEngineResult,
  createEngineSignal,
  createOpportunity,
  createTradeDecision,
  validatePriceLevels,
} from '../src/core/domain.js';

test('clampScore constrains scores to the supported range', () => {
  assert.equal(clampScore(-12), 0);
  assert.equal(clampScore(48.5), 48.5);
  assert.equal(clampScore(140), 100);
  assert.throws(() => clampScore(Number.NaN), /finite number/);
});

test('createEngineSignal produces an immutable normalized signal', () => {
  const signal = createEngineSignal({
    engine: 'liquidity-sweep',
    direction: Direction.LONG,
    score: 82,
    confidence: 76,
    reasons: ['sell-side liquidity reclaimed'],
    diagnostics: { sweepDepth: 1.4 },
    observedAt: '2026-07-27T15:00:00.000Z',
  });

  assert.equal(signal.engine, 'liquidity-sweep');
  assert.equal(signal.direction, Direction.LONG);
  assert.equal(signal.confidence.value, 76);
  assert.equal(signal.diagnostics.sweepDepth, 1.4);
  assert.ok(Object.isFrozen(signal));
  assert.ok(Object.isFrozen(signal.reasons));
  assert.ok(Object.isFrozen(signal.diagnostics));
});

test('createEngineResult validates status and latency', () => {
  const result = createEngineResult({
    engine: 'liquidity-sweep',
    status: EngineStatus.NEUTRAL,
    latencyMs: 4,
  });

  assert.equal(result.status, EngineStatus.NEUTRAL);
  assert.throws(
    () => createEngineResult({ engine: 'x', status: 'unknown' }),
    /status must be one of/,
  );
  assert.throws(
    () => createEngineResult({ engine: 'x', status: EngineStatus.ERROR, latencyMs: -1 }),
    /non-negative/,
  );
});

test('price levels are validated for long and short opportunities', () => {
  assert.deepEqual(
    validatePriceLevels({
      direction: Direction.LONG,
      entry: 100,
      stopLoss: 98,
      takeProfit: 104,
    }),
    { entry: 100, stopLoss: 98, takeProfit: 104 },
  );

  assert.deepEqual(
    validatePriceLevels({
      direction: Direction.SHORT,
      entry: 100,
      stopLoss: 102,
      takeProfit: 96,
    }),
    { entry: 100, stopLoss: 102, takeProfit: 96 },
  );

  assert.throws(
    () => validatePriceLevels({
      direction: Direction.LONG,
      entry: 100,
      stopLoss: 101,
      takeProfit: 104,
    }),
    /below entry/,
  );
});

test('createOpportunity normalizes symbols and preserves engine evidence', () => {
  const engineResult = createEngineResult({
    engine: 'liquidity-sweep',
    status: EngineStatus.ACCEPTED,
  });

  const opportunity = createOpportunity({
    id: 'opp-1',
    symbol: 'aapl',
    direction: Direction.LONG,
    entry: 200,
    stopLoss: 198,
    takeProfit: 205,
    score: 88,
    confidence: 84,
    timeframe: '5m',
    engineResults: [engineResult],
    reasons: ['multi-engine alignment'],
    createdAt: '2026-07-27T15:00:00.000Z',
  });

  assert.equal(opportunity.symbol, 'AAPL');
  assert.equal(opportunity.confidence.source, 'fusion');
  assert.equal(opportunity.engineResults.length, 1);
  assert.ok(Object.isFrozen(opportunity));
  assert.ok(Object.isFrozen(opportunity.engineResults));
});

test('enter decisions require an opportunity', () => {
  assert.throws(
    () => createTradeDecision({
      action: DecisionAction.ENTER,
      score: 90,
    }),
    /require an opportunity/,
  );

  const decision = createTradeDecision({
    action: DecisionAction.HOLD,
    score: 35,
    reasons: ['insufficient confirmation'],
    decidedAt: '2026-07-27T15:00:00.000Z',
  });

  assert.equal(decision.action, DecisionAction.HOLD);
});
