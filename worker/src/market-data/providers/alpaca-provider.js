import { fetchJson, MARKET_TIMEFRAMES, normalizeTimeframe, providerIdentity, positiveInteger, withQuery } from '../provider-utils.js';

export function createAlpacaProvider({
  apiKey,
  apiSecret,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://data.alpaca.markets',
  feed = 'iex',
  rateLimit = { requests: 200, intervalMs: 60_000 },
} = {}) {
  const identity = providerIdentity('alpaca', rateLimit);
  if (!apiKey || !apiSecret) throw new Error('Alpaca provider requires apiKey and apiSecret.');
  const headers = Object.freeze({
    'APCA-API-KEY-ID': apiKey,
    'APCA-API-SECRET-KEY': apiSecret,
    Accept: 'application/json',
  });

  return Object.freeze({
    ...identity,
    async fetchSnapshot(symbol, options = {}) {
      const timeframe = normalizeTimeframe(options.timeframe || '5m');
      const limit = positiveInteger(options.limit, 120, 1, 10_000);
      const now = Number(options.now) || Date.now();
      const lookbackMs = MARKET_TIMEFRAMES[timeframe].milliseconds * Math.max(limit * 4, 500);
      const barsUrl = withQuery(baseUrl, `/v2/stocks/${encodeURIComponent(symbol)}/bars`, {
        timeframe: MARKET_TIMEFRAMES[timeframe].alpaca,
        start: new Date(now - lookbackMs).toISOString(),
        end: new Date(now).toISOString(),
        limit,
        adjustment: 'raw',
        feed: options.feed || feed,
      });
      const quoteUrl = withQuery(baseUrl, `/v2/stocks/${encodeURIComponent(symbol)}/quotes/latest`, { feed: options.feed || feed });
      const [barsPayload, quotePayload] = await Promise.all([
        fetchJson(fetchImpl, barsUrl, { headers }),
        fetchJson(fetchImpl, quoteUrl, { headers }).catch(() => ({})),
      ]);
      const bars = (Array.isArray(barsPayload.bars) ? barsPayload.bars : []).map((row) => ({
        timestamp: row.t, open: row.o, high: row.h, low: row.l, close: row.c,
        volume: row.v, vwap: row.vw, trades: row.n,
      }));
      const quote = quotePayload.quote || {};

      return {
        symbol,
        timeframe,
        bars,
        quote: {
          bid: quote.bp,
          ask: quote.ap,
          bidSize: quote.bs,
          askSize: quote.as,
          last: bars.at(-1)?.close,
          timestamp: quote.t ?? bars.at(-1)?.timestamp,
          volume: bars.at(-1)?.volume,
        },
        volume: bars.reduce((sum, bar) => sum + (Number(bar.volume) || 0), 0),
        dataTimestamp: quote.t ?? bars.at(-1)?.timestamp,
        metadata: { feed: options.feed || feed, nextPageToken: barsPayload.next_page_token || null },
      };
    },
  });
}
