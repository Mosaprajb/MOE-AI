// MOE-AI — Technical Indicators (pure functions, no side effects)

export interface Candle {
  ts:     number;   // unix ms
  open:   number;
  high:   number;
  low:    number;
  close:  number;
  volume: number;
}

/** Exponential Moving Average */
export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0;
  if (values.length < period) return values[values.length - 1];
  const k = 2 / (period + 1);
  let v = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) v = values[i] * k + v * (1 - k);
  return v;
}

/** Relative Strength Index (Wilder smoothing) */
export function rsi(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gains += d; else losses -= d;
  }
  let avgG = gains / period, avgL = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (avgL === 0) return 100;
  return 100 - 100 / (1 + avgG / avgL);
}

/** Average volume over last N candles */
export function avgVolume(candles: Candle[], period = 20): number {
  const slice = candles.slice(-period);
  return slice.length ? slice.reduce((a, c) => a + c.volume, 0) / slice.length : 1;
}

/** Simple Average True Range */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs = candles.slice(1).map((c, i) => {
    const prev = candles[i].close;
    return Math.max(c.high - c.low, Math.abs(c.high - prev), Math.abs(c.low - prev));
  });
  return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
}
