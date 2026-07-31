import {
  DecisionAction,
  Direction,
  EngineStatus,
  clampScore,
  createTradeDecision,
} from './domain.js';

export const FUSION_ENGINE_ID = 'FUSION';

export const DEFAULT_ENGINE_WEIGHTS = Object.freeze({
  LIQUIDITY_SWEEP: 1.15,
  SMART_MONEY: 1.2,
  ORDER_FLOW: 1.05,
  INSTITUTIONAL_FLOW: 1.2,
  GAMMA_GEX: 0.85,
  VWAP: 0.7,
  POC: 0.8,
  IMBALANCE: 0.9,
  ABSORPTION: 1.0,
  STOP_RUN: 1.05,
});

export const FusionGrade = Object.freeze({
  AAA: 'AAA',
  AA: 'AA',
  A: 'A',
  BBB: 'BBB',
  BB: 'BB',
  REJECT: 'REJECT',
});

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, finite(value)));
}

function validateEngineResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Fusion engine results must be objects');
  }
  if (typeof result.engine !== 'string' || !result.engine.trim()) {
    throw new Error('Fusion engine result.engine is required');
  }
  if (!Object.values(EngineStatus).includes(result.status)) {
    throw new Error(`Unsupported engine status: ${result.status}`);
  }
  if (result.signal && !Object.values(Direction).includes(result.signal.direction)) {
    throw new Error(`Unsupported signal direction: ${result.signal.direction}`);
  }
}

function effectiveWeight(result, weights) {
  const configured = finite(weights[result.engine], 1);
  const confidence = clamp01(finite(result.signal?.confidence?.value, 0) / 100);
  const quality = clamp01(finite(result.diagnostics?.dataQuality?.score ?? result.diagnostics?.quality, 100) / 100);
  return Math.max(0, configured) * confidence * quality;
}

function directionalScore(result) {
  if (result.status !== EngineStatus.ACCEPTED || !result.signal) return 0;
  const score = clampScore(result.signal.score ?? 0) / 100;
  if (result.signal.direction === Direction.LONG) return score;
  if (result.signal.direction === Direction.SHORT) return -score;
  return 0;
}

function gradeFor({ confidence, agreementScore, conflictScore, acceptedCount }) {
  if (acceptedCount < 2 || confidence < 55 || agreementScore < 55 || conflictScore > 45) return FusionGrade.REJECT;
  if (confidence >= 90 && agreementScore >= 85 && conflictScore <= 12) return FusionGrade.AAA;
  if (confidence >= 82 && agreementScore >= 76 && conflictScore <= 20) return FusionGrade.AA;
  if (confidence >= 74 && agreementScore >= 68 && conflictScore <= 28) return FusionGrade.A;
  if (confidence >= 66 && agreementScore >= 60 && conflictScore <= 36) return FusionGrade.BBB;
  return FusionGrade.BB;
}

export function fuseEngineResults(engineResults, options = {}) {
  if (!Array.isArray(engineResults)) throw new Error('engineResults must be an array');
  engineResults.forEach(validateEngineResult);

  const weights = { ...DEFAULT_ENGINE_WEIGHTS, ...(options.weights || {}) };
  const usable = engineResults.filter((result) => result.status !== EngineStatus.ERROR);
  const accepted = usable.filter((result) => result.status === EngineStatus.ACCEPTED && result.signal);

  let longSupport = 0;
  let shortSupport = 0;
  let totalSupport = 0;
  const contributions = [];

  for (const result of usable) {
    const weight = effectiveWeight(result, weights);
    const score = directionalScore(result);
    const contribution = weight * Math.abs(score);
    totalSupport += contribution;
    if (score > 0) longSupport += contribution;
    if (score < 0) shortSupport += contribution;
    contributions.push(Object.freeze({
      engine: result.engine,
      status: result.status,
      direction: result.signal?.direction ?? Direction.NEUTRAL,
      weight,
      contribution,
    }));
  }

  const winningDirection = longSupport === shortSupport
    ? Direction.NEUTRAL
    : longSupport > shortSupport ? Direction.LONG : Direction.SHORT;
  const winner = Math.max(longSupport, shortSupport);
  const loser = Math.min(longSupport, shortSupport);
  const agreementScore = totalSupport > 0 ? clampScore((winner / totalSupport) * 100) : 0;
  const conflictScore = totalSupport > 0 ? clampScore((loser / totalSupport) * 100) : 0;

  const directionalAccepted = accepted.filter((result) => result.signal.direction === winningDirection);
  const weightedConfidenceNumerator = directionalAccepted.reduce((sum, result) => {
    const weight = effectiveWeight(result, weights);
    return sum + weight * clampScore(result.signal.confidence?.value ?? result.signal.score ?? 0);
  }, 0);
  const weightedConfidenceDenominator = directionalAccepted.reduce(
    (sum, result) => sum + effectiveWeight(result, weights),
    0,
  );
  const baseConfidence = weightedConfidenceDenominator > 0
    ? weightedConfidenceNumerator / weightedConfidenceDenominator
    : 0;
  const confidence = clampScore(baseConfidence * (agreementScore / 100) * (1 - conflictScore / 100));
  const score = clampScore((confidence * 0.65) + (agreementScore * 0.35));
  const grade = gradeFor({ confidence, agreementScore, conflictScore, acceptedCount: accepted.length });

  const requiredEngines = Array.isArray(options.requiredEngines) ? options.requiredEngines : [];
  const missingRequiredEngines = requiredEngines.filter(
    (engine) => !accepted.some((result) => result.engine === engine),
  );
  const blocked = winningDirection === Direction.NEUTRAL
    || grade === FusionGrade.REJECT
    || missingRequiredEngines.length > 0;

  const reasons = [];
  if (winningDirection === Direction.NEUTRAL) reasons.push('NO_DIRECTIONAL_CONSENSUS');
  if (accepted.length < 2) reasons.push('INSUFFICIENT_ACCEPTED_ENGINES');
  if (conflictScore > 45) reasons.push('EXCESSIVE_ENGINE_CONFLICT');
  if (missingRequiredEngines.length) reasons.push('MISSING_REQUIRED_ENGINES');
  if (!blocked) reasons.push(`${winningDirection}_CONSENSUS`);

  return Object.freeze({
    engine: FUSION_ENGINE_ID,
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
    direction: blocked ? Direction.NEUTRAL : winningDirection,
    score,
    confidence,
    grade,
    agreementScore,
    conflictScore,
    acceptedCount: accepted.length,
    evaluatedCount: usable.length,
    missingRequiredEngines: Object.freeze([...missingRequiredEngines]),
    reasons: Object.freeze(reasons),
    contributions: Object.freeze(contributions),
    decision: createTradeDecision({
      action: blocked ? DecisionAction.REJECT : DecisionAction.HOLD,
      score,
      confidence,
      reasons,
      diagnostics: {
        fusionEngine: FUSION_ENGINE_ID,
        winningDirection,
        agreementScore,
        conflictScore,
        grade,
        acceptedCount: accepted.length,
        evaluatedCount: usable.length,
        missingRequiredEngines,
        observationOnly: true,
        executionAllowed: false,
      },
      decidedAt: options.decidedAt ?? Date.now(),
    }),
  });
}

export {
  DEFAULT_FUSION_WEIGHTS_V2,
  FUSION_ENGINE_V2_ID,
  FUSION_RESULT_SCHEMA,
  FUSION_RESULT_VERSION,
  FusionGradeV2,
  createFusionEngineV2,
  fuseEngineResultsV2,
} from './fusion-engine-v2.js';
