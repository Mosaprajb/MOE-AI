const EXCHANGE_TIME_ZONE = 'America/New_York';
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);

function enabled(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).toLowerCase() === 'true';
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback) {
  const parsed = finite(value, fallback);
  return parsed > 0 ? parsed : fallback;
}

function clamp(value, minimum, maximum, fallback) {
  const parsed = finite(value, fallback);
  return Math.min(maximum, Math.max(minimum, parsed));
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'items', 'positions', 'position_list', 'list']) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (value.data && value.data !== value) return pickArray(value.data);
  return [];
}

function exchangeParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EXCHANGE_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((item) => [item.type, item.value]));
  return {
    ...values,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    weekdayOpen: WEEKDAYS.has(values.weekday),
  };
}

function minuteSetting(value, fallback) {
  const raw = text(value);
  if (!raw) return fallback;
  if (/^\d{1,2}:\d{2}$/.test(raw)) {
    const [hour, minute] = raw.split(':').map(Number);
    if (hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59) return hour * 60 + minute;
  }
  const numeric = finite(raw, fallback);
  return Math.max(0, Math.min(1439, numeric));
}

function formatMinute(minutes) {
  const normalized = Math.max(0, Math.min(1439, Math.floor(minutes)));
  return `${String(Math.floor(normalized / 60)).padStart(2, '0')}:${String(normalized % 60).padStart(2, '0')} ET`;
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = finite(value, null);
    if (parsed != null) return parsed;
  }
  return null;
}

function accountMetrics(snapshot = {}) {
  const rawBalance = snapshot.balance || {};
  const balance = rawBalance?.data && !Array.isArray(rawBalance.data) ? rawBalance.data : rawBalance;
  const usd = Array.isArray(balance.account_currency_assets)
    ? balance.account_currency_assets.find((item) => String(item.currency || '').toUpperCase() === 'USD') || balance.account_currency_assets[0] || {}
    : {};
  const positions = pickArray(snapshot.positions);
  const marketValue = positions.reduce((sum, item) => sum + (firstFinite(item.market_value, item.marketValue, item.position_value) || 0), 0);
  return {
    cashBalance: firstFinite(usd.cash_balance, balance.total_cash_balance, balance.cash_balance),
    settledCash: firstFinite(usd.settled_cash, balance.settled_cash, balance.settledCash),
    dayBuyingPower: firstFinite(usd.day_buying_power, balance.day_buying_power, balance.dayBuyingPower),
    overnightBuyingPower: firstFinite(usd.overnight_buying_power, balance.overnight_buying_power, balance.overnightBuyingPower),
    netLiquidation: firstFinite(usd.net_liquidation_value, balance.total_net_liquidation_value, balance.net_liquidation_value, balance.total_asset, balance.equity),
    maintenanceMargin: firstFinite(balance.maintenance_margin, balance.maintenanceMargin),
    marginExcess: firstFinite(balance.margin_excess, balance.marginExcess),
    sma: firstFinite(balance.sma, balance.special_memorandum_account),
    marginCallCount: Array.isArray(balance.open_margin_calls) ? balance.open_margin_calls.length : 0,
    positionMarketValue: Number(marketValue.toFixed(2)),
  };
}

function qualityMetrics({ signal = {}, plan = {}, brain = {}, decision = {}, context = {} } = {}) {
  const referencePrice = firstFinite(signal.limitPrice, context.marketPrice, plan.order?.limitPrice);
  const quantity = Math.max(0, Math.floor(firstFinite(plan.sizing?.quantity, signal.requestedQuantity, context.quantity) || 0));
  const stopLoss = firstFinite(signal.stopLoss, plan.order?.stopLoss);
  const takeProfit = firstFinite(signal.takeProfit, plan.order?.takeProfit);
  const riskPerShare = referencePrice != null && stopLoss != null ? Math.abs(referencePrice - stopLoss) : null;
  const rewardPerShare = referencePrice != null && takeProfit != null ? Math.abs(takeProfit - referencePrice) : null;
  const riskReward = firstFinite(plan.evaluation?.riskReward, context.riskReward, riskPerShare > 0 ? rewardPerShare / riskPerShare : null);
  return {
    referencePrice,
    quantity,
    notional: referencePrice != null && quantity > 0 ? Number((referencePrice * quantity).toFixed(2)) : null,
    riskDollars: riskPerShare != null && quantity > 0 ? Number((riskPerShare * quantity).toFixed(2)) : null,
    riskReward,
    confidence: firstFinite(decision.confidence, brain.confidence, context.aiConfidence, context.confidence),
    score: firstFinite(plan.evaluation?.score, brain.brainScore, brain.score, context.signalScore),
    grade: text(decision.grade ?? context.grade).toUpperCase(),
    relativeVolume: firstFinite(context.relativeVolume, brain.relativeVolume),
    spreadPercent: firstFinite(context.spreadPercent, brain.spreadPercent),
    marginable: context.marginable === true || context.isMarginable === true || signal.marginable === true,
    maintenanceRequirementPercent: firstFinite(context.maintenanceRequirementPercent, context.maintenanceRequirement, signal.maintenanceRequirementPercent),
  };
}

function requestedCapitalMode(value) {
  const mode = text(value, 'AUTO').toUpperCase();
  return new Set(['AUTO', 'CASH_ONLY', 'MARGIN_INTRADAY']).has(mode) ? mode : 'AUTO';
}

function marginQualityAccepted(quality, env = {}) {
  const minimumConfidence = clamp(env.MOE_MARGIN_MIN_CONFIDENCE, 0, 100, 85);
  const minimumScore = clamp(env.MOE_MARGIN_MIN_SCORE, 0, 100, 85);
  const minimumRiskReward = positive(env.MOE_MARGIN_MIN_RISK_REWARD, 2.5);
  const maximumSpread = positive(env.MOE_MARGIN_MAX_SPREAD_PERCENT, 0.35);
  const minimumRelativeVolume = positive(env.MOE_MARGIN_MIN_RELATIVE_VOLUME, 1.2);
  const allowedGrades = new Set(text(env.MOE_MARGIN_ALLOWED_GRADES, 'ELITE,A+,A').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean));
  const checks = {
    confidence: quality.confidence != null && quality.confidence >= minimumConfidence,
    score: quality.score != null && quality.score >= minimumScore,
    riskReward: quality.riskReward != null && quality.riskReward >= minimumRiskReward,
    grade: allowedGrades.size === 0 || allowedGrades.has(quality.grade),
    relativeVolume: quality.relativeVolume != null && quality.relativeVolume >= minimumRelativeVolume,
    spread: quality.spreadPercent != null && quality.spreadPercent <= maximumSpread,
  };
  return {
    accepted: Object.values(checks).every(Boolean),
    checks,
    thresholds: { minimumConfidence, minimumScore, minimumRiskReward, maximumSpread, minimumRelativeVolume, allowedGrades: [...allowedGrades] },
  };
}

export function capitalPolicySchedule(env = {}) {
  const newEntryCutoff = minuteSetting(env.MOE_MARGIN_NEW_ENTRY_CUTOFF_ET, 15 * 60 + 15);
  const liquidationStart = minuteSetting(env.MOE_MARGIN_LIQUIDATION_START_ET, 15 * 60 + 45);
  const hardExit = minuteSetting(env.MOE_MARGIN_HARD_EXIT_ET, 15 * 60 + 55);
  if (!(newEntryCutoff < liquidationStart && liquidationStart < hardExit && hardExit < 16 * 60)) {
    throw new Error('Margin time controls must satisfy entry cutoff < liquidation start < hard exit < 16:00 ET');
  }
  return {
    newEntryCutoff,
    liquidationStart,
    hardExit,
    labels: {
      newEntryCutoff: formatMinute(newEntryCutoff),
      liquidationStart: formatMinute(liquidationStart),
      hardExit: formatMinute(hardExit),
    },
  };
}

export function evaluateCapitalPolicy({
  signal = {},
  plan = {},
  brain = {},
  decision = {},
  context = {},
  accountSnapshot = {},
  mode = 'SANDBOX',
  now = new Date(),
} = {}, env = {}) {
  const runtimeMode = text(mode, 'SANDBOX').toUpperCase();
  const schedule = capitalPolicySchedule(env);
  const clock = exchangeParts(now);
  const account = accountMetrics(accountSnapshot);
  const quality = qualityMetrics({ signal, plan, brain, decision, context });
  const requestedMode = requestedCapitalMode(context.capitalMode ?? signal.capitalMode);
  const reasons = [];
  const warnings = [];
  const cashBufferPercent = clamp(env.MOE_CASH_BUYING_POWER_BUFFER_PERCENT, 0, 50, 2);
  const cashRequired = quality.notional == null ? null : quality.notional * (1 + cashBufferPercent / 100);
  const availableCash = firstFinite(account.settledCash, account.cashBalance);
  const cashCanFund = cashRequired != null && availableCash != null && availableCash >= cashRequired;
  const cashOvernightEnabled = enabled(env.MOE_CASH_OVERNIGHT_ENABLED, true);
  const marginEnabled = enabled(env.MOE_INTRADAY_MARGIN_ENABLED, false);
  const qualityGate = marginQualityAccepted(quality, env);
  const regularSession = clock.weekdayOpen && clock.minutes >= 9 * 60 + 30 && clock.minutes < 16 * 60;
  const beforeMarginEntryCutoff = clock.minutes < schedule.newEntryCutoff;
  const liveRequiresBrokerMarginability = runtimeMode === 'LIVE';
  const marginable = quality.marginable || (!liveRequiresBrokerMarginability && enabled(env.MOE_SANDBOX_ASSUME_MARGINABLE, false));
  const maintenanceBufferRatio = account.maintenanceMargin > 0 && account.netLiquidation != null
    ? account.netLiquidation / account.maintenanceMargin
    : null;
  const minimumMaintenanceBuffer = positive(env.MOE_MARGIN_MIN_MAINTENANCE_BUFFER, 1.5);
  const maximumMarginNotionalPercent = clamp(env.MOE_MARGIN_MAX_NOTIONAL_PERCENT_EQUITY, 1, 100, 25);
  const maximumMarginNotional = account.netLiquidation != null ? account.netLiquidation * maximumMarginNotionalPercent / 100 : null;
  const marginNotionalWithinCap = quality.notional != null && maximumMarginNotional != null && quality.notional <= maximumMarginNotional;
  const dayBuyingPowerAvailable = quality.notional != null && account.dayBuyingPower != null && quality.notional <= account.dayBuyingPower;
  const marginAccountHealthy = account.marginCallCount === 0
    && maintenanceBufferRatio != null
    && maintenanceBufferRatio >= minimumMaintenanceBuffer
    && account.netLiquidation != null
    && account.netLiquidation >= positive(env.MOE_MARGIN_MIN_ACCOUNT_EQUITY, 25000);

  let capitalSource = 'REJECTED';
  if (requestedMode !== 'MARGIN_INTRADAY' && cashCanFund) {
    capitalSource = 'CASH';
  } else if (requestedMode !== 'CASH_ONLY' && marginEnabled) {
    const marginChecks = {
      regularSession,
      beforeMarginEntryCutoff,
      marginable,
      quality: qualityGate.accepted,
      accountHealthy: marginAccountHealthy,
      dayBuyingPower: dayBuyingPowerAvailable,
      notionalCap: marginNotionalWithinCap,
      realTimeData: context.dataDelayMinutes == null || Number(context.dataDelayMinutes) === 0,
      protectedOrder: Boolean(signal.stopLoss && signal.takeProfit),
    };
    for (const [key, passed] of Object.entries(marginChecks)) if (!passed) reasons.push(`MARGIN_${key.toUpperCase()}_FAILED`);
    if (Object.values(marginChecks).every(Boolean)) capitalSource = 'MARGIN_INTRADAY';
  }

  if (requestedMode === 'CASH_ONLY' && !cashCanFund) reasons.push('CASH_BUYING_POWER_INSUFFICIENT');
  if (requestedMode === 'MARGIN_INTRADAY' && !marginEnabled) reasons.push('INTRADAY_MARGIN_DISABLED');
  if (capitalSource === 'REJECTED' && reasons.length === 0) reasons.push('NO_APPROVED_CAPITAL_SOURCE');
  if (quality.notional == null || !(quality.notional > 0)) reasons.push('ORDER_NOTIONAL_UNAVAILABLE');
  if (quality.riskDollars == null || !(quality.riskDollars > 0)) reasons.push('ORDER_RISK_UNAVAILABLE');
  if (account.overnightBuyingPower != null && quality.notional != null && quality.notional > account.overnightBuyingPower) warnings.push('POSITION_EXCEEDS_OVERNIGHT_BUYING_POWER');
  if (capitalSource === 'CASH' && !cashOvernightEnabled) warnings.push('CASH_OVERNIGHT_HOLDING_DISABLED');

  const accountRoute = capitalSource === 'CASH'
    ? (text(env.WEBULL_LIVE_CASH_ACCOUNT_ID) ? 'CASH_ACCOUNT' : 'PRIMARY_ACCOUNT_CASH_CAPITAL')
    : capitalSource === 'MARGIN_INTRADAY'
      ? (text(env.WEBULL_LIVE_MARGIN_ACCOUNT_ID) ? 'MARGIN_ACCOUNT' : 'PRIMARY_MARGIN_ACCOUNT')
      : 'NONE';
  const holdPolicy = capitalSource === 'MARGIN_INTRADAY'
    ? 'FORCE_FLAT_SAME_DAY'
    : cashOvernightEnabled ? 'OVERNIGHT_ALLOWED_BY_TRADE_RULES' : 'FORCE_FLAT_SAME_DAY';

  return {
    version: 1,
    accepted: capitalSource !== 'REJECTED',
    runtimeMode,
    requestedMode,
    capitalSource,
    accountRoute,
    holdPolicy,
    exchangeTimeZone: EXCHANGE_TIME_ZONE,
    evaluatedAt: now.toISOString(),
    exchangeClock: {
      weekday: clock.weekday,
      hour: Number(clock.hour),
      minute: Number(clock.minute),
      minuteOfDay: clock.minutes,
      regularSession,
    },
    timeControls: {
      ...schedule,
      newMarginEntriesAllowed: regularSession && beforeMarginEntryCutoff,
      liquidationWindowActive: regularSession && clock.minutes >= schedule.liquidationStart,
      hardExitRequired: regularSession && clock.minutes >= schedule.hardExit,
    },
    qualityGate,
    reasons: [...new Set(reasons)],
    warnings: [...new Set(warnings)],
    metrics: {
      ...quality,
      ...account,
      availableCash,
      cashRequired: cashRequired == null ? null : Number(cashRequired.toFixed(2)),
      cashCanFund,
      maintenanceBufferRatio: maintenanceBufferRatio == null ? null : Number(maintenanceBufferRatio.toFixed(3)),
      minimumMaintenanceBuffer,
      maximumMarginNotional: maximumMarginNotional == null ? null : Number(maximumMarginNotional.toFixed(2)),
      maximumMarginNotionalPercent,
      marginAccountHealthy,
      marginEnabled,
    },
    safety: {
      noMarginInPremarket: true,
      noMarginAfterHours: true,
      noMarginOvernight: true,
      marginRequiresRealTimeData: true,
      marginRequiresProtectedOrder: true,
      marginRequiresExplicitBrokerMarginabilityInLive: true,
    },
  };
}

export function marginExitDirective({ capitalSource, now = new Date() } = {}, env = {}) {
  const schedule = capitalPolicySchedule(env);
  const clock = exchangeParts(now);
  if (text(capitalSource).toUpperCase() !== 'MARGIN_INTRADAY') {
    return { action: 'NONE', reason: 'NOT_MARGIN_FUNDED', evaluatedAt: now.toISOString() };
  }
  if (!clock.weekdayOpen || clock.minutes >= 16 * 60) {
    return { action: 'EMERGENCY_FLATTEN', reason: 'MARGIN_POSITION_OUTSIDE_REGULAR_SESSION', evaluatedAt: now.toISOString() };
  }
  if (clock.minutes >= schedule.hardExit) {
    return { action: 'FORCE_EXIT', reason: 'MARGIN_HARD_EXIT_TIME', evaluatedAt: now.toISOString(), deadline: schedule.labels.hardExit };
  }
  if (clock.minutes >= schedule.liquidationStart) {
    return { action: 'BEGIN_EXIT', reason: 'MARGIN_LIQUIDATION_WINDOW', evaluatedAt: now.toISOString(), deadline: schedule.labels.hardExit };
  }
  return { action: 'HOLD_INTRADAY', reason: 'BEFORE_MARGIN_LIQUIDATION_WINDOW', evaluatedAt: now.toISOString(), deadline: schedule.labels.liquidationStart };
}
