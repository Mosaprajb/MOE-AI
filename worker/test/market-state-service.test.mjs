import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketStateService } from '../src/market-state/market-state-service.js';
import { createMarketInternalsProvider } from '../src/market-state/market-internals-provider.js';
import { createScannerEngine } from '../src/scanner/scanner-engine.js';

const NOW = 1_800_000_000_000;

function snapshot(symbol, previousClose, lastPrice, provider = 'test') {
  return {
    symbol,
    provider,
    lastPrice,
    dataTimestamp: NOW,
    stale: false,
    bars: [
      { timestamp: NOW - 300_000, open: previousClose, high: Math.max(previousClose, lastPrice), low: Math.min(previousClose, lastPrice), close: previousClose, volume: 10_000 },
      { timestamp: NOW, open: previousClose, high: Math.max(previousClose, lastPrice), low: Math.min(previousClose, lastPrice), close: lastPrice, volume: 12_000 },
    ],
    quote: { last: lastPrice, timestamp: NOW },
    quality: { score: 95, warnings: [] },
  };
}

function stateMarketData(overrides = {}) {
  const values = {
    SPY: snapshot('SPY', 500, 505),
    QQQ: snapshot('QQQ', 450, 456),
    VIX: snapshot('VIX', 18, 16),
    DXY: snapshot('DXY', 104, 103),
    US10Y: snapshot('US10Y', 4.35, 4.25),
    ...overrides,
  };
  return {
    async getSnapshot(symbol) {
      const value = values[symbol];
      if (value instanceof Error) throw value;
      if (!value) throw new Error(`${symbol} unavailable`);
      return value;
    },
  };
}

function bullishInternals() {
  return {
    advances: 3200,
    declines: 1000,
    unchanged: 200,
    tick: 650,
    add: 2200,
    trin: 0.72,
    dataTimestamp: NOW,
  };
}

test('market state service reads all requested instruments and internals into a risk-on snapshot', async () => {
  const service = createMarketStateService({
    marketData: stateMarketData(),
    internalsProvider: createMarketInternalsProvider({ load: async () => bullishInternals() }),
    now: () => NOW,
  });

  const state = await service.getState();
  assert.equal(state.status, 'READY');
  assert.equal(state.regime, 'RISK_ON');
  assert.equal(state.availableComponents.length, 10);
  assert.equal(state.components.spy.symbol, 'SPY');
  assert.equal(state.components.vix.direction, 'BULLISH');
  assert.equal(state.components.advanceDecline.value, 2200);
  assert.equal(state.observationOnly, true);
  assert.equal(state.executionEnabled, false);
  assert.ok(state.marketAlignment.long > state.marketAlignment.short);
});

test('market state service degrades explicitly and never fabricates missing values', async () => {
  const service = createMarketStateService({
    marketData: stateMarketData({
      QQQ: new Error('feed unavailable'),
      VIX: new Error('feed unavailable'),
      DXY: new Error('feed unavailable'),
      US10Y: new Error('feed unavailable'),
    }),
    now: () => NOW,
  });

  const state = await service.getState();
  assert.equal(state.status, 'DEGRADED');
  assert.equal(state.components.spy.available, true);
  assert.equal(state.components.qqq.available, false);
  assert.equal(state.components.qqq.value, null);
  assert.equal(state.components.trin.available, false);
  assert.ok(state.blockers.some((blocker) => blocker.includes('qqq')));
  assert.equal(state.executionEnabled, false);
});

test('market state service caches a completed state snapshot', async () => {
  let calls = 0;
  const marketData = stateMarketData();
  const service = createMarketStateService({
    marketData: {
      async getSnapshot(symbol, options) {
        calls += 1;
        return marketData.getSnapshot(symbol, options);
      },
    },
    internalsProvider: createMarketInternalsProvider({ load: async () => bullishInternals() }),
    cacheTtlMs: 10_000,
    now: () => NOW,
  });

  const first = await service.getState();
  const second = await service.getState();
  assert.equal(first.cache, 'MISS');
  assert.equal(second.cache, 'HIT');
  assert.equal(calls, 5);
  assert.equal(service.getMetrics().cacheHits, 1);
});

test('scanner reads market state once per cycle and passes it to every analysis without execution authority', async () => {
  let stateCalls = 0;
  const marketState = Object.freeze({
    status: 'READY',
    regime: 'RISK_ON',
    observationOnly: true,
    executionEnabled: false,
  });
  const seen = [];
  const scanner = createScannerEngine({
    marketData: {
      async getSnapshot(symbol) {
        return { symbol };
      },
    },
    marketStateService: {
      async getState() {
        stateCalls += 1;
        return marketState;
      },
    },
    pipeline: {
      async analyze(value, context) {
        seen.push(context.marketState);
        return {
          symbol: value.symbol,
          score: 80,
          direction: 'LONG',
          accepted: true,
          observationOnly: true,
          executionEnabled: false,
          blockers: [],
          reasons: [],
        };
      },
    },
  });

  const result = await scanner.scan(['AAPL', 'MSFT']);
  assert.equal(stateCalls, 1);
  assert.deepEqual(seen, [marketState, marketState]);
  assert.equal(result.marketState, marketState);
  assert.equal(result.observationOnly, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.candidates.every((candidate) => candidate.executionEnabled === false), true);
});
