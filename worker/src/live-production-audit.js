import { getWebullAccountSnapshot } from './webull-client.js';
import { getWebullLiveOpenOrders, getWebullLiveOrderHistory } from './webull-live-client.js';

function enabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function liveEnvironment(env = {}) {
  return {
    ...env,
    WEBULL_ENVIRONMENT: 'production',
    WEBULL_API_BASE_URL: env.WEBULL_LIVE_API_BASE_URL || 'https://api.webull.com',
    WEBULL_APP_KEY: env.WEBULL_LIVE_APP_KEY,
    WEBULL_APP_SECRET: env.WEBULL_LIVE_APP_SECRET,
    WEBULL_ACCESS_TOKEN: env.WEBULL_LIVE_ACCESS_TOKEN,
  };
}

function countRecords(value) {
  if (Array.isArray(value)) return value.length;
  if (!value || typeof value !== 'object') return 0;
  for (const key of ['items', 'orders', 'list', 'positions', 'position_list']) {
    if (Array.isArray(value[key])) return value[key].length;
  }
  if (value.data && value.data !== value) return countRecords(value.data);
  return 0;
}

function message(error) {
  return error instanceof Error ? error.message : String(error || 'Unknown error');
}

async function readProbe(id, label, action, summarize) {
  const started = Date.now();
  try {
    const result = await action();
    return {
      id,
      label,
      passed: true,
      status: 'PASS',
      durationMs: Date.now() - started,
      summary: summarize(result),
    };
  } catch (error) {
    return {
      id,
      label,
      passed: false,
      status: 'BLOCKED',
      durationMs: Date.now() - started,
      summary: message(error),
    };
  }
}

export async function runReadOnlyProductionAudit(env = {}) {
  const missingSecrets = ['WEBULL_LIVE_APP_KEY', 'WEBULL_LIVE_APP_SECRET', 'WEBULL_LIVE_ACCESS_TOKEN', 'WEBULL_LIVE_ACCOUNT_ID']
    .filter((key) => !String(env[key] || '').trim());
  const safetyChecks = {
    pinConfigured: enabled(env.MOE_LIVE_PIN_CONTROL_ENABLED) && Boolean(String(env.MOE_LIVE_CONTROL_PIN || '').trim()),
    credentialsConfigured: missingSecrets.length === 0,
    protectedOrdersConfigured: enabled(env.WEBULL_PROTECTED_ORDERS),
    liveMasterLocked: !enabled(env.WEBULL_LIVE_TRADING),
    orderSubmissionLocked: !enabled(env.WEBULL_LIVE_ORDER_SUBMISSION),
    killSwitchActive: enabled(env.WEBULL_LIVE_KILL_SWITCH),
  };

  if (missingSecrets.length > 0) {
    return {
      version: 1,
      auditType: 'READ_ONLY_PRODUCTION_DIAGNOSTIC',
      completedAt: new Date().toISOString(),
      noOrdersSubmitted: true,
      safetyChecks,
      probes: [],
      summary: {
        passed: false,
        status: 'BLOCKED',
        reason: `Missing production secrets: ${missingSecrets.join(', ')}.`,
      },
    };
  }

  const accountId = String(env.WEBULL_LIVE_ACCOUNT_ID).trim();
  const liveEnv = liveEnvironment(env);
  const probes = await Promise.all([
    readProbe('account', 'Production account read', () => getWebullAccountSnapshot(accountId, liveEnv), (snapshot) => `Account response received; positions returned: ${countRecords(snapshot?.positions)}.`),
    readProbe('open-orders', 'Open-order read', () => getWebullLiveOpenOrders(accountId, { pageSize: 100 }, liveEnv), (result) => `Open-order response received; records returned: ${countRecords(result)}.`),
    readProbe('order-history', 'Order-history read', () => getWebullLiveOrderHistory(accountId, { pageSize: 100 }, liveEnv), (result) => `Order-history response received; records returned: ${countRecords(result)}.`),
  ]);
  const passed = Object.values(safetyChecks).every(Boolean) && probes.every((probe) => probe.passed);

  return {
    version: 1,
    auditType: 'READ_ONLY_PRODUCTION_DIAGNOSTIC',
    completedAt: new Date().toISOString(),
    noOrdersSubmitted: true,
    noOrdersModified: true,
    safetyChecks,
    probes,
    summary: {
      passed,
      status: passed ? 'READ_ONLY_CHECKS_PASSED' : 'BLOCKED',
      executionAdapterApproved: false,
    },
  };
}
