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
  FUSION_RESULT_SCHEMA,
  FUSION_RESULT_VERSION,
  FusionGradeV2,
  createFusionEngineV2,
  fuseEngineResultsV2,
} from '../src/core/fusion-engine.js';

const NOW = '2026-07-30T15:00:00.000Z';

function accepted(engine, direction, score = 95, confidence = score, quality = 95) {
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
      diagnostics: { dataQuality: { score: quality } },
      observedAt: NOW,
    }),
    diagnostics: { dataQuality: { score: quality } },
    completedAt: NOW,
  });
}

function neutral(engine, quality = 90) {
  return createEngineResult({
    engine,
    status: EngineStatus.NEUTRAL,
    signal: null,
    diagnostics: { dataQuality: { score: quality } },
    completedAt: NOW,
  });
}

function pipelineResult(engineResults, runs, coverage = 1) {
  return Object.freeze({
    schema: 'MOE.AnalysisPipelineResult',
    schemaVersion: '2.0.0',
    symbol: 'AAPL',
    engineResults: Object.freeze(engineResults),
    runs: Object.freeze(runs),
    coverage,
    summary: Object.freeze({ warnings: Object.freeze([]) }),
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    evaluatedAt: NOW,
  });
}

test('strong weighted pipeline consensus produces an observation-only AAA or AA decision', () => {
  const engineResults = [
    accepted('SMART_MONEY', Direction.LONG, 98, 97, 96),
    accepted('LIQUIDITY_SWEEP', Direction.LONG, 96, 95, 94),
    accepted('INSTITUTIONAL_FLOW', Direction.LONG, 94, 94, 92),
    accepted('ORDER_FLOW', Direction.LONG, 92, 93, 90),
    neutral('GAMMA_GEX', 88),
  ];
  const runs = engineResults.map((result, index) => ({
    engine: result.engine,
    name: result.engine.toLowerCase(),
    weight: [1.2, 1.15, 1.2, 1.05, 0.85][index],
    required: index < 3,
  }));

  const result = createFusionEngineV2({ now: () => new Date(NOW) }).fuse(
    pipelineResult(engineResults, runs),
  );

  assert.equal(result.schema, FUSION_RESULT_SCHEMA);
  assert.equal(result.schemaVersion, FUSION_RESULT_VERSION);
  assert.equal(result.symbol, 'AAPL');
  assert.equal(result.direction, Direction.LONG);
  assert.equal(result.accepted, true);
  assert.ok([FusionGradeV2.AAA, FusionGradeV2.AA].includes(result.grade));
  assert.equal(result.decision.action, DecisionAction.HOLD);
  assert.equal(result.observationOnly, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.automaticSubmissionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
  assert.equal(result.agreementScore, 100);
  assert.ok(result.confidence >= 80);
  assert.ok(result.dataQuality.score >= 90);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.contributions));
});

test('data quality and configured weights reduce an opposing engine contribution', () => {
  const result = fuseEngineResultsV2([
    accepted('SMART_MONEY', Direction.LONG, 92, 92, 95),
    accepted('ORDER_FLOW', Direction.SHORT, 100, 100, 10),
  ], {
    weights: { SMART_MONEY: 1, ORDER_FLOW: 1 },
    minimumDataQuality: 0,
    now: () => new Date(NOW),
    context: { evaluatedAt: NOW },
  });

  const smartMoney = result.contributions.find((item) => item.engine === 'SMART_MONEY');
  const orderFlow = result.contributions.find((item) => item.engine === 'ORDER_FLOW');

  assert.equal(result.winningDirection, Direction.LONG);
  assert.ok(result.agreementScore > 80);
  assert.ok(smartMoney.contribution > orderFlow.contribution * 5);
  assert.equal(orderFlow.dataQuality, 10);
  assert.equal(orderFlow.dataQualityAvailable, true);
});

test('required engine failures force a unified REJECT decision', () => {
  const engineResults = [
    accepted('SMART_MONEY', Direction.LONG),
    accepted('LIQUIDITY_SWEEP', Direction.LONG),
    neutral('INSTITUTIONAL_FLOW'),
  ];
  const runs = [
    { engine: 'SMART_MONEY', name: 'smartMoney', required: true, weight: 1.2 },
    { engine: 'LIQUIDITY_SWEEP', name: 'liquiditySweep', required: true, weight: 1.15 },
    { engine: 'INSTITUTIONAL_FLOW', name: 'institutionalFlow', required: true, weight: 1.2 },
  ];

  const result = createFusionEngineV2({ now: () => new Date(NOW) }).fuse(
    pipelineResult(engineResults, runs),
  );

  assert.equal(result.grade, FusionGradeV2.REJECT);
  assert.equal(result.direction, Direction.NEUTRAL);
  assert.equal(result.decision.action, DecisionAction.REJECT);
  assert.ok(result.blockers.includes('FAILED_REQUIRED_ENGINES'));
  assert.deepEqual(result.failedRequiredEngines, ['INSTITUTIONAL_FLOW']);
});

test('low pipeline coverage and weak data quality remain explicit blockers', () => {
  const source = pipelineResult(
    [accepted('SMART_MONEY', Direction.LONG, 80, 80, 20)],
    [
      { engine: 'SMART_MONEY', required: false, weight: 1 },
      { engine: 'ORDER_FLOW', required: false, weight: 1 },
      { engine: 'GAMMA_GEX', required: false, weight: 1 },
    ],
    1 / 3,
  );

  const result = createFusionEngineV2({ now: () => new Date(NOW) }).fuse(source);

  assert.equal(result.grade, FusionGradeV2.REJECT);
  assert.ok(result.blockers.includes('INSUFFICIENT_COVERAGE'));
  assert.ok(result.blockers.includes('LOW_DATA_QUALITY'));
  assert.equal(result.dataQuality.score, 20);
  assert.equal(result.coverage, 0.3333);
});

test('long-only policy blocks a strong short consensus', () => {
  const result = createFusionEngineV2({ now: () => new Date(NOW) }).fuse([
    accepted('SMART_MONEY', Direction.SHORT),
    accepted('ORDER_FLOW', Direction.SHORT),
    accepted('GAMMA_GEX', Direction.SHORT),
  ], { evaluatedAt: NOW });

  assert.equal(result.winningDirection, Direction.SHORT);
  assert.equal(result.direction, Direction.NEUTRAL);
  assert.equal(result.grade, FusionGradeV2.REJECT);
  assert.ok(result.blockers.includes('SHORT_ENTRIES_DISABLED'));
});

test('malformed and execution-enabled inputs fail closed', () => {
  const engine = createFusionEngineV2({ now: () => new Date(NOW) });

  assert.throws(
    () => engine.fuse(null),
    /requires an Analysis Pipeline result or an EngineResult array/,
  );
  assert.throws(
    () => engine.fuse([{ engine: 'BROKEN', status: 'UNKNOWN' }]),
    /Unsupported engine status/,
  );
  assert.throws(
    () => engine.fuse({ engineResults: [], executionAllowed: true }),
    /rejects execution-enabled pipeline results/,
  );
});
