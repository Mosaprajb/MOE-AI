const DEFAULT_CORRELATION_GROUPS = {
  SEMICONDUCTORS: ['NVDA', 'AMD', 'AVGO', 'INTC', 'MU', 'ARM', 'SMH', 'SOXL'],
  MEGA_CAP_TECH: ['AAPL', 'MSFT', 'META', 'GOOGL', 'GOOG', 'AMZN', 'QQQ', 'TQQQ'],
  EV: ['TSLA', 'RIVN', 'LCID'],
  FINANCIALS: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'XLF'],
  ENERGY: ['XOM', 'CVX', 'COP', 'OXY', 'XLE'],
};

export const PORTFOLIO_INTELLIGENCE_VERSION = '1.0.0';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeSector(value) {
  return String(value || '').trim().toUpperCase();
}

function groupFor(symbol, groups = DEFAULT_CORRELATION_GROUPS) {
  const normalized = normalizeSymbol(symbol);
  return Object.entries(groups).find(([, symbols]) => symbols.includes(normalized))?.[0] || null;
}

function positionMarketValue(position) {
  const explicit = number(position.marketValue, NaN);
  if (Number.isFinite(explicit)) return Math.abs(explicit);
  const quantity = Math.abs(number(position.quantity, 0));
  const price = number(position.marketPrice ?? position.lastPrice ?? position.averagePrice, 0);
  return quantity * price;
}

function positionRiskDollars(position, accountEquity) {
  if (Number.isFinite(Number(position.riskDollars))) return Math.max(0, Number(position.riskDollars));
  if (Number.isFinite(Number(position.riskPercent)) && accountEquity > 0) {
    return Math.max(0, accountEquity * (Number(position.riskPercent) / 100));
  }
  const quantity = Math.abs(number(position.quantity, 0));
  const entry = number(position.entryPrice ?? position.averagePrice, 0);
  const stop = number(position.stopLoss, 0);
  return entry > 0 && stop > 0 ? quantity * Math.abs(entry - stop) : 0;
}

function sessionProfile(signal, context, env) {
  const label = String(context.tradingSession || signal.session || 'CORE').trim().toUpperCase();
  const profile = label === 'PREMARKET' || label === 'PRE_MARKET'
    ? { key: 'PREMARKET', multiplier: number(env.MOE_PREMARKET_SIZE_MULTIPLIER, 0.5) }
    : label === 'AFTERHOURS' || label === 'AFTER_HOURS' || label === 'NIGHT'
      ? { key: 'AFTER_HOURS', multiplier: number(env.MOE_AFTER_HOURS_SIZE_MULTIPLIER, 0.4) }
      : label === 'POWER_HOUR'
        ? { key: 'POWER_HOUR', multiplier: number(env.MOE_POWER_HOUR_SIZE_MULTIPLIER, 0.85) }
        : label === 'MIDDAY'
          ? { key: 'MIDDAY', multiplier: number(env.MOE_MIDDAY_SIZE_MULTIPLIER, 0.7) }
          : { key: 'CORE', multiplier: 1 };
  return { ...profile, multiplier: clamp(profile.multiplier, 0, 1) };
}

function recoveryProfile(portfolio, env) {
  const consecutiveLosses = Math.max(0, Math.floor(number(portfolio.consecutiveLosses, 0)));
  const dailyPnl = number(portfolio.dailyPnl, 0);
  const dailyLossLimit = Math.abs(number(env.MOE_MAX_DAILY_LOSS_DOLLARS, 0));
  const maxConsecutiveLosses = Math.max(1, Math.floor(number(env.MOE_MAX_CONSECUTIVE_LOSSES, 3)));
  const step = clamp(number(env.MOE_RECOVERY_SIZE_REDUCTION_PER_LOSS, 0.2), 0, 0.75);
  const multiplier = clamp(1 - consecutiveLosses * step, number(env.MOE_RECOVERY_MIN_SIZE_MULTIPLIER, 0.25), 1);
  const hardBlocked = consecutiveLosses >= maxConsecutiveLosses || (dailyLossLimit > 0 && dailyPnl <= -dailyLossLimit);
  return { consecutiveLosses, dailyPnl, dailyLossLimit, maxConsecutiveLosses, multiplier, hardBlocked };
}

function adaptiveRiskProfile(context, env) {
  const regime = String(context.marketRegime || '').trim().toUpperCase();
  const volatility = number(context.volatilityScore ?? context.vix, 0);
  let multiplier = 1;
  if (regime.includes('EXTREME') || regime.includes('NEWS')) multiplier = number(env.MOE_EXTREME_VOL_SIZE_MULTIPLIER, 0.35);
  else if (regime.includes('HIGH_VOL') || volatility >= number(env.MOE_HIGH_VOLATILITY_THRESHOLD, 25)) multiplier = number(env.MOE_HIGH_VOL_SIZE_MULTIPLIER, 0.6);
  else if (regime.includes('LOW_VOL') || (volatility > 0 && volatility <= number(env.MOE_LOW_VOLATILITY_THRESHOLD, 14))) multiplier = number(env.MOE_LOW_VOL_SIZE_MULTIPLIER, 1);
  return { regime: regime || 'UNKNOWN', volatility, multiplier: clamp(multiplier, 0, 1) };
}

function duplicateAction({ signal, plan, duplicatePosition, duplicateOrder, env }) {
  if (!duplicatePosition && !duplicateOrder) return null;
  const score = number(plan?.evaluation?.score, 0);
  const minimumReplacementScore = number(env.MOE_REPLACEMENT_MIN_SCORE, 92);
  const unrealizedPnl = number(duplicatePosition?.unrealizedPnl, 0);
  const allowSandboxReplacement = env.WEBULL_ENVIRONMENT === 'sandbox'
    && env.MOE_SANDBOX_REPLACEMENT_RECOMMENDATIONS !== 'false';
  if (duplicateOrder) return { type: 'KEEP_PENDING_ORDER', eligible: false, automatic: false, reason: 'A pending order already exists for this symbol.' };
  if (allowSandboxReplacement && score >= minimumReplacementScore && unrealizedPnl <= 0) {
    return { type: 'REVIEW_REPLACEMENT', eligible: true, automatic: false, reason: `New setup score ${score} is strong and the existing position is not profitable. Manual sandbox replacement review is recommended.`, safeguards: { minimumReplacementScore, existingUnrealizedPnl: unrealizedPnl } };
  }
  if (unrealizedPnl > 0) return { type: 'PROTECT_EXISTING_POSITION', eligible: false, automatic: false, reason: 'Existing position is profitable. Keep the duplicate-entry block and consider moving protection toward break-even.', safeguards: { existingUnrealizedPnl: unrealizedPnl } };
  return { type: 'BLOCK_DUPLICATE', eligible: false, automatic: false, reason: 'Existing exposure remains protected from duplicate entry.' };
}

export function evaluatePortfolioRisk({ signal, plan, portfolio = {}, context = {}, env = {} }) {
  const intelligenceContext = {
    ...portfolio,
    ...(portfolio.context || {}),
    ...context,
  };
  const positions = Array.isArray(portfolio.openPositions) ? portfolio.openPositions : [];
  const pendingOrders = Array.isArray(portfolio.pendingOrders) ? portfolio.pendingOrders : [];
  const reasons = [];
  const warnings = [];
  const maxOpenPositions = Math.max(1, Math.floor(number(env.MOE_MAX_OPEN_POSITIONS, 4)));
  const maxPortfolioRiskPercent = number(env.MOE_MAX_PORTFOLIO_RISK_PERCENT, 3);
  const maxPortfolioExposurePercent = number(env.MOE_MAX_PORTFOLIO_EXPOSURE_PERCENT, 80);
  const maxSymbolExposurePercent = number(env.MOE_MAX_SYMBOL_EXPOSURE_PERCENT, 20);
  const maxSectorExposurePercent = number(env.MOE_MAX_SECTOR_EXPOSURE_PERCENT, 35);
  const maxCorrelatedPositions = Math.max(1, Math.floor(number(env.MOE_MAX_CORRELATED_POSITIONS, 1)));
  const maxDailyTrades = Math.max(1, Math.floor(number(env.MOE_MAX_DAILY_TRADES, 4)));
  const dailyTrades = Math.max(0, Math.floor(number(portfolio.dailyTrades, 0)));
  const accountEquity = number(portfolio.accountEquity, 0);
  const referencePrice = number(signal.limitPrice ?? intelligenceContext.marketPrice, 0);
  const proposedQuantity = Math.max(0, Math.floor(number(plan?.sizing?.quantity, signal.requestedQuantity || 0)));
  const proposedNotional = referencePrice * proposedQuantity;

  if (positions.length >= maxOpenPositions) reasons.push('Maximum open positions reached');
  if (dailyTrades >= maxDailyTrades) reasons.push('Maximum daily trades reached');

  const duplicatePosition = positions.find((item) => normalizeSymbol(item.symbol) === signal.symbol) || null;
  const duplicateOrder = pendingOrders.find((item) => normalizeSymbol(item.symbol) === signal.symbol) || null;
  const duplicate = Boolean(duplicatePosition || duplicateOrder);
  if (duplicate) reasons.push('Symbol already has an open position or pending order');

  const currentRiskDollars = positions.reduce((sum, item) => sum + positionRiskDollars(item, accountEquity), 0);
  const proposedRiskDollars = Math.max(0, number(plan?.sizing?.estimatedRisk, 0));
  const totalRiskDollars = currentRiskDollars + proposedRiskDollars;
  const totalRiskPercent = accountEquity > 0 ? (totalRiskDollars / accountEquity) * 100 : null;
  if (totalRiskPercent != null && totalRiskPercent > maxPortfolioRiskPercent) reasons.push(`Portfolio risk ${totalRiskPercent.toFixed(2)}% exceeds ${maxPortfolioRiskPercent}%`);

  const currentExposureDollars = positions.reduce((sum, item) => sum + positionMarketValue(item), 0);
  const totalExposureDollars = currentExposureDollars + proposedNotional;
  const totalExposurePercent = accountEquity > 0 ? (totalExposureDollars / accountEquity) * 100 : null;
  const symbolExposureDollars = positions.filter((item) => normalizeSymbol(item.symbol) === signal.symbol).reduce((sum, item) => sum + positionMarketValue(item), 0) + proposedNotional;
  const symbolExposurePercent = accountEquity > 0 ? (symbolExposureDollars / accountEquity) * 100 : null;
  if (totalExposurePercent != null && totalExposurePercent > maxPortfolioExposurePercent) reasons.push(`Portfolio exposure ${totalExposurePercent.toFixed(2)}% exceeds ${maxPortfolioExposurePercent}%`);
  if (symbolExposurePercent != null && symbolExposurePercent > maxSymbolExposurePercent) reasons.push(`Symbol exposure ${symbolExposurePercent.toFixed(2)}% exceeds ${maxSymbolExposurePercent}%`);

  const signalGroup = groupFor(signal.symbol);
  const correlatedPositions = signalGroup ? positions.filter((item) => groupFor(item.symbol) === signalGroup) : [];
  if (signalGroup && correlatedPositions.length >= maxCorrelatedPositions) reasons.push(`Correlation limit reached for ${signalGroup}`);

  const sector = normalizeSector(portfolio.signalSector || intelligenceContext.sector);
  const sectorExposureDollars = sector
    ? positions.filter((item) => normalizeSector(item.sector) === sector).reduce((sum, item) => sum + positionMarketValue(item), 0) + proposedNotional
    : 0;
  const sectorExposurePercent = accountEquity > 0 && sector ? (sectorExposureDollars / accountEquity) * 100 : null;
  const maxSectorPositions = Math.max(1, Math.floor(number(env.MOE_MAX_SECTOR_POSITIONS, 2)));
  if (sector) {
    const sectorCount = positions.filter((item) => normalizeSector(item.sector) === sector).length;
    if (sectorCount >= maxSectorPositions) reasons.push(`Sector exposure limit reached for ${sector}`);
    if (sectorExposurePercent != null && sectorExposurePercent > maxSectorExposurePercent) reasons.push(`Sector exposure ${sectorExposurePercent.toFixed(2)}% exceeds ${maxSectorExposurePercent}% for ${sector}`);
  }

  const session = sessionProfile(signal, intelligenceContext, env);
  const recovery = recoveryProfile(portfolio, env);
  const adaptiveRisk = adaptiveRiskProfile(intelligenceContext, env);
  if (recovery.hardBlocked) reasons.push(recovery.consecutiveLosses >= recovery.maxConsecutiveLosses ? 'Recovery protection blocked new trades after the configured losing streak' : 'Maximum daily loss reached');
  if (session.multiplier < 1) warnings.push(`Session sizing reduced for ${session.key}`);
  if (recovery.multiplier < 1) warnings.push('Recovery protection reduced position sizing');
  if (adaptiveRisk.multiplier < 1) warnings.push('Adaptive volatility protection reduced position sizing');

  const allocationMultiplier = clamp(Math.min(session.multiplier, recovery.multiplier, adaptiveRisk.multiplier), 0, 1);
  const recommendedQuantity = Math.floor(proposedQuantity * allocationMultiplier);
  if (proposedQuantity > 0 && recommendedQuantity < 1) reasons.push('Portfolio intelligence reduced position size below one share');

  const action = duplicateAction({ signal, plan, duplicatePosition, duplicateOrder, env });
  return {
    version: PORTFOLIO_INTELLIGENCE_VERSION,
    accepted: reasons.length === 0,
    reasons,
    warnings,
    action,
    allocation: { multiplier: Number(allocationMultiplier.toFixed(4)), requestedQuantity: proposedQuantity, recommendedQuantity, sessionMultiplier: session.multiplier, recoveryMultiplier: recovery.multiplier, volatilityMultiplier: adaptiveRisk.multiplier },
    metrics: {
      openPositions: positions.length, maxOpenPositions, dailyTrades, maxDailyTrades,
      currentRiskDollars: Number(currentRiskDollars.toFixed(2)), proposedRiskDollars: Number(proposedRiskDollars.toFixed(2)), totalRiskDollars: Number(totalRiskDollars.toFixed(2)),
      totalRiskPercent: totalRiskPercent == null ? null : Number(totalRiskPercent.toFixed(2)), maxPortfolioRiskPercent,
      currentExposureDollars: Number(currentExposureDollars.toFixed(2)), proposedNotional: Number(proposedNotional.toFixed(2)), totalExposureDollars: Number(totalExposureDollars.toFixed(2)),
      totalExposurePercent: totalExposurePercent == null ? null : Number(totalExposurePercent.toFixed(2)), maxPortfolioExposurePercent,
      symbolExposurePercent: symbolExposurePercent == null ? null : Number(symbolExposurePercent.toFixed(2)), maxSymbolExposurePercent,
      sector, sectorExposurePercent: sectorExposurePercent == null ? null : Number(sectorExposurePercent.toFixed(2)), maxSectorExposurePercent,
      correlationGroup: signalGroup, correlatedPositions: correlatedPositions.map((item) => normalizeSymbol(item.symbol)), maxCorrelatedPositions,
      duplicateSymbol: duplicate ? signal.symbol : null, duplicateKind: duplicateOrder ? 'PENDING_ORDER' : duplicatePosition ? 'OPEN_POSITION' : null,
      duplicatePositionUnrealizedPnl: duplicatePosition ? number(duplicatePosition.unrealizedPnl, 0) : null,
      positionHeatPercent: totalRiskPercent == null ? null : Number(totalRiskPercent.toFixed(2)),
      session: session.key, consecutiveLosses: recovery.consecutiveLosses, dailyPnl: recovery.dailyPnl, marketRegime: adaptiveRisk.regime,
    },
  };
}

export { DEFAULT_CORRELATION_GROUPS };
