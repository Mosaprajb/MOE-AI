export const LIVE_TRADING_GUARD_VERSION = '1.0.0';

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function positiveNumber(value, fallback, name) {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function evaluateLiveTradingGuard({
  order = {},
  brain = {},
  decision = {},
  portfolio = {},
  consensus = {},
  capitalPolicy = {},
  accountSafety = {},
  accountSnapshot = {},
} = {}, env = {}) {
  const blockers = [];
  const warnings = [];
  const environment = String(env.WEBULL_ENVIRONMENT || '').trim().toLowerCase();
  const requiredPhrase = String(env.WEBULL_LIVE_CONFIRMATION_REQUIRED || 'MOE_LIVE_TRADING_CONFIRMED');
  const suppliedPhrase = String(env.WEBULL_LIVE_CONFIRMATION || '');
  const maxQuantity = positiveNumber(env.WEBULL_LIVE_MAX_QUANTITY, 1, 'WEBULL_LIVE_MAX_QUANTITY');
  const maxNotional = positiveNumber(env.WEBULL_LIVE_MAX_NOTIONAL, 100, 'WEBULL_LIVE_MAX_NOTIONAL');
  const maxDailyLoss = positiveNumber(env.WEBULL_LIVE_MAX_DAILY_LOSS, 50, 'WEBULL_LIVE_MAX_DAILY_LOSS');
  const maxOpenPositions = Math.max(1, Math.floor(positiveNumber(env.WEBULL_LIVE_MAX_OPEN_POSITIONS, 3, 'WEBULL_LIVE_MAX_OPEN_POSITIONS')));

  if (environment !== 'production') blockers.push('Webull environment must be production');
  if (!enabled(env.WEBULL_LIVE_TRADING)) blockers.push('WEBULL_LIVE_TRADING is disabled');
  if (!enabled(env.WEBULL_LIVE_ORDER_SUBMISSION)) blockers.push('WEBULL_LIVE_ORDER_SUBMISSION is disabled');
  if (!enabled(env.WEBULL_LIVE_AUTOMATION_ARMED)) blockers.push('WEBULL_LIVE_AUTOMATION_ARMED is disabled');
  if (enabled(env.WEBULL_LIVE_KILL_SWITCH)) blockers.push('Live trading kill switch is active');
  if (!suppliedPhrase || suppliedPhrase !== requiredPhrase) blockers.push('Live trading confirmation phrase is invalid');

  if (brain.accepted !== true) blockers.push('MOE AI Brain did not approve the trade');
  if (decision.accepted !== true) blockers.push('Decision Engine did not approve the trade');
  if (portfolio.accepted !== true) blockers.push('Portfolio Manager did not approve the trade');
  if (consensus.accepted !== true) blockers.push('Institutional Consensus did not approve the trade');
  if (capitalPolicy.accepted !== true) blockers.push('Capital Policy did not approve the trade');
  if (accountSafety.accepted !== true) blockers.push('Account Safety did not approve the trade');

  const symbol = String(order.symbol || '').trim().toUpperCase();
  const side = String(order.side || '').trim().toUpperCase();
  const quantity = finiteNumber(order.quantity, 0);
  const referencePrice = finiteNumber(order.limitPrice ?? order.marketPrice, 0);
  const stopLoss = finiteNumber(order.stopLoss, 0);
  const takeProfit = finiteNumber(order.takeProfit, 0);
  const notional = quantity * referencePrice;

  if (!symbol) blockers.push('Order symbol is missing');
  if (side !== 'BUY') blockers.push('Protected live entry currently supports BUY only');
  if (!Number.isInteger(quantity) || quantity <= 0) blockers.push('Order quantity must be a positive whole number');
  if (referencePrice <= 0) blockers.push('Order reference price is invalid');
  if (stopLoss <= 0 || takeProfit <= 0) blockers.push('Protected stop loss and take profit are required');
  if (referencePrice > 0 && stopLoss >= referencePrice) blockers.push('Stop loss must be below the entry price');
  if (referencePrice > 0 && takeProfit <= referencePrice) blockers.push('Take profit must be above the entry price');
  if (quantity > maxQuantity) blockers.push(`Order quantity exceeds live maximum of ${maxQuantity}`);
  if (notional > maxNotional) blockers.push(`Order notional exceeds live maximum of ${maxNotional}`);

  const dailyPnl = finiteNumber(accountSnapshot.dailyPnl ?? accountSnapshot.dayPnl ?? accountSnapshot.metrics?.dailyPnl, 0);
  const openPositions = Array.isArray(accountSnapshot.openPositions)
    ? accountSnapshot.openPositions.length
    : finiteNumber(accountSnapshot.openPositionCount ?? accountSnapshot.metrics?.openPositionCount, 0);
  if (dailyPnl <= -maxDailyLoss) blockers.push(`Daily loss limit of ${maxDailyLoss} has been reached`);
  if (openPositions >= maxOpenPositions) blockers.push(`Maximum open positions of ${maxOpenPositions} has been reached`);
  if (notional > maxNotional * 0.8) warnings.push('Order uses more than 80% of the live notional limit');

  return {
    version: LIVE_TRADING_GUARD_VERSION,
    accepted: blockers.length === 0,
    state: blockers.length === 0 ? 'ARMED' : 'LOCKED',
    blockers,
    warnings,
    orderMetrics: {
      symbol,
      side,
      quantity,
      referencePrice,
      notional: Number(notional.toFixed(2)),
      stopLoss,
      takeProfit,
    },
    accountMetrics: { dailyPnl, openPositions },
    limits: { maxQuantity, maxNotional, maxDailyLoss, maxOpenPositions },
  };
}

export function assertLiveTradingGuard(input, env = {}) {
  const result = evaluateLiveTradingGuard(input, env);
  if (!result.accepted) throw new Error(`Live trading blocked: ${result.blockers.join('; ')}`);
  return result;
}
