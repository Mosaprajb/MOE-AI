import {
  Direction,
  EngineStatus,
  createEngineResult,
  createEngineSignal,
} from './domain.js';

export const INSTITUTIONAL_FLOW_ENGINE_ID = 'INSTITUTIONAL_FLOW';

const expectedStageOrder = Object.freeze([
  'STOP_RUN',
  'ABSORPTION',
  'IMBALANCE',
  'STRUCTURE_CONFIRMATION',
  'RISK_ENGINE',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value) {
  return Math.max(0, Math.min(100, finite(value)));
}

function items(...values) {
  return values
    .flat(Infinity)
    .map((value) => text(value))
    .filter(Boolean);
}

function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Institutional flow result must be an object');
  }
  if (
    result.executionAllowed === true
    || result.automaticSubmissionAllowed === true
    || result.liveExecutionAllowed === true
  ) {
    throw new Error('Institutional flow adapter rejects execution-enabled results');
  }
  if (text(result.mode, 'PAPER_TRADING').toUpperCase() !== 'PAPER_TRADING') {
    throw new Error('Institutional flow adapter accepts PAPER_TRADING results only');
  }
  const decision = text(result.tradeDecision).toUpperCase();
  if (decision !== 'NO_TRADE') {
    throw new Error(`Unsupported institutional flow tradeDecision: ${decision || 'EMPTY'}`);
  }
  if (result.stageOrder != null) {
    if (!Array.isArray(result.stageOrder)) {
      throw new Error('Institutional flow stageOrder must be an array');
    }
    const normalized = result.stageOrder.map((stage) => text(stage).toUpperCase());
    if (normalized.join('|') !== expectedStageOrder.join('|')) {
      throw new Error('Institutional flow stage order is invalid');
    }
  }
}

function normalizeDirection(value) {
  const normalized = text(value, 'NEUTRAL').toUpperCase();
  if (normalized === 'LONG' || normalized === 'BULLISH') return Direction.LONG;
  if (normalized === 'SHORT' || normalized === 'BEARISH') return Direction.SHORT;
  if (normalized === 'NEUTRAL' || normalized === 'NONE') return Direction.NEUTRAL;
  throw new Error(`Unsupported institutional flow direction: ${normalized}`);
}

function compactStage(stage, name) {
  if (!stage || typeof stage !== 'object') {
    return {
      name,
      passed: false,
      status: 'NOT_EVALUATED',
      score: 0,
      classification: null,
      reason: 'STAGE_RESULT_MISSING',
      failedConditions: ['STAGE_RESULT_MISSING'],
    };
  }
  return {
    name,
    passed: stage.passed === true,
    status: stage.status ?? (stage.passed === true ? 'PASSED' : 'REJECTED'),
    score: clamp(stage.score ?? (name === 'RISK_ENGINE' ? finite(stage.rewardRisk) * 20 : 0)),
    confidence: Number.isFinite(Number(stage.confidence)) ? Number(stage.confidence) : null,
    direction: stage.direction ?? null,
    classification: stage.classification ?? stage.type ?? stage.category ?? null,
    reason: stage.reason ?? null,
    failedConditions: items(stage.failedConditions),
  };
}

function stageDiagnostics(result) {
  const stages = result.stages ?? {};
  return Object.fromEntries(
    expectedStageOrder.map((name) => [name, compactStage(stages[name], name)]),
  );
}

function extractReasons(result, stages) {
  const failedStage = text(result.failedStage);
  const stageFailures = failedStage ? stages[failedStage]?.failedConditions ?? [] : [];
  return items(
    result.reason,
    stageFailures,
    result.diagnostics?.marketDataError,
    result.diagnostics?.executionQuality?.reasons,
  );
}

function completedAt(result) {
  return result.evaluatedAt ?? result.completedAt ?? Date.now();
}

function diagnostics(result, direction, score, stages) {
  return {
    tradeDecision: 'NO_TRADE',
    eventType: result.eventType ?? null,
    strategyVersion: result.strategyVersion ?? null,
    symbol: result.symbol ?? null,
    executionTimeframe: result.executionTimeframe ?? null,
    contextTimeframe: result.contextTimeframe ?? null,
    pipelinePassed: result.pipelinePassed === true,
    failedStage: result.failedStage ?? null,
    pipelineScore: score,
    direction,
    dataMode: result.dataMode ?? 'INSUFFICIENT_DATA',
    candidate: result.candidate ?? null,
    stageOrder: expectedStageOrder,
    stages,
    engineDiagnostics: result.diagnostics ?? {},
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
  };
}

function resultStatus(result) {
  const reason = text(result.reason).toUpperCase();
  if (
    reason === 'INSTITUTIONAL_FLOW_MARKET_DATA_REJECTED'
    || reason === 'MARKET_DATA_REJECTED'
  ) {
    return EngineStatus.REJECTED;
  }
  if (result.pipelinePassed === true) return EngineStatus.ACCEPTED;
  return EngineStatus.NEUTRAL;
}

export function adaptInstitutionalFlowResult(result, { latencyMs = 0 } = {}) {
  validateResult(result);

  const direction = normalizeDirection(result.direction ?? result.candidate?.direction);
  const score = clamp(result.pipelineScore);
  const stages = stageDiagnostics(result);
  const reasons = extractReasons(result, stages);
  const engineDiagnostics = diagnostics(result, direction, score, stages);
  const pipelinePassed = result.pipelinePassed === true;
  const hasSignal = pipelinePassed && direction !== Direction.NEUTRAL;

  if (pipelinePassed && !result.candidate) {
    throw new Error('Passed institutional flow pipeline requires an observation candidate');
  }
  if (pipelinePassed && direction === Direction.NEUTRAL) {
    throw new Error('Passed institutional flow pipeline requires a directional result');
  }

  const signal = hasSignal
    ? createEngineSignal({
      engine: INSTITUTIONAL_FLOW_ENGINE_ID,
      direction,
      score,
      confidence: result.confidence ?? score,
      confidenceSource: INSTITUTIONAL_FLOW_ENGINE_ID,
      reasons,
      diagnostics: engineDiagnostics,
      observedAt: result.evaluatedAt ?? Date.now(),
    })
    : null;

  return Object.freeze({
    engineResult: createEngineResult({
      engine: INSTITUTIONAL_FLOW_ENGINE_ID,
      status: resultStatus(result),
      signal,
      latencyMs: Math.max(0, finite(latencyMs)),
      reasons,
      diagnostics: engineDiagnostics,
      completedAt: completedAt(result),
    }),
    opportunity: null,
  });
}
