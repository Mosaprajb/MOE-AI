import test from 'node:test';
import assert from 'node:assert/strict';
import { createUniverseManager, UNIVERSE_SOURCES } from '../src/universe/universe-manager.js';
import {
  createEarningsUniverseProvider,
  createIndexUniverseProvider,
  createMarketMoversProvider,
  createOptionsUniverseProvider,
  createWatchlistUniverseProvider,
} from '../src/universe/providers/index.js';
import { createScannerEngine } from '../src/scanner/scanner-engine.js';

function allProviders() {
  return {
    sp500: createIndexUniverseProvider({ source: 'sp500', symbols: ['AAPL', 'MSFT', 'NVDA'] }),
    nasdaq100: createIndexUniverseProvider({ source: 'nasdaq100', symbols: ['NVDA', 'AAPL'] }),
    russell2000: createIndexUniverseProvider({ source: 'russell2000', symbols: ['PLTR'] }),
    topVolume: createMarketMoversProvider({ source: 'topVolume', load: async () => [{ symbol: 'NVDA', score: 95 }, { symbol: 'AMD', score: 88 }] }),
    topRelativeVolume: createMarketMoversProvider({ source: 'topRelativeVolume', load: async () => [{ symbol: 'AMD', score: 99 }] }),
    topGainers: createMarketMoversProvider({ source: 'topGainers', load: async () => ['PLTR'] }),
    topLosers: createMarketMoversProvider({ source: 'topLosers', load: async () => ['TSLA'] }),
    highOptionsVolume: createOptionsUniverseProvider({ source: 'highOptionsVolume', load: async () => ['NVDA', 'AMD'] }),
    highGammaExposure: createOptionsUniverseProvider({ source: 'highGammaExposure', load: async () => ['NVDA'] }),
    earningsToday: createEarningsUniverseProvider({ load: async () => ['AAPL'] }),
    watchlists: createWatchlistUniverseProvider({ symbols: ['PLTR'] }),
  };
}

test('universe manager merges every supported source and ranks symbols deterministically', async () => {
  const manager = createUniverseManager({ providers: allProviders(), maxSymbols: 20 });
  const result = await manager.build();

  assert.deepEqual(Object.keys(result.sourceCounts).sort(), [...UNIVERSE_SOURCES].sort());
  assert.equal(result.failures.length, 0);
  assert.equal(result.symbols[0].symbol, 'NVDA');
  assert.equal(result.symbols[0].priority, 100);
  assert.equal(new Set(result.symbols.map((row) => row.symbol)).size, result.symbols.length);
  assert.equal(result.symbols.find((row) => row.symbol === 'NVDA').sources.includes('highGammaExposure'), true);
});

test('universe manager isolates provider failures, rejects invalid symbols, and honors exclusions', async () => {
  const manager = createUniverseManager({
    providers: {
      sp500: createIndexUniverseProvider({ source: 'sp500', symbols: ['AAPL', 'bad symbol', 'MSFT'] }),
      topVolume: createMarketMoversProvider({ source: 'topVolume', load: async () => { throw new Error('rate limited'); } }),
    },
    excludedSymbols: ['MSFT'],
  });
  const result = await manager.build();

  assert.deepEqual(result.symbols.map((row) => row.symbol), ['AAPL']);
  assert.equal(result.failures.length, 1);
  assert.equal(result.failures[0].source, 'topVolume');
});

test('scanner can request a prioritized universe without gaining execution authority', async () => {
  const manager = createUniverseManager({
    providers: { watchlists: createWatchlistUniverseProvider({ symbols: ['MSFT', 'AAPL'] }) },
  });
  const observedPriorities = [];
  const scanner = createScannerEngine({
    universeManager: manager,
    marketData: { async getSnapshot(symbol) { return { symbol }; } },
    pipeline: {
      async analyze(snapshot, context) {
        observedPriorities.push(context.universeEntry.priority);
        return { symbol: snapshot.symbol, score: 80, accepted: true, executionEnabled: false, observationOnly: true };
      },
    },
  });

  const result = await scanner.scanUniverse();
  assert.equal(result.scanned, 2);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.observationOnly, true);
  assert.equal(result.candidates.every((candidate) => candidate.executionEnabled === false), true);
  assert.equal(observedPriorities.every((priority) => priority > 0), true);
});
