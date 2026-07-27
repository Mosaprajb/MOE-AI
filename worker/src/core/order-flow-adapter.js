import {
  Direction,
  EngineStatus,
  createEngineResult,
  createEngineSignal,
} from './domain.js';

export const ORDER_FLOW_ENGINE_ID = 'ORDER_FLOW';

const directionalBiases = new Set([
  'LONG',
  'SHORT',
  'BULLISH',
  'BEARISH',
  'NEUTRAL',
  'BALANCED',
  'NONE',
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

function stringList(...values) {
  return values
    .flat(Infinity)
    .map((value) => text(value))
    .filter(Boolean);
}

function normalizeDirection(value) {
  const normalized = text(value, 'NEUTRAL').toUpperCase();
  if (!directionalBiases.has(normalized)) {
    throw new Error(`Unsupported order flow direction: ${normalized}`);
  }
  if (normalized === 'LONG' || normalized === 'BULLISH') return Direction.LONG;
  if (normalized === 'SHORT' || normalized === 'BEARISH') return Direction.SHORT;
  return Direction.NEUTRAL;
}

function ensurePaperOnly(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Order flow result must be an object');
  }
  if (result.executionAllowed === true || result.automaticSubmissionAllowed === true) {
    throw new Error('Order flow adapter rejects execution-enabled results');
  }
  const mode = text(result.mode, 'PAPER_TRADING').toUpperCase();
  if (mode !== 'PAPER_TRADING') {
    throw new Error('Order flow adapter accepts PAPER_TRADING results only');
  }
}

function completedAt(result) {
  return result.evaluatedAt ?? result.observedAt ?? result.createdAt ?? Date.now();
}

function extractScore(result) {
  return clamp(
    result.orderFlowScore
      ?? result.score
      ?? result.quality?.total
      ?? result.confluence?.score
      ?? result.confidence,
  );
}

function extractDirection(result) {
  return normalizeDirection(
    result.direction
      ?? result.bias
      ?? result.orderFlow?.direction
      ?? result.orderFlow?.bias
      ?? result.signal?.direction,
  );
}

function extractReasons(result) {
  return stringList(
    result.reasons,
    result.evidence,
    result.explanation?.reasons,
    result.explanation?.supportingReasons,
    result.explanation?.acceptanceReasons,
    result.quality?.reasons,
    result.orderFlow?.evidence,
    result.delta?.evidence,
    result.imbalance?.evidence,
    result.absorption?.evidence,
    result.aggression?.evidence,
  );
}

function diagnostics(result, decision, direction, score) {
  return {
    tradeDecision: decision,
    direction,
    score,
    delta: result.delta ?? {},
    cumulativeDelta: result.cumulativeDelta ?? result.delta?.cumulative ?? null,
    imbalance: result.imbalance ?? {},
    stackedImbalances: result.stackedImbalances ?? result.imbalance?.stacked ?? [],
    absorption: result.absorption ?? {},
    aggression: result.aggression ?? {},
    footprint: result.footprint ?? {},
    liquidityConsumption: result.liquidityConsumption ?? {},
    exhaustion: result.exhaustion ?? {},
    iceberg: result.iceberg ?? {},
    volumeClusters: result.volumeClusters ?? [],
    confluence: result.confluence ?? {},
    quality: result.quality ?? {},
    rawDiagnostics: result.diagnostics ?? [],
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    mode: 'PAPER_TRADING',
  };
}

function statusForNoTrade(result) {
  const reason = text(result.reason).toUpperCase();
  if (reason === 'MARKET_DATA_REJECTED' || reason === 'ORDER_FLOW_DATA_REJECTED') {
    return EngineStatus.REJECTED;
  }
  return EngineStatus.NEUTRAL;
}

function adaptNoTrade(result, latencyMs) {
  const reason = text(result.reason, 'NO_ORDER_FLOW_CONFIRMATION');
  const reasons = stringList(reason, extractReasons(result));
  const direction = extractDirection(result);
  const score = extractScore(result);
  const engineDiagnostics = diagnostics(result, 'NO_TRADE', direction, score);

  return Object.freeze({
    engineResult: createEngineResult({
      engine: ORDER_FLOW_ENGINE_ID,
      status: statusForNoTrade(result),
      signal: null,
      latencyMs,
      reasons,
      diagnostics: engineDiagnostics,
      completedAt: completedAt(result),
    }),
    opportunity: null,
  });
}

function adaptObservation(result, latencyMs, decision) {
  const direction = extractDirection(result);
  const score = extractScore(result);
  const reasons = extractReasons(result);
  const engineDiagnostics = diagnostics(result, decision, direction, score);
  const hasDirectionalSignal = direction !== Direction.NEUTRAL;

  const signal = hasDirectionalSignal
    ? createEngineSignal({
      engine: ORDER_FLOW_ENGINE_ID,
      direction,
      score,
      confidence: result.confidence ?? score,
      confidenceSource: ORDER_FLOW_ENGINE_ID,
      reasons,
      diagnostics: engineDiagnostics,
      observedAt: result.observedAt ?? result.evaluatedAt ?? Date.now(),
    })
    : null;

  return Object.freeze({
    engineResult: createEngineResult({
      engine: ORDER_FLOW_ENGINE_ID,
      status: hasDirectionalSignal ? EngineStatus.ACCEPTED : EngineStatus.NEUTRAL,
      signal,
      latencyMs,
      reasons,
      diagnostics: engineDiagnostics,
      completedAt: completedAt(result),
    }),
    opportunity: null,
  });
}

export function adaptOrderFlowResult(result, { latencyMs = 0 } = {}) {
  ensurePaperOnly(result);
  const decision = text(result.tradeDecision, 'OBSERVATION').toUpperCase();
  const normalizedLatency = Math.max(0, finite(latencyMs));

  if (decision === 'NO_TRADE') return adaptNoTrade(result, normalizedLatency);
  if (decision === 'OBSERVATION' || decision === 'SIGNAL' || decision === 'PAPER_SIGNAL') {
    return adaptObservation(result, normalizedLatency, decision);
  }

  throw new Error(`Unsupported order flow tradeDecision: ${decision || 'EMPTY'}`);
}
