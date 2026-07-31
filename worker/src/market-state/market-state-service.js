import { createMarketStateSnapshot, MARKET_STATE_COMPONENTS } from './market-state-snapshot.js';

export const DEFAULT_MARKET_STATE_SYMBOLS = Object.freeze({
  spy: 'SPY',
  qqq: 'QQQ',
  vix: 'VIX',
  dxy: 'DXY',
  us10y: 'US10Y',
});

const INSTRUMENT_COMPONENTS = Object.freeze(['spy', 'qqq', 'vix', 'dxy', 'us10y']);

function positiveInteger(value, fallback, minimum = 0, maximum = 3_600_000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeSymbols(symbols = {}) {
  return Object.freeze(Object.fromEntries(INSTRUMENT_COMPONENTS.map((name) => {
    const symbol = String(symbols[name] || DEFAULT_MARKET_STATE_SYMBOLS[name]).trim().toUpperCase();
    if (!symbol) throw new Error(`Market-state symbol for ${name} is required.`);
    return [name, symbol];
  })));
}

export class MarketStateService {
  constructor({
    marketData,
    internalsProvider,
    instrumentLoader,
    symbols = {},
    timeframe = '5m',
    limit = 2,
    cacheTtlMs = 15_000,
    instrumentMaxAgeMs = 900_000,
    internalsMaxAgeMs = 300_000,
    requiredComponents = MARKET_STATE_COMPONENTS,
    weights = {},
    now = () => Date.now(),
  } = {}) {
    if (!marketData || typeof marketData.getSnapshot !== 'function') {
      throw new Error('Market State Service requires a market-data service.');
    }
    if (internalsProvider && typeof internalsProvider.fetchInternals !== 'function') {
      throw new Error('Market-internals provider must expose fetchInternals(context).');
    }
    if (instrumentLoader !== undefined && typeof instrumentLoader !== 'function') {
      throw new Error('Market-state instrumentLoader must be a function when provided.');
    }

    this.marketData = marketData;
    this.internalsProvider = internalsProvider || null;
    this.instrumentLoader = instrumentLoader || null;
    this.symbols = normalizeSymbols(symbols);
    this.timeframe = String(timeframe || '5m');
    this.limit = positiveInteger(limit, 2, 1, 5000);
    this.cacheTtlMs = positiveInteger(cacheTtlMs, 15_000, 0, 300_000);
    this.instrumentMaxAgeMs = positiveInteger(instrumentMaxAgeMs, 900_000, 1, 86_400_000);
    this.internalsMaxAgeMs = positiveInteger(internalsMaxAgeMs, 300_000, 1, 86_400_000);
    this.requiredComponents = Object.freeze([...(Array.isArray(requiredComponents) ? requiredComponents : MARKET_STATE_COMPONENTS)]);
    this.weights = Object.freeze({ ...weights });
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.cache = null;
    this.inFlight = null;
    this.metrics = {
      requests: 0,
      cacheHits: 0,
      coalesced: 0,
      refreshes: 0,
      instrumentErrors: 0,
      internalsErrors: 0,
    };
  }

  async loadInstrument(name, context) {
    const symbol = this.symbols[name];
    if (context.instrumentSnapshots && context.instrumentSnapshots[name]) {
      return context.instrumentSnapshots[name];
    }
    if (this.instrumentLoader) {
      return this.instrumentLoader(name, symbol, context);
    }
    return this.marketData.getSnapshot(symbol, {
      timeframe: context.timeframe || this.timeframe,
      limit: context.limit || this.limit,
      maxAgeMs: context.instrumentMaxAgeMs || this.instrumentMaxAgeMs,
      ...(context.marketDataOptions || {}),
    });
  }

  async loadFresh(context = {}) {
    this.metrics.refreshes += 1;
    const instruments = {};
    const errors = [];

    await Promise.all(INSTRUMENT_COMPONENTS.map(async (name) => {
      try {
        instruments[name] = await this.loadInstrument(name, context);
      } catch (error) {
        this.metrics.instrumentErrors += 1;
        errors.push(Object.freeze({
          component: name,
          message: error instanceof Error ? error.message : 'Unknown instrument failure.',
        }));
      }
    }));

    let internals = context.internals || null;
    if (!internals && this.internalsProvider) {
      try {
        internals = await this.internalsProvider.fetchInternals(context);
      } catch (error) {
        this.metrics.internalsErrors += 1;
        errors.push(Object.freeze({
          component: 'marketInternals',
          message: error instanceof Error ? error.message : 'Unknown market-internals failure.',
        }));
      }
    }

    const state = createMarketStateSnapshot({ instruments, internals, errors }, {
      now: this.now(),
      instrumentMaxAgeMs: context.instrumentMaxAgeMs || this.instrumentMaxAgeMs,
      internalsMaxAgeMs: context.internalsMaxAgeMs || this.internalsMaxAgeMs,
      requiredComponents: context.requiredComponents || this.requiredComponents,
      weights: { ...this.weights, ...(context.weights || {}) },
    });
    const value = Object.freeze({ ...state, cache: 'MISS' });
    if (this.cacheTtlMs > 0) this.cache = { value, expiresAt: this.now() + this.cacheTtlMs };
    return value;
  }

  async getState(context = {}) {
    this.metrics.requests += 1;
    const forceRefresh = context.forceRefresh === true;
    if (!forceRefresh && this.cache && this.cache.expiresAt > this.now()) {
      this.metrics.cacheHits += 1;
      return Object.freeze({ ...this.cache.value, cache: 'HIT' });
    }
    if (!forceRefresh && this.inFlight) {
      this.metrics.coalesced += 1;
      return Object.freeze({ ...(await this.inFlight), cache: 'COALESCED' });
    }

    const request = this.loadFresh(context);
    this.inFlight = request;
    try {
      return await request;
    } finally {
      if (this.inFlight === request) this.inFlight = null;
    }
  }

  async refresh(context = {}) {
    return this.getState({ ...context, forceRefresh: true });
  }

  clear() {
    this.cache = null;
    this.inFlight = null;
  }

  getMetrics() {
    return Object.freeze({
      ...this.metrics,
      cacheReady: Boolean(this.cache && this.cache.expiresAt > this.now()),
      inFlight: Boolean(this.inFlight),
      symbols: this.symbols,
    });
  }
}

export function createMarketStateService(options) {
  return new MarketStateService(options);
}
