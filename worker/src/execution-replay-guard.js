export const EXECUTION_REPLAY_GUARD_VERSION = '1.3.0';

function positiveInteger(value, fallback) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeMode(mode) {
  const value = String(mode || '').trim().toUpperCase();
  if (!['LIVE', 'SANDBOX'].includes(value)) throw new Error('Execution mode must be LIVE or SANDBOX');
  return value;
}

function normalizeSignalId(signalId) {
  const value = String(signalId || '').trim();
  if (!/^[A-Za-z0-9._:-]{8,96}$/.test(value)) {
    throw new Error('A stable signalId of 8-96 safe characters is required for order submission');
  }
  return value;
}

function normalizeIssuedAt(value, now) {
  const timestamp = value == null || value === '' ? now : Date.parse(String(value));
  if (!Number.isFinite(timestamp)) throw new Error('issuedAt must be a valid ISO timestamp');
  return timestamp;
}

function keyFor(mode, signalId) {
  return `execution:${mode.toLowerCase()}:${signalId}`;
}

function getStore(env = {}) {
  const store = env.MOE_EXECUTION_GUARD;
  return store && typeof store.get === 'function' && typeof store.put === 'function' ? store : null;
}

function persistenceFailure(error) {
  return String(error instanceof Error ? error.message : error || 'Execution state persistence failed').slice(0, 500);
}

export function evaluateExecutionReplayGuard({ mode, signalId, issuedAt, now = Date.now() } = {}, env = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedSignalId = normalizeSignalId(signalId);
  const issuedAtMs = normalizeIssuedAt(issuedAt, now);
  const maxAgeSeconds = positiveInteger(env.MOE_SIGNAL_MAX_AGE_SECONDS, normalizedMode === 'LIVE' ? 90 : 300);
  const futureToleranceSeconds = positiveInteger(env.MOE_SIGNAL_FUTURE_TOLERANCE_SECONDS, 15);
  const ageMs = now - issuedAtMs;
  const blockers = [];

  if (ageMs > maxAgeSeconds * 1000) blockers.push(`Signal is older than the ${maxAgeSeconds}-second execution window`);
  if (ageMs < -futureToleranceSeconds * 1000) blockers.push('Signal timestamp is too far in the future');

  return {
    version: EXECUTION_REPLAY_GUARD_VERSION,
    accepted: blockers.length === 0,
    mode: normalizedMode,
    signalId: normalizedSignalId,
    issuedAt: new Date(issuedAtMs).toISOString(),
    ageSeconds: Math.round(ageMs / 1000),
    maxAgeSeconds,
    key: keyFor(normalizedMode, normalizedSignalId),
    blockers,
  };
}

export async function reserveExecution({ mode, signalId, issuedAt, now = Date.now() } = {}, env = {}) {
  const evaluation = evaluateExecutionReplayGuard({ mode, signalId, issuedAt, now }, env);
  if (!evaluation.accepted) return { ...evaluation, reserved: false, duplicate: false };

  const ttlSeconds = positiveInteger(env.MOE_EXECUTION_REPLAY_TTL_SECONDS, evaluation.mode === 'LIVE' ? 900 : 600);
  const store = getStore(env);
  if (!store) {
    const required = evaluation.mode === 'LIVE'
      ? env.MOE_EXECUTION_GUARD_REQUIRED_LIVE !== 'false'
      : env.MOE_EXECUTION_GUARD_REQUIRED_SANDBOX === 'true';
    return {
      ...evaluation,
      accepted: !required,
      reserved: false,
      duplicate: false,
      storage: 'UNAVAILABLE',
      blockers: required ? [`${evaluation.mode} execution replay storage is unavailable`] : [],
    };
  }

  try {
    const existing = await store.get(evaluation.key);
    if (existing) {
      return {
        ...evaluation,
        accepted: false,
        reserved: false,
        duplicate: true,
        storage: 'KV',
        blockers: ['This signalId has already been reserved or submitted in this execution mode'],
      };
    }

    await store.put(evaluation.key, JSON.stringify({
      mode: evaluation.mode,
      signalId: evaluation.signalId,
      issuedAt: evaluation.issuedAt,
      status: 'RESERVED',
      reservedAt: new Date(now).toISOString(),
    }), { expirationTtl: ttlSeconds });
  } catch (error) {
    const required = evaluation.mode === 'LIVE'
      ? env.MOE_EXECUTION_GUARD_REQUIRED_LIVE !== 'false'
      : env.MOE_EXECUTION_GUARD_REQUIRED_SANDBOX === 'true';
    return {
      ...evaluation,
      accepted: !required,
      reserved: false,
      duplicate: false,
      storage: 'ERROR',
      persistenceError: persistenceFailure(error),
      blockers: required ? [`${evaluation.mode} execution replay storage failed`] : [],
    };
  }

  return {
    ...evaluation,
    accepted: true,
    reserved: true,
    duplicate: false,
    storage: 'KV',
    status: 'RESERVED',
    ttlSeconds,
  };
}

export async function finalizeExecution({ mode, signalId, status, brokerOrderIds = null, error = null, now = Date.now() } = {}, env = {}) {
  const normalizedMode = normalizeMode(mode);
  const normalizedSignalId = normalizeSignalId(signalId);
  const normalizedStatus = String(status || '').trim().toUpperCase();
  if (!['SUBMITTED', 'FAILED'].includes(normalizedStatus)) throw new Error('Execution status must be SUBMITTED or FAILED');
  const store = getStore(env);
  const key = keyFor(normalizedMode, normalizedSignalId);
  if (!store) return { updated: false, storage: 'UNAVAILABLE', mode: normalizedMode, signalId: normalizedSignalId, status: normalizedStatus };

  const ttlSeconds = positiveInteger(env.MOE_EXECUTION_REPLAY_TTL_SECONDS, normalizedMode === 'LIVE' ? 900 : 600);
  try {
    const existingText = await store.get(key);
    let existing = {};
    try { existing = existingText ? JSON.parse(existingText) : {}; } catch { existing = {}; }
    const record = {
      ...existing,
      mode: normalizedMode,
      signalId: normalizedSignalId,
      status: normalizedStatus,
      updatedAt: new Date(now).toISOString(),
      ...(normalizedStatus === 'SUBMITTED' ? { submittedAt: new Date(now).toISOString(), brokerOrderIds } : {}),
      ...(normalizedStatus === 'FAILED' ? { failedAt: new Date(now).toISOString(), error: String(error || 'Order submission failed').slice(0, 500) } : {}),
    };
    await store.put(key, JSON.stringify(record), { expirationTtl: ttlSeconds });
    return { updated: true, storage: 'KV', key, ...record };
  } catch (persistenceError) {
    return {
      updated: false,
      storage: 'ERROR',
      key,
      mode: normalizedMode,
      signalId: normalizedSignalId,
      status: normalizedStatus,
      brokerOrderIds,
      persistenceError: persistenceFailure(persistenceError),
    };
  }
}

export function reserveLiveExecution(order = {}, env = {}) {
  return reserveExecution({ mode: 'LIVE', signalId: order.signalId, issuedAt: order.issuedAt }, env);
}

export function reserveSandboxExecution(order = {}, env = {}) {
  return reserveExecution({ mode: 'SANDBOX', signalId: order.signalId, issuedAt: order.issuedAt }, env);
}

export function finalizeLiveExecution(order = {}, result = {}, env = {}) {
  return finalizeExecution({ mode: 'LIVE', signalId: order.signalId, ...result }, env);
}

export function finalizeSandboxExecution(order = {}, result = {}, env = {}) {
  return finalizeExecution({ mode: 'SANDBOX', signalId: order.signalId, ...result }, env);
}
