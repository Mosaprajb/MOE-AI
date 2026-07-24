const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  const entry = number(signal.limitPrice || context.marketPrice);
  const stop = number(signal.stopLoss);
  const target = number(signal.takeProfit);
  const reasons = [];
  const breakdown = {};

  if (entry <= 0 || stop <= 0 || target <= 0) {
    throw new Error('Confidence evaluation requires entry, stopLoss and takeProfit');
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
  const minimumRR = number(env.MOE_MIN_RISK_REWARD, 2);

  if (rr < minimumRR) reasons.push(`Risk/reward ${rr.toFixed(2)} is below ${minimumRR}`);
  if (score < minimumScore) reasons.push(`Confidence ${score} is below ${minimumScore}`);
  if (context.newsBlocked === true) reasons.push('Trade blocked by news filter');
  if (context.duplicateSignal === true) reasons.push('Duplicate signal');
  if (context.signalExpired === true) reasons.push('Signal expired');
  if (context.spreadPercent != null && number(context.spreadPercent) > number(env.MOE_MAX_SPREAD_PERCENT, 0.5)) {
    reasons.push('Spread exceeds allowed maximum');
  }

  return {
    accepted: reasons.length === 0,
    score,
    minimumScore,
    riskReward: Number(rr.toFixed(2)),
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

  const tp1 = signal.takeProfit;
  const breakEvenOffsetPercent = number(env.MOE_BREAK_EVEN_OFFSET_PERCENT, 0.1);
  const securedStop = signal.side === 'BUY'
    ? entryPrice * (1 + breakEvenOffsetPercent / 100)
    : entryPrice * (1 - breakEvenOffsetPercent / 100);

  return {
    evaluation,
    sizing,
    management: {
      tp1,
      tp1Action: 'CLOSE_PARTIAL_AND_MOVE_STOP',
      tp1ClosePercent: number(env.MOE_TP1_CLOSE_PERCENT, 50),
      securedStop: Number(securedStop.toFixed(4)),
      trailingStopAfterTp1: true,
      liveManagementEnabled: false,
    },
  };
}
