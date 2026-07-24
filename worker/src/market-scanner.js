function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeCandidate(input = {}) {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('Invalid scanner symbol');

  return {
    symbol,
    exchange: String(input.exchange || '').trim().toUpperCase(),
    sector: String(input.sector || 'UNKNOWN').trim().toUpperCase(),
    price: number(input.price),
    averageVolume: number(input.averageVolume),
    relativeVolume: number(input.relativeVolume, 1),
    spreadPercent: number(input.spreadPercent, 999),
    atrPercent: number(input.atrPercent),
    gapPercent: number(input.gapPercent),
    premarketVolume: number(input.premarketVolume),
    marketCap: number(input.marketCap),
    newsScore: number(input.newsScore, 50),
    trendScore: number(input.trendScore, 50),
    momentumScore: number(input.momentumScore, 50),
    sectorScore: number(input.sectorScore, 50),
    hasEarningsRisk: input.hasEarningsRisk === true,
    isHalted: input.isHalted === true,
    isTradable: input.isTradable !== false,
  };
}

export function scoreScannerCandidate(candidate, env = {}) {
  const breakdown = {
    liquidity: clamp(Math.round(Math.log10(Math.max(candidate.averageVolume, 1)) * 8), 0, 20),
    relativeVolume: clamp(Math.round(candidate.relativeVolume * 8), 0, 20),
    volatility: clamp(Math.round(candidate.atrPercent * 4), 0, 15),
    momentum: clamp(Math.round(candidate.momentumScore * 0.15), 0, 15),
    trend: clamp(Math.round(candidate.trendScore * 0.15), 0, 15),
    sector: clamp(Math.round(candidate.sectorScore * 0.1), 0, 10),
    catalyst: clamp(Math.round(candidate.newsScore * 0.05), 0, 5),
  };

  let score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  if (candidate.spreadPercent > number(env.MOE_SCANNER_MAX_SPREAD_PERCENT, 0.5)) score -= 25;
  if (candidate.hasEarningsRisk) score -= number(env.MOE_SCANNER_EARNINGS_PENALTY, 20);
  if (candidate.isHalted || !candidate.isTradable) score = 0;

  return {
    score: clamp(Math.round(score), 0, 100),
    breakdown,
  };
}

export function scanMarket(rawCandidates = [], env = {}) {
  if (!Array.isArray(rawCandidates)) throw new Error('candidates must be an array');

  const minPrice = number(env.MOE_SCANNER_MIN_PRICE, 3);
  const maxPrice = number(env.MOE_SCANNER_MAX_PRICE, 1000);
  const minAverageVolume = number(env.MOE_SCANNER_MIN_AVERAGE_VOLUME, 1000000);
  const minRelativeVolume = number(env.MOE_SCANNER_MIN_RELATIVE_VOLUME, 1.2);
  const maxSpreadPercent = number(env.MOE_SCANNER_MAX_SPREAD_PERCENT, 0.5);
  const minAtrPercent = number(env.MOE_SCANNER_MIN_ATR_PERCENT, 1);
  const minScore = number(env.MOE_SCANNER_MIN_SCORE, 65);
  const maxResults = Math.max(1, Math.floor(number(env.MOE_SCANNER_MAX_RESULTS, 30)));
  const allowedExchanges = new Set(
    String(env.MOE_SCANNER_EXCHANGES || 'NASDAQ,NYSE,AMEX')
      .split(',')
      .map((value) => value.trim().toUpperCase())
      .filter(Boolean),
  );

  const rejected = [];
  const ranked = [];

  for (const raw of rawCandidates) {
    try {
      const candidate = normalizeCandidate(raw);
      const reasons = [];

      if (candidate.exchange && !allowedExchanges.has(candidate.exchange)) reasons.push('Unsupported exchange');
      if (candidate.price < minPrice || candidate.price > maxPrice) reasons.push('Price outside allowed range');
      if (candidate.averageVolume < minAverageVolume) reasons.push('Insufficient average volume');
      if (candidate.relativeVolume < minRelativeVolume) reasons.push('Relative volume too low');
      if (candidate.spreadPercent > maxSpreadPercent) reasons.push('Spread too wide');
      if (candidate.atrPercent < minAtrPercent) reasons.push('Volatility too low');
      if (candidate.hasEarningsRisk && env.MOE_SCANNER_BLOCK_EARNINGS === 'true') reasons.push('Earnings risk');
      if (candidate.isHalted) reasons.push('Symbol halted');
      if (!candidate.isTradable) reasons.push('Symbol not tradable');

      const scoring = scoreScannerCandidate(candidate, env);
      if (scoring.score < minScore) reasons.push(`Scanner score below ${minScore}`);

      const result = { ...candidate, ...scoring, reasons };
      if (reasons.length === 0) ranked.push(result);
      else rejected.push(result);
    } catch (error) {
      rejected.push({ symbol: String(raw?.symbol || ''), reasons: [error instanceof Error ? error.message : 'Invalid candidate'] });
    }
  }

  ranked.sort((a, b) => b.score - a.score || b.relativeVolume - a.relativeVolume || b.averageVolume - a.averageVolume);
  const watchlist = ranked.slice(0, maxResults).map((item, index) => ({ rank: index + 1, ...item }));

  return {
    generatedAt: new Date().toISOString(),
    inputCount: rawCandidates.length,
    qualifiedCount: ranked.length,
    rejectedCount: rejected.length,
    watchlist,
    rejected,
    filters: {
      minPrice,
      maxPrice,
      minAverageVolume,
      minRelativeVolume,
      maxSpreadPercent,
      minAtrPercent,
      minScore,
      maxResults,
      exchanges: [...allowedExchanges],
    },
  };
}

export async function handleMarketScan(request, env = {}) {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const suppliedSecret = request.headers.get('x-moe-webhook-secret') || '';
    if (!env.MOE_WEBHOOK_SECRET || suppliedSecret !== env.MOE_WEBHOOK_SECRET) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json();
    const result = scanMarket(payload.candidates, env);
    return Response.json({ ok: true, mode: 'SCANNER_PREVIEW', ...result });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Scanner failed' }, { status: 400 });
  }
}
