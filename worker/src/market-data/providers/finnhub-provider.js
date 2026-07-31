import { aggregateBars, fetchJson, MARKET_TIMEFRAMES, normalizeTimeframe, providerIdentity, positiveInteger, withQuery } from '../provider-utils.js';

export function createFinnhubProvider({
  apiKey,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://finnhub.io',
  rateLimit = { requests: 60, intervalMs: 60_000 },
} = {}) {
  const identity = providerIdentity('finnhub', rateLimit);
  if (!apiKey) throw new Error('Finnhub provider requires apiKey.');

  return Object.freeze({
    ...identity,
    async fetchSnapshot(symbol, options = {}) {
      const timeframe = normalizeTimeframe(options.timeframe || '5m');
      const limit = positiveInteger(options.limit, 120, 1, 5_000);
      const now = Math.floor((Number(options.now) || Date.now()) / 1000);
      const lookbackSeconds = Math.ceil((MARKET_TIMEFRAMES[timeframe].milliseconds * Math.max(limit * 3, 250)) / 1000);
      const headers = { 'X-Finnhub-Token': apiKey, Accept: 'application/json' };
      const candleUrl = withQuery(baseUrl, '/api/v1/stock/candle', {
        symbol, resolution: MARKET_TIMEFRAMES[timeframe].finnhub, from: now - lookbackSeconds, to: now,
      });
      const quoteUrl = withQuery(baseUrl, '/api/v1/quote', { symbol });
      const bidAskUrl = withQuery(baseUrl, '/api/v1/stock/bidask', { symbol });
      const [candlePayload, quotePayload, bidAskPayload] = await Promise.all([
        fetchJson(fetchImpl, candleUrl, { headers }).catch(() => ({})),
        fetchJson(fetchImpl, quoteUrl, { headers }),
        fetchJson(fetchImpl, bidAskUrl, { headers }).catch(() => ({})),
      ]);
      const timestamps = Array.isArray(candlePayload.t) ? candlePayload.t : [];
      const sourceLimit = timeframe === '4h' ? limit * 4 : limit;
      const sourceRows = timestamps.slice(-sourceLimit).map((timestamp, indexOffset) => {
        const sourceIndex = timestamps.length - Math.min(sourceLimit, timestamps.length) + indexOffset;
        return {
          timestamp,
          open: candlePayload.o?.[sourceIndex],
          high: candlePayload.h?.[sourceIndex],
          low: candlePayload.l?.[sourceIndex],
          close: candlePayload.c?.[sourceIndex],
          volume: candlePayload.v?.[sourceIndex],
        };
      });
      const bars = timeframe === '4h'
        ? aggregateBars(sourceRows, MARKET_TIMEFRAMES[timeframe].milliseconds).slice(-limit)
        : sourceRows.slice(-limit);

      return {
        symbol,
        timeframe,
        bars,
        quote: {
          bid: bidAskPayload.b,
          ask: bidAskPayload.a,
          bidSize: bidAskPayload.bv,
          askSize: bidAskPayload.av,
          last: quotePayload.c ?? bars.at(-1)?.close,
          timestamp: bidAskPayload.t ?? quotePayload.t ?? bars.at(-1)?.timestamp,
          volume: bars.at(-1)?.volume,
        },
        volume: bars.reduce((sum, bar) => sum + (Number(bar.volume) || 0), 0),
        dataTimestamp: bidAskPayload.t ?? quotePayload.t ?? bars.at(-1)?.timestamp,
        metadata: { candleStatus: candlePayload.s || 'unavailable' },
      };
    },
  });
}
