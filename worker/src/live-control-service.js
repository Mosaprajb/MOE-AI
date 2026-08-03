const CONTROL_KEY = 'live-control:v1';
const SECURITY_KEY = 'live-control-security:v1';
const VERSION = 4;

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
  return {
    ready: buildReady,
    buildReady,
    activationConfigured: checks.liveMasterConfigured && checks.liveSubmissionConfigured,
    runtimeActivationRequired: true,
    missingSecrets,
    checks,
  };
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
  else if (action === 'ACTIVATE_LIVE_FULLY') {
    if (!capability.ready) throw new Error(`Production is incomplete: ${capability.missingSecrets.join(', ') || 'required gate failed'}.`);
    if (String(patch.confirmation || '') !== 'ACTIVATE_LIVE_TRADING') throw new Error('Full live activation requires the exact confirmation ACTIVATE_LIVE_TRADING.');
    next = {
      ...next,
      sandboxAutomationEnabled: false,
      liveControlsUnlocked: true,
      liveAutomationArmed: true,
      killSwitch: false,
      lastAction: 'LIVE_FULLY_ACTIVATED',
    };
  } else if (action === 'RETURN_TO_SANDBOX') {
    if (String(patch.confirmation || '') !== 'RETURN_TO_SANDBOX') throw new Error('Sandbox return requires the exact confirmation RETURN_TO_SANDBOX.');
    next = {
      ...next,
      sandboxAutomationEnabled: true,
      liveControlsUnlocked: false,
      liveAutomationArmed: false,
      killSwitch: true,
      lastAction: 'RETURNED_TO_SANDBOX_LOCKED',
    };
  } else if (action === 'UNLOCK_LIVE_CONTROLS') {
    if (!capability.ready) throw new Error(`Static live-trading capability is incomplete: ${capability.missingSecrets.join(', ') || 'required gate failed'}.`);
    if (String(patch.confirmation || '') !== 'UNLOCK_LIVE_CONTROLS') throw new Error('Live control unlock requires the exact confirmation UNLOCK_LIVE_CONTROLS.');
    next = { ...next, sandboxAutomationEnabled: false, liveControlsUnlocked: true, liveAutomationArmed: false, killSwitch: true };
  } else if (action === 'CLEAR_LIVE_KILL_SWITCH') {
    if (!capability.ready) throw new Error('Static live-trading capability is incomplete.');
    if (!next.liveControlsUnlocked) throw new Error('Live controls must be unlocked first.');
    if (String(patch.confirmation || '') !== 'CLEAR_LIVE_KILL_SWITCH') throw new Error('Clearing the live kill switch requires the exact confirmation CLEAR_LIVE_KILL_SWITCH.');
    next = { ...next, killSwitch: false, liveAutomationArmed: false };
  } else if (action === 'ARM_LIVE_AUTOMATION') {
    if (!capability.ready) throw new Error('Static live-trading capability is incomplete.');
    if (!next.liveControlsUnlocked || next.killSwitch) throw new Error('Live controls must be unlocked and the kill switch must be cleared first.');
    if (String(patch.confirmation || '') !== 'ARM_LIVE_AUTOMATION') throw new Error('Arming live automation requires the exact confirmation ARM_LIVE_AUTOMATION.');
    next = { ...next, sandboxAutomationEnabled: false, liveAutomationArmed: true };
  } else if (action === 'DISARM_LIVE_AUTOMATION') next = { ...next, liveAutomationArmed: false, killSwitch: true };
  else if (action === 'LOCK_LIVE_CONTROLS') next = { ...next, liveControlsUnlocked: false, liveAutomationArmed: false, killSwitch: true };
  else if (action === 'LOCK_ALL') next = { ...next, sandboxAutomationEnabled: false, liveControlsUnlocked: false, liveAutomationArmed: false, killSwitch: true };
  else throw new Error('Unsupported live-control action.');

  await storage.put(CONTROL_KEY, next);
  return getLiveControlState(storage, env);
}

export function applyRuntimeLiveControl(env = {}, state = {}) {
  const liveActive = state.liveControlsUnlocked === true && state.killSwitch === false;
  return {
    ...env,
    WEBULL_ENVIRONMENT: liveActive ? 'production' : 'sandbox',
    WEBULL_LIVE_TRADING: liveActive ? 'true' : 'false',
    WEBULL_LIVE_ORDER_SUBMISSION: liveActive ? 'true' : 'false',
    MOE_LIVE_MODE_UNLOCKED: liveActive ? 'true' : 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: liveActive && state.liveAutomationArmed === true ? 'true' : 'false',
    WEBULL_LIVE_KILL_SWITCH: liveActive ? 'false' : 'true',
  };
}
// Authenticated mobile control may only change Sandbox automation or move the
// whole runtime toward a safer state. It cannot unlock Live, clear the kill
// switch, or arm Live automation.
export async function setSandboxAutomationFromAuthenticatedSession(storage, armed, actor = 'MOBILE_DASHBOARD', env = {}) {
  const current = await getLiveControlState(storage, env);
  const next = {
    version: VERSION,
    sandboxAutomationEnabled: armed === true,
    liveControlsUnlocked: current.liveControlsUnlocked === true,
    liveAutomationArmed: current.liveAutomationArmed === true,
    killSwitch: current.killSwitch !== false,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor || 'MOBILE_DASHBOARD').slice(0, 64),
    lastAction: armed === true ? 'MOBILE_SANDBOX_AUTOMATION_ENABLED' : 'MOBILE_SANDBOX_AUTOMATION_DISABLED',
  };
  if (armed === true && (next.liveControlsUnlocked || next.killSwitch === false || next.liveAutomationArmed)) {
    throw new Error('Sandbox automation cannot be armed while any Live control is active.');
  }
  await storage.put(CONTROL_KEY, next);
  return getLiveControlState(storage, env);
}

export async function forceSafeDisarmFromAuthenticatedSession(storage, actor = 'MOBILE_DASHBOARD', env = {}) {
  const next = {
    version: VERSION,
    sandboxAutomationEnabled: false,
    liveControlsUnlocked: false,
    liveAutomationArmed: false,
    killSwitch: true,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor || 'MOBILE_DASHBOARD').slice(0, 64),
    lastAction: 'MOBILE_FORCE_SAFE_DISARM',
  };
  await storage.put(CONTROL_KEY, next);
  return getLiveControlState(storage, env);
}
