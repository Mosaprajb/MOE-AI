import { fetchJson, normalizeTimeframe, providerIdentity, positiveInteger, withQuery } from '../provider-utils.js';

export function createIexProvider({
  enabled = false,
  baseUrl,
  token,
  fetchImpl = globalThis.fetch,
  rateLimit = { requests: 60, intervalMs: 60_000 },
  quotePath = (symbol) => `/stable/stock/${encodeURIComponent(symbol)}/quote`,
  chartPath = (symbol) => `/stable/stock/${encodeURIComponent(symbol)}/chart/5d`,
} = {}) {
  const identity = providerIdentity('iex', rateLimit);
  const configured = enabled === true && Boolean(baseUrl);

  return Object.freeze({
    ...identity,
    availability: configured ? 'CUSTOM_ENDPOINT' : 'DISABLED_RETIRED_SERVICE',
    async fetchSnapshot(symbol, options = {}) {
      if (!configured) {
        throw new Error('IEX Cloud is retired; configure an explicit IEX-compatible baseUrl and enable the adapter before use.');
      }
      const timeframe = normalizeTimeframe(options.timeframe || '5m');
      const limit = positiveInteger(options.limit, 120, 1, 5_000);
      const query = token ? { token } : {};
      const [quotePayload, chartPayload] = await Promise.all([
        fetchJson(fetchImpl, withQuery(baseUrl, quotePath(symbol), query)),
        fetchJson(fetchImpl, withQuery(baseUrl, chartPath(symbol), query)),
      ]);
      const chartRows = Array.isArray(chartPayload) ? chartPayload : Array.isArray(chartPayload.data) ? chartPayload.data : [];
      const bars = chartRows.slice(-limit).map((row) => ({
        timestamp: row.timestamp ?? row.minute ?? row.date,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close ?? row.marketClose,
        volume: row.volume ?? row.marketVolume,
        vwap: row.average,
      }));

      return {
        symbol,
        timeframe,
        bars,
        quote: {
          bid: quotePayload.iexBidPrice ?? quotePayload.bid,
          ask: quotePayload.iexAskPrice ?? quotePayload.ask,
          bidSize: quotePayload.iexBidSize ?? quotePayload.bidSize,
          askSize: quotePayload.iexAskSize ?? quotePayload.askSize,
          last: quotePayload.latestPrice ?? bars.at(-1)?.close,
          timestamp: quotePayload.latestUpdate ?? bars.at(-1)?.timestamp,
          volume: quotePayload.latestVolume,
          preMarketPrice: quotePayload.extendedPrice,
          afterHoursPrice: quotePayload.extendedPrice,
        },
        volume: quotePayload.latestVolume,
        dataTimestamp: quotePayload.latestUpdate ?? bars.at(-1)?.timestamp,
        metadata: { compatibilityEndpoint: true },
      };
    },
  });
}
