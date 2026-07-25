function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function classifyTrend(score) {
  if (score > 0.2) return 'BULLISH';
  if (score < -0.2) return 'BEARISH';
  return 'NEUTRAL';
}

function classifyVolatility(atrPercent) {
  if (atrPercent > 3) return 'HIGH';
  if (atrPercent < 1) return 'LOW';
  return 'NORMAL';
}

export class ContextEngine {
  build(snapshot, overrides = {}) {
    if (!snapshot) throw new Error('Context engine requires a feature snapshot');

    const values = { ...(snapshot.values || {}) };
    return {
      symbol: snapshot.symbol,
      timeframe: snapshot.timeframe,
      timestamp: number(snapshot.timestamp, Date.now()),
      marketPrice: number(overrides.marketPrice, number(values.marketPrice)),
      marketTrend: overrides.marketTrend || classifyTrend(number(values.trendScore)),
      volatility: overrides.volatility || classifyVolatility(number(values.atrPercent)),
      htfAligned: overrides.htfAligned ?? values.htfAligned ?? null,
      relativeVolume: number(overrides.relativeVolume, number(values.relativeVolume, 1)),
      liquidityScore: number(overrides.liquidityScore, number(values.liquidityScore, 50)),
      marketScore: number(overrides.marketScore, number(values.marketScore, 50)),
      signalScore: number(overrides.signalScore, number(values.signalScore, 50)),
      spreadPercent: number(overrides.spreadPercent, number(values.spreadPercent)),
      newsBlocked: overrides.newsBlocked === true,
      duplicateSignal: overrides.duplicateSignal === true,
      signalExpired: overrides.signalExpired === true,
      accountEquity: number(overrides.accountEquity),
      riskPercent: number(overrides.riskPercent),
      features: values,
    };
  }
}

export const contextEngine = new ContextEngine();
