const TIMEFRAME_MAP = Object.freeze({
  '1': '15',
  '1m': '15m',
  '5': '60',
  '5m': '1h',
  '15': '240',
  '15m': '4h',
  '240': '1D',
  '4h': '1D',
  '1D': '1W',
  'D': 'W',
  '1d': '1w',
});

function normalizeTrend(value) {
  const trend = String(value || '').toLowerCase();
  if (['bullish', 'up', 'long', 'buy'].includes(trend)) return 'bullish';
  if (['bearish', 'down', 'short', 'sell'].includes(trend)) return 'bearish';
  return 'neutral';
}

export function getHigherTimeframe(timeframe) {
  const key = String(timeframe || '').trim();
  return TIMEFRAME_MAP[key] || null;
}

export function evaluateTimeframeAlignment({ timeframe, localTrend, higherTimeframeTrend }) {
  const higherTimeframe = getHigherTimeframe(timeframe);
  if (!higherTimeframe) {
    return {
      validMapping: false,
      timeframe,
      higherTimeframe: null,
      aligned: false,
      direction: 'neutral',
      reason: 'Unsupported timeframe mapping',
    };
  }

  const local = normalizeTrend(localTrend);
  const higher = normalizeTrend(higherTimeframeTrend);
  const aligned = higher !== 'neutral' && local === higher;

  return {
    validMapping: true,
    timeframe,
    higherTimeframe,
    aligned,
    direction: higher,
    reason: aligned ? 'Local trend aligns with higher timeframe' : 'Local trend does not align with higher timeframe',
  };
}

export { TIMEFRAME_MAP };
