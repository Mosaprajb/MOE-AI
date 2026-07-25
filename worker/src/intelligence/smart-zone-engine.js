function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function sideDirection(side) {
  return String(side || 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
}

export function buildSmartZone({ side, marketPrice, atr, confidence = 70, liquidity = {}, env = {}, now = Date.now() }) {
  const direction = sideDirection(side);
  const price = number(marketPrice);
  const atrValue = number(atr);
  if (price <= 0 || atrValue <= 0) throw new Error('Smart zone requires positive marketPrice and atr');

  const expectedLiquidityDirection = direction === 'BUY' ? 'bullish' : 'bearish';
  const liquidityAligned = liquidity?.confirmed === true && liquidity?.direction === expectedLiquidityDirection;
  const confidenceValue = clamp(number(confidence, 70), 0, 100);
  const confidenceFactor = clamp(confidenceValue / 80, 0.75, 1.15);

  const baseWidthMultiplier = clamp(number(env.MOE_ZONE_ATR_MULTIPLIER, 0.45), 0.2, 0.8);
  const widthMultiplier = baseWidthMultiplier * (liquidityAligned ? 0.8 : 1);
  const zoneWidth = atrValue * widthMultiplier;

  const reclaimedLevel = number(liquidity?.reclaimedLevel);
  const sweepPrice = number(liquidity?.sweepPrice);
  const fallbackOffset = atrValue * clamp(number(env.MOE_ZONE_ENTRY_OFFSET_ATR, 0.12), 0, 0.5);
  const fallbackCenter = direction === 'BUY' ? price - fallbackOffset : price + fallbackOffset;
  const center = liquidityAligned && reclaimedLevel > 0 ? reclaimedLevel : fallbackCenter;

  let lower = center - zoneWidth * 0.5;
  let upper = center + zoneWidth * 0.5;

  if (direction === 'BUY') {
    upper = Math.min(upper, price);
    lower = Math.min(lower, upper - atrValue * 0.1);
  } else {
    lower = Math.max(lower, price);
    upper = Math.max(upper, lower + atrValue * 0.1);
  }

  const sweepBuffer = atrValue * clamp(number(env.MOE_ZONE_SWEEP_BUFFER_ATR, 0.18), 0.05, 0.5);
  const maximumStopDistance = atrValue * clamp(number(env.MOE_ZONE_MAX_STOP_ATR, 1.35), 0.6, 2.5);
  const structuralStop = direction === 'BUY'
    ? (sweepPrice > 0 && liquidityAligned ? sweepPrice - sweepBuffer : lower - atrValue * 0.65)
    : (sweepPrice > 0 && liquidityAligned ? sweepPrice + sweepBuffer : upper + atrValue * 0.65);

  const entryReference = direction === 'BUY' ? upper : lower;
  const stopLoss = direction === 'BUY'
    ? Math.max(structuralStop, entryReference - maximumStopDistance)
    : Math.min(structuralStop, entryReference + maximumStopDistance);
  const risk = Math.abs(entryReference - stopLoss);

  const minimumRiskReward = clamp(number(env.MOE_ZONE_MIN_RR, 1.5), 1.1, 4);
  const targetRiskReward = clamp(number(env.MOE_ZONE_TARGET_RR, 1.8) * confidenceFactor, minimumRiskReward, 3.5);
  const takeProfit = direction === 'BUY'
    ? entryReference + risk * targetRiskReward
    : entryReference - risk * targetRiskReward;

  const expiryMinutes = clamp(number(env.MOE_ZONE_EXPIRY_MINUTES, 90), 5, 1440);
  const riskReward = risk > 0 ? Math.abs(takeProfit - entryReference) / risk : 0;

  return {
    direction,
    lower: round(lower),
    upper: round(upper),
    entryReference: round(entryReference),
    stopLoss: round(stopLoss),
    takeProfit: round(takeProfit),
    risk: round(risk),
    riskReward: round(riskReward, 2),
    width: round(upper - lower),
    confidence: round(confidenceValue, 2),
    liquidityAligned,
    anchor: liquidityAligned ? 'LIQUIDITY_RECLAIM' : 'ATR_PULLBACK',
    valid: risk > 0 && riskReward >= minimumRiskReward,
    invalidReason: risk <= 0 ? 'INVALID_RISK' : riskReward < minimumRiskReward ? 'RISK_REWARD_TOO_LOW' : null,
    createdAt: now,
    expiresAt: now + expiryMinutes * 60_000,
  };
}
