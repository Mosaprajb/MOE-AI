import { fetchJson, MARKET_TIMEFRAMES, normalizeTimeframe, providerIdentity, positiveInteger, unwrapArray, unwrapObject, withQuery } from '../provider-utils.js';

async function requestHeaders(authHeaders, details) {
  if (typeof authHeaders !== 'function') throw new Error('Webull provider requires authHeaders(details).');
  const value = await authHeaders(details);
  if (!value || typeof value !== 'object') throw new Error('Webull authHeaders returned invalid headers.');
  return { Accept: 'application/json', ...value };
}

export function createWebullProvider({
  authHeaders,
  fetchImpl = globalThis.fetch,
  baseUrl = 'https://api.webull.com',
  category = 'US_STOCK',
  rateLimit = { requests: 300, intervalMs: 60_000 },
} = {}) {
  const identity = providerIdentity('webull', rateLimit);

  return Object.freeze({
    ...identity,
    async fetchSnapshot(symbol, options = {}) {
      const timeframe = normalizeTimeframe(options.timeframe || '5m');
      const limit = positiveInteger(options.limit, 120, 1, 1_200);
      const barsPath = '/openapi/market-data/stock/bars';
      const snapshotPath = '/openapi/market-data/stock/snapshot';
      const barsQuery = { symbol, category, interval: MARKET_TIMEFRAMES[timeframe].webull, count: limit };
      const snapshotQuery = { symbols: symbol, category, extend_hour_required: 'true', overnight_required: 'true' };
      const barsUrl = withQuery(baseUrl, barsPath, barsQuery);
      const snapshotUrl = withQuery(baseUrl, snapshotPath, snapshotQuery);
      const [barsPayload, snapshotPayload] = await Promise.all([
        requestHeaders(authHeaders, { method: 'GET', path: barsPath, query: barsQuery }).then((headers) => fetchJson(fetchImpl, barsUrl, { headers })),
        requestHeaders(authHeaders, { method: 'GET', path: snapshotPath, query: snapshotQuery })
          .then((headers) => fetchJson(fetchImpl, snapshotUrl, { headers }))
          .catch(() => ({})),
      ]);
      const barsRows = unwrapArray(barsPayload, ['data', 'bars', 'result', 'data.result', 'data.bars']);
      const snapshotRows = unwrapArray(snapshotPayload, ['data', 'result', 'data.result']);
      const snapshot = snapshotRows[0] || unwrapObject(snapshotPayload, ['data', 'snapshot', 'result']);
      const bars = barsRows.map((row) => ({
        timestamp: row.timestamp ?? row.time ?? row.t,
        open: row.open ?? row.o,
        high: row.high ?? row.h,
        low: row.low ?? row.l,
        close: row.close ?? row.c,
        volume: row.volume ?? row.v,
        vwap: row.vwap ?? row.vw,
      }));

      return {
        symbol,
        timeframe,
        bars,
        quote: {
          bid: snapshot.bid_price ?? snapshot.bidPrice ?? snapshot.bid,
          ask: snapshot.ask_price ?? snapshot.askPrice ?? snapshot.ask,
          bidSize: snapshot.bid_size ?? snapshot.bidSize,
          askSize: snapshot.ask_size ?? snapshot.askSize,
          last: snapshot.latest_price ?? snapshot.last_price ?? snapshot.lastPrice ?? snapshot.close ?? bars.at(-1)?.close,
          timestamp: snapshot.timestamp ?? snapshot.time ?? bars.at(-1)?.timestamp,
          volume: snapshot.volume ?? snapshot.day_volume,
          preMarketPrice: snapshot.pre_market_price ?? snapshot.preMarketPrice,
          afterHoursPrice: snapshot.after_hours_price ?? snapshot.afterHoursPrice,
        },
        volume: snapshot.volume ?? snapshot.day_volume,
        session: snapshot.market_session ?? snapshot.session ?? 'extended',
        dataTimestamp: snapshot.timestamp ?? snapshot.time ?? bars.at(-1)?.timestamp,
        metadata: { category, officialOpenApi: true },
      };
    },
  });
}
