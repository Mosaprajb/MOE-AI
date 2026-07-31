import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketDataService } from '../src/market-data/market-data-service.js';
import { createMarketDataProvidersFromEnv } from '../src/market-data/provider-registry.js';
import { createIexProvider } from '../src/market-data/providers/iex-provider.js';

const NOW = 1_800_000_000_000;

function provider(name, load) {
  return Object.freeze({
    name,
    rateLimit: { requests: 100_000, intervalMs: 1 },
    fetchSnapshot: load,
  });
}

function validSnapshot(symbol, timestamp = NOW) {
  return {
    symbol,
    timeframe: '5m',
    bars: [
      { timestamp: timestamp - 300_000, open: 100, high: 102, low: 99, close: 101, volume: 10_000 },
      { timestamp, open: 101, high: 103, low: 100, close: 102, volume: 12_000 },
    ],
    quote: { bid: 101.99, ask: 102.01, last: 102, timestamp, volume: 22_000 },
    dataTimestamp: timestamp,
  };
}

test('market data service fails over and returns a validated normalized snapshot', async () => {
  const service = createMarketDataService({
    providers: [
      provider('primary', async () => { throw new Error('primary unavailable'); }),
      provider('backup', async (symbol) => validSnapshot(symbol)),
    ],
    maxRetries: 0,
    now: () => NOW,
  });

  const result = await service.getSnapshot('aapl', { timeframe: '5m', limit: 120 });
  assert.equal(result.symbol, 'AAPL');
  assert.equal(result.provider, 'backup');
  assert.equal(result.cache, 'MISS');
  assert.equal(result.quality.valid, true);
  assert.equal(result.stale, false);
  assert.deepEqual(result.providerAttempts.map((attempt) => attempt.status), ['FAILED', 'SUCCESS']);
  assert.equal(service.getMetrics().providers.backup.fallbacks, 1);
});

test('market data service caches results and deduplicates provider work', async () => {
  let calls = 0;
  const service = createMarketDataService({
    provider: provider('only', async (symbol) => { calls += 1; return validSnapshot(symbol); }),
    maxRetries: 0,
    cacheTtlMs: 10_000,
    now: () => NOW,
  });

  const first = await service.getSnapshot('MSFT');
  const second = await service.getSnapshot('msft');
  assert.equal(first.cache, 'MISS');
  assert.equal(second.cache, 'HIT');
  assert.equal(calls, 1);
});

test('stale or malformed data is rejected before analyzers and a fresh provider may replace it', async () => {
  const service = createMarketDataService({
    providers: [
      provider('stale', async (symbol) => validSnapshot(symbol, NOW - 10_000_000)),
      provider('fresh', async (symbol) => validSnapshot(symbol, NOW)),
    ],
    maxRetries: 0,
    now: () => NOW,
  });

  const result = await service.getSnapshot('NVDA', { maxAgeMs: 600_000 });
  assert.equal(result.provider, 'fresh');
  assert.equal(result.providerAttempts[0].status, 'FAILED');
  assert.match(result.providerAttempts[0].message, /quality validation failed/i);

  const broken = createMarketDataService({
    provider: provider('broken', async (symbol) => ({
      ...validSnapshot(symbol),
      bars: [{ timestamp: NOW, open: 100, high: 90, low: 95, close: 99, volume: 1 }],
    })),
    maxRetries: 0,
    now: () => NOW,
  });
  await assert.rejects(() => broken.getSnapshot('TSLA'), /All market-data providers failed/);
});

test('provider circuits fail closed after repeated failures', async () => {
  let primaryCalls = 0;
  let cacheClock = NOW;
  const service = createMarketDataService({
    providers: [
      provider('primary', async () => { primaryCalls += 1; throw new Error('offline'); }),
      provider('backup', async (symbol) => validSnapshot(symbol, cacheClock)),
    ],
    maxRetries: 0,
    failureThreshold: 1,
    cacheTtlMs: 100,
    circuitCooldownMs: 10_000,
    now: () => cacheClock,
  });

  await service.getSnapshot('META');
  cacheClock += 200;
  const second = await service.getSnapshot('META');
  assert.equal(primaryCalls, 1);
  assert.equal(second.providerAttempts[0].status, 'CIRCUIT_OPEN');
});

test('provider registry preserves requested fallback order and IEX remains explicit fail-closed', async () => {
  const providers = createMarketDataProvidersFromEnv({
    POLYGON_API_KEY: 'polygon-key',
    ALPACA_DATA_API_KEY: 'alpaca-key',
    ALPACA_DATA_API_SECRET: 'alpaca-secret',
    WEBULL_MARKET_DATA_ENABLED: 'true',
    IEX_MARKET_DATA_ENABLED: 'true',
    IEX_MARKET_DATA_BASE_URL: 'https://iex-compatible.example',
    FINNHUB_API_KEY: 'finnhub-key',
    YAHOO_MARKET_DATA_ENABLED: 'true',
  }, {
    fetchImpl: async () => { throw new Error('not called'); },
    webullAuthHeaders: async () => ({ 'x-app-key': 'key' }),
  });

  assert.deepEqual(providers.map((item) => item.name), ['polygon', 'alpaca', 'webull', 'iex', 'finnhub', 'yahoo']);

  const disabledIex = createIexProvider();
  await assert.rejects(() => disabledIex.fetchSnapshot('AAPL'), /retired/i);
});
