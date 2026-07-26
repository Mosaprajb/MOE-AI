import { createDealingRange } from './contracts.js';

function classifyPosition(price, low, high, tolerance) {
  if (price < low || price > high) return 'OUTSIDE_RANGE';
  const width = high - low;
  const location = (price - low) / width;
  if (location <= 0.15) return 'EXTREME_DISCOUNT';
  if (location < 0.5 - tolerance) return 'DISCOUNT';
  if (location <= 0.5 + tolerance) return 'EQUILIBRIUM';
  if (location < 0.85) return 'PREMIUM';
  return 'EXTREME_PREMIUM';
}

export async function buildActiveDealingRange({ symbol, snapshot, config, swings } = {}) {
  if (!snapshot?.candles?.length) throw new Error('snapshot.candles are required');
  if (!Array.isArray(swings)) throw new Error('Confirmed swings are required');
  const external = swings.filter((swing) => swing.scope === 'EXTERNAL');
  const highSwing = [...external].reverse().find((swing) => swing.type === 'SWING_HIGH') || null;
  const lowSwing = [...external].reverse().find((swing) => swing.type === 'SWING_LOW') || null;
  if (!highSwing || !lowSwing) {
    return Object.freeze({ range: null, reason: 'NO_CONFIRMED_EXTERNAL_DEALING_RANGE' });
  }
  const low = lowSwing.price;
  const high = highSwing.price;
  if (!(high > low)) return Object.freeze({ range: null, reason: 'INVALID_EXTERNAL_RANGE_ORDER' });
  const widthAtr = (high - low) / Math.max(Number(snapshot.atr), Number.EPSILON);
  if (widthAtr < config.dealingRange.minimumRangeAtr) {
    return Object.freeze({ range: null, reason: 'DEALING_RANGE_TOO_NARROW', widthAtr });
  }
  const currentPrice = snapshot.latest.close;
  const position = classifyPosition(currentPrice, low, high, config.dealingRange.equilibriumTolerance);
  const range = await createDealingRange({
    symbol,
    timeframe: snapshot.timeframe,
    low,
    high,
    widthAtr,
    lowSwingId: lowSwing.swingId,
    highSwingId: highSwing.swingId,
    createdAt: Math.max(lowSwing.confirmedAt, highSwing.confirmedAt),
    currentPrice,
    position,
    valid: true,
    evidence: ['CONFIRMED_EXTERNAL_SWING_BOUNDARIES', 'MINIMUM_RANGE_ATR_PASSED'],
  });
  return Object.freeze({ range, reason: null });
}
