const STORAGE_KEY = 'moe-trading-mode';
const VERSION = 2;

export const TRADING_MODES = Object.freeze({
  DRY_RUN: 'DRY_RUN',
  SANDBOX: 'SANDBOX',
  LIVE: 'LIVE',
});

const MODE_LABELS = Object.freeze({
  DRY_RUN: 'Preview / Dry Run',
  SANDBOX: 'Webull Sandbox',
  LIVE: 'Live Trading',
});

function enabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function normalizeMode(value, fallback = TRADING_MODES.DRY_RUN) {
  const mode = String(value || '').trim().toUpperCase();
  return Object.values(TRADING_MODES).includes(mode) ? mode : fallback;
}

function capability(mode, env = {}) {
  const reasons = [];

  if (mode === TRADING_MODES.DRY_RUN) {
    return { id: mode, label: MODE_LABELS[mode], available: true, reasons };
  }

  if (mode === TRADING_MODES.SANDBOX) {
    if (String(env.WEBULL_ENVIRONMENT || '').toLowerCase() !== 'sandbox') reasons.push('WEBULL_ENVIRONMENT must be sandbox');
    if (!enabled(env.WEBULL_SANDBOX_ENABLED)) reasons.push('Webull Sandbox is disabled');
    if (!enabled(env.WEBULL_SANDBOX_ORDER_SUBMISSION)) reasons.push('Sandbox order submission is disabled');
    return { id: mode, label: MODE_LABELS[mode], available: reasons.length === 0, reasons };
  }

  if (String(env.WEBULL_ENVIRONMENT || '').toLowerCase() !== 'production') reasons.push('Production Webull environment is not configured');
  if (!enabled(env.WEBULL_LIVE_TRADING)) reasons.push('Live trading master switch is disabled');
  if (!enabled(env.WEBULL_LIVE_ORDER_SUBMISSION)) reasons.push('Live order submission is disabled');
  if (!enabled(env.MOE_LIVE_MODE_UNLOCKED)) reasons.push('MOERAND live-mode unlock is disabled');
  if (!enabled(env.MOE_LIVE_EXECUTION_IMPLEMENTED)) reasons.push('Live execution adapter is not yet approved');
  if (!enabled(env.WEBULL_PROTECTED_ORDERS)) reasons.push('Protected orders are required');

  return { id: mode, label: MODE_LABELS[mode], available: reasons.length === 0, reasons };
}

function capabilities(env = {}) {
  return Object.values(TRADING_MODES).map((mode) => capability(mode, env));
}

function runtimeLiveActive(env = {}) {
  return enabled(env.MOE_LIVE_MODE_UNLOCKED)
    && enabled(env.WEBULL_LIVE_TRADING)
    && enabled(env.WEBULL_LIVE_ORDER_SUBMISSION)
    && !enabled(env.WEBULL_LIVE_KILL_SWITCH);
}

export async function getTradingMode(storage, env = {}) {
  const stored = await storage.get(STORAGE_KEY);
  const fallback = normalizeMode(env.MOE_TRADING_MODE_DEFAULT, TRADING_MODES.SANDBOX);
  const forcedLive = runtimeLiveActive(env);
  const storedSelectedMode = normalizeMode(stored?.selectedMode, fallback);
  const selectedMode = forcedLive ? TRADING_MODES.LIVE : storedSelectedMode;
  const modes = capabilities(env);
  const selectedCapability = modes.find((item) => item.id === selectedMode);
  const effectiveMode = selectedCapability?.available ? selectedMode : TRADING_MODES.DRY_RUN;

  return {
    version: VERSION,
    selectedMode,
    storedSelectedMode,
    runtimeForcedLive: forcedLive,
    effectiveMode,
    locked: selectedMode !== effectiveMode,
    modes,
    automationArmed: effectiveMode === TRADING_MODES.LIVE
      ? enabled(env.WEBULL_LIVE_AUTOMATION_ARMED)
      : enabled(env.WEBULL_AUTOMATION_ARMED),
    liveTradingEnabled: enabled(env.WEBULL_LIVE_TRADING),
    updatedAt: stored?.updatedAt || null,
    updatedBy: stored?.updatedBy || null,
  };
}

export async function updateTradingMode(storage, patch = {}, env = {}) {
  const requestedMode = normalizeMode(patch.mode || patch.selectedMode, '');
  if (!requestedMode) throw new Error('Trading mode must be DRY_RUN, SANDBOX, or LIVE');

  const requestedCapability = capability(requestedMode, env);
  if (!requestedCapability.available) {
    throw new Error(`Trading mode ${requestedMode} is locked: ${requestedCapability.reasons.join('; ')}`);
  }

  if (requestedMode === TRADING_MODES.LIVE && String(patch.confirmation || '') !== 'ENABLE_LIVE_TRADING') {
    throw new Error('Live trading requires the exact confirmation ENABLE_LIVE_TRADING');
  }

  const record = {
    version: VERSION,
    selectedMode: requestedMode,
    updatedAt: new Date().toISOString(),
    updatedBy: String(patch.actor || 'OWNER').slice(0, 64),
  };

  await storage.put(STORAGE_KEY, record);
  return getTradingMode(storage, env);
}