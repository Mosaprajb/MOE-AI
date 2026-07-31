export const OPPORTUNITY_MANAGER_SCHEMA = 'MOE.OpportunityManagerResult';
export const OPPORTUNITY_MANAGER_VERSION = '1.0.0';

export const OpportunityStatus = Object.freeze({
  ACTIVE: 'ACTIVE',
  EXPIRED: 'EXPIRED',
  INVALIDATED: 'INVALIDATED',
  CLOSED: 'CLOSED',
});

export const OPPORTUNITY_GRADE_SCORE = Object.freeze({
  AAA: 100,
  AA: 92,
  A: 84,
  BBB: 74,
  BB: 62,
  REJECT: 0,
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

function positiveInteger(value, fallback, minimum = 1, maximum = 1000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function positiveDuration(value, fallback, minimum = 1_000, maximum = 7 * 24 * 60 * 60_000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function iso(value, field = 'timestamp') {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid timestamp.`);
  return date.toISOString();
}

function timestamp(value, field = 'timestamp') {
  return new Date(iso(value, field)).getTime();
}

function stringList(...values) {
  return [...new Set(values.flat(Infinity).map((value) => text(value)).filter(Boolean))];
}

function normalizeSymbol(value) {
  const symbol = text(value).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('Opportunity symbol is invalid.');
  return symbol;
}

function normalizeDirection(value) {
  const direction = text(value).toUpperCase();
  if (!['LONG', 'SHORT'].includes(direction)) throw new Error('Opportunity direction must be LONG or SHORT.');
  return direction;
}

function normalizeTimeframe(value) {
  const timeframe = text(value).toLowerCase();
  if (!timeframe) throw new Error('Opportunity timeframe is required.');
  return timeframe;
}

function normalizeConfidence(value, fallback) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return clamp(value.value ?? fallback);
  return clamp(value ?? fallback);
}

function executionAuthorityGranted(value) {
  return Boolean(value && typeof value === 'object' && (
    value.executionEnabled === true
    || value.executionAllowed === true
    || value.automaticSubmissionAllowed === true
    || value.liveExecutionAllowed === true
    || value.submit === true
    || value.submitOrder === true
  ));
}

function assertExecutionLocked(envelope, opportunity, fusion) {
  if (executionAuthorityGranted(envelope) || executionAuthorityGranted(opportunity) || executionAuthorityGranted(fusion)) {
    throw new Error('Opportunity Manager rejects execution-enabled input.');
  }
}

function gradeScore(grade) {
  const normalized = text(grade).toUpperCase();
  return OPPORTUNITY_GRADE_SCORE[normalized] ?? 50;
}

function normalizeCoverage(value) {
  const parsed = finite(value, 1);
  return clamp(parsed <= 1 ? parsed * 100 : parsed);
}

function dataQualityScore(fusion, opportunity) {
  const value = fusion?.dataQuality?.score
    ?? fusion?.dataQuality
    ?? opportunity?.metadata?.dataQuality?.score
    ?? opportunity?.metadata?.dataQuality;
  return value == null ? 50 : clamp(value);
}

function familyFrom(opportunity, envelope) {
  return text(
    envelope?.family
      ?? opportunity?.metadata?.setupFamily
      ?? opportunity?.metadata?.strategy
      ?? opportunity?.metadata?.setupType
      ?? opportunity?.metadata?.source
      ?? opportunity?.metadata?.engine,
    'GENERAL',
  ).toUpperCase();
}

function fnv1a(value) {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36).padStart(7, '0');
}

function normalizeFusion(fusion, opportunity) {
  if (fusion == null) return null;
  if (!fusion || typeof fusion !== 'object' || Array.isArray(fusion)) {
    throw new Error('Opportunity fusion result must be an object.');
  }
  const symbol = fusion.symbol == null ? null : normalizeSymbol(fusion.symbol);
  const direction = ['LONG', 'SHORT'].includes(text(fusion.direction).toUpperCase())
    ? text(fusion.direction).toUpperCase()
    : null;
  if (symbol && symbol !== opportunity.symbol) throw new Error('Opportunity and Fusion symbols do not match.');
  if (direction && direction !== opportunity.direction) throw new Error('Opportunity and Fusion directions do not match.');
  return fusion;
}

function resolveExpiry(opportunity, envelope, createdMs, defaultTtlMs, maxTtlMs) {
  const explicit = envelope.expiresAt
    ?? envelope.validUntil
    ?? opportunity.expiresAt
    ?? opportunity.validUntil
    ?? opportunity.metadata?.expiresAt
    ?? opportunity.metadata?.validUntil;
  if (explicit != null) {
    const explicitMs = timestamp(explicit, 'opportunity.expiresAt');
    return Math.min(explicitMs, createdMs + maxTtlMs);
  }
  const requestedTtl = envelope.validForMs
    ?? opportunity.validForMs
    ?? opportunity.metadata?.validForMs
    ?? defaultTtlMs;
  return createdMs + positiveDuration(requestedTtl, defaultTtlMs, 1_000, maxTtlMs);
}

function normalizeEnvelope(input, options) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('Opportunity Manager input must be an object.');
  }
  const opportunity = input.opportunity ?? input;
  if (!opportunity || typeof opportunity !== 'object' || Array.isArray(opportunity)) {
    throw new Error('Opportunity Manager requires an opportunity object.');
  }
  const normalizedIdentity = {
    symbol: normalizeSymbol(opportunity.symbol),
    direction: normalizeDirection(opportunity.direction),
  };
  const fusion = normalizeFusion(input.fusion ?? input.fusionResult ?? opportunity.fusion ?? null, normalizedIdentity);
  assertExecutionLocked(input, opportunity, fusion);

  const symbol = normalizedIdentity.symbol;
  const direction = normalizedIdentity.direction;
  const timeframe = normalizeTimeframe(opportunity.timeframe);
  const createdAt = iso(opportunity.createdAt ?? input.createdAt ?? options.now(), 'opportunity.createdAt');
  const createdMs = new Date(createdAt).getTime();
  const score = clamp(opportunity.score ?? fusion?.score ?? 0);
  const confidence = normalizeConfidence(opportunity.confidence ?? fusion?.confidence, score);
  const grade = text(input.grade ?? fusion?.grade ?? opportunity.metadata?.grade).toUpperCase() || null;
  const family = familyFrom(opportunity, input);
  const customKey = text(input.dedupeKey ?? opportunity.metadata?.dedupeKey);
  const dedupeKey = customKey || `${symbol}|${direction}|${timeframe}|${family}`;
  const expiresMs = resolveExpiry(opportunity, input, createdMs, options.defaultTtlMs, options.maxTtlMs);
  const observedAt = iso(input.observedAt ?? fusion?.evaluatedAt ?? opportunity.createdAt ?? options.now(), 'opportunity.observedAt');
  const quality = dataQualityScore(fusion, opportunity);
  const agreement = clamp(fusion?.agreementScore ?? opportunity.metadata?.agreementScore ?? 50);
  const conflict = clamp(fusion?.conflictScore ?? opportunity.metadata?.conflictScore ?? 0);
  const coverage = normalizeCoverage(fusion?.coverage ?? opportunity.metadata?.coverage ?? 1);
  const universePriority = finite(input.universePriority ?? opportunity.metadata?.universePriority, 0);

  return {
    envelope: input,
    opportunity,
    fusion,
    symbol,
    direction,
    timeframe,
    family,
    dedupeKey,
    sourceId: text(opportunity.id, `${symbol}:${timeframe}:${createdAt}`),
    createdAt,
    createdMs,
    observedAt,
    observedMs: new Date(observedAt).getTime(),
    expiresAt: new Date(expiresMs).toISOString(),
    expiresMs,
    score,
    confidence,
    grade,
    quality,
    agreement,
    conflict,
    coverage,
    universePriority,
    reasons: stringList(opportunity.reasons, fusion?.reasons),
  };
}

function baseRankScore(candidate, nowMs) {
  const ttl = Math.max(1_000, candidate.expiresMs - candidate.createdMs);
  const age = Math.max(0, nowMs - candidate.observedMs);
  const freshness = clamp((1 - age / ttl) * 100);
  const score = candidate.score * 0.30
    + candidate.confidence * 0.20
    + gradeScore(candidate.grade) * 0.15
    + candidate.quality * 0.10
    + candidate.agreement * 0.10
    + candidate.coverage * 0.05
    + freshness * 0.05
    + clamp(candidate.universePriority, 0, 100) * 0.05
    - candidate.conflict * 0.10;
  return { score: clamp(score), freshness };
}

function compareCandidates(left, right, nowMs) {
  const leftRank = baseRankScore(left, nowMs);
  const rightRank = baseRankScore(right, nowMs);
  return leftRank.score - rightRank.score
    || gradeScore(left.grade) - gradeScore(right.grade)
    || left.score - right.score
    || left.confidence - right.confidence
    || left.quality - right.quality
    || left.observedMs - right.observedMs
    || right.sourceId.localeCompare(left.sourceId);
}

function candidateValidity(candidate, options, context, nowMs) {
  if (candidate.expiresMs <= nowMs) {
    return { valid: false, status: OpportunityStatus.EXPIRED, reasons: ['OPPORTUNITY_EXPIRED'] };
  }
  if (candidate.score < options.minimumScore) {
    return { valid: false, status: OpportunityStatus.INVALIDATED, reasons: ['OPPORTUNITY_SCORE_BELOW_MINIMUM'] };
  }
  if (candidate.confidence < options.minimumConfidence) {
    return { valid: false, status: OpportunityStatus.INVALIDATED, reasons: ['OPPORTUNITY_CONFIDENCE_BELOW_MINIMUM'] };
  }
  if (candidate.fusion) {
    if (candidate.fusion.accepted !== true || candidate.grade === 'REJECT') {
      return { valid: false, status: OpportunityStatus.INVALIDATED, reasons: ['FUSION_REJECTED_OPPORTUNITY'] };
    }
    if (Array.isArray(candidate.fusion.blockers) && candidate.fusion.blockers.length) {
      return { valid: false, status: OpportunityStatus.INVALIDATED, reasons: ['FUSION_BLOCKERS_PRESENT', ...candidate.fusion.blockers] };
    }
  }
  if (typeof options.validator === 'function') {
    const result = options.validator(candidate.opportunity, {
      ...context,
      fusion: candidate.fusion,
      now: new Date(nowMs),
    });
    if (result === false) {
      return { valid: false, status: OpportunityStatus.INVALIDATED, reasons: ['CUSTOM_VALIDATION_FAILED'] };
    }
    if (result && typeof result === 'object' && result.valid === false) {
      return {
        valid: false,
        status: result.status === OpportunityStatus.EXPIRED ? OpportunityStatus.EXPIRED : OpportunityStatus.INVALIDATED,
        reasons: stringList(result.reasons, result.reason, 'CUSTOM_VALIDATION_FAILED'),
      };
    }
  }
  return { valid: true, status: OpportunityStatus.ACTIVE, reasons: [] };
}

function recordCandidate(record) {
  return {
    opportunity: record.opportunity,
    fusion: record.fusion,
    symbol: record.symbol,
    direction: record.direction,
    timeframe: record.timeframe,
    family: record.family,
    dedupeKey: record.dedupeKey,
    sourceId: record.sourceId,
    createdAt: record.createdAt,
    createdMs: record.createdMs,
    observedAt: record.observedAt,
    observedMs: record.observedMs,
    expiresAt: record.expiresAt,
    expiresMs: record.expiresMs,
    score: record.score,
    confidence: record.confidence,
    grade: record.grade,
    quality: record.quality,
    agreement: record.agreement,
    conflict: record.conflict,
    coverage: record.coverage,
    universePriority: record.universePriority,
    reasons: record.reasons,
  };
}

function externalRecord(record, nowMs, selected = false, rank = null) {
  const ranking = baseRankScore(recordCandidate(record), nowMs);
  return deepFreeze({
    id: record.id,
    dedupeKey: record.dedupeKey,
    generation: record.generation,
    status: record.status,
    selected,
    rank,
    rankScore: Number(ranking.score.toFixed(2)),
    freshness: Number(ranking.freshness.toFixed(2)),
    symbol: record.symbol,
    direction: record.direction,
    timeframe: record.timeframe,
    family: record.family,
    score: record.score,
    confidence: record.confidence,
    grade: record.grade,
    dataQuality: record.quality,
    agreementScore: record.agreement,
    conflictScore: record.conflict,
    coverage: Number((record.coverage / 100).toFixed(4)),
    universePriority: record.universePriority,
    opportunity: record.opportunity,
    fusion: record.fusion,
    sourceIds: Object.freeze([...record.sourceIds]),
    duplicateCount: record.duplicateCount,
    confirmationCount: record.confirmationCount,
    reasons: Object.freeze([...record.reasons]),
    lifecycleReasons: Object.freeze([...record.lifecycleReasons]),
    firstSeenAt: record.firstSeenAt,
    lastSeenAt: record.lastSeenAt,
    expiresAt: record.expiresAt,
    terminalAt: record.terminalAt,
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}

export function createOpportunityManager({
  topN = 5,
  defaultTtlMs = 15 * 60_000,
  maxTtlMs = 24 * 60 * 60_000,
  minimumScore = 0,
  minimumConfidence = 0,
  identityResolver = null,
  validator = null,
  now = () => new Date(),
} = {}) {
  const options = Object.freeze({
    topN: positiveInteger(topN, 5, 1, 100),
    defaultTtlMs: positiveDuration(defaultTtlMs, 15 * 60_000),
    maxTtlMs: positiveDuration(maxTtlMs, 24 * 60 * 60_000),
    minimumScore: clamp(minimumScore),
    minimumConfidence: clamp(minimumConfidence),
    identityResolver,
    validator,
  });
  if (identityResolver != null && typeof identityResolver !== 'function') {
    throw new Error('Opportunity identityResolver must be a function.');
  }
  if (validator != null && typeof validator !== 'function') {
    throw new Error('Opportunity validator must be a function.');
  }

  const records = new Map();
  const activeByKey = new Map();
  const generations = new Map();
  let duplicatesRemoved = 0;

  function nowMs(context = {}) {
    return timestamp(context.now ?? now(), 'opportunity manager now');
  }

  function transition(record, status, reasons, atMs) {
    if (record.status !== OpportunityStatus.ACTIVE) return false;
    record.status = status;
    record.lifecycleReasons = stringList(record.lifecycleReasons, reasons);
    record.terminalAt = new Date(atMs).toISOString();
    activeByKey.delete(record.dedupeKey);
    return true;
  }

  function refresh(context = {}) {
    const currentMs = nowMs(context);
    let expired = 0;
    let invalidated = 0;
    for (const record of records.values()) {
      if (record.status !== OpportunityStatus.ACTIVE) continue;
      const validity = candidateValidity(recordCandidate(record), options, context, currentMs);
      if (!validity.valid) {
        transition(record, validity.status, validity.reasons, currentMs);
        if (validity.status === OpportunityStatus.EXPIRED) expired += 1;
        else invalidated += 1;
      }
    }
    return { expired, invalidated };
  }

  function createRecord(candidate, validity, currentMs) {
    const resolvedKey = candidate.dedupeKey;
    const generation = (generations.get(resolvedKey) || 0) + 1;
    generations.set(resolvedKey, generation);
    const id = `opp_${fnv1a(`${resolvedKey}|${generation}`)}`;
    const record = {
      id,
      generation,
      status: validity.status,
      dedupeKey: resolvedKey,
      symbol: candidate.symbol,
      direction: candidate.direction,
      timeframe: candidate.timeframe,
      family: candidate.family,
      sourceId: candidate.sourceId,
      sourceIds: new Set([candidate.sourceId]),
      opportunity: candidate.opportunity,
      fusion: candidate.fusion,
      createdAt: candidate.createdAt,
      createdMs: candidate.createdMs,
      observedAt: candidate.observedAt,
      observedMs: candidate.observedMs,
      firstSeenAt: new Date(currentMs).toISOString(),
      lastSeenAt: new Date(currentMs).toISOString(),
      expiresAt: candidate.expiresAt,
      expiresMs: candidate.expiresMs,
      score: candidate.score,
      confidence: candidate.confidence,
      grade: candidate.grade,
      quality: candidate.quality,
      agreement: candidate.agreement,
      conflict: candidate.conflict,
      coverage: candidate.coverage,
      universePriority: candidate.universePriority,
      duplicateCount: 0,
      confirmationCount: 1,
      reasons: [...candidate.reasons],
      lifecycleReasons: [...validity.reasons],
      terminalAt: validity.valid ? null : new Date(currentMs).toISOString(),
    };
    records.set(id, record);
    if (validity.valid) activeByKey.set(resolvedKey, id);
    return record;
  }

  function mergeDuplicate(record, candidate, currentMs) {
    record.duplicateCount += 1;
    record.confirmationCount += 1;
    record.lastSeenAt = new Date(currentMs).toISOString();
    record.sourceIds.add(candidate.sourceId);
    record.reasons = stringList(record.reasons, candidate.reasons);
    record.expiresMs = Math.max(record.expiresMs, candidate.expiresMs);
    record.expiresAt = new Date(record.expiresMs).toISOString();
    duplicatesRemoved += 1;

    if (compareCandidates(candidate, recordCandidate(record), currentMs) > 0) {
      record.sourceId = candidate.sourceId;
      record.opportunity = candidate.opportunity;
      record.fusion = candidate.fusion;
      record.createdAt = candidate.createdAt;
      record.createdMs = candidate.createdMs;
      record.observedAt = candidate.observedAt;
      record.observedMs = candidate.observedMs;
      record.score = candidate.score;
      record.confidence = candidate.confidence;
      record.grade = candidate.grade;
      record.quality = candidate.quality;
      record.agreement = candidate.agreement;
      record.conflict = candidate.conflict;
      record.coverage = candidate.coverage;
      record.universePriority = candidate.universePriority;
    }
    return record;
  }

  function ingest(inputs, context = {}) {
    const currentMs = nowMs(context);
    refresh({ ...context, now: currentMs });
    const list = Array.isArray(inputs) ? inputs : [inputs];
    const touched = [];
    const duplicatesBefore = duplicatesRemoved;
    let added = 0;
    let invalidated = 0;
    let expired = 0;

    for (const input of list.filter((item) => item != null)) {
      const candidate = normalizeEnvelope(input, { ...options, now: () => new Date(currentMs) });
      if (typeof options.identityResolver === 'function') {
        candidate.dedupeKey = text(options.identityResolver(candidate.opportunity, candidate.envelope), candidate.dedupeKey);
      }
      const validity = candidateValidity(candidate, options, context, currentMs);
      const activeId = activeByKey.get(candidate.dedupeKey);
      const active = activeId ? records.get(activeId) : null;

      if (!validity.valid && active && candidate.observedMs >= active.observedMs) {
        transition(active, validity.status, validity.reasons, currentMs);
        touched.push(active);
        if (validity.status === OpportunityStatus.EXPIRED) expired += 1;
        else invalidated += 1;
        continue;
      }
      if (!validity.valid) {
        const terminal = createRecord(candidate, validity, currentMs);
        touched.push(terminal);
        if (validity.status === OpportunityStatus.EXPIRED) expired += 1;
        else invalidated += 1;
        continue;
      }
      if (active) {
        touched.push(mergeDuplicate(active, candidate, currentMs));
        continue;
      }
      touched.push(createRecord(candidate, validity, currentMs));
      added += 1;
    }

    return deepFreeze({
      added,
      duplicatesRemoved: duplicatesRemoved - duplicatesBefore,
      invalidated,
      expired,
      touched: Object.freeze(touched.map((record) => externalRecord(record, currentMs))),
    });
  }

  function selectedSnapshot(limit = options.topN, context = {}) {
    const currentMs = nowMs(context);
    const sweep = refresh({ ...context, now: currentMs });
    const normalizedLimit = positiveInteger(limit, options.topN, 1, 100);
    const active = [...activeByKey.values()]
      .map((id) => records.get(id))
      .filter((record) => record?.status === OpportunityStatus.ACTIVE)
      .sort((left, right) => compareCandidates(recordCandidate(right), recordCandidate(left), currentMs)
        || left.symbol.localeCompare(right.symbol)
        || left.id.localeCompare(right.id));
    const selected = active.slice(0, normalizedLimit)
      .map((record, index) => externalRecord(record, currentMs, true, index + 1));
    const terminal = [...records.values()].filter((record) => record.status !== OpportunityStatus.ACTIVE);

    return deepFreeze({
      schema: OPPORTUNITY_MANAGER_SCHEMA,
      schemaVersion: OPPORTUNITY_MANAGER_VERSION,
      selected: Object.freeze(selected),
      opportunities: Object.freeze(selected),
      summary: Object.freeze({
        stored: records.size,
        active: active.length,
        selected: selected.length,
        omitted: Math.max(0, active.length - selected.length),
        expired: terminal.filter((record) => record.status === OpportunityStatus.EXPIRED).length,
        invalidated: terminal.filter((record) => record.status === OpportunityStatus.INVALIDATED).length,
        closed: terminal.filter((record) => record.status === OpportunityStatus.CLOSED).length,
        duplicatesRemoved,
        expiredThisRun: sweep.expired,
        invalidatedThisRun: sweep.invalidated,
        topN: normalizedLimit,
      }),
      observationOnly: true,
      executionEnabled: false,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
      evaluatedAt: new Date(currentMs).toISOString(),
    });
  }

  function manage(inputs, context = {}) {
    const ingestion = ingest(inputs, context);
    const selection = selectedSnapshot(context.topN ?? options.topN, context);
    return deepFreeze({ ...selection, ingestion });
  }

  function get(id, context = {}) {
    const currentMs = nowMs(context);
    refresh({ ...context, now: currentMs });
    const record = records.get(text(id));
    return record ? externalRecord(record, currentMs) : null;
  }

  function list({ status = null, includeTerminal = true, ...context } = {}) {
    const currentMs = nowMs(context);
    refresh({ ...context, now: currentMs });
    const normalizedStatus = status == null ? null : text(status).toUpperCase();
    return Object.freeze([...records.values()]
      .filter((record) => includeTerminal || record.status === OpportunityStatus.ACTIVE)
      .filter((record) => normalizedStatus == null || record.status === normalizedStatus)
      .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt) || left.id.localeCompare(right.id))
      .map((record) => externalRecord(record, currentMs)));
  }

  function invalidate(id, reason = 'MANUALLY_INVALIDATED', context = {}) {
    const currentMs = nowMs(context);
    const record = records.get(text(id));
    if (!record) return false;
    return transition(record, OpportunityStatus.INVALIDATED, stringList(reason), currentMs);
  }

  function close(id, reason = 'OPPORTUNITY_CLOSED', context = {}) {
    const currentMs = nowMs(context);
    const record = records.get(text(id));
    if (!record) return false;
    return transition(record, OpportunityStatus.CLOSED, stringList(reason), currentMs);
  }

  function clear() {
    records.clear();
    activeByKey.clear();
    generations.clear();
    duplicatesRemoved = 0;
  }

  return Object.freeze({
    schema: OPPORTUNITY_MANAGER_SCHEMA,
    version: OPPORTUNITY_MANAGER_VERSION,
    config: options,
    ingest,
    refresh,
    select: selectedSnapshot,
    manage,
    get,
    list,
    invalidate,
    close,
    clear,
  });
}

export function manageOpportunities(inputs, options = {}) {
  const manager = createOpportunityManager(options);
  return manager.manage(inputs, options.context || {});
}
