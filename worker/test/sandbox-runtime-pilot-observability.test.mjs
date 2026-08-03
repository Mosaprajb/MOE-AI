import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SANDBOX_AUDIT_PATH,
  SANDBOX_HEALTH_PATH,
  SANDBOX_ORDERS_STATUS_PATH,
  SANDBOX_READINESS_PATH,
  buildSandboxHealth,
  buildSandboxOrdersStatus,
  buildSandboxPilotAudit,
  buildSandboxReadiness,
  recordSandboxPilotEvent,
  sandboxPilotSubmissionGate,
  sandboxRuntimeSafety,
} from '../src/observability/sandbox-runtime-pilot.js';
import { finalizeOrderReservation, reserveOrderSubmission } from '../src/order-reservation.js';

const NOW = Date.now();
const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) { return values.get(key); },
    async put(key, value) {
      if (typeof key === 'object' && key != null) {
        for (const [itemKey, itemValue] of Object.entries(key)) values.set(itemKey, itemValue);
        return;
      }
      values.set(key, value);
    },
  };
}

function safeEnv(overrides = {}) {
  return {
    CF_WORKER_NAME: 'moerand-alerts-sandbox',
    MOE_RUNTIME_ENVIRONMENT: 'SANDBOX_PILOT',
    MOE_SANDBOX_PILOT_ENABLED: 'true',
    MOE_SANDBOX_PILOT_MAX_SUBMISSIONS_TOTAL: '1',
    MOE_SANDBOX_PILOT_EVENT_LIMIT: '1000',
    WEBULL_ENVIRONMENT: 'sandbox',
    WEBULL_API_BASE_URL: 'https://api.sandbox.webull.com',
    WEBULL_SANDBOX_ENABLED: 'true',
    WEBULL_SANDBOX_ORDER_SUBMISSION: 'true',
    WEBULL_AUTO_SUBMIT_SANDBOX: 'true',
    WEBULL_AUTOMATION_ARMED: 'true',
    WEBULL_PROTECTED_ORDERS: 'true',
    WEBULL_READ_ONLY_SYNC: 'true',
    WEBULL_MAX_QUANTITY: '1',
    WEBULL_MAX_NOTIONAL: '1000',
    MOE_WEBHOOK_SECRET: 'do-not-leak-webhook-secret',
    ALPACA_KEY_ID: 'do-not-leak-alpaca-key-id',
    ALPACA_SECRET_KEY: 'do-not-leak-alpaca-secret-key',
    WEBULL_APP_KEY: 'do-not-leak-app-key',
    WEBULL_APP_SECRET: 'do-not-leak-app-secret',
    WEBULL_ACCESS_TOKEN: 'do-not-leak-access-token',
    WEBULL_ACCOUNT_ID: 'do-not-leak-account-id',
    MOE_LIVE_EXECUTION_IMPLEMENTED: 'false',
    MOE_LIVE_MODE_UNLOCKED: 'false',
    WEBULL_LIVE_API_BASE_URL: 'https://api.webull.com',
    WEBULL_LIVE_TRADING: 'false',
    WEBULL_LIVE_ORDER_SUBMISSION: 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: 'false',
    WEBULL_LIVE_KILL_SWITCH: 'true',
    ...overrides,
  };
}

const control = Object.freeze({
  sandboxAutomationEnabled: true,
  effectiveLiveUnlocked: false,
  effectiveLiveAutomationArmed: false,
});

test('health and readiness expose safe pilot state without leaking credentials', () => {
  const env = safeEnv();
  const safety = sandboxRuntimeSafety(env, control);
  const health = buildSandboxHealth(env, { control, now: NOW });
  const readiness = buildSandboxReadiness(env, { control, durableObjectAvailable: true, now: NOW });

  assert.equal(safety.pilotEnvironment, true);
  assert.equal(safety.sandboxReady, true);
  assert.equal(safety.liveLocked, true);
  assert.equal(safety.brokerHost, 'api.sandbox.webull.com');
  assert.equal(health.status, 'UP');
  assert.equal(health.liveFundsAllowed, false);
  assert.equal(readiness.ready, true);
  assert.equal(readiness.status, 'READY');
  assert.deepEqual(readiness.blockers, []);
  assert.equal(readiness.credentials.alpacaKeyId, true);
  assert.equal(readiness.credentials.alpacaSecretKey, true);
  assert.equal(readiness.credentials.requiredCount, 7);

  const serialized = JSON.stringify({ health, readiness });
  for (const secret of [
    env.MOE_WEBHOOK_SECRET,
    env.ALPACA_KEY_ID,
    env.ALPACA_SECRET_KEY,
    env.WEBULL_APP_KEY,
    env.WEBULL_APP_SECRET,
    env.WEBULL_ACCESS_TOKEN,
    env.WEBULL_ACCOUNT_ID,
  ]) {
    assert.equal(serialized.includes(secret), false);
  }
});

test('readiness blocks when Alpaca scanner credentials are missing', () => {
  const env = safeEnv({ ALPACA_KEY_ID: '', ALPACA_SECRET_KEY: '' });
  const readiness = buildSandboxReadiness(env, { control, durableObjectAvailable: true, now: NOW });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.checks.credentialsConfigured, false);
  assert.equal(readiness.credentials.alpacaKeyId, false);
  assert.equal(readiness.credentials.alpacaSecretKey, false);
  assert.equal(readiness.credentials.requiredCount, 7);
  assert.ok(readiness.blockers.includes('credentialsConfigured'));
});

test('the committed pilot stays disarmed until explicitly enabled', () => {
  const env = safeEnv({ MOE_SANDBOX_PILOT_ENABLED: 'false' });
  const readiness = buildSandboxReadiness(env, { control, durableObjectAvailable: true, now: NOW });
  const gate = sandboxPilotSubmissionGate(env, { summary: { submitted: 0 } });

  assert.equal(readiness.ready, false);
  assert.equal(readiness.status, 'CONFIGURED_NOT_ARMED');
  assert.ok(readiness.blockers.includes('pilotArmed'));
  assert.equal(gate.allowed, false);
  assert.deepEqual(gate.blockers, ['SANDBOX_PILOT_NOT_ARMED']);
  assert.equal(gate.remaining, 1);
});

test('Durable Object audit summarizes protected submission, expiration, duplicate, and broker failure events', async () => {
  const env = safeEnv();
  const storage = memoryStorage();
  await storage.put('bot-status:v2', {
    ok: true,
    scanned: 10,
    accepted: 2,
    completedAt: new Date(NOW - 5_000).toISOString(),
  });
  await storage.put('dashboard-live-scanner:v1', {
    generatedAt: new Date(NOW - 4_000).toISOString(),
    rows: [{ id: 'opp-nvda', symbol: 'NVDA', status: 'ACTIVE' }],
  });

  await recordSandboxPilotEvent(storage, {
    type: 'SCANNER_CYCLE_COMPLETED', status: 'COMPLETED', scanned: 10, accepted: 2, selected: 1,
  }, { now: NOW - 4_000 });
  await recordSandboxPilotEvent(storage, {
    type: 'SANDBOX_ORDER_BLOCKED', status: 'BLOCKED', code: 'OPPORTUNITY_EXPIRED', symbol: 'NVDA',
  }, { now: NOW - 3_000 });
  await recordSandboxPilotEvent(storage, {
    type: 'SANDBOX_ORDER_BLOCKED', status: 'BLOCKED', code: 'DUPLICATE_ORDER_BLOCKED', symbol: 'NVDA', duplicate: true,
  }, { now: NOW - 2_000 });
  await recordSandboxPilotEvent(storage, {
    type: 'SANDBOX_ORDER_REJECTED', status: 'REJECTED', brokerHost: 'https://api.sandbox.webull.com', brokerStatus: 503,
    protectedOrder: true, executionAttempted: true, reason: 'sandbox broker unavailable',
  }, { now: NOW - 1_000 });
  await recordSandboxPilotEvent(storage, {
    type: 'SANDBOX_ORDER_SUBMITTED', status: 'SUBMITTED', symbol: 'NVDA', brokerHost: 'https://api.sandbox.webull.com',
    protectedOrder: true, liveFundsUsed: false, executionAttempted: true,
  }, { now: NOW });

  const audit = await buildSandboxPilotAudit(storage, env, { control, now: NOW, limit: 20 });
  assert.equal(audit.ok, true);
  assert.equal(audit.scanner.activeOpportunityCount, 1);
  assert.equal(audit.burnIn.submittedOrderCount, 1);
  assert.equal(audit.burnIn.expiredBlockedCount, 1);
  assert.equal(audit.burnIn.duplicateBlockedCount, 1);
  assert.equal(audit.burnIn.brokerFailureCount, 1);
  assert.equal(audit.burnIn.liveLeakAttemptCount, 0);
  assert.equal(audit.burnIn.unprotectedSubmissionCount, 0);
  assert.equal(audit.burnIn.clean, true);
});

test('order status enforces the one-submission Sandbox pilot ceiling', async () => {
  const env = safeEnv();
  const storage = memoryStorage();
  const reserved = await reserveOrderSubmission(storage, {
    signalId: 'OPP-NVDA-1',
    accountId: env.WEBULL_ACCOUNT_ID,
    symbol: 'NVDA',
    side: 'BUY',
    runtimeMode: 'SANDBOX',
    source: 'MOERAND_AUTO_OPPORTUNITY',
    now: NOW,
  }, env);
  assert.equal(reserved.accepted, true);
  await finalizeOrderReservation(storage, reserved.reservation.id, {
    tradeId: 'sandbox-trade-1', capitalSource: 'CASH',
  }, env);
  await recordSandboxPilotEvent(storage, {
    type: 'SANDBOX_ORDER_SUBMITTED',
    status: 'SUBMITTED',
    symbol: 'NVDA',
    reservationId: reserved.reservation.id,
    protectedOrder: true,
    brokerHost: 'https://api.sandbox.webull.com',
  }, { now: NOW });

  const status = await buildSandboxOrdersStatus(storage, env, { now: NOW });
  assert.equal(status.summary.submitted, 1);
  assert.equal(status.summary.orderEvents, 1);
  assert.equal(status.submissionGate.allowed, false);
  assert.ok(status.submissionGate.blockers.includes('SANDBOX_PILOT_SUBMISSION_LIMIT_REACHED'));
  assert.equal(status.submissionGate.remaining, 0);
  assert.equal(status.liveFundsUsed, false);
});

test('Sandbox pilot wrapper, simulation isolation, endpoints, and secret hygiene stay locked', () => {
  const configText = readFileSync(join(root, 'wrangler.sandbox.jsonc'), 'utf8');
  const config = JSON.parse(configText);
  const mobileAccountEntry = readFileSync(join(root, 'worker/src/sandbox-mobile-account-balances-entry.js'), 'utf8');
  const mobilePhoneEntry = readFileSync(join(root, 'worker/src/sandbox-mobile-phone-fix-entry.js'), 'utf8');
  const mobileFinalEntry = readFileSync(join(root, 'worker/src/sandbox-mobile-final-entry.js'), 'utf8');
  const mobileRuntimeEntry = readFileSync(join(root, 'worker/src/sandbox-mobile-runtime-fix-entry.js'), 'utf8');
  const mobileSettingsEntry = readFileSync(join(root, 'worker/src/sandbox-mobile-settings-entry.js'), 'utf8');
  const mobileUiFixEntry = readFileSync(join(root, 'worker/src/sandbox-mobile-ui-fix-entry.js'), 'utf8');
  const entry = readFileSync(join(root, 'worker/src/sandbox-runtime-pilot-entry.js'), 'utf8');
  const operationsEntry = readFileSync(join(root, 'worker/src/sandbox-operations-entry.js'), 'utf8');
  const operationsV2Entry = readFileSync(join(root, 'worker/src/sandbox-operations-v2-entry.js'), 'utf8');
  const scanModeEntry = readFileSync(join(root, 'worker/src/sandbox-scan-mode-entry.js'), 'utf8');
  const rpcEntry = readFileSync(join(root, 'worker/src/sandbox-simulation-rpc-entry.js'), 'utf8');
  const simulationEntry = readFileSync(join(root, 'worker/src/sandbox-simulation-entry.js'), 'utf8');
  const simulationEngine = readFileSync(join(root, 'worker/src/simulation/simulation-engine.js'), 'utf8');
  const dashboardEntry = readFileSync(join(root, 'worker/src/trading-dashboard-entry.js'), 'utf8');
  const observability = readFileSync(join(root, 'worker/src/observability/sandbox-runtime-pilot.js'), 'utf8');
  const gitignore = readFileSync(join(root, '.gitignore'), 'utf8');

  assert.equal(config.name, 'moerand-alerts-sandbox');
  assert.equal(config.main, 'worker/src/sandbox-mobile-account-balances-entry.js');
  assert.match(mobileAccountEntry, /from '\.\/sandbox-mobile-phone-fix-entry\.js'/);
  assert.match(mobileAccountEntry, /WEBULL_LIVE_APP_KEY/);
  assert.match(mobileAccountEntry, /paper-live-read-only/);
  assert.equal(mobileAccountEntry.includes('placeWebullSandboxOrder'), false);
  assert.match(mobilePhoneEntry, /from '\.\/sandbox-mobile-final-entry\.js'/);
  assert.match(mobileFinalEntry, /from '\.\/sandbox-mobile-runtime-fix-entry\.js'/);
  assert.match(mobileRuntimeEntry, /from '\.\/sandbox-mobile-settings-entry\.js'/);
  assert.match(mobileSettingsEntry, /from '\.\/sandbox-mobile-ui-fix-entry\.js'/);
  assert.match(mobileUiFixEntry, /from '\.\/sandbox-scan-mode-entry\.js'/);
  assert.match(scanModeEntry, /from '\.\/sandbox-simulation-rpc-entry\.js'/);
  assert.match(rpcEntry, /from '\.\/sandbox-simulation-entry\.js'/);
  assert.deepEqual(config.triggers.crons, ['* * * * *']);
  assert.equal(config.durable_objects.bindings[0].name, 'ALERT_COORDINATOR');
  assert.equal(config.observability.enabled, true);
  assert.equal(config.observability.logs.head_sampling_rate, 1);
  assert.equal(config.observability.traces.head_sampling_rate, 1);
  assert.equal(config.vars.MOE_RUNTIME_ENVIRONMENT, 'SANDBOX_PILOT');
  assert.equal(config.vars.MOE_SANDBOX_PILOT_ENABLED, 'false');
  assert.equal(config.vars.MOE_SANDBOX_PILOT_MAX_SUBMISSIONS_TOTAL, '1');
  assert.equal(config.vars.MOE_SANDBOX_DEFAULT_CAPITAL, '25000');
  assert.equal(config.vars.MOE_SIMULATION_ENABLED, 'true');
  assert.equal(config.vars.WEBULL_MAX_QUANTITY, '1');
  assert.equal(config.vars.WEBULL_MAX_NOTIONAL, '1000');
  assert.equal(config.vars.MOE_LIVE_EXECUTION_IMPLEMENTED, 'false');
  assert.equal(config.vars.WEBULL_LIVE_TRADING, 'false');
  assert.equal(config.vars.WEBULL_LIVE_ORDER_SUBMISSION, 'false');
  assert.equal(config.vars.WEBULL_LIVE_AUTOMATION_ARMED, 'false');
  assert.equal(config.vars.WEBULL_LIVE_KILL_SWITCH, 'true');
  assert.ok(config.secrets.required.includes('MOE_WEBHOOK_SECRET'));
  assert.ok(config.secrets.required.includes('ALPACA_KEY_ID'));
  assert.ok(config.secrets.required.includes('ALPACA_SECRET_KEY'));
  assert.ok(config.secrets.required.includes('WEBULL_APP_SECRET'));
  assert.equal(config.secrets.required.includes('MOE_SIMULATION_CONTROL_PIN'), false);
  assert.equal(configText.includes('do-not-leak'), false);

  assert.ok(operationsEntry.includes("from './sandbox-runtime-pilot-entry.js'"));
  assert.ok(operationsEntry.includes('return baseWorker.scheduled(controller, env, ctx)'));
  assert.ok(operationsV2Entry.includes("from './sandbox-operations-entry.js'"));
  assert.ok(operationsV2Entry.includes("from './alpaca-market-regime.js'"));
  assert.ok(operationsV2Entry.includes('probeAlpacaHourlyRegime'));
  assert.ok(operationsV2Entry.includes('return baseWorker.scheduled(controller, env, ctx)'));
  assert.ok(simulationEntry.includes("from './sandbox-operations-v2-entry.js'"));
  assert.ok(simulationEntry.includes('SIMULATION_MODE_ACTIVE'));
  assert.ok(simulationEntry.includes('realSandboxScannerExecuted: false'));
  assert.ok(simulationEngine.includes('LOCAL_SIMULATOR_NO_WEBULL'));
  assert.equal(simulationEngine.includes('webull-client'), false);
  assert.equal(simulationEngine.includes('webull-sandbox'), false);
  assert.ok(entry.includes('SANDBOX_PILOT_NOT_ARMED'));
  assert.ok(entry.includes('SANDBOX_PILOT_SUBMISSION_LIMIT_REACHED'));
  assert.ok(entry.includes('liveFundsUsed: false'));
  for (const constant of [
    'SANDBOX_HEALTH_PATH',
    'SANDBOX_READINESS_PATH',
    'SANDBOX_AUDIT_PATH',
    'SANDBOX_ORDERS_STATUS_PATH',
  ]) {
    assert.ok(dashboardEntry.includes(constant));
    assert.ok(observability.includes(constant));
  }
  assert.deepEqual([
    SANDBOX_HEALTH_PATH,
    SANDBOX_READINESS_PATH,
    SANDBOX_AUDIT_PATH,
    SANDBOX_ORDERS_STATUS_PATH,
  ], [
    '/api/health',
    '/api/readiness',
    '/api/sandbox/audit',
    '/api/sandbox/orders/status',
  ]);
  assert.ok(gitignore.includes('.dev.vars*'));
  assert.ok(gitignore.includes('.env*'));
});