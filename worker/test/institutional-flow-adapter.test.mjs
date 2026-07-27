import test from 'node:test';
import assert from 'node:assert/strict';

import {
  INSTITUTIONAL_FLOW_ENGINE_ID,
  adaptInstitutionalFlowResult,
} from '../src/core/institutional-flow-adapter.js';

const STAGE_ORDER = [
  'STOP_RUN',
  'ABSORPTION',
  'IMBALANCE',
  'STRUCTURE_CONFIRMATION',
  'RISK_ENGINE',
];

function stages() {
  return {
    STOP_RUN: { passed: true, score: 88, classification: 'BULLISH_STOP_RUN' },
    ABSORPTION: { passed: true, score: 84, classification: 'BUYER_ABSORPTION' },
    IMBALANCE: { passed: true, score: 86, classification: 'BUY_IMBALANCE' },
    STRUCTURE_CONFIRMATION: { passed: true, score: 82, direction: 'LONG' },
    RISK_ENGINE: { passed: true, score: 90, rewardRisk: 3.2 },
  };
}

function passedResult(overrides = {}) {
  return {
    tradeDecision: 'NO_TRADE',
    pipelinePassed: true,
    pipelineScore: 86,
    confidence: 84,
    direction: 'LONG',
    symbol: 'AAPL',
    executionTimeframe: '5m',
    contextTimeframe: '1h',
    strategyVersion: 'institutional-flow-v1',
    eventType: 'INSTITUTIONAL_FLOW_OBSERVATION',
    evaluatedAt: '2026-07-27T17:00:00.000Z',
    stageOrder: STAGE_ORDER,
    stages: stages(),
    candidate: {
      status: 'OBSERVATION_CANDIDATE',
      direction: 'LONG',
      entryReference: 214.25,
    },
    diagnostics: {
      executionQuality: { reasons: ['PIPELINE_CONFIRMED'] },
    },
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
    ...overrides,
  };
}

test('adapts a passed Institutional Flow pipeline into an accepted EngineResult', () => {
  const adapted = adaptInstitutionalFlowResult(passedResult(), { latencyMs: 11 });

  assert.equal(adapted.engineResult.engine, INSTITUTIONAL_FLOW_ENGINE_ID);
  assert.equal(adapted.engineResult.status, 'ACCEPTED');
  assert.equal(adapted.engineResult.latencyMs, 11);
  assert.equal(adapted.engineResult.signal.direction, 'LONG');
  assert.equal(adapted.engineResult.signal.score, 86);
  assert.equal(adapted.engineResult.signal.confidence.value, 84);
  assert.equal(adapted.engineResult.diagnostics.pipelinePassed, true);
  assert.deepEqual(adapted.engineResult.diagnostics.stageOrder, STAGE_ORDER);
  assert.equal(adapted.engineResult.diagnostics.stages.STOP_RUN.passed, true);
  assert.equal(adapted.opportunity, null);
});

test('normalizes bearish Institutional Flow direction to SHORT', () => {
  const adapted = adaptInstitutionalFlowResult(passedResult({
    direction: 'BEARISH',
    candidate: {
      status: 'OBSERVATION_CANDIDATE',
      direction: 'SHORT',
    },
  }));

  assert.equal(adapted.engineResult.signal.direction, 'SHORT');
});

test('keeps an ordinary failed pipeline neutral without a signal', () => {
  const failedStages = stages();
  failedStages.IMBALANCE = {
    passed: false,
    score: 31,
    reason: 'IMBALANCE_NOT_CONFIRMED',
    failedConditions: ['STACKED_IMBALANCE_MISSING'],
  };

  const adapted = adaptInstitutionalFlowResult(passedResult({
    pipelinePassed: false,
    pipelineScore: 41,
    direction: 'NEUTRAL',
    candidate: null,
    failedStage: 'IMBALANCE',
    reason: 'INSTITUTIONAL_FLOW_PIPELINE_REJECTED',
    stages: failedStages,
  }));

  assert.equal(adapted.engineResult.status, 'NEUTRAL');
  assert.equal(adapted.engineResult.signal, null);
  assert.equal(adapted.engineResult.diagnostics.failedStage, 'IMBALANCE');
  assert.ok(adapted.engineResult.reasons.includes('STACKED_IMBALANCE_MISSING'));
});

test('maps rejected market data to rejected EngineResult', () => {
  const adapted = adaptInstitutionalFlowResult({
    tradeDecision: 'NO_TRADE',
    pipelinePassed: false,
    pipelineScore: 0,
    direction: 'NEUTRAL',
    reason: 'INSTITUTIONAL_FLOW_MARKET_DATA_REJECTED',
    diagnostics: { marketDataError: 'MISSING_BARS' },
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
  });

  assert.equal(adapted.engineResult.status, 'REJECTED');
  assert.equal(adapted.engineResult.signal, null);
  assert.ok(adapted.engineResult.reasons.includes('MISSING_BARS'));
});

test('rejects execution-enabled and non-paper Institutional Flow results', () => {
  assert.throws(
    () => adaptInstitutionalFlowResult(passedResult({ executionAllowed: true })),
    /rejects execution-enabled results/,
  );
  assert.throws(
    () => adaptInstitutionalFlowResult(passedResult({ automaticSubmissionAllowed: true })),
    /rejects execution-enabled results/,
  );
  assert.throws(
    () => adaptInstitutionalFlowResult(passedResult({ liveExecutionAllowed: true })),
    /rejects execution-enabled results/,
  );
  assert.throws(
    () => adaptInstitutionalFlowResult(passedResult({ mode: 'LIVE_TRADING' })),
    /PAPER_TRADING results only/,
  );
});

test('rejects unsupported decisions, directions, and invalid stage order', () => {
  assert.throws(
    () => adaptInstitutionalFlowResult(passedResult({ tradeDecision: 'ENTER_NOW' })),
    /Unsupported institutional flow tradeDecision/,
  );
  assert.throws(
    () => adaptInstitutionalFlowResult(passedResult({ direction: 'UP_ONLY' })),
    /Unsupported institutional flow direction/,
  );
  assert.throws(
    () => adaptInstitutionalFlowResult(passedResult({
      stageOrder: ['ABSORPTION', 'STOP_RUN', 'IMBALANCE', 'STRUCTURE_CONFIRMATION', 'RISK_ENGINE'],
    })),
    /stage order is invalid/,
  );
});

test('requires candidate and directional result when pipeline passes', () => {
  assert.throws(
    () => adaptInstitutionalFlowResult(passedResult({ candidate: null })),
    /requires an observation candidate/,
  );
  assert.throws(
    () => adaptInstitutionalFlowResult(passedResult({
      direction: 'NEUTRAL',
      candidate: { status: 'OBSERVATION_CANDIDATE', direction: 'NEUTRAL' },
    })),
    /requires a directional result/,
  );
});
