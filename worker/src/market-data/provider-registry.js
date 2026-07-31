import { createMarketDataService } from './market-data-service.js';
import {
  createAlpacaProvider,
  createFinnhubProvider,
  createIexProvider,
  createPolygonProvider,
  createWebullProvider,
  createYahooProvider,
} from './providers/index.js';

function enabled(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value).trim().toLowerCase());
}

export function createMarketDataProvidersFromEnv(env = {}, {
  fetchImpl = globalThis.fetch,
  webullAuthHeaders,
} = {}) {
  const providers = [];

  if (env.POLYGON_API_KEY) providers.push(createPolygonProvider({ apiKey: env.POLYGON_API_KEY, fetchImpl }));

  const alpacaKey = env.ALPACA_DATA_API_KEY || env.APCA_API_KEY_ID;
  const alpacaSecret = env.ALPACA_DATA_API_SECRET || env.APCA_API_SECRET_KEY;
  if (alpacaKey && alpacaSecret) {
    providers.push(createAlpacaProvider({
      apiKey: alpacaKey,
      apiSecret: alpacaSecret,
      fetchImpl,
      feed: env.ALPACA_DATA_FEED || 'iex',
    }));
  }

  if (enabled(env.WEBULL_MARKET_DATA_ENABLED) && typeof webullAuthHeaders === 'function') {
    providers.push(createWebullProvider({
      authHeaders: webullAuthHeaders,
      fetchImpl,
      baseUrl: env.WEBULL_MARKET_DATA_BASE_URL || 'https://api.webull.com',
    }));
  }

  if (enabled(env.IEX_MARKET_DATA_ENABLED) && env.IEX_MARKET_DATA_BASE_URL) {
    providers.push(createIexProvider({
      enabled: true,
      baseUrl: env.IEX_MARKET_DATA_BASE_URL,
      token: env.IEX_MARKET_DATA_TOKEN,
      fetchImpl,
    }));
  }

  if (env.FINNHUB_API_KEY) providers.push(createFinnhubProvider({ apiKey: env.FINNHUB_API_KEY, fetchImpl }));
  if (enabled(env.YAHOO_MARKET_DATA_ENABLED, true)) providers.push(createYahooProvider({ fetchImpl }));

  return Object.freeze(providers);
}

export function createMarketDataServiceFromEnv(env = {}, options = {}) {
  const providers = createMarketDataProvidersFromEnv(env, options);
  if (!providers.length) throw new Error('No market-data provider is configured.');
  return createMarketDataService({ ...options, providers });
}
