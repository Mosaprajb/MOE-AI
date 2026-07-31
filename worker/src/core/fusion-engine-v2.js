import {
  DecisionAction,
  Direction,
  EngineStatus,
  clampScore,
  createTradeDecision,
} from './domain.js';

export const FUSION_ENGINE_V2_ID = 'FUSION_V2';
export const FUSION_RESULT_SCHEMA = 'MOE.FusionResult';
export const FUSION_RESULT_VERSION = '2.0.0';

export const FusionGradeV2 = Object.freeze({
  AAA: 'AAA',
  AA: 'AA',
  A: 'A',
  BBB: 'BBB',
  BB: 'BB',
  REJECT: 'REJECT',
});

export const DEFAULT_FUSION_WEIGHTS_V2 = Object.freeze({
  SMART_MONEY: 1.2,
  LIQUIDITY_SWEEP: 1.15,
  INSTITUTIONAL_FLOW: 1.2,
  ORDER_FLOW: 1.05,
  GAMMA_GEX: 0.85,
  SMT_DIVERGENCE: 0.8,
  RELATIVE_VOLUME: 0.75,
  PORTFOLIO_CONSTRAINTS: 1.1,
  VWAP: 0.7,
  POC: 0.8,
  IMBALANCE: 0.9,
  ABSORPTION: 1,
  STOP_RUN: 1.05,
});

const GRADE_THRESHOLDS = Object.freeze([
  Object.freeze({ grade: FusionGradeV2.AAA, score: 90, confidence: 88, agreement: 90, conflict: 10, quality: 85, coverage: 0.85 }),
  Object.freeze({ grade: FusionGradeV2.AA, score: 84, confidence: 82, agreement: 82, conflict: 18, quality: 75, coverage: 0.75 }),
  Object.freeze({ grade: FusionGradeV2.A, score: 76, confidence: 74, agreement: 74, conflict: 26, quality: 65, coverage: 0.65 }),
  Object.freeze({ grade: FusionGradeV2.BBB, score: 68, confidence: 65, agreement: 64, conflict: 36, quality: 55, coverage: 0.55 }),
  Object.freeze({ grade: FusionGradeV2.BB, score: 55, confidence: 55, agreement: 55, conflict: 45, quality: 45, coverage: 0.4 }),
]);

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new Error('Fusion evaluation time must be valid.');
  return date.toISOString();
}

function stringList(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value]).map((item) => text(item)).filter(Boolean);
}

function normalizeQuality(value) {
  if (value == null) return null;
  if (typeof value === 'object' && !Array.isArray(value)) {
    const candidate = value.score ?? value.value ?? value.quality ?? value.dataQuality;
    return Number.isFinite(Number(candidate)) ? clamp(candidate) : null;
  }
  return Number.isFinite(Number(value)) ? clamp(value) : null;
}

function qualityFromResult(result) {
  return normalizeQuality(
    result?.diagnostics?.dataQuality
      ?? result?.diagnostics?.quality
      ?? result?.signal?.diagnostics?.dataQuality
      ?? result?.signal?.diagnostics?.quality,
  );
}

function validateEngineResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Fusion Engine V2 results must be objects.');
  }
  const engine = text(result.engine).toUpperCase();
  if (!engine) throw new Error('Fusion Engine V2 requires result.engine.');
  if (!Object.values(EngineStatus).includes(result.status)) {
    throw new Error(`Unsupported engine status: ${result.status}`);
  }
  if (result.signal != null) {
    if (!Object.values(Direction).includes(result.signal.direction)) {
      throw new Error(`Unsupported signal direction: ${result.signal.direction}`);
    }
    if (text(result.signal.engine).toUpperCase() !== engine) {
      throw new Error(`Engine signal mismatch for ${engine}.`);
    }
  }
  if (
    result.executionEnabled === true
    || result.executionAllowed === true
    || result.automaticSubmissionAllowed === true
    || result.liveExecutionAllowed === true
    || result.signal?.executionEnabled === true
    || result.signal?.executionAllowed === true
  ) {
    throw new Error(`${engine} attempted to grant execution authority.`);
  }
  return engine;
}

function normalizeSource(source) {
  if (Array.isArray(source)) {
    return {
      schema: null,
      schemaVersion: null,
      symbol: null,
      evaluatedAt: null,
      engineResults: source,
      runs: [],
      sourceCoverage: null,
      sourceWarnings: [],
    };
  }
  if (!source || typeof source !== 'object') {
    throw new Error('Fusion Engine V2 requires an Analysis Pipeline result or an EngineResult array.');
  }
  if (!Array.isArray(source.engineResults)) {
    throw new Error('Fusion Engine V2 source.engineResults must be an array.');
  }
  if (
    source.executionEnabled === true
    || source.executionAllowed === true
    || source.automaticSubmissionAllowed === true
    || source.liveExecutionAllowed === true
  ) {
    throw new Error('Fusion Engine V2 rejects execution-enabled pipeline results.');
  }
  return {
    schema: source.schema ?? null,
    schemaVersion: source.schemaVersion ?? null,
    symbol: source.symbol ?? null,
    evaluatedAt: source.evaluatedAt ?? null,
    engineResults: source.engineResults,
    runs: Array.isArray(source.runs) ? source.runs : [],
    sourceCoverage: Number.isFinite(Number(source.coverage)) ? clamp01(source.coverage) : null,
    sourceWarnings: stringList(source.summary?.warnings),
  };
}

function runMetadataMap(runs) {
  const map = new Map();
  for (const run of runs) {
    const engine = text(run?.engine).toUpperCase();
    if (!engine) continue;
    map.set(engine, {
      weight: Number.isFinite(Number(run.weight)) ? Math.max(0, Number(run.weight)) : null,
      required: run.required === true,
      name: text(run.name, engine),
    });
  }
  return map;
}

function observedTimestamp(result) {
  const value = result.signal?.observedAt ?? result.completedAt;
  const timestamp = new Date(value ?? 0).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function freshnessFactor(result, evaluatedMs, maxSignalAgeMs) {
  const timestamp = observedTimestamp(result);
  if (!timestamp || !Number.isFinite(evaluatedMs)) return { ageMs: null, factor: 0.8, available: false };
  const ageMs = Math.max(0, evaluatedMs - timestamp);
  if (ageMs <= maxSignalAgeMs) return { ageMs, factor: 1, available: true };
  const overage = ageMs - maxSignalAgeMs;
  const factor = Math.max(0.25, 1 - (overage / Math.max(1, maxSignalAgeMs * 3)));
  return { ageMs, factor, available: true };
}

function gradeFor(metrics) {
  for (const threshold of GRADE_THRESHOLDS) {
    if (
      metrics.score >= threshold.score
      && metrics.confidence >= threshold.confidence
      && metrics.agreementScore >= threshold.agreement
      && metrics.conflictScore <= threshold.conflict
      && metrics.dataQualityScore >= threshold.quality
      && metrics.coverage >= threshold.coverage
    ) return threshold.grade;
  }
  return FusionGradeV2.REJECT;
}

function reasonCode(value) {
  return text(value).toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '');
}

export function createFusionEngineV2({
  weights = {},
  requiredEngines = [],
  longOnly = true,
  minimumCoverage = 0.5,
  minimumAgreement = 55,
  maximumConflict = 45,
  minimumConfidence = 55,
  minimumDataQuality = 45,
  minimumScore = 55,
  unknownQualityFactor = 0.75,
  maxSignalAgeMs = 15 * 60_000,
  now = () => new Date(),
} = {}) {
  const configuredWeights = Object.freeze({ ...DEFAULT_FUSION_WEIGHTS_V2, ...weights });
  const explicitRequired = new Set(stringList(requiredEngines).map((item) => item.toUpperCase()));
  const thresholds = Object.freeze({
    minimumCoverage: clamp01(minimumCoverage),
    minimumAgreement: clamp(minimumAgreement),
    maximumConflict: clamp(maximumConflict),
    minimumConfidence: clamp(minimumConfidence),
    minimumDataQuality: clamp(minimumDataQuality),
    minimumScore: clamp(minimumScore),
    unknownQualityFactor: clamp01(unknownQualityFactor),
    maxSignalAgeMs: Math.max(1_000, Math.floor(finite(maxSignalAgeMs, 15 * 60_000))),
  });

  function fuse(source, context = {}) {
    const normalizedSource = normalizeSource(source);
    const evaluatedAt = iso(context.evaluatedAt ?? now());
    const evaluatedMs = new Date(evaluatedAt).getTime();
    const runMap = runMetadataMap(normalizedSource.runs);
    const seen = new Set();
    const required = new Set(explicitRequired);
    for (const [engine, metadata] of runMap) if (metadata.required) required.add(engine);

    const contributions = [];
    const statusCounts = { accepted: 0, neutral: 0, rejected: 0, errors: 0 };
    let qualityWeight = 0;
    let qualityNumerator = 0;
    let qualityKnown = 0;
    let longSupport = 0;
    let shortSupport = 0;
    let neutralSupport = 0;
    let winningScoreNumerator = 0;
    let winningConfidenceNumerator = 0;
    let winningQualityNumerator = 0;
    let winningWeight = 0;

    for (const result of normalizedSource.engineResults) {
      const engine = validateEngineResult(result);
      if (seen.has(engine)) throw new Error(`Duplicate Fusion Engine V2 result: ${engine}.`);
      seen.add(engine);
      if (result.status === EngineStatus.ACCEPTED) statusCounts.accepted += 1;
      if (result.status === EngineStatus.NEUTRAL) statusCounts.neutral += 1;
      if (result.status === EngineStatus.REJECTED) statusCounts.rejected += 1;
      if (result.status === EngineStatus.ERROR) statusCounts.errors += 1;

      const metadata = runMap.get(engine) || {};
      const baseWeight = Math.max(0, finite(metadata.weight ?? configuredWeights[engine], 1));
      const score = result.signal ? clampScore(result.signal.score ?? 0) : 0;
      const confidence = result.signal ? clampScore(result.signal.confidence?.value ?? score) : 0;
      const quality = qualityFromResult(result);
      const qualityFactor = quality == null ? thresholds.unknownQualityFactor : quality / 100;
      const freshness = freshnessFactor(result, evaluatedMs, thresholds.maxSignalAgeMs);
      const usable = result.status === EngineStatus.ACCEPTED && Boolean(result.signal);
      const direction = usable ? result.signal.direction : Direction.NEUTRAL;
      const effectiveWeight = usable
        ? baseWeight * (confidence / 100) * qualityFactor * freshness.factor
        : 0;
      const directionalContribution = effectiveWeight * (score / 100);

      if (quality != null) {
        qualityKnown += 1;
        qualityWeight += Math.max(baseWeight, 0.000001);
        qualityNumerator += quality * Math.max(baseWeight, 0.000001);
      }
      if (direction === Direction.LONG) longSupport += directionalContribution;
      else if (direction === Direction.SHORT) shortSupport += directionalContribution;
      else neutralSupport += baseWeight;

      contributions.push({
        engine,
        analyzer: metadata.name ?? engine,
        required: required.has(engine),
        status: result.status,
        direction,
        baseWeight: Number(baseWeight.toFixed(6)),
        effectiveWeight: Number(effectiveWeight.toFixed(6)),
        score: Number(score.toFixed(2)),
        confidence: Number(confidence.toFixed(2)),
        dataQuality: quality,
        dataQualityAvailable: quality != null,
        qualityFactor: Number(qualityFactor.toFixed(4)),
        freshnessFactor: Number(freshness.factor.toFixed(4)),
        ageMs: freshness.ageMs,
        contribution: Number(directionalContribution.toFixed(6)),
        reasons: Object.freeze([...result.reasons]),
      });
    }

    const configuredCount = Math.max(normalizedSource.engineResults.length, normalizedSource.runs.length);
    const evaluatedCount = normalizedSource.engineResults.filter((result) => result.status !== EngineStatus.ERROR).length;
    const coverage = normalizedSource.sourceCoverage ?? (configuredCount ? evaluatedCount / configuredCount : 0);
    const directionalTotal = longSupport + shortSupport;
    const winningDirection = longSupport === shortSupport
      ? Direction.NEUTRAL
      : longSupport > shortSupport ? Direction.LONG : Direction.SHORT;
    const winnerSupport = Math.max(longSupport, shortSupport);
    const loserSupport = Math.min(longSupport, shortSupport);
    const agreementScore = directionalTotal > 0 ? clampScore((winnerSupport / directionalTotal) * 100) : 0;
    const conflictScore = directionalTotal > 0 ? clampScore((loserSupport / directionalTotal) * 100) : 0;

    for (const item of contributions.filter((entry) => entry.direction === winningDirection)) {
      const weight = Math.max(0, item.effectiveWeight);
      winningWeight += weight;
      winningScoreNumerator += item.score * weight;
      winningConfidenceNumerator += item.confidence * weight;
      winningQualityNumerator += (item.dataQuality ?? thresholds.unknownQualityFactor * 100) * weight;
    }

    const weightedSignalScore = winningWeight > 0 ? winningScoreNumerator / winningWeight : 0;
    const weightedSignalConfidence = winningWeight > 0 ? winningConfidenceNumerator / winningWeight : 0;
    const winningQuality = winningWeight > 0 ? winningQualityNumerator / winningWeight : thresholds.unknownQualityFactor * 100;
    const dataQualityScore = qualityWeight > 0 ? qualityNumerator / qualityWeight : thresholds.unknownQualityFactor * 100;
    const qualityCoverage = normalizedSource.engineResults.length ? qualityKnown / normalizedSource.engineResults.length : 0;
    const confidence = clampScore(
      weightedSignalConfidence
      * (agreementScore / 100)
      * Math.sqrt(clamp01(coverage))
      * (winningQuality / 100),
    );
    const score = clampScore(
      weightedSignalScore * 0.45
      + confidence * 0.3
      + agreementScore * 0.15
      + dataQualityScore * 0.1
      - conflictScore * 0.2,
    );

    const missingRequiredEngines = [...required].filter((engine) => !seen.has(engine));
    const failedRequiredEngines = contributions
      .filter((item) => item.required && item.status !== EngineStatus.ACCEPTED)
      .map((item) => item.engine);
    const blockers = [];
    if (winningDirection === Direction.NEUTRAL) blockers.push('NO_DIRECTIONAL_CONSENSUS');
    if (missingRequiredEngines.length) blockers.push('MISSING_REQUIRED_ENGINES');
    if (failedRequiredEngines.length) blockers.push('FAILED_REQUIRED_ENGINES');
    if (coverage < thresholds.minimumCoverage) blockers.push('INSUFFICIENT_COVERAGE');
    if (agreementScore < thresholds.minimumAgreement) blockers.push('INSUFFICIENT_AGREEMENT');
    if (conflictScore > thresholds.maximumConflict) blockers.push('EXCESSIVE_ENGINE_CONFLICT');
    if (confidence < thresholds.minimumConfidence) blockers.push('INSUFFICIENT_CONFIDENCE');
    if (dataQualityScore < thresholds.minimumDataQuality) blockers.push('LOW_DATA_QUALITY');
    if (score < thresholds.minimumScore) blockers.push('INSUFFICIENT_FUSION_SCORE');
    if (longOnly && winningDirection === Direction.SHORT) blockers.push('SHORT_ENTRIES_DISABLED');

    const metrics = {
      score,
      confidence,
      agreementScore,
      conflictScore,
      dataQualityScore,
      coverage,
    };
    let grade = gradeFor(metrics);
    if (blockers.length) grade = FusionGradeV2.REJECT;
    const accepted = grade !== FusionGradeV2.REJECT && blockers.length === 0;
    const direction = accepted ? winningDirection : Direction.NEUTRAL;
    const reasons = [];
    if (accepted) reasons.push(`${winningDirection}_FUSION_CONSENSUS`);
    else reasons.push(...blockers);
    for (const warning of normalizedSource.sourceWarnings) reasons.push(`PIPELINE_WARNING_${reasonCode(warning)}`);

    const decision = createTradeDecision({
      action: accepted ? DecisionAction.HOLD : DecisionAction.REJECT,
      score,
      confidence,
      reasons,
      diagnostics: {
        fusionEngine: FUSION_ENGINE_V2_ID,
        schema: FUSION_RESULT_SCHEMA,
        schemaVersion: FUSION_RESULT_VERSION,
        grade,
        winningDirection,
        agreementScore,
        conflictScore,
        dataQualityScore,
        coverage,
        qualityCoverage,
        missingRequiredEngines,
        failedRequiredEngines,
        observationOnly: true,
        executionAllowed: false,
      },
      decidedAt: evaluatedAt,
    });

    return deepFreeze({
      schema: FUSION_RESULT_SCHEMA,
      schemaVersion: FUSION_RESULT_VERSION,
      engine: FUSION_ENGINE_V2_ID,
      symbol: context.symbol ?? normalizedSource.symbol,
      accepted,
      grade,
      direction,
      winningDirection,
      score: Number(score.toFixed(2)),
      confidence: Number(confidence.toFixed(2)),
      agreementScore: Number(agreementScore.toFixed(2)),
      conflictScore: Number(conflictScore.toFixed(2)),
      dataQuality: Object.freeze({
        score: Number(dataQualityScore.toFixed(2)),
        coverage: Number(qualityCoverage.toFixed(4)),
        known: qualityKnown,
        total: normalizedSource.engineResults.length,
        unknownQualityFactor: thresholds.unknownQualityFactor,
      }),
      coverage: Number(clamp01(coverage).toFixed(4)),
      support: Object.freeze({
        long: Number(longSupport.toFixed(6)),
        short: Number(shortSupport.toFixed(6)),
        neutral: Number(neutralSupport.toFixed(6)),
      }),
      summary: Object.freeze({
        configured: configuredCount,
        evaluated: evaluatedCount,
        ...statusCounts,
        required: required.size,
        missingRequired: missingRequiredEngines.length,
        failedRequired: failedRequiredEngines.length,
      }),
      requiredEngines: Object.freeze([...required]),
      missingRequiredEngines: Object.freeze(missingRequiredEngines),
      failedRequiredEngines: Object.freeze(failedRequiredEngines),
      blockers: Object.freeze(blockers),
      reasons: Object.freeze(reasons),
      contributions: Object.freeze(contributions),
      decision,
      source: Object.freeze({
        schema: normalizedSource.schema,
        schemaVersion: normalizedSource.schemaVersion,
        evaluatedAt: normalizedSource.evaluatedAt,
      }),
      thresholds,
      observationOnly: true,
      executionEnabled: false,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
      mode: 'PAPER_TRADING',
      evaluatedAt,
    });
  }

  return Object.freeze({
    id: FUSION_ENGINE_V2_ID,
    schema: FUSION_RESULT_SCHEMA,
    version: FUSION_RESULT_VERSION,
    weights: configuredWeights,
    thresholds,
    fuse,
  });
}

export function fuseEngineResultsV2(source, options = {}) {
  return createFusionEngineV2(options).fuse(source, options.context || {});
}
