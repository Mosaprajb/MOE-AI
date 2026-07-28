const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function direction(side) {
  return String(side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
}

export function calculatePositionSize({
  accountEquity,
  riskPercent,
  entryPrice,
  stopLoss,
  maxNotional,
  maxQuantity,
}) {
  const equity = number(accountEquity);
  const riskPct = number(riskPercent);
  const entry = number(entryPrice);
  const stop = number(stopLoss);
  const notionalCap = number(maxNotional, Number.MAX_SAFE_INTEGER);
  const quantityCap = Math.floor(number(maxQuantity, Number.MAX_SAFE_INTEGER));

  if (equity <= 0 || riskPct <= 0 || entry <= 0 || stop <= 0) {
    throw new Error('Position sizing requires accountEquity, riskPercent, entryPrice and stopLoss');
  }

  const riskPerShare = Math.abs(entry - stop);
  if (riskPerShare <= 0) throw new Error('Stop loss cannot equal entry price');

  const riskBudget = equity * (riskPct / 100);
  const byRisk = Math.floor(riskBudget / riskPerShare);
  const byNotional = Math.floor(notionalCap / entry);
  const quantity = Math.max(0, Math.min(byRisk, byNotional, quantityCap));

  return {
    quantity,
    riskBudget: Number(riskBudget.toFixed(2)),
    riskPerShare: Number(riskPerShare.toFixed(4)),
    estimatedNotional: Number((quantity * entry).toFixed(2)),
    estimatedRisk: Number((quantity * riskPerShare).toFixed(2)),
  };
}

export function evaluateTrade(signal, context = {}, env = {}) {
  const side = direction(signal.side);
  const entry = number(signal.limitPrice || context.marketPrice);
  const stop = number(signal.stopLoss);
  const target = number(signal.takeProfit);
  const lowerZone = number(signal.lowerZone, context.smartZone?.lower);
  const upperZone = number(signal.upperZone, context.smartZone?.upper);
  const reasons = [];
  const breakdown = {};

  if (entry <= 0 || stop <= 0 || target <= 0) {
    throw new Error('Confidence evaluation requires entry, stopLoss and takeProfit');
  }

  if (side === 'BUY' && !(stop < entry && target > entry)) {
    reasons.push('Buy setup requires stop below entry and target above entry');
  }
  if (side === 'SELL' && !(stop > entry && target < entry)) {
    reasons.push('Sell setup requires stop above entry and target below entry');
  }
  if (lowerZone > 0 && upperZone > 0) {
    if (lowerZone >= upperZone) reasons.push('Smart zone lower boundary must be below upper boundary');
    if (entry < lowerZone || entry > upperZone) reasons.push('Entry price is outside the smart zone');
  }
  if (context.smartZone && context.smartZone.valid === false) {
    reasons.push(context.smartZone.invalidReason || 'Smart zone is invalid');
  }

  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rr = risk > 0 ? reward / risk : 0;

  breakdown.riskReward = clamp(Math.round(rr * 12.5), 0, 25);
  breakdown.htfAlignment = context.htfAligned === true ? 20 : context.htfAligned === false ? 0 : 10;
  breakdown.volume = clamp(Math.round(number(context.relativeVolume, 1) * 8), 0, 15);
  breakdown.liquidity = clamp(Math.round(number(context.liquidityScore, 50) * 0.15), 0, 15);
  breakdown.market = clamp(Math.round(number(context.marketScore, 50) * 0.15), 0, 15);
  breakdown.signalQuality = clamp(Math.round(number(context.signalScore, 50) * 0.1), 0, 10);

  const score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const minimumScore = number(env.MOE_MIN_CONFIDENCE_SCORE, 70);
  const minimumRR = number(env.MOE_MIN_RISK_REWARD, env.MOE_ZONE_MIN_RR || 1.5);

  if (rr < minimumRR) reasons.push(`Risk/reward ${rr.toFixed(2)} is below ${minimumRR}`);
  if (score < minimumScore) reasons.push(`Confidence ${score} is below ${minimumScore}`);
  if (context.newsBlocked === true) reasons.push('Trade blocked by news filter');
  if (context.duplicateSignal === true) reasons.push('Duplicate signal');
  if (context.signalExpired === true) reasons.push(context.rejectionReason || 'Signal expired');
  if (context.spreadPercent != null && number(context.spreadPercent) > number(env.MOE_MAX_SPREAD_PERCENT, 0.5)) {
    reasons.push('Spread exceeds allowed maximum');
  }

  return {
    accepted: reasons.length === 0,
    score,
    minimumScore,
    riskReward: Number(rr.toFixed(2)),
    risk: Number(risk.toFixed(4)),
    reward: Number(reward.toFixed(4)),
    breakdown,
    reasons,
  };
}

export function buildTradePlan(signal, context = {}, env = {}) {
  const evaluation = evaluateTrade(signal, context, env);
  const entryPrice = number(signal.limitPrice || context.marketPrice);
  const sizing = calculatePositionSize({
    accountEquity: number(context.accountEquity, env.MOE_TEST_ACCOUNT_EQUITY || 25000),
    riskPercent: number(context.riskPercent, env.MOE_RISK_PER_TRADE_PERCENT || 0.5),
    entryPrice,
    stopLoss: signal.stopLoss,
    maxNotional: number(env.WEBULL_MAX_NOTIONAL, 1000),
    maxQuantity: number(env.WEBULL_MAX_QUANTITY, 10),
  });

  if (sizing.quantity < 1) {
    evaluation.accepted = false;
    evaluation.reasons.push('Calculated position size is zero');
  }

  const zone = context.smartZone || null;
  return {
    evaluation,
    sizing,
    order: {
      side: direction(signal.side),
      type: 'LIMIT',
      entryPrice,
      lowerZone: number(signal.lowerZone, zone?.lower),
      upperZone: number(signal.upperZone, zone?.upper),
      stopLoss: number(signal.stopLoss),
      takeProfit: number(signal.takeProfit),
      quantity: sizing.quantity,
      expiresAt: number(signal.expiresAt, zone?.expiresAt),
    },
    management: {
      takeProfitAction: 'CLOSE_FULL_POSITION',
      stopLossAction: 'CLOSE_FULL_POSITION',
      trailingStopEnabled: false,
      breakEvenEnabled: false,
      liveManagementEnabled: false,
    },
  };
}
