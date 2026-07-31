import { LIVE_SCANNER_STORAGE_KEY } from '../dashboard/live-scanner.js';
import { listOrderReservations } from '../order-reservation.js';

export const SANDBOX_PILOT_SCHEMA = 'MOE.SandboxRuntimePilot';
export const SANDBOX_PILOT_VERSION = '1.0.0';
export const SANDBOX_PILOT_EVENT_KEY = 'sandbox-runtime-pilot-events:v1';
export const SANDBOX_HEALTH_PATH = '/api/health';
export const SANDBOX_READINESS_PATH = '/api/readiness';
export const SANDBOX_AUDIT_PATH = '/api/sandbox/audit';
export const SANDBOX_ORDERS_STATUS_PATH = '/api/sandbox/orders/status';

const BOT_STATUS_KEY = 'bot-status:v2';
const DEFAULT_EVENT_LIMIT = 1_000;
const ORDER_EVENT_TYPES = new Set([
  'SANDBOX_ORDER_SUBMITTED',
  'SANDBOX_ORDER_REJECTED',
  'SANDBOX_ORDER_FAILED',
  'SANDBOX_ORDER_BLOCKED',
  'SANDBOX_ORDER_PREVIEWED',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function enabled(value) {
  return text(value).toLowerCase() === 'true';
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback, minimum = 0, maximum = Number.MAX_SAFE_INTEGER) {
  return Math.min(maximum, Math.max(minimum, Math.floor(finite(value, fallback))));
}

function nowMs(value = Date.now()) {
  const parsed = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function iso(value = Date.now()) {
  return new Date(nowMs(value)).toISOString();
}

function host(value, fallback = null) {
  try {
    return new URL(text(value, 'https://api.sandbox.webull.com')).host;
  } catch {
    return fallback;
  }
}

function publicReason(value) {
  const normalized = text(value);
  return normalized ? normalized.slice(0, 240) : null;
}

function countBy(items, selector) {
  return items.reduce((counts, item) => {
    const key = text(selector(item), 'UNKNOWN').toUpperCase();
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
}

function eventLimit(env = {}, override = null) {
  return integer(
    override ?? env.MOE_SANDBOX_PILOT_EVENT_LIMIT,
    DEFAULT_EVENT_LIMIT,
    100,
    5_000,
  );
}

function credentialState(env = {}) {
  const required = {
    webhookSecret: Boolean(text(env.MOE_WEBHOOK_SECRET)),
    alpacaKeyId: Boolean(text(env.ALPACA_KEY_ID)),
    alpacaSecretKey: Boolean(text(env.ALPACA_SECRET_KEY)),
    appKey: Boolean(text(env.WEBULL_APP_KEY)),
    appSecret: Boolean(text(env.WEBULL_APP_SECRET)),
    accessToken: Boolean(text(env.WEBULL_ACCESS_TOKEN)),
    accountId: Boolean(text(env.WEBULL_ACCOUNT_ID)),
  };
  return {
    ...required,
    configured: Object.values(required).every(Boolean),
    configuredCount: Object.values(required).filter(Boolean).length,
    requiredCount: Object.keys(required).length,
  };
}

export function sandboxRuntimeSafety(env = {}, control = {}) {
  const liveLocks = {
    implementationDisabled: !enabled(env.MOE_LIVE_EXECUTION_IMPLEMENTED),
    staticModeLocked: !enabled(env.MOE_LIVE_MODE_UNLOCKED),
    liveTradingDisabled: !enabled(env.WEBULL_LIVE_TRADING),
    liveSubmissionDisabled: !enabled(env.WEBULL_LIVE_ORDER_SUBMISSION),
    liveAutomationDisarmed: !enabled(env.WEBULL_LIVE_AUTOMATION_ARMED),
    liveKillSwitchActive: enabled(env.WEBULL_LIVE_KILL_SWITCH),
    runtimeModeLocked: control.effectiveLiveUnlocked !== true,
    runtimeAutomationDisarmed: control.effectiveLiveAutomationArmed !== true,
  };
  const sandbox = {
    environment: text(env.WEBULL_ENVIRONMENT, 'sandbox').toLowerCase() === 'sandbox',
    enabled: enabled(env.WEBULL_SANDBOX_ENABLED),
    submissionEnabled: enabled(env.WEBULL_SANDBOX_ORDER_SUBMISSION),
    autoSubmitEnabled: enabled(env.WEBULL_AUTO_SUBMIT_SANDBOX),
    automationArmed: enabled(env.WEBULL_AUTOMATION_ARMED),
    protectedOrdersRequired: enabled(env.WEBULL_PROTECTED_ORDERS),
    readOnlyAccountSync: enabled(env.WEBULL_READ_ONLY_SYNC),
    controlEnabled: control.sandboxAutomationEnabled !== false,
  };
  const pilotEnvironment = text(env.MOE_RUNTIME_ENVIRONMENT).toUpperCase() === 'SANDBOX_PILOT';
  const pilotArmed = enabled(env.MOE_SANDBOX_PILOT_ENABLED);
  const liveLocked = Object.values(liveLocks).every(Boolean);
  const sandboxReady = Object.values(sandbox).every(Boolean);
  return Object.freeze({
    runtimeEnvironment: text(env.MOE_RUNTIME_ENVIRONMENT, 'DEFAULT').toUpperCase(),
    pilotEnvironment,
    pilotArmed,
    sandbox,
    liveLocks,
    liveLocked,
    sandboxReady,
    brokerHost: host(env.WEBULL_API_BASE_URL),
    liveBrokerHost: host(env.WEBULL_LIVE_API_BASE_URL, 'api.webull.com'),
    liveFundsAllowed: false,
  });
}

export function sandboxPilotSubmissionGate(env = {}, orderStatus = {}) {
  const pilotEnvironment = text(env.MOE_RUNTIME_ENVIRONMENT).toUpperCase() === 'SANDBOX_PILOT';
  if (!pilotEnvironment) {
    return Object.freeze({ pilotEnvironment: false, allowed: true, blockers: [], maximumSubmissions: null, submitted: null, remaining: null });
  }

  const maximumSubmissions = integer(env.MOE_SANDBOX_PILOT_MAX_SUBMISSIONS_TOTAL, 1, 1, 100);
  const submitted = integer(orderStatus?.summary?.submitted, 0, 0, 100_000);
  const blockers = [];
  if (!enabled(env.MOE_SANDBOX_PILOT_ENABLED)) blockers.push('SANDBOX_PILOT_NOT_ARMED');
  if (submitted >= maximumSubmissions) blockers.push('SANDBOX_PILOT_SUBMISSION_LIMIT_REACHED');
  return Object.freeze({
    pilotEnvironment: true,
    allowed: blockers.length === 0,
    blockers,
    maximumSubmissions,
    submitted,
    remaining: Math.max(0, maximumSubmissions - submitted),
  });
}

function normalizeEvent(input = {}, currentTime = Date.now()) {
  const createdAt = iso(input.createdAt ?? currentTime);
  return Object.freeze({
    id: text(input.id, `pilot_${crypto.randomUUID()}`).slice(0, 96),
    type: text(input.type, 'SANDBOX_PILOT_EVENT').toUpperCase().slice(0, 64),
    status: text(input.status, 'RECORDED').toUpperCase().slice(0, 32),
    code: text(input.code).toUpperCase().slice(0, 96) || null,
    symbol: text(input.symbol).toUpperCase().slice(0, 12) || null,
    opportunityId: text(input.opportunityId).slice(0, 128) || null,
    reservationId: text(input.reservationId).slice(0, 128) || null,
    tradeId: text(input.tradeId).slice(0, 128) || null,
    brokerHost: host(input.brokerHost),
    brokerStatus: integer(input.brokerStatus, 0, 0, 599) || null,
    protectedOrder: input.protectedOrder === true,
    liveFundsUsed: input.liveFundsUsed === true,
    duplicate: input.duplicate === true,
    executionAttempted: input.executionAttempted === true,
    scanned: integer(input.scanned, 0, 0, 100_000),
    accepted: integer(input.accepted, 0, 0, 100_000),
    selected: integer(input.selected, 0, 0, 100_000),
    expired: integer(input.expired, 0, 0, 100_000),
    duplicatesRemoved: integer(input.duplicatesRemoved, 0, 0, 100_000),
    reason: publicReason(input.reason ?? input.error),
    createdAt,
  });
}

export async function recordSandboxPilotEvent(storage, input = {}, options = {}) {
  if (!storage || typeof storage.get !== 'function' || typeof storage.put !== 'function') {
    throw new Error('Sandbox pilot event storage is unavailable.');
  }
  const currentTime = nowMs(options.now);
  const record = normalizeEvent(input, currentTime);
  const previous = await storage.get(SANDBOX_PILOT_EVENT_KEY);
  const events = [record, ...(Array.isArray(previous) ? previous : [])]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, integer(options.limit, DEFAULT_EVENT_LIMIT, 100, 5_000));
  await storage.put(SANDBOX_PILOT_EVENT_KEY, events);
  console.log(JSON.stringify({ event: 'SANDBOX_RUNTIME_PILOT_AUDIT', ...record }));
  return record;
}

function burnInSummary(events, reservations, currentTime) {
  const chronological = [...events].sort((left, right) => Date.parse(left.createdAt) - Date.parse(right.createdAt));
  const firstAt = chronological[0]?.createdAt || null;
  const lastAt = chronological.at(-1)?.createdAt || null;
  const submittedOrders = events.filter((event) => event.type === 'SANDBOX_ORDER_SUBMITTED');
  const duplicateBlocks = events.filter((event) => event.duplicate || event.code === 'DUPLICATE_ORDER_BLOCKED');
  const expiredBlocks = events.filter((event) => event.code === 'OPPORTUNITY_EXPIRED');
  const brokerFailures = events.filter((event) => new Set(['SANDBOX_ORDER_FAILED', 'SANDBOX_ORDER_REJECTED']).has(event.type));
  const liveLeakAttempts = events.filter((event) => event.liveFundsUsed || event.brokerHost === 'api.webull.com');
  const protectionViolations = submittedOrders.filter((event) => !event.protectedOrder);
  return {
    firstEventAt: firstAt,
    lastEventAt: lastAt,
    runtimeMinutes: firstAt ? Math.max(0, Math.floor((currentTime - Date.parse(firstAt)) / 60_000)) : 0,
    eventCount: events.length,
    submittedOrderCount: submittedOrders.length,
    duplicateBlockedCount: duplicateBlocks.length,
    expiredBlockedCount: expiredBlocks.length,
    brokerFailureCount: brokerFailures.length,
    releasedReservationCount: reservations.filter((item) => item.status === 'RELEASED').length,
    liveLeakAttemptCount: liveLeakAttempts.length,
    unprotectedSubmissionCount: protectionViolations.length,
    clean: liveLeakAttempts.length === 0 && protectionViolations.length === 0,
  };
}

export function buildSandboxHealth(env = {}, options = {}) {
  const currentTime = nowMs(options.now);
  const safety = sandboxRuntimeSafety(env, options.control || {});
  const status = !safety.liveLocked
    ? 'SAFETY_BLOCKED'
    : safety.pilotEnvironment && !safety.pilotArmed
      ? 'DISARMED'
      : 'UP';
  return Object.freeze({
    schema: SANDBOX_PILOT_SCHEMA,
    schemaVersion: SANDBOX_PILOT_VERSION,
    ok: status !== 'SAFETY_BLOCKED',
    status,
    service: text(env.CF_WORKER_NAME, safety.pilotEnvironment ? 'moerand-alerts-sandbox' : 'moerand-alerts'),
    runtimeEnvironment: safety.runtimeEnvironment,
    pilotArmed: safety.pilotArmed,
    liveLocked: safety.liveLocked,
    liveFundsAllowed: false,
    checkedAt: iso(currentTime),
  });
}

export function buildSandboxReadiness(env = {}, options = {}) {
  const currentTime = nowMs(options.now);
  const control = options.control || {};
  const safety = sandboxRuntimeSafety(env, control);
  const credentials = credentialState(env);
  const checks = {
    pilotEnvironment: safety.pilotEnvironment,
    pilotArmed: safety.pilotArmed,
    durableObjectAvailable: options.durableObjectAvailable !== false,
    sandboxConfiguration: safety.sandboxReady,
    liveLocked: safety.liveLocked,
    credentialsConfigured: credentials.configured,
    sandboxBrokerOnly: safety.brokerHost !== 'api.webull.com',
    maximumQuantityOne: finite(env.WEBULL_MAX_QUANTITY, 1) <= 1,
    maximumNotionalOneThousand: finite(env.WEBULL_MAX_NOTIONAL, 1_000) <= 1_000,
    maximumSubmissionsOne: integer(env.MOE_SANDBOX_PILOT_MAX_SUBMISSIONS_TOTAL, 1, 1, 100) === 1,
  };
  const blockers = Object.entries(checks).filter(([, passed]) => !passed).map(([name]) => name);
  return Object.freeze({
    schema: SANDBOX_PILOT_SCHEMA,
    schemaVersion: SANDBOX_PILOT_VERSION,
    ok: blockers.length === 0,
    ready: blockers.length === 0,
    status: blockers.length === 0 ? 'READY' : safety.pilotEnvironment && !safety.pilotArmed ? 'CONFIGURED_NOT_ARMED' : 'BLOCKED',
    blockers,
    checks,
    credentials,
    safety,
    checkedAt: iso(currentTime),
  });
}

export async function buildSandboxOrdersStatus(storage, env = {}, options = {}) {
  const currentTime = nowMs(options.now);
  const reservations = await listOrderReservations(storage, { limit: 500 });
  const previous = await storage.get(SANDBOX_PILOT_EVENT_KEY);
  const events = (Array.isArray(previous) ? previous : [])
    .filter((event) => ORDER_EVENT_TYPES.has(text(event?.type).toUpperCase()))
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const summary = {
    totalReservations: reservations.length,
    reserved: reservations.filter((item) => item.status === 'RESERVED').length,
    submitted: reservations.filter((item) => item.status === 'SUBMITTED').length,
    released: reservations.filter((item) => item.status === 'RELEASED').length,
    orderEvents: events.length,
  };
  const gate = sandboxPilotSubmissionGate(env, { summary });
  return Object.freeze({
    schema: SANDBOX_PILOT_SCHEMA,
    schemaVersion: SANDBOX_PILOT_VERSION,
    ok: true,
    mode: 'SANDBOX',
    summary,
    submissionGate: gate,
    reservations,
    recentOrderEvents: events.slice(0, integer(options.limit, 100, 1, 500)),
    liveFundsUsed: false,
    checkedAt: iso(currentTime),
  });
}

export async function buildSandboxPilotAudit(storage, env = {}, options = {}) {
  const currentTime = nowMs(options.now);
  const limit = integer(options.limit, 100, 1, 500);
  const [storedEvents, botStatus, liveScanner, reservations] = await Promise.all([
    storage.get(SANDBOX_PILOT_EVENT_KEY),
    storage.get(BOT_STATUS_KEY),
    storage.get(LIVE_SCANNER_STORAGE_KEY),
    listOrderReservations(storage, { limit: 500 }),
  ]);
  const events = (Array.isArray(storedEvents) ? storedEvents : [])
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  const safety = sandboxRuntimeSafety(env, options.control || {});
  const activeRows = Array.isArray(liveScanner?.rows) ? liveScanner.rows : [];
  const lastScannerAt = botStatus?.completedAt || botStatus?.recordedAt || null;
  const scannerAgeSeconds = lastScannerAt
    ? Math.max(0, Math.floor((currentTime - Date.parse(lastScannerAt)) / 1_000))
    : null;
  const burnIn = burnInSummary(events, reservations, currentTime);
  return Object.freeze({
    schema: SANDBOX_PILOT_SCHEMA,
    schemaVersion: SANDBOX_PILOT_VERSION,
    ok: safety.liveLocked && burnIn.clean,
    mode: 'SANDBOX',
    storage: 'DURABLE_OBJECT',
    safety,
    scanner: {
      lastRun: botStatus || null,
      lastRunAt: lastScannerAt,
      ageSeconds: scannerAgeSeconds,
      activeOpportunityCount: activeRows.length,
      generatedAt: liveScanner?.generatedAt || null,
    },
    reservations: {
      counts: countBy(reservations, (item) => item.status),
      recent: reservations.slice(0, limit),
    },
    events: {
      counts: countBy(events, (item) => item.type),
      recent: events.slice(0, limit),
    },
    burnIn,
    liveFundsUsed: false,
    checkedAt: iso(currentTime),
  });
}
