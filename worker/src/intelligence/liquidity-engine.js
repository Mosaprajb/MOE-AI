function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function analyzeLiquidity({ high, low, close, previousHigh, previousLow, volume, averageVolume, atr }) {
  const h = number(high);
  const l = number(low);
  const c = number(close);
  const ph = number(previousHigh);
  const pl = number(previousLow);
  const vol = number(volume);
  const avgVol = Math.max(number(averageVolume, 1), 1);
  const atrValue = Math.max(number(atr, h - l), 0.000001);

  const sweptHigh = h > ph && c < ph;
  const sweptLow = l < pl && c > pl;
  const relativeVolume = vol / avgVol;
  const rejectionFromHigh = sweptHigh ? (h - c) / atrValue : 0;
  const rejectionFromLow = sweptLow ? (c - l) / atrValue : 0;

  const bearishScore = Math.min(100, Math.round((sweptHigh ? 45 : 0) + Math.min(30, relativeVolume * 12) + Math.min(25, rejectionFromHigh * 20)));
  const bullishScore = Math.min(100, Math.round((sweptLow ? 45 : 0) + Math.min(30, relativeVolume * 12) + Math.min(25, rejectionFromLow * 20)));

  return {
    sweptHigh,
    sweptLow,
    relativeVolume: Number(relativeVolume.toFixed(2)),
    bullishScore,
    bearishScore,
    direction: bullishScore > bearishScore ? 'bullish' : bearishScore > bullishScore ? 'bearish' : 'neutral',
    confirmed: Math.max(bullishScore, bearishScore) >= 65,
  };
}
