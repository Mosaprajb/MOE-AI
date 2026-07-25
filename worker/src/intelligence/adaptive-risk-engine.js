const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function buildAdaptiveLevels({ side, entryPrice, atr, volatilityPercent, confidence = 70, env = {} }) {
  const entry = number(entryPrice);
  const atrValue = Math.abs(number(atr));
  if (entry <= 0 || atrValue <= 0) throw new Error('Adaptive levels require positive entryPrice and ATR');

  const direction = String(side || '').toUpperCase() === 'SELL' ? -1 : 1;
  const volatility = Math.max(0, number(volatilityPercent, (atrValue / entry) * 100));
  const confidenceFactor = clamp(number(confidence, 70) / 100, 0.5, 1);

  const baseStopMultiplier = number(env.MOE_ATR_STOP_MULTIPLIER, 1.25);
  const baseTargetMultiplier = number(env.MOE_ATR_TARGET_MULTIPLIER, 2.25);
  const volatilityFactor = clamp(1 + (volatility - 1.5) * 0.12, 0.8, 1.35);

  const maxStopPercent = number(env.MOE_MAX_STOP_PERCENT, 2.5);
  const maxTargetPercent = number(env.MOE_MAX_TARGET_PERCENT, 6);
  const minRiskReward = number(env.MOE_MIN_RISK_REWARD, 2);

  const rawStopDistance = atrValue * baseStopMultiplier * volatilityFactor;
  const stopDistance = Math.min(rawStopDistance, entry * (maxStopPercent / 100));

  const desiredTargetDistance = Math.max(
    stopDistance * minRiskReward,
    atrValue * baseTargetMultiplier * volatilityFactor * confidenceFactor,
  );
  const targetDistance = Math.min(desiredTargetDistance, entry * (maxTargetPercent / 100));

  const stopLoss = entry - direction * stopDistance;
  const takeProfit = entry + direction * targetDistance;
  const riskReward = stopDistance > 0 ? targetDistance / stopDistance : 0;

  return {
    stopLoss: Number(stopLoss.toFixed(4)),
    takeProfit: Number(takeProfit.toFixed(4)),
    stopDistance: Number(stopDistance.toFixed(4)),
    targetDistance: Number(targetDistance.toFixed(4)),
    stopPercent: Number(((stopDistance / entry) * 100).toFixed(2)),
    targetPercent: Number(((targetDistance / entry) * 100).toFixed(2)),
    riskReward: Number(riskReward.toFixed(2)),
    capped: rawStopDistance > stopDistance || desiredTargetDistance > targetDistance,
  };
}
