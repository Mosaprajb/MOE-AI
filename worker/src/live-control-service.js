const CONTROL_KEY = 'live-control:v1';
const SECURITY_KEY = 'live-control-security:v1';
const VERSION = 2;

function enabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function integer(value, fallback, minimum = 1, maximum = 1000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

async function digest(value) {
  const bytes = new TextEncoder().encode(String(value || ''));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)];
}

async function secureEqual(left, right) {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function defaultState(env = {}) {
  return {
    version: VERSION,
    sandboxAutomationEnabled: enabled(env.AUTO_SCANNER_ENABLED) && enabled(env.WEBULL_AUTOMATION_ARMED),
    liveControlsUnlocked: false,
    liveAutomationArmed: false,
    killSwitch: true,
    updatedAt: null,
    updatedBy: null,
    lastAction: 'INITIALIZED_LOCKED',
  };
}

function staticLiveCapability(env = {}) {
  const missingSecrets = ['WEBULL_LIVE_APP_KEY', 'WEBULL_LIVE_APP_SECRET', 'WEBULL_LIVE_ACCESS_TOKEN', 'WEBULL_LIVE_ACCOUNT_ID']
    .filter((key) => !String(env[key] || '').trim());
  const checks = {
    pinControlEnabled: enabled(env.MOE_LIVE_PIN_CONTROL_ENABLED),
    pinConfigured: Boolean(String(env.MOE_LIVE_CONTROL_PIN || '').trim()),
    productionCredentials: missingSecrets.length === 0,
    liveMasterConfigured: enabled(env.WEBULL_LIVE_TRADING),
    liveSubmissionConfigured: enabled(env.WEBULL_LIVE_ORDER_SUBMISSION),
    executionAdapterApproved: enabled(env.MOE_LIVE_EXECUTION_IMPLEMENTED),
    protectedOrders: enabled(env.WEBULL_PROTECTED_ORDERS),
  };
  const buildReady = checks.pinControlEnabled
    && checks.pinConfigured
    && checks.productionCredentials
    && checks.executionAdapterApproved
    && checks.protectedOrders;
  const activationConfigured = checks.liveMasterConfigured && checks.liveSubmissionConfigured;
  return { ready: buildReady && activationConfigured, buildReady, activationConfigured, missingSecrets, checks };
}

async function securityState(storage) {
  const saved = await storage.get(SECURITY_KEY);
  return saved && typeof saved === 'object' ? saved : { failedAttempts: 0, lockedUntil: null, lastFailureAt: null };
}

async function verifyPin(storage, pin, env = {}) {
  if (!enabled(env.MOE_LIVE_PIN_CONTROL_ENABLED)) throw new Error('PIN control is disabled in configuration.');
  const configured = String(env.MOE_LIVE_CONTROL_PIN || '');
  if (!configured) throw new Error('MOE_LIVE_CONTROL_PIN is not configured.');
  const security = await securityState(storage);
  const lockedUntil = security.lockedUntil ? Date.parse(security.lockedUntil) : 0;
  if (lockedUntil > Date.now()) throw new Error(`PIN controls are temporarily locked until ${security.lockedUntil}.`);
  const valid = await secureEqual(pin, configured);
  if (!valid) {
    const maximumAttempts = integer(env.MOE_LIVE_PIN_MAX_ATTEMPTS, 5, 3, 20);
    const lockoutMinutes = integer(env.MOE_LIVE_PIN_LOCKOUT_MINUTES, 15, 1, 1440);
    const failedAttempts = Number(security.failedAttempts || 0) + 1;
    const lockoutTriggered = failedAttempts >= maximumAttempts;
    const remainingAttempts = Math.max(0, maximumAttempts - failedAttempts);
    await storage.put(SECURITY_KEY, {
      failedAttempts: lockoutTriggered ? 0 : failedAttempts,
      lastFailureAt: new Date().toISOString(),
      lockedUntil: lockoutTriggered ? new Date(Date.now() + lockoutMinutes * 60_000).toISOString() : null,
    });
    if (lockoutTriggered) throw new Error(`Incorrect PIN. Too many failed attempts; PIN controls are locked for ${lockoutMinutes} minutes.`);
    throw new Error(`Incorrect PIN. ${remainingAttempts} attempt${remainingAttempts === 1 ? '' : 's'} remaining before temporary lockout.`);
  }
  await storage.put(SECURITY_KEY, { failedAttempts: 0, lockedUntil: null, lastFailureAt: null });
  return true;
}

export async function verifyLiveControlPin(storage, pin, env = {}) {
  return verifyPin(storage, pin, env);
}

export async function getLiveControlState(storage, env = {}) {
  const saved = await storage.get(CONTROL_KEY);
  const state = { ...defaultState(env), ...(saved && typeof saved === 'object' ? saved : {}) };
  const security = await securityState(storage);
  const capability = staticLiveCapability(env);
  const effectiveLiveUnlocked = state.liveControlsUnlocked === true && state.killSwitch === false && capability.ready;
  return {
    ...state,
    pinConfigured: capability.checks.pinConfigured,
    pinControlEnabled: capability.checks.pinControlEnabled,
    staticLiveCapability: capability,
    productionBuildReady: capability.buildReady,
    liveTradingEnabled: effectiveLiveUnlocked,
    pinLockedUntil: security.lockedUntil || null,
    effectiveLiveUnlocked,
    effectiveLiveAutomationArmed: state.liveAutomationArmed === true && effectiveLiveUnlocked,
  };
}

export async function updateLiveControlState(storage, patch = {}, env = {}) {
  await verifyPin(storage, patch.pin, env);
  const action = String(patch.action || '').trim().toUpperCase();
  const actor = String(patch.actor || 'OWNER').slice(0, 64);
  const current = await getLiveControlState(storage, env);
  const capability = current.staticLiveCapability;
  let next = {
    version: VERSION,
    sandboxAutomationEnabled: current.sandboxAutomationEnabled === true,
    liveControlsUnlocked: current.liveControlsUnlocked === true,
    liveAutomationArmed: current.liveAutomationArmed === true,
    killSwitch: current.killSwitch !== false,
    updatedAt: new Date().toISOString(),
    updatedBy: actor,
    lastAction: action,
  };

  if (action === 'TEST_PIN') next = { ...next, lastAction: 'PIN_VERIFIED' };
  else if (action === 'ENABLE_SANDBOX_AUTOMATION') next = { ...next, sandboxAutomationEnabled: true };
  else if (action === 'DISABLE_SANDBOX_AUTOMATION') next = { ...next, sandboxAutomationEnabled: false };
  else if (action === 'UNLOCK_LIVE_CONTROLS') {
    if (String(patch.confirmation || '') !== 'UNLOCK_LIVE_CONTROLS') throw new Error('Live control unlock requires the exact confirmation UNLOCK_LIVE_CONTROLS.');
    next = { ...next, liveControlsUnlocked: true, liveAutomationArmed: false, killSwitch: true };
  } else if (action === 'CLEAR_LIVE_KILL_SWITCH') {
    if (!capability.ready) throw new Error('Static live-trading capability is incomplete.');
    if (!next.liveControlsUnlocked) throw new Error('Live controls must be unlocked first.');
    if (String(patch.confirmation || '') !== 'CLEAR_LIVE_KILL_SWITCH') throw new Error('Clearing the live kill switch requires the exact confirmation CLEAR_LIVE_KILL_SWITCH.');
    next = { ...next, killSwitch: false, liveAutomationArmed: false };
  } else if (action === 'ARM_LIVE_AUTOMATION') {
    if (!capability.ready) throw new Error('Static live-trading capability is incomplete.');
    if (!next.liveControlsUnlocked || next.killSwitch) throw new Error('Live controls must be unlocked and the kill switch must be cleared first.');
    if (String(patch.confirmation || '') !== 'ARM_LIVE_AUTOMATION') throw new Error('Arming live automation requires the exact confirmation ARM_LIVE_AUTOMATION.');
    next = { ...next, liveAutomationArmed: true };
  } else if (action === 'DISARM_LIVE_AUTOMATION') next = { ...next, liveAutomationArmed: false, killSwitch: true };
  else if (action === 'LOCK_LIVE_CONTROLS') next = { ...next, liveControlsUnlocked: false, liveAutomationArmed: false, killSwitch: true };
  else if (action === 'LOCK_ALL') next = { ...next, sandboxAutomationEnabled: false, liveControlsUnlocked: false, liveAutomationArmed: false, killSwitch: true };
  else throw new Error('Unsupported live-control action.');

  await storage.put(CONTROL_KEY, next);
  return getLiveControlState(storage, env);
}

export function applyRuntimeLiveControl(env = {}, state = {}) {
  return {
    ...env,
    MOE_LIVE_MODE_UNLOCKED: state.liveControlsUnlocked === true ? 'true' : 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: state.liveAutomationArmed === true ? 'true' : 'false',
    WEBULL_LIVE_KILL_SWITCH: state.killSwitch === false ? 'false' : 'true',
  };
}
