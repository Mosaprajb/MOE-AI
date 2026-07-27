export const EXECUTION_REPLAY_GUARD_VERSION = '1.0.0';

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
  const store = env.MOE_EXECUTION_GUARD;
  if (!store || typeof store.get !== 'function' || typeof store.put !== 'function') {
    const required = evaluation.mode === 'LIVE' && env.MOE_EXECUTION_GUARD_REQUIRED_LIVE !== 'false';
    return {
      ...evaluation,
      accepted: !required,
      reserved: false,
      duplicate: false,
      storage: 'UNAVAILABLE',
      blockers: required ? ['Live execution replay storage is unavailable'] : [],
    };
  }

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
    reservedAt: new Date(now).toISOString(),
  }), { expirationTtl: ttlSeconds });

  return {
    ...evaluation,
    accepted: true,
    reserved: true,
    duplicate: false,
    storage: 'KV',
    ttlSeconds,
  };
}
