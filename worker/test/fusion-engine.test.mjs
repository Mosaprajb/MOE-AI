import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DecisionAction,
  Direction,
  EngineStatus,
  createEngineResult,
  createEngineSignal,
} from '../src/core/domain.js';
import {
  FusionGrade,
  fuseEngineResults,
} from '../src/core/fusion-engine.js';

function accepted(engine, direction, score = 90, confidence = score, diagnostics = {}) {
  return createEngineResult({
    engine,
    status: EngineStatus.ACCEPTED,
    signal: createEngineSignal({
      engine,
      direction,
      score,
      confidence,
      confidenceSource: engine,
      reasons: [`${engine}_${direction}`],
      diagnostics,
      observedAt: '2026-07-27T12:00:00.000Z',
    }),
    diagnostics,
    completedAt: '2026-07-27T12:00:01.000Z',
  });
}

function neutral(engine) {
  return createEngineResult({
    engine,
    status: EngineStatus.NEUTRAL,
    signal: null,
    diagnostics: {},
    completedAt: '2026-07-27T12:00:01.000Z',
  });
}

test('builds a strong observation-only LONG consensus', () => {
  const result = fuseEngineResults([
    accepted('SMART_MONEY', Direction.LONG, 96, 95),
    accepted('LIQUIDITY_SWEEP', Direction.LONG, 94, 93),
    accepted('INSTITUTIONAL_FLOW', Direction.LONG, 92, 91),
    accepted('ORDER_FLOW', Direction.LONG, 88, 90),
    neutral('VWAP'),
  ], { decidedAt: '2026-07-27T12:05:00.000Z' });

  assert.equal(result.direction, Direction.LONG);
  assert.equal(result.decision.action, DecisionAction.HOLD);
  assert.equal(result.observationOnly, true);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.automaticSubmissionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
  assert.equal(result.agreementScore, 100);
  assert.equal(result.conflictScore, 0);
  assert.ok([FusionGrade.AAA, FusionGrade.AA].includes(result.grade));
  assert.ok(result.confidence >= 85);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.contributions));
});

test('rejects an evenly split directional conflict', () => {
  const result = fuseEngineResults([
    accepted('SMART_MONEY', Direction.LONG, 90, 90),
    accepted('INSTITUTIONAL_FLOW', Direction.SHORT, 90, 90),
  ], {
    weights: { SMART_MONEY: 1, INSTITUTIONAL_FLOW: 1 },
    decidedAt: '2026-07-27T12:05:00.000Z',
  });

  assert.equal(result.direction, Direction.NEUTRAL);
  assert.equal(result.grade, FusionGrade.REJECT);
  assert.equal(result.decision.action, DecisionAction.REJECT);
  assert.ok(result.reasons.includes('NO_DIRECTIONAL_CONSENSUS'));
  assert.ok(result.conflictScore >= 49);
});

test('rejects when a required engine is missing', () => {
  const result = fuseEngineResults([
    accepted('SMART_MONEY', Direction.LONG, 95, 95),
    accepted('LIQUIDITY_SWEEP', Direction.LONG, 95, 95),
    accepted('ORDER_FLOW', Direction.LONG, 92, 92),
  ], {
    requiredEngines: ['INSTITUTIONAL_FLOW'],
    decidedAt: '2026-07-27T12:05:00.000Z',
  });

  assert.equal(result.direction, Direction.NEUTRAL);
  assert.equal(result.decision.action, DecisionAction.REJECT);
  assert.deepEqual(result.missingRequiredEngines, ['INSTITUTIONAL_FLOW']);
  assert.ok(result.reasons.includes('MISSING_REQUIRED_ENGINES'));
});

test('reduces contribution when data quality is weak', () => {
  const strong = accepted('SMART_MONEY', Direction.LONG, 90, 90, { quality: 100 });
  const weak = accepted('ORDER_FLOW', Direction.SHORT, 100, 100, { quality: 10 });
  const result = fuseEngineResults([strong, weak], {
    weights: { SMART_MONEY: 1, ORDER_FLOW: 1 },
    decidedAt: '2026-07-27T12:05:00.000Z',
  });

  const smartMoney = result.contributions.find((item) => item.engine === 'SMART_MONEY');
  const orderFlow = result.contributions.find((item) => item.engine === 'ORDER_FLOW');

  assert.equal(result.direction, Direction.LONG);
  assert.ok(smartMoney.contribution > orderFlow.contribution * 5);
  assert.ok(result.agreementScore > 85);
});

test('rejects malformed engine results', () => {
  assert.throws(
    () => fuseEngineResults([{ engine: 'BROKEN', status: 'UNKNOWN' }]),
    /Unsupported engine status/,
  );
  assert.throws(() => fuseEngineResults(null), /engineResults must be an array/);
});
