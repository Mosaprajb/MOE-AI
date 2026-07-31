import { createMarketSnapshot } from './market-snapshot.js';
import { mergeMarketSnapshotInput } from './market-snapshot-enricher.js';
import { MARKET_TIMEFRAMES, normalizeSymbol, normalizeTimeframe, positiveInteger } from './provider-utils.js';

const DEFAULT_CACHE_TTL_MS = 15_000;
const DEFAULT_MAX_RETRIES = 2;
const DEFAULT_RETRY_DELAY_MS = 150;
const DEFAULT_MAX_CONCURRENT = 4;
const DEFAULT_FAILURE_THRESHOLD = 3;
const DEFAULT_CIRCUIT_COOLDOWN_MS = 30_000;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function providerList(provider, providers) {
  const rows = Array.isArray(providers) ? providers : provider ? [provider] : [];
  const normalized = rows.filter((row) => row && typeof row.fetchSnapshot === 'function');
  if (!normalized.length) throw new Error('At least one market-data provider with fetchSnapshot(symbol, options) is required.');
  return Object.freeze(normalized.map((row, index) => Object.freeze({
    ...row,
    name: String(row.name || row.source || `provider-${index + 1}`).trim().toLowerCase(),
  })));
}

function normalizeEnricher(enrichmentProvider) {
  if (!enrichmentProvider) return null;
  if (typeof enrichmentProvider === 'function') {
    return Object.freeze({ name: 'market-snapshot-enricher', enrichSnapshot: enrichmentProvider });
  }
  if (typeof enrichmentProvider.enrichSnapshot !== 'function') {
    throw new Error('Market-data enrichment provider must expose enrichSnapshot(symbol, raw, options).');
  }
  return Object.freeze({
    ...enrichmentProvider,
    name: String(enrichmentProvider.name || 'market-snapshot-enricher').trim().toLowerCase(),
  });
}

function maxAgeFor(timeframe, configured) {
  if (Number.isFinite(Number(configured)) && Number(configured) > 0) return Number(configured);
  return MARKET_TIMEFRAMES[timeframe].milliseconds * 3;
}

export class MarketDataService {
  constructor({
    provider,
    providers,
    enrichmentProvider,
    requireEnrichment = false,
    cacheTtlMs = DEFAULT_CACHE_TTL_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    maxConcurrent = DEFAULT_MAX_CONCURRENT,
    failureThreshold = DEFAULT_FAILURE_THRESHOLD,
    circuitCooldownMs = DEFAULT_CIRCUIT_COOLDOWN_MS,
    minimumBars = 1,
    requirePrice = true,
    rejectStale = true,
    minimumQualityScore = 60,
    atrPeriod = 14,
    relativeVolumeLookback = 20,
    pocBuckets = 24,
    now = () => Date.now(),
  } = {}) {
    this.providers = providerList(provider, providers);
    this.enrichmentProvider = normalizeEnricher(enrichmentProvider);
    this.requireEnrichment = requireEnrichment === true;
    this.cacheTtlMs = positiveInteger(cacheTtlMs, DEFAULT_CACHE_TTL_MS, 100, 300_000);
    this.maxRetries = positiveInteger(maxRetries, DEFAULT_MAX_RETRIES, 0, 10);
    this.retryDelayMs = positiveInteger(retryDelayMs, DEFAULT_RETRY_DELAY_MS, 1, 10_000);
    this.maxConcurrent = positiveInteger(maxConcurrent, DEFAULT_MAX_CONCURRENT, 1, 32);
    this.failureThreshold = positiveInteger(failureThreshold, DEFAULT_FAILURE_THRESHOLD, 1, 100);
    this.circuitCooldownMs = positiveInteger(circuitCooldownMs, DEFAULT_CIRCUIT_COOLDOWN_MS, 100, 3_600_000);
    this.minimumBars = positiveInteger(minimumBars, 1, 0, 10_000);
    this.requirePrice = requirePrice !== false;
    this.rejectStale = rejectStale !== false;
    this.minimumQualityScore = positiveInteger(minimumQualityScore, 60, 0, 100);
    this.atrPeriod = positiveInteger(atrPeriod, 14, 1, 200);
    this.relativeVolumeLookback = positiveInteger(relativeVolumeLookback, 20, 1, 500);
    this.pocBuckets = positiveInteger(pocBuckets, 24, 4, 100);
    this.now = typeof now === 'function' ? now : () => Date.now();
    this.cache = new Map();
    this.inFlight = new Map();
    this.active = 0;
    this.waiters = [];
    this.enrichmentMetrics = {
      calls: 0,
      successes: 0,
      errors: 0,
    };
    this.providerStates = new Map(this.providers.map((item) => [item.name, {
      failures: 0,
      circuitOpenUntil: 0,
      nextAllowedAt: 0,
      calls: 0,
      successes: 0,
      errors: 0,
      fallbacks: 0,
    }]));
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
    return `${symbol}:${normalizeTimeframe(options.timeframe || '5m')}:${positiveInteger(options.limit, 120, 1, 5000)}`;
  }

  async respectRateLimit(provider) {
    const state = this.providerStates.get(provider.name);
    const requests = positiveInteger(provider.rateLimit?.requests, 60, 1, 100_000);
    const intervalMs = positiveInteger(provider.rateLimit?.intervalMs, 60_000, 1, 3_600_000);
    const spacingMs = Math.max(1, Math.ceil(intervalMs / requests));
    const waitMs = Math.max(0, state.nextAllowedAt - this.now());
    if (waitMs) await sleep(waitMs);
    state.nextAllowedAt = Math.max(this.now(), state.nextAllowedAt) + spacingMs;
  }

  async enrichSnapshotInput(symbol, raw, options) {
    if (!this.enrichmentProvider || options.enrich === false) return raw;
    this.enrichmentMetrics.calls += 1;
    try {
      const enrichment = await this.enrichmentProvider.enrichSnapshot(symbol, raw, options);
      if (enrichment !== undefined && (!enrichment || typeof enrichment !== 'object' || Array.isArray(enrichment))) {
        throw new Error('Market-data enrichment provider returned an invalid payload.');
      }
      this.enrichmentMetrics.successes += 1;
      return mergeMarketSnapshotInput(raw, enrichment || {});
    } catch (error) {
      this.enrichmentMetrics.errors += 1;
      if (this.requireEnrichment || options.requireEnrichment === true) throw error;
      return mergeMarketSnapshotInput(raw, {
        metadata: {
          enrichmentProvider: this.enrichmentProvider.name,
          enrichmentError: error instanceof Error ? error.message : 'Unknown market-data enrichment failure.',
        },
      });
    }
  }

  async requestProvider(provider, symbol, options, attempts) {
    const state = this.providerStates.get(provider.name);
    if (state.circuitOpenUntil > this.now()) {
      attempts.push(Object.freeze({ provider: provider.name, status: 'CIRCUIT_OPEN' }));
      return null;
    }

    let lastError;
    for (let retry = 0; retry <= this.maxRetries; retry += 1) {
      try {
        await this.respectRateLimit(provider);
        state.calls += 1;
        const raw = await provider.fetchSnapshot(symbol, options);
        const enrichedRaw = await this.enrichSnapshotInput(symbol, raw, options);
        const timeframe = normalizeTimeframe(options.timeframe || enrichedRaw?.timeframe || '5m');
        const snapshot = createMarketSnapshot(enrichedRaw, {
          symbol,
          provider: provider.name,
          timeframe,
          now: this.now(),
          maxAgeMs: maxAgeFor(timeframe, options.maxAgeMs),
          minimumBars: options.minimumBars ?? this.minimumBars,
          requirePrice: options.requirePrice ?? this.requirePrice,
          rejectStale: options.rejectStale ?? this.rejectStale,
          minimumQualityScore: options.minimumQualityScore ?? this.minimumQualityScore,
          atrPeriod: options.atrPeriod ?? this.atrPeriod,
          relativeVolumeLookback: options.relativeVolumeLookback ?? this.relativeVolumeLookback,
          pocBuckets: options.pocBuckets ?? this.pocBuckets,
        });
        state.failures = 0;
        state.circuitOpenUntil = 0;
        state.successes += 1;
        attempts.push(Object.freeze({ provider: provider.name, status: 'SUCCESS', retry }));
        return snapshot;
      } catch (error) {
        lastError = error;
        state.errors += 1;
        attempts.push(Object.freeze({
          provider: provider.name,
          status: 'FAILED',
          retry,
          message: error instanceof Error ? error.message : 'Unknown market-data provider failure.',
        }));
        if (retry < this.maxRetries) await sleep(this.retryDelayMs * (retry + 1));
      }
    }

    state.failures += 1;
    if (state.failures >= this.failureThreshold) state.circuitOpenUntil = this.now() + this.circuitCooldownMs;
    if (lastError) state.lastError = lastError instanceof Error ? lastError.message : String(lastError);
    return null;
  }

  async fetchFresh(symbol, options, key) {
    await this.acquire();
    try {
      const attempts = [];
      for (let index = 0; index < this.providers.length; index += 1) {
        const provider = this.providers[index];
        const snapshot = await this.requestProvider(provider, symbol, options, attempts);
        if (!snapshot) continue;
        if (index > 0) this.providerStates.get(provider.name).fallbacks += 1;
        const value = Object.freeze({
          ...snapshot,
          cache: 'MISS',
          providerAttempts: Object.freeze(attempts),
        });
        this.cache.set(key, { value, expiresAt: this.now() + this.cacheTtlMs });
        return value;
      }
      const message = attempts.length
        ? attempts.filter((attempt) => attempt.status === 'FAILED').map((attempt) => `${attempt.provider}: ${attempt.message}`).join(' | ')
        : 'No market-data providers were available.';
      const error = new Error(`All market-data providers failed for ${symbol}. ${message}`);
      error.attempts = Object.freeze(attempts);
      throw error;
    } finally {
      this.release();
    }
  }

  async getSnapshot(symbol, options = {}) {
    const normalizedSymbol = normalizeSymbol(symbol);
    const key = this.cacheKey(normalizedSymbol, options);
    const cached = this.cache.get(key);
    if (cached && cached.expiresAt > this.now()) return Object.freeze({ ...cached.value, cache: 'HIT' });
    if (cached) this.cache.delete(key);

    const existing = this.inFlight.get(key);
    if (existing) return Object.freeze({ ...(await existing), cache: 'COALESCED' });

    const request = this.fetchFresh(normalizedSymbol, options, key);
    this.inFlight.set(key, request);
    try {
      return await request;
    } finally {
      this.inFlight.delete(key);
    }
  }

  clear() {
    this.cache.clear();
    this.inFlight.clear();
  }

  getMetrics() {
    return Object.freeze({
      cacheEntries: this.cache.size,
      inFlight: this.inFlight.size,
      active: this.active,
      enrichment: Object.freeze({
        provider: this.enrichmentProvider?.name || null,
        required: this.requireEnrichment,
        ...this.enrichmentMetrics,
      }),
      providers: Object.freeze(Object.fromEntries([...this.providerStates.entries()].map(([name, state]) => [name, Object.freeze({ ...state })]))),
    });
  }
}

export function createMarketDataService(options) {
  return new MarketDataService(options);
}
