import {
  Direction,
  EngineStatus,
  createEngineResult,
  createEngineSignal,
} from './domain.js';

export const VWAP_ENGINE_ID = 'VWAP';

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
  return values.flat(Infinity).map((value) => text(value)).filter(Boolean);
}

function normalizeDirection(value) {
  const normalized = text(value, 'NEUTRAL').toUpperCase();
  if (['LONG', 'BULLISH', 'ABOVE'].includes(normalized)) return Direction.LONG;
  if (['SHORT', 'BEARISH', 'BELOW'].includes(normalized)) return Direction.SHORT;
  if (['NEUTRAL', 'BALANCED', 'AT_VWAP', 'NONE'].includes(normalized)) return Direction.NEUTRAL;
  throw new Error(`Unsupported VWAP direction: ${normalized}`);
}

function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('VWAP result must be an object');
  }
  if (
    result.executionAllowed === true
    || result.automaticSubmissionAllowed === true
    || result.liveExecutionAllowed === true
  ) {
    throw new Error('VWAP adapter rejects execution-enabled results');
  }
  if (text(result.mode, 'PAPER_TRADING').toUpperCase() !== 'PAPER_TRADING') {
    throw new Error('VWAP adapter accepts PAPER_TRADING results only');
  }
  const decision = text(result.tradeDecision, 'NO_TRADE').toUpperCase();
  if (!['OBSERVATION', 'SIGNAL', 'PAPER_SIGNAL', 'NO_TRADE'].includes(decision)) {
    throw new Error(`Unsupported VWAP tradeDecision: ${decision}`);
  }
}

function resultStatus(result, direction) {
  const reason = text(result.reason).toUpperCase();
  if (['VWAP_DATA_REJECTED', 'MARKET_DATA_REJECTED'].includes(reason)) {
    return EngineStatus.REJECTED;
  }
  const decision = text(result.tradeDecision, 'NO_TRADE').toUpperCase();
  if (decision === 'NO_TRADE' || direction === Direction.NEUTRAL) return EngineStatus.NEUTRAL;
  return EngineStatus.ACCEPTED;
}

function diagnostics(result, direction, score) {
  return {
    tradeDecision: text(result.tradeDecision, 'NO_TRADE').toUpperCase(),
    symbol: result.symbol ?? null,
    direction,
    vwapScore: score,
    price: result.price ?? null,
    vwap: result.vwap ?? null,
    anchoredVwap: result.anchoredVwap ?? null,
    deviation: result.deviation ?? result.deviationPercent ?? null,
    slope: result.slope ?? null,
    position: result.position ?? null,
    retest: result.retest ?? null,
    reclaim: result.reclaim ?? null,
    rejection: result.rejection ?? null,
    bands: result.bands ?? null,
    volumeContext: result.volumeContext ?? null,
    session: result.session ?? null,
    timeframe: result.timeframe ?? null,
    sourceTimestamp: result.sourceTimestamp ?? null,
    dataQuality: result.dataQuality ?? null,
    engineDiagnostics: result.diagnostics ?? {},
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
  };
}

export function adaptVwapResult(result, { latencyMs = 0 } = {}) {
  validateResult(result);

  const direction = normalizeDirection(result.direction ?? result.bias ?? result.position);
  const score = clamp(result.vwapScore ?? result.score);
  const confidence = clamp(result.confidence ?? score);
  const reasons = items(result.reasons, result.reason, result.evidence, result.diagnostics?.reasons);
  const engineDiagnostics = diagnostics(result, direction, score);
  const status = resultStatus(result, direction);
  const hasSignal = status === EngineStatus.ACCEPTED && direction !== Direction.NEUTRAL;

  const signal = hasSignal
    ? createEngineSignal({
      engine: VWAP_ENGINE_ID,
      direction,
      score,
      confidence,
      confidenceSource: VWAP_ENGINE_ID,
      reasons,
      diagnostics: engineDiagnostics,
      observedAt: result.observedAt ?? result.evaluatedAt ?? Date.now(),
    })
    : null;

  return Object.freeze({
    engineResult: createEngineResult({
      engine: VWAP_ENGINE_ID,
      status,
      signal,
      latencyMs: Math.max(0, finite(latencyMs)),
      reasons,
      diagnostics: engineDiagnostics,
      completedAt: result.evaluatedAt ?? result.completedAt ?? Date.now(),
    }),
    opportunity: null,
  });
}
