import {
  Direction,
  EngineStatus,
  createEngineResult,
  createEngineSignal,
} from '../core/domain.js';
import {
  MARKET_SNAPSHOT_SCHEMA,
  MARKET_SNAPSHOT_VERSION,
  validateUnifiedMarketSnapshot,
} from '../market-data/market-snapshot.js';

export const ANALYSIS_PIPELINE_SCHEMA = 'MOE.AnalysisPipelineResult';
export const ANALYSIS_PIPELINE_VERSION = '2.0.0';

export const ANALYZER_CATALOG = Object.freeze({
  smartMoney: Object.freeze({ engine: 'SMART_MONEY', required: true, weight: 1.2, timeoutMs: 3_000 }),
  liquiditySweep: Object.freeze({ engine: 'LIQUIDITY_SWEEP', required: true, weight: 1.15, timeoutMs: 3_000 }),
  institutionalFlow: Object.freeze({ engine: 'INSTITUTIONAL_FLOW', required: true, weight: 1.2, timeoutMs: 3_000 }),
  orderFlow: Object.freeze({ engine: 'ORDER_FLOW', required: false, weight: 1.05, timeoutMs: 2_500 }),
  gammaGex: Object.freeze({ engine: 'GAMMA_GEX', required: false, weight: 0.85, timeoutMs: 2_500 }),
  smt: Object.freeze({ engine: 'SMT_DIVERGENCE', required: false, weight: 0.8, timeoutMs: 2_000 }),
  rvol: Object.freeze({ engine: 'RELATIVE_VOLUME', required: false, weight: 0.75, timeoutMs: 1_500 }),
  portfolioConstraints: Object.freeze({ engine: 'PORTFOLIO_CONSTRAINTS', required: true, weight: 1.1, timeoutMs: 2_000 }),
});

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

function positive(value, fallback, minimum = 1, maximum = 60_000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function strings(...values) {
  return values
    .flat(Infinity)
    .map((value) => text(value))
    .filter(Boolean);
}

function normalizeDirection(value) {
  const normalized = text(value, Direction.NEUTRAL).toUpperCase();
  if (['LONG', 'BULLISH', 'UPSIDE', 'BUY'].includes(normalized)) return Direction.LONG;
  if (['SHORT', 'BEARISH', 'DOWNSIDE', 'SELL'].includes(normalized)) return Direction.SHORT;
  return Direction.NEUTRAL;
}

function iso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) return new Date().toISOString();
  return date.toISOString();
}

function ensureExecutionLocked(result, name) {
  if (!result || typeof result !== 'object') return;
  if (
    result.executionEnabled === true
    || result.executionAllowed === true
    || result.automaticSubmissionAllowed === true
    || result.liveExecutionAllowed === true
  ) {
    throw new Error(`${name} attempted to return execution authority`);
  }
}

function definitionNames(analyzers, definitions) {
  if (Array.isArray(definitions)) {
    return definitions.map((item) => text(item?.name ?? item)).filter(Boolean);
  }
  if (definitions && typeof definitions === 'object') return Object.keys(definitions);

  const supplied = Object.keys(analyzers || {});
  const catalogNames = Object.keys(ANALYZER_CATALOG).filter((name) => supplied.includes(name));
  const customNames = supplied.filter((name) => !ANALYZER_CATALOG[name]).sort();
  return [...catalogNames, ...customNames];
}

function definitionOverride(definitions, name) {
  if (Array.isArray(definitions)) {
    const match = definitions.find((item) => text(item?.name ?? item) === name);
    return match && typeof match === 'object' ? match : {};
  }
  if (definitions && typeof definitions === 'object') return definitions[name] || {};
  return {};
}

function normalizeDefinitions({ analyzers, adapters, definitions, weights, requiredAnalyzers, defaultTimeoutMs }) {
  const required = new Set((Array.isArray(requiredAnalyzers) ? requiredAnalyzers : []).map(String));
  const names = definitionNames(analyzers, definitions);
  if (!names.length) throw new Error('Analysis Pipeline V2 requires at least one analyzer.');

  const seen = new Set();
  return Object.freeze(names.map((name) => {
    if (seen.has(name)) throw new Error(`Duplicate analyzer definition: ${name}`);
    seen.add(name);
    const catalog = ANALYZER_CATALOG[name] || {};
    const override = definitionOverride(definitions, name);
    const engine = text(override.engine ?? catalog.engine ?? name).toUpperCase();
    const adapter = override.adapter ?? adapters?.[name] ?? null;
    if (adapter != null && typeof adapter !== 'function') throw new Error(`${name} adapter must be a function.`);
    return Object.freeze({
      name,
      engine,
      required: override.required ?? (required.has(name) || catalog.required === true),
      weight: Math.max(0, finite(override.weight ?? weights?.[name] ?? catalog.weight, 1)),
      timeoutMs: positive(override.timeoutMs ?? catalog.timeoutMs, defaultTimeoutMs),
      analyzer: analyzers?.[name] ?? null,
      adapter,
    });
  }));
}

function normalizeEngineResult(definition, raw, latencyMs, nowValue) {
  const adapted = raw?.engineResult ?? raw;
  if (adapted && typeof adapted === 'object' && adapted.engine && adapted.status) {
    if (text(adapted.engine).toUpperCase() !== definition.engine) {
      throw new Error(`${definition.name} adapter returned engine ${adapted.engine}; expected ${definition.engine}`);
    }
    ensureExecutionLocked(adapted, definition.name);
    ensureExecutionLocked(adapted.signal, definition.name);
    return createEngineResult({
      ...adapted,
      engine: definition.engine,
      latencyMs,
      completedAt: adapted.completedAt ?? nowValue,
    });
  }

  if (!adapted || typeof adapted !== 'object' || Array.isArray(adapted)) {
    throw new Error(`${definition.name} must return an object.`);
  }
  ensureExecutionLocked(adapted, definition.name);

  const direction = normalizeDirection(adapted.direction ?? adapted.bias ?? adapted.signal?.direction);
  const score = clamp(adapted.score ?? adapted.confidence ?? adapted.signal?.score);
  const confidence = clamp(adapted.confidence ?? adapted.signal?.confidence?.value ?? score);
  const blockers = strings(adapted.blockers, adapted.failedConditions);
  const reasons = strings(adapted.reasons, adapted.reason, adapted.evidence, blockers);
  const requestedStatus = text(adapted.status).toUpperCase();
  let status = EngineStatus.NEUTRAL;
  if (requestedStatus === EngineStatus.ERROR) status = EngineStatus.ERROR;
  else if (requestedStatus === EngineStatus.REJECTED || adapted.rejected === true) status = EngineStatus.REJECTED;
  else if (adapted.available !== false && direction !== Direction.NEUTRAL) status = EngineStatus.ACCEPTED;

  const diagnostics = {
    analyzer: definition.name,
    blockers,
    sourceDiagnostics: adapted.diagnostics ?? {},
    dataQuality: adapted.dataQuality ?? adapted.quality ?? null,
    observationOnly: true,
    executionAllowed: false,
  };
  const signal = status === EngineStatus.ACCEPTED
    ? createEngineSignal({
      engine: definition.engine,
      direction,
      score,
      confidence,
      confidenceSource: definition.engine,
      reasons,
      diagnostics,
      observedAt: adapted.observedAt ?? adapted.evaluatedAt ?? nowValue,
    })
    : null;

  return createEngineResult({
    engine: definition.engine,
    status,
    signal,
    latencyMs,
    reasons,
    diagnostics,
    completedAt: adapted.completedAt ?? adapted.evaluatedAt ?? nowValue,
  });
}

function errorEngineResult(definition, error, latencyMs, nowValue, code = 'ANALYZER_FAILED') {
  const message = error instanceof Error ? error.message : String(error || 'Unknown analyzer failure.');
  return createEngineResult({
    engine: definition.engine,
    status: EngineStatus.ERROR,
    signal: null,
    latencyMs,
    reasons: [code, message],
    diagnostics: {
      analyzer: definition.name,
      code,
      error: { name: error instanceof Error ? error.name : 'Error', message },
      observationOnly: true,
      executionAllowed: false,
    },
    completedAt: nowValue,
  });
}

async function executeAnalyzer(definition, snapshot, context, now) {
  const startedMs = Date.now();
  const startedAt = iso(now());
  const controller = new AbortController();
  let timeoutHandle;

  try {
    if (typeof definition.analyzer !== 'function') {
      throw Object.assign(new Error(`${definition.name} analyzer is not configured.`), { code: 'ANALYZER_NOT_CONFIGURED' });
    }
    const analyzerContext = Object.freeze({
      ...context,
      signal: controller.signal,
      analysisPipeline: Object.freeze({
        schema: ANALYSIS_PIPELINE_SCHEMA,
        version: ANALYSIS_PIPELINE_VERSION,
        analyzer: definition.name,
        engine: definition.engine,
        required: definition.required,
        timeoutMs: definition.timeoutMs,
      }),
    });
    const timeout = new Promise((_, reject) => {
      timeoutHandle = setTimeout(() => {
        controller.abort('ANALYZER_TIMEOUT');
        reject(Object.assign(new Error(`${definition.name} timed out after ${definition.timeoutMs}ms.`), { code: 'ANALYZER_TIMEOUT' }));
      }, definition.timeoutMs);
    });
    const raw = await Promise.race([
      Promise.resolve().then(() => definition.analyzer(snapshot, analyzerContext)),
      timeout,
    ]);
    ensureExecutionLocked(raw, definition.name);
    const adapted = definition.adapter
      ? await definition.adapter(raw, { latencyMs: Date.now() - startedMs, snapshot, context: analyzerContext })
      : raw;
    ensureExecutionLocked(adapted, definition.name);
    const latencyMs = Math.max(0, Date.now() - startedMs);
    const engineResult = normalizeEngineResult(definition, adapted, latencyMs, now());
    return deepFreeze({
      name: definition.name,
      engine: definition.engine,
      required: definition.required,
      weight: definition.weight,
      timeoutMs: definition.timeoutMs,
      startedAt,
      completedAt: engineResult.completedAt,
      latencyMs,
      engineResult,
      opportunity: adapted?.opportunity ?? null,
    });
  } catch (error) {
    const latencyMs = Math.max(0, Date.now() - startedMs);
    const code = text(error?.code, controller.signal.aborted ? 'ANALYZER_TIMEOUT' : 'ANALYZER_FAILED');
    const engineResult = errorEngineResult(definition, error, latencyMs, now(), code);
    return deepFreeze({
      name: definition.name,
      engine: definition.engine,
      required: definition.required,
      weight: definition.weight,
      timeoutMs: definition.timeoutMs,
      startedAt,
      completedAt: engineResult.completedAt,
      latencyMs,
      engineResult,
      opportunity: null,
    });
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

function compatibilityAnalysis(run) {
  const result = run.engineResult;
  const blockers = result.status === EngineStatus.ERROR || result.status === EngineStatus.REJECTED
    ? [...result.reasons]
    : strings(result.diagnostics?.blockers);
  return deepFreeze({
    name: run.name,
    engine: run.engine,
    required: run.required,
    available: result.status !== EngineStatus.ERROR,
    status: result.status,
    score: clamp(result.signal?.score),
    confidence: clamp(result.signal?.confidence?.value),
    direction: result.signal?.direction ?? Direction.NEUTRAL,
    blockers,
    reasons: [...result.reasons],
    latencyMs: run.latencyMs,
    raw: result,
  });
}

function summarizeRuns(runs, { minimumScore, minimumCoverage, longOnly }) {
  const engineResults = runs.map((run) => run.engineResult);
  const analyses = Object.freeze(Object.fromEntries(runs.map((run) => [run.name, compatibilityAnalysis(run)])));
  const successful = runs.filter((run) => run.engineResult.status !== EngineStatus.ERROR);
  const accepted = runs.filter((run) => run.engineResult.status === EngineStatus.ACCEPTED && run.engineResult.signal);
  const requiredFailures = runs.filter((run) => run.required && run.engineResult.status !== EngineStatus.ACCEPTED);
  const coverage = runs.length ? successful.length / runs.length : 0;

  let longSupport = 0;
  let shortSupport = 0;
  let winningScoreNumerator = 0;
  let winningConfidenceNumerator = 0;
  let winningWeight = 0;
  for (const run of accepted) {
    const signal = run.engineResult.signal;
    const contribution = run.weight * (clamp(signal.score) / 100);
    if (signal.direction === Direction.LONG) longSupport += contribution;
    if (signal.direction === Direction.SHORT) shortSupport += contribution;
  }
  const direction = longSupport === shortSupport
    ? Direction.NEUTRAL
    : longSupport > shortSupport ? Direction.LONG : Direction.SHORT;
  for (const run of accepted.filter((item) => item.engineResult.signal.direction === direction)) {
    winningScoreNumerator += run.weight * clamp(run.engineResult.signal.score);
    winningConfidenceNumerator += run.weight * clamp(run.engineResult.signal.confidence?.value);
    winningWeight += run.weight;
  }
  const score = winningWeight > 0 ? winningScoreNumerator / winningWeight : 0;
  const confidence = winningWeight > 0 ? winningConfidenceNumerator / winningWeight : 0;
  const blockers = [];
  for (const run of requiredFailures) blockers.push(`required:${run.name}:${run.engineResult.status}`);
  if (coverage < minimumCoverage) blockers.push(`coverage:${coverage.toFixed(4)} below ${minimumCoverage.toFixed(4)}`);
  if (direction === Direction.NEUTRAL) blockers.push('consensus:no directional majority');
  if (longOnly && direction === Direction.SHORT) blockers.push('directionPolicy:short entries are disabled');
  if (score < minimumScore) blockers.push(`score:${score.toFixed(2)} below ${minimumScore.toFixed(2)}`);

  const reasons = runs.flatMap((run) => run.engineResult.reasons.map((reason) => `${run.name}:${reason}`));
  if (!blockers.length) reasons.push(`${direction}_PIPELINE_CONSENSUS`);

  const counts = Object.freeze({
    configured: runs.length,
    accepted: engineResults.filter((item) => item.status === EngineStatus.ACCEPTED).length,
    neutral: engineResults.filter((item) => item.status === EngineStatus.NEUTRAL).length,
    rejected: engineResults.filter((item) => item.status === EngineStatus.REJECTED).length,
    errors: engineResults.filter((item) => item.status === EngineStatus.ERROR).length,
    requiredFailures: requiredFailures.length,
  });

  return {
    engineResults: Object.freeze(engineResults),
    opportunities: Object.freeze(runs.map((run) => run.opportunity).filter(Boolean)),
    analyses,
    counts,
    coverage: Number(coverage.toFixed(4)),
    score: Number(score.toFixed(2)),
    confidence: Number(confidence.toFixed(2)),
    direction,
    blockers: Object.freeze(blockers),
    reasons: Object.freeze(reasons),
    accepted: blockers.length === 0,
  };
}

export function createAnalysisPipelineV2({
  analyzers = {},
  adapters = {},
  definitions = null,
  weights = {},
  requiredAnalyzers = [],
  minimumScore = 65,
  minimumCoverage = 0.5,
  longOnly = true,
  timeoutMs = 3_000,
  now = () => new Date(),
} = {}) {
  const defaultTimeoutMs = positive(timeoutMs, 3_000);
  const normalizedMinimumScore = clamp(minimumScore);
  const normalizedMinimumCoverage = Math.min(1, Math.max(0, finite(minimumCoverage, 0.5)));
  const normalizedDefinitions = normalizeDefinitions({
    analyzers,
    adapters,
    definitions,
    weights,
    requiredAnalyzers,
    defaultTimeoutMs,
  });

  return Object.freeze({
    schema: ANALYSIS_PIPELINE_SCHEMA,
    version: ANALYSIS_PIPELINE_VERSION,
    definitions: normalizedDefinitions,
    async analyze(snapshot, context = {}) {
      const validation = validateUnifiedMarketSnapshot(snapshot);
      if (!validation.valid) {
        throw new Error(`Analysis Pipeline V2 requires ${MARKET_SNAPSHOT_SCHEMA} ${MARKET_SNAPSHOT_VERSION}: ${validation.blockers.join('; ')}`);
      }
      if (snapshot.executionEnabled === true || snapshot.executionAllowed === true) {
        throw new Error('Analysis Pipeline V2 rejects execution-enabled market snapshots.');
      }

      const startedMs = Date.now();
      const startedAt = iso(now());
      const runs = await Promise.all(
        normalizedDefinitions.map((definition) => executeAnalyzer(definition, snapshot, context, now)),
      );
      const summary = summarizeRuns(runs, {
        minimumScore: normalizedMinimumScore,
        minimumCoverage: normalizedMinimumCoverage,
        longOnly,
      });
      const completedAt = iso(now());

      return deepFreeze({
        schema: ANALYSIS_PIPELINE_SCHEMA,
        schemaVersion: ANALYSIS_PIPELINE_VERSION,
        symbol: snapshot.symbol,
        marketSnapshotSchema: snapshot.schema,
        marketSnapshotVersion: snapshot.schemaVersion,
        accepted: summary.accepted,
        score: summary.score,
        confidence: summary.confidence,
        direction: summary.direction,
        coverage: summary.coverage,
        blockers: summary.blockers,
        reasons: summary.reasons,
        analyses: summary.analyses,
        engineResults: summary.engineResults,
        opportunities: summary.opportunities,
        runs: Object.freeze(runs),
        summary: Object.freeze({
          ...summary.counts,
          warnings: validation.warnings,
          marketStateAvailable: Boolean(context.marketState),
        }),
        observationOnly: true,
        executionEnabled: false,
        executionAllowed: false,
        automaticSubmissionAllowed: false,
        liveExecutionAllowed: false,
        mode: 'PAPER_TRADING',
        startedAt,
        evaluatedAt: completedAt,
        durationMs: Math.max(0, Date.now() - startedMs),
      });
    },
  });
}
