// MOE-AI — MOE Scalp v1 Strategy
// Fast scalping: EMA cross + RSI zone + volume spike + green candle
import type { Candle } from './indicators';
import { ema, rsi, avgVolume } from './indicators';

export type Confidence = 'HIGH' | 'MEDIUM' | 'NONE';

export interface ScanCandidate {
  symbol:      string;
  score:       number;       // 0–10
  confidence:  Confidence;
  price:       number;
  ema9:        number;
  ema21:       number;
  rsi14:       number;
  volumeRatio: number;
  reasons:     string[];
  entry:       number;
  stopLoss:    number;       // hard stop
  takeProfit:  number;
  trailPct:    number;
  scannedAt:   string;
}

export interface StrategyConfig {
  tpPct:       number;   // default 1.5
  trailPct:    number;   // default 1.0
  hardStopPct: number;   // default 1.5
}

export function scoreStock(
  symbol: string,
  candles: Candle[],
  cfg: StrategyConfig,
): ScanCandidate | null {
  if (candles.length < 22) return null;

  const closes  = candles.map(c => c.close);
  const last    = candles[candles.length - 1];
  const price   = last.close;

  const e9  = ema(closes, 9);
  const e21 = ema(closes, 21);
  const e20 = ema(closes, 20);
  const r14 = rsi(closes, 14);
  const avgVol   = avgVolume(candles, 20);
  const volRatio = avgVol > 0 ? last.volume / avgVol : 1;

  let score = 0;
  const reasons: string[] = [];

  // ── EMA cross bullish (+3) ─────────────────────────────────────────────────
  if (e9 > e21) {
    score += 3;
    reasons.push(`EMA9 (${e9.toFixed(2)}) > EMA21 (${e21.toFixed(2)})`);
  }

  // ── RSI in momentum zone (+2 strong, +1 weak) ─────────────────────────────
  if (r14 >= 45 && r14 <= 65) {
    score += 2;
    reasons.push(`RSI ${r14.toFixed(1)} (منطقة الزخم)`);
  } else if (r14 >= 35 && r14 < 45) {
    score += 1;
    reasons.push(`RSI ${r14.toFixed(1)} (ارتداد من تشبع بيع)`);
  } else if (r14 > 65 && r14 < 75) {
    score += 1;
    reasons.push(`RSI ${r14.toFixed(1)} (زخم قوي)`);
  }

  // ── Volume spike (+2 strong, +1 moderate) ────────────────────────────────
  if (volRatio >= 2.0) {
    score += 2;
    reasons.push(`حجم ×${volRatio.toFixed(1)} المتوسط (ارتفاع قوي)`);
  } else if (volRatio >= 1.3) {
    score += 1;
    reasons.push(`حجم ×${volRatio.toFixed(1)} المتوسط`);
  }

  // ── Price above EMA20 (+1) ────────────────────────────────────────────────
  if (price > e20) {
    score += 1;
    reasons.push(`السعر ($${price.toFixed(2)}) فوق EMA20 ($${e20.toFixed(2)})`);
  }

  // ── Green candle (+2) ─────────────────────────────────────────────────────
  if (last.close > last.open) {
    score += 2;
    reasons.push(`شمعة خضراء (+${((last.close - last.open) / last.open * 100).toFixed(2)}%)`);
  }

  // ── Confidence mapping ────────────────────────────────────────────────────
  let confidence: Confidence = 'NONE';
  if (score >= 8)      confidence = 'HIGH';
  else if (score >= 5) confidence = 'MEDIUM';

  const entry      = price;
  const takeProfit = entry * (1 + cfg.tpPct / 100);
  const stopLoss   = entry * (1 - cfg.hardStopPct / 100);

  return {
    symbol, score, confidence, price,
    ema9: e9, ema21: e21, rsi14: r14, volumeRatio: volRatio,
    reasons, entry, stopLoss, takeProfit,
    trailPct: cfg.trailPct,
    scannedAt: new Date().toISOString(),
  };
}

/** Determine position size multiplier from confidence */
export function confidenceMultiplier(c: Confidence): number {
  return c === 'HIGH' ? 1.0 : c === 'MEDIUM' ? 0.5 : 0;
}
