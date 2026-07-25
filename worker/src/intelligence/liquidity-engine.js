function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function normalizeCandles(candles = []) {
  return (Array.isArray(candles) ? candles : [])
    .map((candle) => ({
      high: number(candle?.high),
      low: number(candle?.low),
      open: number(candle?.open),
      close: number(candle?.close),
      volume: number(candle?.volume),
      timestamp: number(candle?.timestamp),
    }))
    .filter((candle) => candle.high > 0 && candle.low > 0 && candle.high >= candle.low);
}

export function findLiquidityLevels(candles = [], options = {}) {
  const rows = normalizeCandles(candles);
  const lookback = Math.max(3, Math.min(rows.length, number(options.lookback, 20)));
  const sample = rows.slice(-lookback);
  if (sample.length < 3) return null;

  const reference = sample.slice(0, -1);
  const swingHigh = Math.max(...reference.map((candle) => candle.high));
  const swingLow = Math.min(...reference.map((candle) => candle.low));
  const averageVolume = reference.reduce((sum, candle) => sum + candle.volume, 0) / Math.max(1, reference.length);

  return {
    swingHigh: round(swingHigh),
    swingLow: round(swingLow),
    averageVolume: round(averageVolume, 2),
    lastCandle: sample[sample.length - 1],
    lookback: sample.length,
  };
}

export function analyzeLiquidity(input = {}) {
  const levels = input.candles?.length ? findLiquidityLevels(input.candles, input) : null;
  const high = number(input.high, levels?.lastCandle?.high);
  const low = number(input.low, levels?.lastCandle?.low);
  const open = number(input.open, levels?.lastCandle?.open);
  const close = number(input.close, levels?.lastCandle?.close);
  const previousHigh = number(input.previousHigh, levels?.swingHigh);
  const previousLow = number(input.previousLow, levels?.swingLow);
  const volume = number(input.volume, levels?.lastCandle?.volume);
  const averageVolume = Math.max(number(input.averageVolume, levels?.averageVolume || 1), 1);
  const atr = Math.max(number(input.atr, high - low), 0.000001);

  if (high <= 0 || low <= 0 || close <= 0 || previousHigh <= 0 || previousLow <= 0) {
    return {
      confirmed: false,
      direction: 'neutral',
      bullishScore: 0,
      bearishScore: 0,
      reason: 'INSUFFICIENT_MARKET_DATA',
    };
  }

  const range = Math.max(high - low, 0.000001);
  const body = Math.abs(close - open);
  const sweptHigh = high > previousHigh && close < previousHigh;
  const sweptLow = low < previousLow && close > previousLow;
  const relativeVolume = volume / averageVolume;
  const upperWickRatio = Math.max(0, high - Math.max(open, close)) / range;
  const lowerWickRatio = Math.max(0, Math.min(open, close) - low) / range;
  const rejectionFromHigh = sweptHigh ? (high - close) / atr : 0;
  const rejectionFromLow = sweptLow ? (close - low) / atr : 0;
  const displacement = body / atr;

  const volumePoints = Math.min(20, Math.max(0, (relativeVolume - 0.8) * 20));
  const bearishScore = Math.min(100, Math.round(
    (sweptHigh ? 45 : 0)
      + volumePoints
      + Math.min(20, upperWickRatio * 30)
      + Math.min(15, rejectionFromHigh * 15),
  ));
  const bullishScore = Math.min(100, Math.round(
    (sweptLow ? 45 : 0)
      + volumePoints
      + Math.min(20, lowerWickRatio * 30)
      + Math.min(15, rejectionFromLow * 15),
  ));

  const direction = bullishScore > bearishScore ? 'bullish' : bearishScore > bullishScore ? 'bearish' : 'neutral';
  const strongestScore = Math.max(bullishScore, bearishScore);
  const minimumScore = Math.max(50, number(input.minimumScore, 65));

  return {
    sweptHigh,
    sweptLow,
    direction,
    confirmed: strongestScore >= minimumScore && (sweptHigh || sweptLow),
    bullishScore,
    bearishScore,
    strongestScore,
    relativeVolume: round(relativeVolume, 2),
    upperWickRatio: round(upperWickRatio, 3),
    lowerWickRatio: round(lowerWickRatio, 3),
    displacement: round(displacement, 2),
    levels: {
      swingHigh: round(previousHigh),
      swingLow: round(previousLow),
    },
    sweepPrice: sweptLow ? round(low) : sweptHigh ? round(high) : null,
    reclaimedLevel: sweptLow ? round(previousLow) : sweptHigh ? round(previousHigh) : null,
    reason: sweptLow ? 'SELL_SIDE_LIQUIDITY_SWEEP' : sweptHigh ? 'BUY_SIDE_LIQUIDITY_SWEEP' : 'NO_SWEEP',
  };
}
