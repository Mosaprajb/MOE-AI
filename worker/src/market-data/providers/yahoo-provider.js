import { aggregateBars, fetchJson, MARKET_TIMEFRAMES, normalizeTimeframe, providerIdentity, positiveInteger, withQuery } from '../provider-utils.js';

const RANGE_BY_TIMEFRAME = Object.freeze({
  '1m': '5d', '5m': '5d', '15m': '1mo', '1h': '3mo', '4h': '6mo', '1d': '1y',
});

export function createYahooProvider({
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://query1.finance.yahoo.com',
  rateLimit = { requests: 60, intervalMs: 60_000 },
} = {}) {
  const identity = providerIdentity('yahoo', rateLimit);

  return Object.freeze({
    ...identity,
    unofficialFallback: true,
    async fetchSnapshot(symbol, options = {}) {
      const timeframe = normalizeTimeframe(options.timeframe || '5m');
      const limit = positiveInteger(options.limit, 120, 1, 5_000);
      const url = withQuery(baseUrl, `/v8/finance/chart/${encodeURIComponent(symbol)}`, {
        interval: MARKET_TIMEFRAMES[timeframe].yahoo,
        range: options.range || RANGE_BY_TIMEFRAME[timeframe],
        includePrePost: 'true',
        events: 'div,splits',
      });
      const payload = await fetchJson(fetchImpl, url, {
        headers: { Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' },
      });
      const result = payload.chart?.result?.[0];
      if (!result) throw new Error(payload.chart?.error?.description || 'Yahoo chart returned no result.');
      const timestamps = Array.isArray(result.timestamp) ? result.timestamp : [];
      const quoteRows = result.indicators?.quote?.[0] || {};
      const adjusted = result.indicators?.adjclose?.[0]?.adjclose || [];
      const sourceLimit = timeframe === '4h' ? limit * 4 : limit;
      const start = Math.max(0, timestamps.length - sourceLimit);
      const bars = [];
      for (let index = start; index < timestamps.length; index += 1) {
        const open = quoteRows.open?.[index];
        const high = quoteRows.high?.[index];
        const low = quoteRows.low?.[index];
        const close = quoteRows.close?.[index];
        if (![open, high, low, close].every((value) => Number.isFinite(Number(value)))) continue;
        bars.push({
          timestamp: timestamps[index],
          open,
          high,
          low,
          close,
          volume: quoteRows.volume?.[index] ?? 0,
          adjustedClose: adjusted[index],
        });
      }
      const normalizedBars = timeframe === '4h'
        ? aggregateBars(bars, MARKET_TIMEFRAMES[timeframe].milliseconds).slice(-limit)
        : bars.slice(-limit);
      const meta = result.meta || {};
      const last = meta.regularMarketPrice ?? normalizedBars.at(-1)?.close;

      return {
        symbol,
        timeframe,
        bars: normalizedBars,
        quote: {
          bid: meta.bid,
          ask: meta.ask,
          last,
          timestamp: meta.regularMarketTime ?? normalizedBars.at(-1)?.timestamp,
          volume: meta.regularMarketVolume ?? normalizedBars.at(-1)?.volume,
          preMarketPrice: meta.preMarketPrice,
          afterHoursPrice: meta.postMarketPrice,
        },
        volume: meta.regularMarketVolume,
        dataTimestamp: meta.regularMarketTime ?? normalizedBars.at(-1)?.timestamp,
        metadata: {
          exchange: meta.exchangeName || null,
          currency: meta.currency || null,
          unofficialFallback: true,
        },
      };
    },
  });
}
