export const TRADINGVIEW_SETTINGS_VERSION = 2;

export const TRADING_MODES = Object.freeze({
  CASH: 'CASH_LONG_ONLY',
  MARGIN: 'CASH_PLUS_MARGIN_LONG',
});

export const TRADINGVIEW_V2_DEFAULT_SETTINGS = Object.freeze({
  settingsVersion: TRADINGVIEW_SETTINGS_VERSION,
  configured: false,
  accountType: 'DEMO',
  tradingMode: TRADING_MODES.CASH,
  maxBuyingPowerPercent: 25,
  positionSizeDollars: null,
  takeProfitDollars: null,
  stopLossDollars: null,
  trailingEnabled: true,
  breakEvenTriggerDollars: 0.02,
  trailRiseStepDollars: 0.05,
  trailStopStepDollars: 0.01,
  maxDailyLossDollars: null,
  maxOpenPositions: 1,
  session: 'ALL',
  autoFlattenTimeLocal: '18:55',
  autoFlattenTimezone: 'America/Chicago',
  noOvernightHolding: true,
  wholeTradeTargets: true,
  wholeSharesOnly: true,
  equitiesOnly: true,
  spotOnly: true,
  cashOnly: true,
  marginLongEnabled: false,
  longOnly: true,
  updatedAt: null,
});

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveMoney(value, field, minimum = 0.01) {
  const parsed = finite(value, null);
  if (parsed == null || parsed < minimum) {
    throw new Error(`${field} must be at least $${minimum.toFixed(2)}`);
  }
  return Number(parsed.toFixed(2));
}

function integer(value, field, minimum, maximum) {
  const parsed = Math.trunc(finite(value, NaN));
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function percentage(value, field) {
  const parsed = finite(value, null);
  if (parsed == null || parsed < 1 || parsed > 100) {
    throw new Error(`${field} must be between 1 and 100`);
  }
  return Number(parsed.toFixed(2));
}

function normalizeTime(value) {
  const normalized = String(value || '').trim();
  const match = /^(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) throw new Error('Auto-flatten time must use HH:MM');
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) throw new Error('Auto-flatten time is invalid');
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function normalizeTimezone(value) {
  const timezone = String(value || TRADINGVIEW_V2_DEFAULT_SETTINGS.autoFlattenTimezone).trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date());
  } catch {
    throw new Error('Auto-flatten timezone is invalid');
  }
  return timezone;
}

function rejectForbiddenFields(input = {}) {
  const allowedPercentageField = 'maxBuyingPowerPercent';
  const forbidden = Object.keys(input).filter((key) => {
    if (key === allowedPercentageField || key === 'tradingMode') return false;
    return /percent|percentage|marginAmount|leverage|short|derivative|option|future|crypto/i.test(key);
  });
  if (forbidden.length) {
    throw new Error(`Unsupported or unsafe settings are forbidden: ${forbidden.join(', ')}`);
  }
}

export function normalizeTradingViewSettingsV2(input = {}) {
  rejectForbiddenFields(input);

  const accountType = String(input.accountType || 'DEMO').trim().toUpperCase();
  if (!['DEMO', 'LIVE'].includes(accountType)) throw new Error('accountType must be DEMO or LIVE');

  const tradingMode = String(input.tradingMode || TRADING_MODES.CASH).trim().toUpperCase();
  if (!Object.values(TRADING_MODES).includes(tradingMode)) {
    throw new Error('Trading mode must be CASH_LONG_ONLY or CASH_PLUS_MARGIN_LONG');
  }

  const session = String(input.session || 'ALL').trim().toUpperCase();
  if (!['CORE', 'ALL'].includes(session)) {
    throw new Error('Trading session must be CORE or ALL; overnight entries are disabled');
  }

  const marginLongEnabled = tradingMode === TRADING_MODES.MARGIN;

  return {
    ...TRADINGVIEW_V2_DEFAULT_SETTINGS,
    settingsVersion: TRADINGVIEW_SETTINGS_VERSION,
    configured: true,
    accountType,
    tradingMode,
    maxBuyingPowerPercent: percentage(
      input.maxBuyingPowerPercent ?? TRADINGVIEW_V2_DEFAULT_SETTINGS.maxBuyingPowerPercent,
      'Max buying power percentage',
    ),
    positionSizeDollars: positiveMoney(input.positionSizeDollars, 'Position size', 1),
    takeProfitDollars: positiveMoney(input.takeProfitDollars, 'Total take profit', 0.01),
    stopLossDollars: positiveMoney(input.stopLossDollars, 'Total stop loss', 0.01),
    maxDailyLossDollars: positiveMoney(input.maxDailyLossDollars, 'Daily max loss', 0.01),
    maxOpenPositions: integer(input.maxOpenPositions ?? 1, 'Max open positions', 1, 30),
    trailingEnabled: input.trailingEnabled !== false,
    breakEvenTriggerDollars: 0.02,
    trailRiseStepDollars: 0.05,
    trailStopStepDollars: 0.01,
    session,
    autoFlattenTimeLocal: normalizeTime(
      input.autoFlattenTimeLocal || TRADINGVIEW_V2_DEFAULT_SETTINGS.autoFlattenTimeLocal,
    ),
    autoFlattenTimezone: normalizeTimezone(
      input.autoFlattenTimezone || TRADINGVIEW_V2_DEFAULT_SETTINGS.autoFlattenTimezone,
    ),
    noOvernightHolding: true,
    wholeTradeTargets: true,
    wholeSharesOnly: true,
    equitiesOnly: true,
    spotOnly: !marginLongEnabled,
    cashOnly: !marginLongEnabled,
    marginLongEnabled,
    longOnly: true,
    updatedAt: new Date().toISOString(),
  };
}

export function migrateTradingViewSettingsV2(stored = {}) {
  const current = stored && typeof stored === 'object' ? stored : {};
  if (Number(current.settingsVersion) === TRADINGVIEW_SETTINGS_VERSION) {
    return {
      ...TRADINGVIEW_V2_DEFAULT_SETTINGS,
      ...current,
      settingsVersion: TRADINGVIEW_SETTINGS_VERSION,
      noOvernightHolding: true,
      wholeTradeTargets: true,
      wholeSharesOnly: true,
      equitiesOnly: true,
      longOnly: true,
    };
  }
  return {
    ...TRADINGVIEW_V2_DEFAULT_SETTINGS,
    accountType: ['DEMO', 'LIVE'].includes(String(current.accountType || '').toUpperCase())
      ? String(current.accountType).toUpperCase()
      : 'DEMO',
    configured: false,
    migrationRequired: true,
    migrationReason: 'SAVE_WHOLE_TRADE_AND_SESSION_SETTINGS',
  };
}
