function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

export function buildSmartZone({ side, marketPrice, atr, confidence = 70, liquidity, env = {} }) {
  const direction = String(side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const price = number(marketPrice);
  const atrValue = number(atr);
  if (price <= 0 || atrValue <= 0) throw new Error('Smart zone requires positive marketPrice and atr');

  const confidenceFactor = Math.max(0.75, Math.min(1.2, number(confidence, 70) / 80));
  const liquidityBoost = liquidity?.confirmed ? 0.85 : 1;
  const widthMultiplier = Math.max(0.25, number(env.MOE_ZONE_ATR_MULTIPLIER, 0.55)) * liquidityBoost;
  const stopMultiplier = Math.max(widthMultiplier + 0.2, number(env.MOE_ZONE_STOP_ATR_MULTIPLIER, 1.05));
  const rewardMultiplier = Math.max(1.2, number(env.MOE_ZONE_REWARD_ATR_MULTIPLIER, 1.8)) * confidenceFactor;

  const halfWidth = atrValue * widthMultiplier * 0.5;
  const centerOffset = atrValue * number(env.MOE_ZONE_ENTRY_OFFSET_ATR, 0.12);
  const center = direction === 'BUY' ? price - centerOffset : price + centerOffset;
  const lower = center - halfWidth;
  const upper = center + halfWidth;

  const stopLoss = direction === 'BUY'
    ? lower - atrValue * stopMultiplier
    : upper + atrValue * stopMultiplier;
  const takeProfit = direction === 'BUY'
    ? upper + atrValue * rewardMultiplier
    : lower - atrValue * rewardMultiplier;

  const entryReference = direction === 'BUY' ? upper : lower;
  const risk = Math.abs(entryReference - stopLoss);
  const reward = Math.abs(takeProfit - entryReference);

  return {
    direction,
    lower: round(lower),
    upper: round(upper),
    stopLoss: round(stopLoss),
    takeProfit: round(takeProfit),
    riskReward: round(risk > 0 ? reward / risk : 0, 2),
    width: round(upper - lower),
    expiresAt: Date.now() + Math.max(1, number(env.MOE_ZONE_EXPIRY_MINUTES, 90)) * 60_000,
  };
}
