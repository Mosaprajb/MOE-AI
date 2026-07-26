import { buildPortfolioRiskIntelligence } from './portfolio-risk.js';

function finite(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'items', 'positions', 'position_list', 'list', 'orders']) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (value.data && value.data !== value) return pickArray(value.data);
  return [];
}

function liveRecord(record = {}) {
  const explicit = [
    record.environment,
    record.executionEnvironment,
    record.brokerEnvironment,
    record.mode,
    record.tradingMode,
    record.accountEnvironment,
  ].map((value) => text(value).toUpperCase()).join('|');
  return record.live === true
    || record.liveExecution === true
    || explicit.includes('LIVE')
    || explicit.includes('PRODUCTION');
}

function recordSymbol(record = {}) {
  return text(record.symbol || record.ticker || record.instrument?.symbol || record.security?.symbol).toUpperCase();
}

function flattenOrders(value, output = []) {
  if (Array.isArray(value)) {
    for (const item of value) flattenOrders(item, output);
    return output;
  }
  if (!value || typeof value !== 'object') return output;
  const looksLikeOrder = value.symbol
    || value.client_order_id
    || value.order_type
    || value.combo_type
    || value.side;
  if (looksLikeOrder) output.push(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === 'object' && child !== value) flattenOrders(child, output);
  }
  return output;
}

function orderProtection(openOrders) {
  const map = new Map();
  for (const order of flattenOrders(openOrders)) {
    const symbol = recordSymbol(order);
    if (!symbol) continue;
    const item = map.get(symbol) || { stop: null, target: null, records: 0 };
    const type = text(order.order_type || order.orderType).toUpperCase();
    const combo = text(order.combo_type || order.comboType).toUpperCase();
    const side = text(order.side).toUpperCase();
    const stop = finite(order.stop_price ?? order.stopPrice ?? order.trigger_price ?? order.triggerPrice);
    const limit = finite(order.limit_price ?? order.limitPrice ?? order.price);
    if (combo.includes('STOP_LOSS') || type.includes('STOP')) item.stop = stop ?? limit ?? item.stop;
    if (combo.includes('STOP_PROFIT') || combo.includes('TAKE_PROFIT')) item.target = limit ?? item.target;
    if (side === 'SELL' && type === 'LIMIT' && !item.target) item.target = limit;
    item.records += 1;
    map.set(symbol, item);
  }
  return map;
}

function latestTradeForSymbol(trades, symbol) {
  return [...trades]
    .filter((trade) => recordSymbol(trade) === symbol)
    .sort((left, right) => Date.parse(right.updatedAt || right.createdAt || right.entryTime || 0) - Date.parse(left.updatedAt || left.createdAt || left.entryTime || 0))[0] || null;
}

function brokerPosition(raw = {}, trades = [], protectionMap = new Map(), openOrdersRead = false) {
  const symbol = recordSymbol(raw);
  if (!symbol) return null;
  const signedQuantity = finite(raw.position_quantity ?? raw.positionQuantity ?? raw.quantity ?? raw.qty ?? raw.total_quantity ?? raw.holding_quantity, 0);
  const quantity = Math.abs(signedQuantity || 0);
  const direction = signedQuantity < 0 ? 'SHORT' : 'LONG';
  const entryPrice = finite(raw.cost_price ?? raw.costPrice ?? raw.average_price ?? raw.averagePrice ?? raw.avg_price ?? raw.average_cost);
  const currentPrice = finite(raw.last_price ?? raw.lastPrice ?? raw.market_price ?? raw.marketPrice ?? raw.mark_price ?? raw.current_price, entryPrice);
  const suppliedMarketValue = finite(raw.market_value ?? raw.marketValue ?? raw.position_value ?? raw.positionValue);
  const marketValue = suppliedMarketValue != null
    ? Math.abs(suppliedMarketValue)
    : currentPrice != null && quantity > 0 ? Math.abs(currentPrice * quantity) : null;
  const unrealizedPnl = finite(raw.unrealized_profit_loss ?? raw.unrealized_pnl ?? raw.unrealizedPnl ?? raw.profit_loss);
  const trade = latestTradeForSymbol(trades, symbol);
  const brokerProtection = protectionMap.get(symbol) || {};
  const stopLoss = finite(brokerProtection.stop, finite(trade?.stopLoss ?? trade?.stopPrice));
  const takeProfit = finite(brokerProtection.target, finite(trade?.takeProfit ?? trade?.targetPrice));
  const openRisk = stopLoss != null && currentPrice != null && quantity > 0
    ? Math.abs(currentPrice - stopLoss) * quantity
    : null;
  let protectionStatus = 'UNVERIFIED';
  if (stopLoss != null && takeProfit != null) protectionStatus = 'PROTECTED';
  else if (stopLoss != null || takeProfit != null) protectionStatus = 'PARTIALLY_PROTECTED';
  else if (openOrdersRead) protectionStatus = 'UNPROTECTED';
  return {
    tradeId: trade?.id || null,
    symbol,
    sector: text(trade?.sector, 'UNKNOWN').toUpperCase(),
    direction,
    quantity,
    entryPrice,
    currentPrice,
    marketValue: marketValue == null ? null : Number(marketValue.toFixed(2)),
    openRisk: openRisk == null ? null : Number(openRisk.toFixed(2)),
    unrealizedPnl,
    stopLoss,
    takeProfit,
    capitalSource: 'WEBULL_PRODUCTION',
    protectionStatus,
    lifecycleStatus: text(trade?.lifecycleStatus, 'BROKER_OPEN').toUpperCase(),
    attentionRequired: protectionStatus !== 'PROTECTED',
  };
}

function statusFrom(blockers, warnings) {
  if (blockers.some((item) => ['MARGIN_CALL_ACTIVE', 'DAILY_LOSS_LIMIT_REACHED', 'UNPROTECTED_POSITION_EXISTS', 'MARGIN_HARD_EXIT_REQUIRED'].includes(item))) return 'CRITICAL';
  if (blockers.length) return 'BLOCKED';
  if (warnings.length) return 'WARNING';
  return 'NORMAL';
}

export function liveWebullEnvironment(env = {}) {
  return {
    ...env,
    WEBULL_ENVIRONMENT: 'production',
    WEBULL_API_BASE_URL: env.WEBULL_LIVE_API_BASE_URL || 'https://api.webull.com',
    WEBULL_APP_KEY: env.WEBULL_LIVE_APP_KEY,
    WEBULL_APP_SECRET: env.WEBULL_LIVE_APP_SECRET,
    WEBULL_ACCESS_TOKEN: env.WEBULL_LIVE_ACCESS_TOKEN,
    WEBULL_LIVE_TRADING: 'true',
    WEBULL_LIVE_ORDER_SUBMISSION: 'true',
    WEBULL_LIVE_KILL_SWITCH: 'false',
  };
}

export function buildProductionPortfolioRisk({
  trades = [],
  reservations = [],
  lifecycleReport = null,
  accountSnapshot = null,
  openOrders = null,
  accountError = null,
  control = {},
  env = {},
  now = Date.now(),
} = {}) {
  const liveTrades = trades.filter(liveRecord);
  const liveReservations = reservations.filter(liveRecord);
  const runtimeEnv = liveWebullEnvironment({
    ...env,
    WEBULL_LIVE_AUTOMATION_ARMED: control.effectiveLiveAutomationArmed ? 'true' : 'false',
  });
  const base = buildPortfolioRiskIntelligence({
    trades: liveTrades,
    reservations: liveReservations,
    lifecycleReport,
    accountSnapshot,
    accountError,
    env: runtimeEnv,
    now,
  });

  const protectionMap = orderProtection(openOrders);
  const openOrdersRead = openOrders != null;
  const positions = pickArray(accountSnapshot?.positions)
    .map((item) => brokerPosition(item, trades, protectionMap, openOrdersRead))
    .filter(Boolean);
  const grossExposure = positions.reduce((sum, position) => sum + Math.abs(finite(position.marketValue, 0)), 0);
  const openRiskValues = positions.map((position) => finite(position.openRisk)).filter((value) => value != null);
  const openRisk = openRiskValues.reduce((sum, value) => sum + Math.abs(value), 0);
  const unrealizedPnl = positions.reduce((sum, position) => sum + finite(position.unrealizedPnl, 0), 0);
  const equity = finite(base.capital.netLiquidation);
  const bySymbol = positions
    .map((position) => ({ name: position.symbol, marketValue: Math.abs(finite(position.marketValue, 0)) }))
    .sort((left, right) => right.marketValue - left.marketValue);
  const largest = bySymbol[0] || null;
  const symbolConcentrationPercent = largest
    ? Number((largest.marketValue / Math.max(equity || grossExposure, 1) * 100).toFixed(2))
    : 0;
  const openRiskPercentEquity = equity > 0 && openRiskValues.length === positions.length
    ? Number((openRisk / equity * 100).toFixed(4))
    : null;

  const removed = new Set([
    'MAXIMUM_OPEN_POSITIONS_REACHED',
    'OPEN_POSITION_CAPACITY_LOW',
    'UNPROTECTED_POSITION_EXISTS',
    'PARTIALLY_PROTECTED_POSITION_EXISTS',
    'SYMBOL_CONCENTRATION_LIMIT_EXCEEDED',
    'SECTOR_PROXY_EXPOSURE_LIMIT_EXCEEDED',
    'OPEN_RISK_LIMIT_EXCEEDED',
    'EQUITY_UNAVAILABLE_FOR_PERCENT_RISK',
    'CORRELATION_MATRIX_UNAVAILABLE_SECTOR_PROXY_ONLY',
  ]);
  const blockers = base.blockers.filter((item) => !removed.has(item));
  const warnings = base.warnings.filter((item) => !removed.has(item));
  const unprotected = positions.filter((item) => item.protectionStatus === 'UNPROTECTED').length;
  const partial = positions.filter((item) => item.protectionStatus === 'PARTIALLY_PROTECTED').length;
  const unverified = positions.filter((item) => item.protectionStatus === 'UNVERIFIED').length;

  if (positions.length >= base.limits.maximumOpenPositions) blockers.push('MAXIMUM_OPEN_POSITIONS_REACHED');
  else if (positions.length >= Math.max(1, base.limits.maximumOpenPositions - 1)) warnings.push('OPEN_POSITION_CAPACITY_LOW');
  if (unprotected > 0) blockers.push('UNPROTECTED_POSITION_EXISTS');
  if (partial > 0) warnings.push('PARTIALLY_PROTECTED_POSITION_EXISTS');
  if (unverified > 0) warnings.push('BROKER_PROTECTION_STATUS_UNVERIFIED');
  if (symbolConcentrationPercent > base.limits.maximumSymbolConcentrationPercent) blockers.push('SYMBOL_CONCENTRATION_LIMIT_EXCEEDED');
  if (openRiskPercentEquity != null && openRiskPercentEquity > base.limits.maximumOpenRiskPercentEquity) blockers.push('OPEN_RISK_LIMIT_EXCEEDED');
  if (openRiskValues.length !== positions.length && positions.length > 0) warnings.push('OPEN_RISK_PARTIALLY_UNAVAILABLE');
  if (positions.length > 1) warnings.push('CORRELATION_MATRIX_UNAVAILABLE');

  const uniqueBlockers = [...new Set(blockers)];
  const uniqueWarnings = [...new Set(warnings)];
  const portfolioAcceptsNewRisk = uniqueBlockers.length === 0;
  const runtimeLiveEnabled = control.liveTradingEnabled === true && control.killSwitch === false;
  const automaticSubmissionAllowed = runtimeLiveEnabled && control.effectiveLiveAutomationArmed === true && portfolioAcceptsNewRisk;

  return {
    ...base,
    status: statusFrom(uniqueBlockers, uniqueWarnings),
    riskGate: portfolioAcceptsNewRisk ? 'ALLOWED' : 'BLOCKED',
    portfolioAcceptsNewRisk,
    newEntryPermission: automaticSubmissionAllowed,
    executionPermission: automaticSubmissionAllowed,
    capitalData: {
      ...base.capitalData,
      source: 'WEBULL_PRODUCTION_READ_ONLY',
      accountIdMasked: accountSnapshot?.accountId ? `***${String(accountSnapshot.accountId).slice(-4)}` : null,
      error: accountError ? String(accountError).slice(0, 240) : null,
    },
    capital: {
      ...base.capital,
      deployedCapital: Number(grossExposure.toFixed(2)),
      reservedCapital: base.capital.reservedCapital,
    },
    daily: {
      ...base.daily,
      unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
    },
    exposure: {
      ...base.exposure,
      openPositions: positions.length,
      grossExposure: Number(grossExposure.toFixed(2)),
      openRisk: openRiskValues.length ? Number(openRisk.toFixed(2)) : null,
      openRiskPercentEquity,
      largestSymbol: largest?.name || null,
      largestSymbolMarketValue: largest?.marketValue ?? null,
      symbolConcentrationPercent,
      largestSectorProxy: null,
      largestSectorProxyMarketValue: null,
      sectorProxyExposurePercent: null,
      bySymbol,
      bySectorProxy: [],
      correlationMethod: positions.length > 1 ? 'UNAVAILABLE' : 'NOT_APPLICABLE',
    },
    protection: {
      ...base.protection,
      protectedPositions: positions.filter((item) => item.protectionStatus === 'PROTECTED').length,
      partiallyProtectedPositions: partial,
      unprotectedPositions: unprotected,
      unverifiedPositions: unverified,
      lifecycleAttentionRequired: positions.filter((item) => item.attentionRequired).length,
    },
    positions,
    blockers: uniqueBlockers,
    warnings: uniqueWarnings,
    mode: 'LIVE',
    accountEnvironment: 'PRODUCTION',
    executionAllowed: runtimeLiveEnabled && portfolioAcceptsNewRisk,
    automaticSubmissionAllowed,
    liveExecutionAllowed: automaticSubmissionAllowed,
    readOnly: true,
    observationOnly: false,
  };
}
