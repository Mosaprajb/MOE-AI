import { fetchJson, MARKET_TIMEFRAMES, normalizeTimeframe, providerIdentity, positiveInteger, withQuery } from '../provider-utils.js';

export function createPolygonProvider({
  apiKey,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.polygon.io',
  rateLimit = { requests: 5, intervalMs: 60_000 },
} = {}) {
  const identity = providerIdentity('polygon', rateLimit);
  if (!apiKey) throw new Error('Polygon provider requires apiKey.');

  return Object.freeze({
    ...identity,
    async fetchSnapshot(symbol, options = {}) {
      const timeframe = normalizeTimeframe(options.timeframe || '5m');
      const limit = positiveInteger(options.limit, 120, 1, 5_000);
      const now = Number(options.now) || Date.now();
      const [multiplier, timespan] = MARKET_TIMEFRAMES[timeframe].polygon;
      const lookbackMs = MARKET_TIMEFRAMES[timeframe].milliseconds * Math.max(limit * 3, 250);
      const from = new Date(now - lookbackMs).toISOString().slice(0, 10);
      const to = new Date(now).toISOString().slice(0, 10);
      const barsUrl = withQuery(baseUrl, `/v2/aggs/ticker/${encodeURIComponent(symbol)}/range/${multiplier}/${timespan}/${from}/${to}`, {
        adjusted: 'true', sort: 'asc', limit, apiKey,
      });
      const snapshotUrl = withQuery(baseUrl, `/v2/snapshot/locale/us/markets/stocks/tickers/${encodeURIComponent(symbol)}`, { apiKey });
      const [barsPayload, snapshotPayload] = await Promise.all([
        fetchJson(fetchImpl, barsUrl),
        fetchJson(fetchImpl, snapshotUrl).catch(() => ({})),
      ]);
      const ticker = snapshotPayload.ticker || {};
      const lastQuote = ticker.lastQuote || {};
      const lastTrade = ticker.lastTrade || {};
      const bars = (Array.isArray(barsPayload.results) ? barsPayload.results : []).map((row) => ({
        timestamp: row.t, open: row.o, high: row.h, low: row.l, close: row.c,
        volume: row.v, vwap: row.vw, trades: row.n,
      }));

      return {
        symbol,
        timeframe,
        bars,
        quote: {
          bid: lastQuote.p,
          ask: lastQuote.P,
          bidSize: lastQuote.s,
          askSize: lastQuote.S,
          last: lastTrade.p ?? ticker.min?.c ?? bars.at(-1)?.close,
          timestamp: lastQuote.t ?? lastTrade.t ?? ticker.updated,
          volume: ticker.day?.v,
        },
        volume: ticker.day?.v,
        dataTimestamp: ticker.updated ?? bars.at(-1)?.timestamp,
        metadata: { requestId: barsPayload.request_id || snapshotPayload.request_id || null },
      };
    },
  });
}
