const EXCHANGE_TIME_ZONE = 'America/New_York';
const ACTIVE_RESERVATION_STATES = new Set(['RESERVED', 'SUBMITTED']);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function finite(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(value, fallback = null) {
  const parsed = finite(value, fallback);
  return parsed != null && parsed > 0 ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
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

function firstFinite(...values) {
  for (const value of values) {
    const parsed = finite(value);
    if (parsed != null) return parsed;
  }
  return null;
}

function exchangeDateKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EXCHANGE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function accountMetrics(snapshot = {}) {
  const rawBalance = snapshot.balance || {};
  const balance = rawBalance?.data && !Array.isArray(rawBalance.data) ? rawBalance.data : rawBalance;
  const usd = Array.isArray(balance.account_currency_assets)
    ? balance.account_currency_assets.find((item) => String(item.currency || '').toUpperCase() === 'USD') || balance.account_currency_assets[0] || {}
    : {};
  const positions = pickArray(snapshot.positions);
  const positionMarketValue = positions.reduce((sum, item) => sum + Math.abs(firstFinite(item.market_value, item.marketValue, item.position_value) || 0), 0);
  return {
    cashBalance: firstFinite(usd.cash_balance, balance.total_cash_balance, balance.cash_balance),
    settledCash: firstFinite(usd.settled_cash, balance.settled_cash, balance.settledCash),
    dayBuyingPower: firstFinite(usd.day_buying_power, balance.day_buying_power, balance.dayBuyingPower),
    overnightBuyingPower: firstFinite(usd.overnight_buying_power, balance.overnight_buying_power, balance.overnightBuyingPower),
    netLiquidation: firstFinite(usd.net_liquidation_value, balance.total_net_liquidation_value, balance.net_liquidation_value, balance.total_asset, balance.equity),
    maintenanceMargin: firstFinite(balance.maintenance_margin, balance.maintenanceMargin),
    marginExcess: firstFinite(balance.margin_excess, balance.marginExcess),
    marginCallCount: Array.isArray(balance.open_margin_calls) ? balance.open_margin_calls.length : firstFinite(balance.margin_call_count, 0),
    brokerPositionMarketValue: Number(positionMarketValue.toFixed(2)),
  };
}

function latestStoredCapitalMetrics(trades = []) {
  return [...trades]
    .filter((trade) => trade?.capitalPolicy?.metrics && typeof trade.capitalPolicy.metrics === 'object')
    .sort((left, right) => Date.parse(right.capitalPolicy?.evaluatedAt || right.updatedAt || right.createdAt || 0) - Date.parse(left.capitalPolicy?.evaluatedAt || left.updatedAt || left.createdAt || 0))
    .map((trade) => ({
      source: 'STORED_CAPITAL_POLICY',
      observedAt: trade.capitalPolicy?.evaluatedAt || trade.updatedAt || trade.createdAt || null,
      metrics: trade.capitalPolicy.metrics,
    }))[0] || null;
}

function positionMetrics(trade = {}) {
  const quantity = Math.abs(firstFinite(trade.filledQuantity, trade.quantity) || 0);
  const entry = positive(firstFinite(trade.averageFillPrice, trade.entryPrice));
  const current = positive(firstFinite(trade.currentPrice, entry));
  const stop = positive(trade.stopLoss);
  const marketValue = current != null && quantity > 0 ? current * quantity : null;
  const risk = finite(trade.risk, entry != null && stop != null && quantity > 0 ? Math.abs(entry - stop) * quantity : null);
  return {
    tradeId: trade.id || null,
    symbol: text(trade.symbol).toUpperCase() || null,
    sector: text(trade.sector, 'OTHER').toUpperCase(),
    direction: text(trade.direction, 'BUY').toUpperCase(),
    quantity,
    entryPrice: entry,
    currentPrice: current,
    marketValue: marketValue == null ? null : Number(marketValue.toFixed(2)),
    openRisk: risk == null ? null : Number(Math.abs(risk).toFixed(2)),
    unrealizedPnl: finite(trade.unrealizedPnl),
    capitalSource: text(trade.capitalSource, 'UNKNOWN').toUpperCase(),
    protectionStatus: text(trade.protectionStatus, 'UNKNOWN').toUpperCase(),
    lifecycleStatus: text(trade.lifecycleStatus, 'UNKNOWN').toUpperCase(),
    attentionRequired: trade.attentionRequired === true,
  };
}

function aggregateExposure(positions, key) {
  const result = new Map();
  for (const position of positions) {
    const group = text(position[key], 'UNKNOWN').toUpperCase();
    const value = finite(position.marketValue, 0);
    result.set(group, (result.get(group) || 0) + Math.abs(value));
  }
  return [...result.entries()]
    .map(([name, marketValue]) => ({ name, marketValue: Number(marketValue.toFixed(2)) }))
    .sort((left, right) => right.marketValue - left.marketValue);
}

function configuredLimits(env = {}, netLiquidation = null) {
  const dailyDollar = positive(env.MOE_MAX_DAILY_LOSS_DOLLARS, positive(env.MOE_MAX_DAILY_LOSS));
  const dailyPercent = positive(env.MOE_MAX_DAILY_LOSS_PERCENT);
  const dailyPercentDollars = dailyPercent != null && netLiquidation != null ? netLiquidation * dailyPercent / 100 : null;
  const dailyCandidates = [dailyDollar, dailyPercentDollars].filter((value) => value != null && value > 0);
  return freeze({
    maximumOpenPositions: Math.max(1, Math.floor(positive(env.MOE_MAX_OPEN_POSITIONS, 4))),
    maximumDailyTrades: Math.max(1, Math.floor(positive(env.MOE_MAX_DAILY_TRADES, 4))),
    maximumSymbolConcentrationPercent: clamp(positive(env.MOE_MAX_SYMBOL_CONCENTRATION_PERCENT, 35), 1, 100),
    maximumSectorProxyExposurePercent: clamp(positive(env.MOE_MAX_SECTOR_EXPOSURE_PERCENT, 50), 1, 100),
    maximumOpenRiskPercentEquity: clamp(positive(env.MOE_MAX_OPEN_RISK_PERCENT, 2), 0.1, 100),
    dailyLossLimitDollars: dailyCandidates.length ? Number(Math.min(...dailyCandidates).toFixed(2)) : null,
    accountStaleAfterSeconds: Math.max(30, Math.floor(positive(env.MOE_PORTFOLIO_ACCOUNT_STALE_SECONDS, 300))),
  });
}

function activeReservations(reservations = [], now = Date.now()) {
  return (Array.isArray(reservations) ? reservations : []).filter((item) => {
    const status = text(item?.status).toUpperCase();
    const expiresAt = finite(item?.expiresAt, 0);
    return ACTIVE_RESERVATION_STATES.has(status) && (!expiresAt || expiresAt > now);
  });
}

function metricCoverage(metrics) {
  const keys = ['cashBalance', 'settledCash', 'dayBuyingPower', 'overnightBuyingPower', 'netLiquidation', 'maintenanceMargin', 'marginExcess'];
  const available = keys.filter((key) => finite(metrics[key]) != null);
  return {
    availableFields: available,
    missingFields: keys.filter((key) => !available.includes(key)),
    coveragePercent: Number((available.length / keys.length * 100).toFixed(2)),
  };
}

export function buildPortfolioRiskIntelligence({
  trades = [],
  reservations = [],
  lifecycleReport = null,
  accountSnapshot = null,
  accountError = null,
  env = {},
  now = Date.now(),
} = {}) {
  const currentTime = Number(now) || Date.now();
  const nowIso = new Date(currentTime).toISOString();
  const today = exchangeDateKey(currentTime);
  const allTrades = Array.isArray(trades) ? trades : [];
  const openTrades = allTrades.filter((trade) => text(trade?.status).toUpperCase() === 'OPEN');
  const positions = openTrades.map(positionMetrics).filter((position) => position.symbol);
  const currentReservations = activeReservations(reservations, currentTime);

  let capitalSource = 'UNAVAILABLE';
  let capitalObservedAt = null;
  let capital = {};
  if (accountSnapshot && typeof accountSnapshot === 'object') {
    capitalSource = 'WEBULL_SANDBOX_READ_ONLY';
    capitalObservedAt = accountSnapshot.fetchedAt || nowIso;
    capital = accountMetrics(accountSnapshot);
  } else {
    const stored = latestStoredCapitalMetrics(allTrades);
    if (stored) {
      capitalSource = stored.source;
      capitalObservedAt = stored.observedAt;
      capital = {
        cashBalance: finite(stored.metrics.cashBalance),
        settledCash: finite(stored.metrics.settledCash),
        dayBuyingPower: finite(stored.metrics.dayBuyingPower),
        overnightBuyingPower: finite(stored.metrics.overnightBuyingPower),
        netLiquidation: finite(stored.metrics.netLiquidation),
        maintenanceMargin: finite(stored.metrics.maintenanceMargin),
        marginExcess: finite(stored.metrics.marginExcess),
        marginCallCount: finite(stored.metrics.marginCallCount, 0),
        brokerPositionMarketValue: finite(stored.metrics.positionMarketValue),
      };
    }
  }

  const observedTimestamp = capitalObservedAt ? Date.parse(capitalObservedAt) : NaN;
  const accountAgeSeconds = Number.isFinite(observedTimestamp) ? Math.max(0, Math.floor((currentTime - observedTimestamp) / 1000)) : null;
  const coverage = metricCoverage(capital);
  const limits = configuredLimits(env, finite(capital.netLiquidation));
  const accountStale = accountAgeSeconds != null && accountAgeSeconds > limits.accountStaleAfterSeconds;

  const grossExposure = positions.reduce((sum, position) => sum + Math.abs(finite(position.marketValue, 0)), 0);
  const openRisk = positions.reduce((sum, position) => sum + Math.abs(finite(position.openRisk, 0)), 0);
  const unrealizedPnl = positions.reduce((sum, position) => sum + finite(position.unrealizedPnl, 0), 0);
  const symbolExposure = aggregateExposure(positions, 'symbol');
  const sectorExposure = aggregateExposure(positions, 'sector');
  const largestSymbol = symbolExposure[0] || null;
  const largestSector = sectorExposure[0] || null;
  const equity = finite(capital.netLiquidation);
  const symbolConcentrationPercent = largestSymbol
    ? Number((largestSymbol.marketValue / Math.max(equity || grossExposure, 1) * 100).toFixed(2))
    : 0;
  const sectorProxyExposurePercent = largestSector
    ? Number((largestSector.marketValue / Math.max(equity || grossExposure, 1) * 100).toFixed(2))
    : 0;
  const openRiskPercentEquity = equity > 0 ? Number((openRisk / equity * 100).toFixed(4)) : null;

  const activeReservationNotionalValues = currentReservations.map((item) => finite(item.notional)).filter((value) => value != null && value >= 0);
  const activeReservationRiskValues = currentReservations.map((item) => finite(item.riskDollars)).filter((value) => value != null && value >= 0);
  const reservedCapital = activeReservationNotionalValues.length === currentReservations.length
    ? Number(activeReservationNotionalValues.reduce((sum, value) => sum + value, 0).toFixed(2))
    : null;
  const reservedRisk = activeReservationRiskValues.length === currentReservations.length
    ? Number(activeReservationRiskValues.reduce((sum, value) => sum + value, 0).toFixed(2))
    : null;

  const todaysClosed = allTrades.filter((trade) => text(trade?.status).toUpperCase() === 'CLOSED' && exchangeDateKey(trade.exitTime || trade.updatedAt) === today);
  const todaysEntries = allTrades.filter((trade) => exchangeDateKey(trade.entryTime || trade.createdAt) === today);
  const realizedPnlToday = todaysClosed.reduce((sum, trade) => sum + finite(trade.realizedPnl, 0), 0);
  const realizedLossToday = Math.max(0, -realizedPnlToday);
  const remainingDailyLossCapacity = limits.dailyLossLimitDollars == null
    ? null
    : Number(Math.max(0, limits.dailyLossLimitDollars - realizedLossToday).toFixed(2));

  const lifecycleMetrics = lifecycleReport?.metrics || {};
  const unprotectedPositions = Math.max(
    positions.filter((position) => position.protectionStatus === 'UNPROTECTED').length,
    finite(lifecycleMetrics.unprotectedPositions, 0),
  );
  const partiallyProtectedPositions = positions.filter((position) => position.protectionStatus === 'PARTIALLY_PROTECTED').length;
  const lifecycleAttentionRequired = Math.max(
    positions.filter((position) => position.attentionRequired).length,
    finite(lifecycleMetrics.attentionRequired, 0),
  );
  const marginHardExitRequired = finite(lifecycleMetrics.marginHardExitRequired, 0);
  const marginExitWindow = finite(lifecycleMetrics.marginExitWindow, 0);

  const blockers = [];
  const warnings = [];
  if (capitalSource === 'UNAVAILABLE' || coverage.coveragePercent === 0) blockers.push('CAPITAL_DATA_UNAVAILABLE');
  if (accountStale) blockers.push('CAPITAL_DATA_STALE');
  if (finite(capital.marginCallCount, 0) > 0) blockers.push('MARGIN_CALL_ACTIVE');
  if (limits.dailyLossLimitDollars != null && realizedLossToday >= limits.dailyLossLimitDollars) blockers.push('DAILY_LOSS_LIMIT_REACHED');
  if (positions.length >= limits.maximumOpenPositions) blockers.push('MAXIMUM_OPEN_POSITIONS_REACHED');
  if (todaysEntries.length >= limits.maximumDailyTrades) blockers.push('MAXIMUM_DAILY_TRADES_REACHED');
  if (unprotectedPositions > 0) blockers.push('UNPROTECTED_POSITION_EXISTS');
  if (marginHardExitRequired > 0) blockers.push('MARGIN_HARD_EXIT_REQUIRED');
  if (symbolConcentrationPercent > limits.maximumSymbolConcentrationPercent) blockers.push('SYMBOL_CONCENTRATION_LIMIT_EXCEEDED');
  if (sectorProxyExposurePercent > limits.maximumSectorProxyExposurePercent) blockers.push('SECTOR_PROXY_EXPOSURE_LIMIT_EXCEEDED');
  if (openRiskPercentEquity != null && openRiskPercentEquity > limits.maximumOpenRiskPercentEquity) blockers.push('OPEN_RISK_LIMIT_EXCEEDED');

  if (limits.dailyLossLimitDollars != null && realizedLossToday >= limits.dailyLossLimitDollars * 0.8 && realizedLossToday < limits.dailyLossLimitDollars) warnings.push('DAILY_LOSS_LIMIT_NEAR');
  if (positions.length >= Math.max(1, limits.maximumOpenPositions - 1) && positions.length < limits.maximumOpenPositions) warnings.push('OPEN_POSITION_CAPACITY_LOW');
  if (todaysEntries.length >= Math.max(1, limits.maximumDailyTrades - 1) && todaysEntries.length < limits.maximumDailyTrades) warnings.push('DAILY_TRADE_CAPACITY_LOW');
  if (partiallyProtectedPositions > 0) warnings.push('PARTIALLY_PROTECTED_POSITION_EXISTS');
  if (marginExitWindow > 0) warnings.push('MARGIN_EXIT_WINDOW_ACTIVE');
  if (lifecycleAttentionRequired > 0) warnings.push('LIFECYCLE_ATTENTION_REQUIRED');
  if (reservedCapital == null && currentReservations.length > 0) warnings.push('RESERVATION_NOTIONAL_COVERAGE_INCOMPLETE');
  if (equity == null) warnings.push('EQUITY_UNAVAILABLE_FOR_PERCENT_RISK');
  if (positions.length > 1) warnings.push('CORRELATION_MATRIX_UNAVAILABLE_SECTOR_PROXY_ONLY');

  const portfolioAcceptsNewRisk = blockers.length === 0;
  const status = blockers.some((item) => ['MARGIN_CALL_ACTIVE', 'DAILY_LOSS_LIMIT_REACHED', 'UNPROTECTED_POSITION_EXISTS', 'MARGIN_HARD_EXIT_REQUIRED'].includes(item))
    ? 'CRITICAL'
    : blockers.length ? 'BLOCKED'
      : warnings.length ? 'WARNING'
        : 'NORMAL';

  return freeze({
    engine: 'PORTFOLIO_CAPITAL_RISK',
    status,
    riskGate: portfolioAcceptsNewRisk ? 'ALLOWED' : 'BLOCKED',
    portfolioAcceptsNewRisk,
    newEntryPermission: false,
    executionPermission: false,
    generatedAt: nowIso,
    exchangeDate: today,
    exchangeTimeZone: EXCHANGE_TIME_ZONE,
    capitalData: {
      source: capitalSource,
      observedAt: capitalObservedAt,
      ageSeconds: accountAgeSeconds,
      stale: accountStale,
      error: accountError ? String(accountError).slice(0, 240) : null,
      coveragePercent: coverage.coveragePercent,
      availableFields: coverage.availableFields,
      missingFields: coverage.missingFields,
    },
    capital: {
      cashBalance: finite(capital.cashBalance),
      settledCash: finite(capital.settledCash),
      dayBuyingPower: finite(capital.dayBuyingPower),
      overnightBuyingPower: finite(capital.overnightBuyingPower),
      netLiquidation: equity,
      maintenanceMargin: finite(capital.maintenanceMargin),
      marginExcess: finite(capital.marginExcess),
      marginCallCount: finite(capital.marginCallCount, 0),
      deployedCapital: Number(grossExposure.toFixed(2)),
      reservedCapital,
      reservedRisk,
    },
    daily: {
      entries: todaysEntries.length,
      closedTrades: todaysClosed.length,
      realizedPnl: Number(realizedPnlToday.toFixed(2)),
      realizedLoss: Number(realizedLossToday.toFixed(2)),
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
      lossLimit: limits.dailyLossLimitDollars,
      remainingLossCapacity: remainingDailyLossCapacity,
    },
    exposure: {
      openPositions: positions.length,
      activeReservations: currentReservations.length,
      grossExposure: Number(grossExposure.toFixed(2)),
      openRisk: Number(openRisk.toFixed(2)),
      openRiskPercentEquity,
      largestSymbol: largestSymbol?.name || null,
      largestSymbolMarketValue: largestSymbol?.marketValue ?? null,
      symbolConcentrationPercent,
      largestSectorProxy: largestSector?.name || null,
      largestSectorProxyMarketValue: largestSector?.marketValue ?? null,
      sectorProxyExposurePercent,
      correlatedExposurePercent: null,
      correlationMethod: positions.length > 1 ? 'UNAVAILABLE_SECTOR_PROXY_ONLY' : 'NOT_APPLICABLE',
      bySymbol: symbolExposure,
      bySectorProxy: sectorExposure,
    },
    protection: {
      protectedPositions: finite(lifecycleMetrics.protectedPositions, positions.filter((position) => position.protectionStatus === 'PROTECTED').length),
      partiallyProtectedPositions,
      unprotectedPositions,
      lifecycleAttentionRequired,
      marginExitWindow,
      marginHardExitRequired,
    },
    positions,
    reservations: currentReservations.map((item) => ({
      id: item.id || null,
      symbol: item.symbol || null,
      side: item.side || null,
      status: item.status || null,
      capitalSource: item.capitalSource || null,
      notional: finite(item.notional),
      riskDollars: finite(item.riskDollars),
      expiresAt: finite(item.expiresAt),
    })),
    limits,
    blockers: [...new Set(blockers)],
    warnings: [...new Set(warnings)],
    readOnly: true,
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
