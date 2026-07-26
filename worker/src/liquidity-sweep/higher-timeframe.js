function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ema(values, length) {
  const usable = values.filter(Number.isFinite);
  if (usable.length < length) return null;
  const alpha = 2 / (length + 1);
  let output = usable[0];
  for (let index = 1; index < usable.length; index += 1) {
    output = usable[index] * alpha + output * (1 - alpha);
  }
  return output;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function trendStructure(candles, lookback = 12) {
  const recent = candles.slice(-Math.max(6, lookback));
  if (recent.length < 6) return 'NEUTRAL';
  const half = Math.floor(recent.length / 2);
  const earlier = recent.slice(0, half);
  const later = recent.slice(half);
  const earlierHigh = Math.max(...earlier.map((candle) => candle.high));
  const earlierLow = Math.min(...earlier.map((candle) => candle.low));
  const laterHigh = Math.max(...later.map((candle) => candle.high));
  const laterLow = Math.min(...later.map((candle) => candle.low));
  if (laterHigh > earlierHigh && laterLow > earlierLow) return 'BULLISH';
  if (laterHigh < earlierHigh && laterLow < earlierLow) return 'BEARISH';
  return 'NEUTRAL';
}

function classifyRegime({ trend, structure, atrPercent, realizedVolatilityPercent, qualityAccepted }) {
  if (!qualityAccepted) return 'ILLIQUID_OR_UNSAFE';
  if (atrPercent >= 2.5 || realizedVolatilityPercent >= 4) {
    return trend === 'BULLISH' || trend === 'BEARISH' ? 'BREAKOUT_EXPANSION' : 'VOLATILE_RANGE';
  }
  if (atrPercent <= 0.18 || realizedVolatilityPercent <= 0.15) return 'LOW_VOLATILITY_COMPRESSION';
  if (trend === 'BULLISH' && structure !== 'BEARISH') return 'TRENDING_BULLISH';
  if (trend === 'BEARISH' && structure !== 'BULLISH') return 'TRENDING_BEARISH';
  return 'BALANCED_RANGE';
}

export function aggregateCompletedCandles(candles = [], targetMinutes) {
  if (!Array.isArray(candles) || candles.length === 0) throw new Error('Completed candles are required for aggregation');
  const minutes = Math.floor(Number(targetMinutes));
  if (!Number.isFinite(minutes) || minutes <= 0) throw new Error('targetMinutes must be a positive integer');
  const bucketMs = minutes * 60_000;
  const buckets = new Map();

  for (const candle of candles) {
    if (!candle?.complete) continue;
    const timestamp = Number(candle.timestamp ?? candle.t);
    if (!Number.isFinite(timestamp) || timestamp <= 0) continue;
    const bucket = Math.floor(timestamp / bucketMs) * bucketMs;
    const existing = buckets.get(bucket);
    const normalized = {
      timestamp: bucket,
      open: Number(candle.open ?? candle.o),
      high: Number(candle.high ?? candle.h),
      low: Number(candle.low ?? candle.l),
      close: Number(candle.close ?? candle.c),
      volume: Number(candle.volume ?? candle.v ?? 0),
      session: String(candle.session || 'REGULAR').toUpperCase(),
      complete: true,
      source: String(candle.source || 'AGGREGATED'),
    };
    if (![normalized.open, normalized.high, normalized.low, normalized.close, normalized.volume].every(Number.isFinite)) continue;
    if (!existing) {
      buckets.set(bucket, normalized);
    } else {
      existing.high = Math.max(existing.high, normalized.high);
      existing.low = Math.min(existing.low, normalized.low);
      existing.close = normalized.close;
      existing.volume += normalized.volume;
      existing.session = normalized.session;
    }
  }

  return Object.freeze([...buckets.values()].sort((left, right) => left.timestamp - right.timestamp).map(Object.freeze));
}

export function analyzeHigherTimeframe(snapshot, { direction = 'LONG' } = {}) {
  if (!snapshot?.candles?.length) throw new Error('A normalized higher-timeframe snapshot is required');
  const normalizedDirection = String(direction).toUpperCase();
  if (!['LONG', 'SHORT'].includes(normalizedDirection)) throw new Error('direction must be LONG or SHORT');

  const candles = snapshot.candles;
  const closes = candles.map((candle) => Number(candle.close)).filter(Number.isFinite);
  const latest = candles.at(-1);
  const evidence = [];
  const penalties = [];
  const minimumTrendBars = 50;

  if (closes.length < minimumTrendBars) penalties.push('INSUFFICIENT_HIGHER_TIMEFRAME_HISTORY');

  const fastLength = Math.min(20, Math.max(5, Math.floor(closes.length / 3)));
  const slowLength = Math.min(50, Math.max(fastLength + 1, Math.floor(closes.length * 0.75)));
  const fastEma = ema(closes, fastLength);
  const slowEma = ema(closes, slowLength);
  const priorSlow = closes.length > slowLength + 3 ? ema(closes.slice(0, -3), slowLength) : null;
  const structure = trendStructure(candles);
  const latestClose = finite(latest?.close, 0);
  const slowSlope = slowEma != null && priorSlow != null ? slowEma - priorSlow : 0;

  let trend = 'NEUTRAL';
  if (fastEma != null && slowEma != null && latestClose > slowEma && fastEma > slowEma && slowSlope >= 0) trend = 'BULLISH';
  if (fastEma != null && slowEma != null && latestClose < slowEma && fastEma < slowEma && slowSlope <= 0) trend = 'BEARISH';

  const aligned = normalizedDirection === 'LONG' ? trend === 'BULLISH' : trend === 'BEARISH';
  const opposing = normalizedDirection === 'LONG' ? trend === 'BEARISH' : trend === 'BULLISH';
  const countertrend = opposing;
  if (aligned) evidence.push('HIGHER_TIMEFRAME_TREND_ALIGNED');
  else if (opposing) penalties.push('COUNTERTREND_HIGHER_TIMEFRAME');
  else evidence.push('HIGHER_TIMEFRAME_NEUTRAL');

  if (structure === (normalizedDirection === 'LONG' ? 'BULLISH' : 'BEARISH')) evidence.push('HIGHER_TIMEFRAME_STRUCTURE_ALIGNED');
  if (structure === (normalizedDirection === 'LONG' ? 'BEARISH' : 'BULLISH')) penalties.push('HIGHER_TIMEFRAME_STRUCTURE_OPPOSES_TRADE');

  const rangeCandles = candles.slice(-Math.min(50, candles.length));
  const rangeHigh = Math.max(...rangeCandles.map((candle) => candle.high));
  const rangeLow = Math.min(...rangeCandles.map((candle) => candle.low));
  const rangeWidth = Math.max(rangeHigh - rangeLow, Number.EPSILON);
  const rangeLocation = clamp((latestClose - rangeLow) / rangeWidth, 0, 1);
  const rangeLocationFavorable = normalizedDirection === 'LONG' ? rangeLocation <= 0.7 : rangeLocation >= 0.3;
  if (rangeLocationFavorable) evidence.push('HIGHER_TIMEFRAME_RANGE_LOCATION_ACCEPTABLE');
  else penalties.push('HIGHER_TIMEFRAME_RANGE_LOCATION_EXTENDED');

  const atr = finite(snapshot.atr, 0);
  const atrPercent = latestClose > 0 ? atr / latestClose * 100 : 0;
  const realizedVolatilityPercent = finite(snapshot.realizedVolatilityPercent, 0);
  const marketRegime = classifyRegime({
    trend,
    structure,
    atrPercent,
    realizedVolatilityPercent,
    qualityAccepted: snapshot.quality?.accepted !== false,
  });

  let score = 0;
  score += aligned ? 42 : opposing ? 8 : 24;
  score += structure === (normalizedDirection === 'LONG' ? 'BULLISH' : 'BEARISH') ? 22 : structure === 'NEUTRAL' ? 12 : 2;
  score += rangeLocationFavorable ? 14 : 5;
  score += snapshot.quality?.accepted === false ? 0 : clamp(Math.round(finite(snapshot.quality?.score, 70) / 100 * 12), 0, 12);
  const emaSeparationAtr = atr > 0 && fastEma != null && slowEma != null ? Math.abs(fastEma - slowEma) / atr : 0;
  score += clamp(Math.round(emaSeparationAtr * 10), 0, 10);
  if (closes.length < minimumTrendBars) score -= 12;
  score = clamp(Math.round(score), 0, 100);

  return Object.freeze({
    timeframe: snapshot.timeframe || null,
    direction: normalizedDirection,
    bias: trend,
    aligned,
    countertrend,
    structure,
    marketRegime,
    score,
    fastEma: fastEma == null ? null : Number(fastEma.toFixed(8)),
    slowEma: slowEma == null ? null : Number(slowEma.toFixed(8)),
    slowSlope: Number(slowSlope.toFixed(8)),
    emaSeparationAtr: Number(emaSeparationAtr.toFixed(4)),
    rangeHigh: Number(rangeHigh.toFixed(8)),
    rangeLow: Number(rangeLow.toFixed(8)),
    rangeLocation: Number(rangeLocation.toFixed(4)),
    atrPercent: Number(atrPercent.toFixed(4)),
    realizedVolatilityPercent: Number(realizedVolatilityPercent.toFixed(4)),
    evidence: Object.freeze(unique(evidence)),
    penalties: Object.freeze(unique(penalties)),
  });
}
