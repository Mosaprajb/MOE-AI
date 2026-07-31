import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_SNAPSHOT_SCHEMA,
  MARKET_SNAPSHOT_VERSION,
  createMarketSnapshot,
  validateUnifiedMarketSnapshot,
} from '../src/market-data/market-snapshot.js';
import { createMarketSnapshotEnricher } from '../src/market-data/market-snapshot-enricher.js';
import { createMarketDataService } from '../src/market-data/market-data-service.js';
import { createScannerEngine } from '../src/scanner/scanner-engine.js';

const NOW = 1_800_000_000_000;

function bars(count = 24) {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index * 0.2;
    const close = open + (index % 2 ? 0.4 : -0.1);
    return {
      timestamp: NOW - (count - 1 - index) * 300_000,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.4,
      close,
      volume: 1_000 + index * 100,
    };
  });
}

function rawSnapshot(symbol = 'AAPL') {
  return {
    symbol,
    timeframe: '5m',
    bars: bars(),
    quote: { bid: 104.49, ask: 104.51, last: 104.5, timestamp: NOW, volume: 80_000 },
    dataTimestamp: NOW,
    session: 'CORE',
    profile: {
      name: 'Example Corp',
      float: 1_200_000_000,
      sector: 'Technology',
      industry: 'Semiconductors',
    },
    news: [{ id: 'n1', headline: 'Example headline', source: 'wire', publishedAt: NOW - 60_000, sentiment: 'positive' }],
    options: { callVolume: 20_000, putVolume: 10_000, impliedVolatility: 0.42, gammaExposure: 1_500_000 },
  };
}

test('unified MarketSnapshot exposes normalized OHLCV, technical, liquidity, company, session, news, and options fields', () => {
  const snapshot = createMarketSnapshot(rawSnapshot(), { now: NOW });
  assert.equal(snapshot.schema, MARKET_SNAPSHOT_SCHEMA);
  assert.equal(snapshot.schemaVersion, MARKET_SNAPSHOT_VERSION);
  assert.equal(snapshot.ohlcv.bars, snapshot.bars);
  assert.equal(snapshot.ohlcv.count, 24);
  assert.ok(snapshot.atr > 0);
  assert.ok(snapshot.vwap > 0);
  assert.ok(snapshot.poc > 0);
  assert.ok(snapshot.rvol > 0);
  assert.ok(Math.abs(snapshot.spread - 0.02) < 1e-9);
  assert.equal(snapshot.float, 1_200_000_000);
  assert.equal(snapshot.sector, 'Technology');
  assert.equal(snapshot.industry, 'Semiconductors');
  assert.equal(snapshot.session, 'REGULAR');
  assert.equal(snapshot.sessionInfo.isExtendedHours, false);
  assert.equal(snapshot.news[0].headline, 'Example headline');
  assert.equal(snapshot.options.putCallRatio, 0.5);
  assert.equal(snapshot.observationOnly, true);
  assert.equal(snapshot.executionEnabled, false);
  assert.equal(validateUnifiedMarketSnapshot(snapshot).valid, true);
  assert.ok(snapshot.completeness.score >= 90);
});

test('unified MarketSnapshot keeps optional unavailable data explicit instead of fabricating values', () => {
  const raw = rawSnapshot('MSFT');
  delete raw.profile;
  delete raw.news;
  delete raw.options;
  const snapshot = createMarketSnapshot(raw, { now: NOW });
  assert.equal(snapshot.float, null);
  assert.equal(snapshot.sector, null);
  assert.equal(snapshot.industry, null);
  assert.deepEqual(snapshot.news, []);
  assert.equal(snapshot.options.available, false);
  assert.ok(snapshot.completeness.missing.includes('Float'));
  assert.ok(snapshot.completeness.missing.includes('News'));
  assert.equal(snapshot.quality.valid, true);
});

test('Market Data Service merges profile, news, options, and session enrichment before normalization', async () => {
  const enricher = createMarketSnapshotEnricher({
    name: 'test-enricher',
    loadProfile: async () => ({ float: 50_000_000, sector: 'Industrials', industry: 'Aerospace' }),
    loadNews: async () => [{ headline: 'Contract awarded', source: 'wire', publishedAt: NOW }],
    loadOptions: async () => ({ callVolume: 900, putVolume: 300, openInterest: 50_000 }),
    loadSession: async () => ({ key: 'PRE_MARKET', isOpen: true }),
  });
  const service = createMarketDataService({
    provider: {
      name: 'primary',
      rateLimit: { requests: 100_000, intervalMs: 1 },
      fetchSnapshot: async (symbol) => {
        const raw = rawSnapshot(symbol);
        delete raw.profile;
        delete raw.news;
        delete raw.options;
        delete raw.session;
        return raw;
      },
    },
    enrichmentProvider: enricher,
    maxRetries: 0,
    now: () => NOW,
  });
  const snapshot = await service.getSnapshot('BA');
  assert.equal(snapshot.float, 50_000_000);
  assert.equal(snapshot.sector, 'Industrials');
  assert.equal(snapshot.industry, 'Aerospace');
  assert.equal(snapshot.news.length, 1);
  assert.equal(snapshot.options.putCallRatio, 1 / 3);
  assert.equal(snapshot.session, 'PRE_MARKET');
  assert.equal(snapshot.rawMetadata.enrichmentProvider, 'test-enricher');
  assert.equal(service.getMetrics().enrichment.successes, 1);
});

test('optional enrichment failures fail open while required enrichment failures reject the provider', async () => {
  const provider = {
    name: 'primary',
    rateLimit: { requests: 100_000, intervalMs: 1 },
    fetchSnapshot: async (symbol) => rawSnapshot(symbol),
  };
  const enrichmentProvider = { name: 'broken', async enrichSnapshot() { throw new Error('metadata offline'); } };
  const optional = createMarketDataService({ provider, enrichmentProvider, maxRetries: 0, now: () => NOW });
  const snapshot = await optional.getSnapshot('NVDA');
  assert.equal(snapshot.rawMetadata.enrichmentError, 'metadata offline');
  assert.equal(optional.getMetrics().enrichment.errors, 1);

  const required = createMarketDataService({ provider, enrichmentProvider, requireEnrichment: true, maxRetries: 0, now: () => NOW });
  await assert.rejects(() => required.getSnapshot('NVDA'), /All market-data providers failed/);
});

test('scanner pipeline receives the same unified MarketSnapshot object for every analyzer stage', async () => {
  const snapshot = createMarketSnapshot(rawSnapshot('TSLA'), { now: NOW });
  const received = [];
  const pipeline = {
    async analyze(value) {
      received.push(value);
      assert.equal(value, snapshot);
      assert.equal(value.schema, MARKET_SNAPSHOT_SCHEMA);
      return {
        symbol: value.symbol,
        score: 80,
        direction: 'LONG',
        accepted: true,
        observationOnly: true,
        executionEnabled: false,
        blockers: [],
        reasons: ['normalized'],
      };
    },
  };
  const scanner = createScannerEngine({ marketData: { getSnapshot: async () => snapshot }, pipeline });
  const result = await scanner.scan(['TSLA']);
  assert.equal(received.length, 1);
  assert.equal(result.accepted, 1);
  assert.equal(result.executionEnabled, false);
});
