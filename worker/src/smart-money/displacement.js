import { createDisplacementEvent } from './contracts.js';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function bodyMetrics(candle) {
  const body = Math.abs(candle.close - candle.open);
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  const bullish = candle.close > candle.open;
  const bearish = candle.close < candle.open;
  const closeLocationBullish = (candle.close - candle.low) / range;
  const closeLocationBearish = (candle.high - candle.close) / range;
  return { body, range, bullish, bearish, closeLocationBullish, closeLocationBearish };
}

function consecutiveDirection(candles, index, direction, maximum = 4) {
  let count = 0;
  for (let cursor = index; cursor >= 0 && count < maximum; cursor -= 1) {
    const candle = candles[cursor];
    const matches = direction === 'BULLISH' ? candle.close > candle.open : candle.close < candle.open;
    if (!matches) break;
    count += 1;
  }
  return count;
}

function overlapRatio(previous, current) {
  if (!previous) return 1;
  const overlap = Math.max(0, Math.min(previous.high, current.high) - Math.max(previous.low, current.low));
  const currentRange = Math.max(current.high - current.low, Number.EPSILON);
  return clamp(overlap / currentRange, 0, 1);
}

function classificationFor(score, rangeAtr, config) {
  if (rangeAtr >= config.displacement.abnormalRangeAtr) return 'ABNORMAL_NEWS_DRIVEN';
  if (score >= config.displacement.minimumExceptionalScore) return 'EXCEPTIONAL';
  if (score >= config.displacement.minimumStrongScore) return 'STRONG';
  if (score >= config.displacement.minimumModerateScore) return 'MODERATE';
  if (score >= 25) return 'WEAK';
  return 'NONE';
}

export async function evaluateDisplacementAt({ symbol, snapshot, index, config } = {}) {
  if (!snapshot?.candles?.length) throw new Error('snapshot.candles are required');
  if (!config?.displacement) throw new Error('Validated Smart Money configuration is required');
  if (!Number.isInteger(index) || index < 0 || index >= snapshot.candles.length) throw new Error('displacement index is invalid');
  const candle = snapshot.candles[index];
  const previous = snapshot.candles[index - 1] || null;
  const metrics = bodyMetrics(candle);
  const direction = metrics.bullish ? 'BULLISH' : 'BEARISH';
  const atr = Math.max(Number(snapshot.atr), Number.EPSILON);
  const bodyAtr = metrics.body / atr;
  const rangeAtr = metrics.range / atr;
  const bodyToRange = metrics.body / metrics.range;
  const closeLocation = direction === 'BULLISH' ? metrics.closeLocationBullish : metrics.closeLocationBearish;
  const relativeVolume = index === snapshot.candles.length - 1
    ? snapshot.relativeVolume
    : null;
  const consecutive = consecutiveDirection(snapshot.candles, index, direction);
  const overlap = overlapRatio(previous, candle);

  let score = 0;
  score += clamp(bodyAtr / 1.2, 0, 1) * 24;
  score += clamp(rangeAtr / 1.8, 0, 1) * 18;
  score += clamp((bodyToRange - 0.2) / 0.65, 0, 1) * 18;
  score += clamp((closeLocation - 0.5) / 0.5, 0, 1) * 14;
  score += relativeVolume == null ? 6 : clamp((relativeVolume - 0.6) / 1.4, 0, 1) * 12;
  score += clamp((consecutive - 1) / 3, 0, 1) * 8;
  score += clamp((0.8 - overlap) / 0.8, 0, 1) * 6;
  score = round(clamp(score, 0, 100), 2);

  const evidence = [];
  const rejectionReasons = [];
  if (bodyAtr >= config.displacement.minimumBodyAtr) evidence.push('BODY_ATR_CONFIRMED');
  else rejectionReasons.push('BODY_TOO_SMALL');
  if (bodyToRange >= config.displacement.minimumBodyToRange) evidence.push('BODY_DOMINATES_RANGE');
  else rejectionReasons.push('EXCESSIVE_WICK_OR_OVERLAP');
  if (closeLocation >= 0.65) evidence.push('DIRECTIONAL_CLOSE_LOCATION');
  if (relativeVolume != null && relativeVolume >= 1) evidence.push('RELATIVE_VOLUME_SUPPORT');
  if (consecutive >= 2) evidence.push('CONSECUTIVE_DIRECTIONAL_CANDLES');
  if (overlap <= 0.35) evidence.push('LOW_OPPOSING_OVERLAP');

  const classification = metrics.body === 0
    ? 'NONE'
    : classificationFor(score, rangeAtr, config);
  if (classification === 'ABNORMAL_NEWS_DRIVEN') rejectionReasons.push('ABNORMAL_NEWS_DISPLACEMENT');

  return createDisplacementEvent({
    symbol,
    timeframe: snapshot.timeframe,
    direction,
    classification,
    index,
    timestamp: candle.timestamp,
    score,
    metrics: {
      bodyAtr: round(bodyAtr),
      rangeAtr: round(rangeAtr),
      bodyToRange: round(bodyToRange),
      closeLocation: round(closeLocation),
      relativeVolume: relativeVolume == null ? null : round(relativeVolume),
      consecutiveDirectionalCandles: consecutive,
      overlapRatio: round(overlap),
    },
    evidence,
    rejectionReasons,
  });
}

export async function evaluateDisplacementSeries({ symbol, snapshot, config, lookback = 30 } = {}) {
  if (!snapshot?.candles?.length) throw new Error('snapshot.candles are required');
  const start = Math.max(0, snapshot.candles.length - Math.max(1, Number(lookback) || 30));
  const events = [];
  for (let index = start; index < snapshot.candles.length; index += 1) {
    events.push(await evaluateDisplacementAt({ symbol, snapshot, index, config }));
  }
  return Object.freeze(events);
}
