export const TRADING_DIRECTION_POLICIES = Object.freeze({
  LONG_ONLY: 'LONG_ONLY',
  LONG_AND_SHORT: 'LONG_AND_SHORT',
});

function normalized(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function getTradingDirectionPolicy(env = {}) {
  const configured = normalized(env.MOE_DIRECTION_POLICY || TRADING_DIRECTION_POLICIES.LONG_ONLY);
  if (configured === TRADING_DIRECTION_POLICIES.LONG_AND_SHORT && normalized(env.MOE_ALLOW_SHORT_ENTRIES) === 'TRUE') {
    return TRADING_DIRECTION_POLICIES.LONG_AND_SHORT;
  }
  return TRADING_DIRECTION_POLICIES.LONG_ONLY;
}

export function isLongOnlyTrading(env = {}) {
  return getTradingDirectionPolicy(env) === TRADING_DIRECTION_POLICIES.LONG_ONLY;
}

export function signalOpeningDirection(payload = {}) {
  const side = normalized(payload.side || payload.action || payload.direction);
  if (['BUY', 'LONG', 'BULLISH'].includes(side)) return 'LONG';
  if (['SELL', 'SHORT', 'BEARISH', 'SELL_SHORT'].includes(side)) return 'SHORT';
  return 'UNKNOWN';
}

export function evaluateOpeningDirection(payload = {}, env = {}) {
  const policy = getTradingDirectionPolicy(env);
  const direction = signalOpeningDirection(payload);
  const shortBlocked = policy === TRADING_DIRECTION_POLICIES.LONG_ONLY && direction === 'SHORT';
  return Object.freeze({
    accepted: !shortBlocked,
    policy,
    direction,
    shortEntriesAllowed: policy === TRADING_DIRECTION_POLICIES.LONG_AND_SHORT,
    reason: shortBlocked ? 'LONG_ONLY_SHORT_ENTRY_BLOCKED' : null,
  });
}

export function enforceOpeningDirection(payload = {}, env = {}) {
  const result = evaluateOpeningDirection(payload, env);
  if (!result.accepted) {
    const error = new Error('Short entries are disabled. MOERAND is configured for long-only trading.');
    error.code = result.reason;
    error.directionPolicy = result.policy;
    throw error;
  }
  return result;
}

export function observationDirectionAllowed(direction, env = {}) {
  if (!isLongOnlyTrading(env)) return true;
  return ['LONG', 'BUY', 'BULLISH'].includes(normalized(direction));
}

export function directionPolicySnapshot(env = {}) {
  const policy = getTradingDirectionPolicy(env);
  return Object.freeze({
    policy,
    longEntriesAllowed: true,
    shortEntriesAllowed: policy === TRADING_DIRECTION_POLICIES.LONG_AND_SHORT,
    protectiveLongExitsAllowed: true,
    note: policy === TRADING_DIRECTION_POLICIES.LONG_ONLY
      ? 'BUY entries only. Broker-generated Stop Loss and Take Profit exits remain allowed for long positions.'
      : 'Long and short opening entries are enabled.',
  });
}
