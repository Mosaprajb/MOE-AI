const DEFAULT_CACHE_TTL_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 150;
const DEFAULT_MAX_CONCURRENT = 4;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function positiveInteger(value, fallback, minimum = 1, maximum = 1000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeSymbol(symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(normalized)) throw new Error('Invalid market-data symbol.');
  return normalized;
}

export class MarketDataLayer {
  constructor({ provider, cacheTtlMs = DEFAULT_CACHE_TTL_MS, maxRetries = DEFAULT_MAX_RETRIES, retryDelayMs = DEFAULT_RETRY_DELAY_MS, maxConcurrent = DEFAULT_MAX_CONCURRENT } = {}) {
    if (!provider || typeof provider.fetchSnapshot !== 'function') throw new Error('A market-data provider with fetchSnapshot(symbol, options) is required.');
    this.provider = provider;
    this.cacheTtlMs = positiveInteger(cacheTtlMs, DEFAULT_CACHE_TTL_MS, 100, 300_000);
    this.maxRetries = positiveInteger(maxRetries, DEFAULT_MAX_RETRIES, 0, 10);
    this.retryDelayMs = positiveInteger(retryDelayMs, DEFAULT_RETRY_DELAY_MS, 1, 10_000);
    this.maxConcurrent = positiveInteger(maxConcurrent, DEFAULT_MAX_CONCURRENT, 1, 32);
    this.cache = new Map();
    this.active = 0;
    this.waiters = [];
  }

  async acquire() {
    if (this.active < this.maxConcurrent) {
      this.active += 1;
      return;
    }
    await new Promise((resolve) => this.waiters.push(resolve));
    this.active += 1;
  }

  release() {
    this.active = Math.max(0, this.active - 1);
    const next = this.waiters.shift();
    if (next) next();
  }

  cacheKey(symbol, options = {}) {
    return `${symbol}:${String(options.timeframe || '5m')}:${String(options.limit || 120)}`;
  }

  async getSnapshot(symbol, options = {}) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const key = this.cacheKey(normalizedSymbol, options);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > Date.now()) return { ...cached.value, cache: 'HIT' };

    await this.acquire();
    try {
      let lastError;
      for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
        try {
          const value = await this.provider.fetchSnapshot(normalizedSymbol, options);
          if (!value || typeof value !== 'object') throw new Error('Market-data provider returned an invalid snapshot.');
          const normalized = Object.freeze({ ...value, symbol: normalizedSymbol, fetchedAt: value.fetchedAt || new Date().toISOString(), cache: 'MISS' });
          this.cache.set(key, { value: normalized, expiresAt: Date.now() + this.cacheTtlMs });
          return normalized;
        } catch (error) {
          lastError = error;
          if (attempt < this.maxRetries) await sleep(this.retryDelayMs * (attempt + 1));
        }
      }
      throw lastError || new Error('Market-data request failed.');
    } finally {
      this.release();
    }
  }

  clear() {
    this.cache.clear();
  }
}

export function createMarketDataLayer(options) {
  return new MarketDataLayer(options);
}
