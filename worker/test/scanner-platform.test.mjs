import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarketDataLayer } from '../src/scanner/market-data-layer.js';
import { createAnalysisPipeline, REQUIRED_ANALYSES } from '../src/scanner/analysis-pipeline.js';
import { createScannerEngine } from '../src/scanner/scanner-engine.js';
import { createObservationService } from '../src/scanner/observation-service.js';

function analyzersFor(score, direction = 'LONG') {
  return Object.fromEntries(REQUIRED_ANALYSES.map((name) => [name, async () => ({ available: true, score, direction, blockers: [], reasons: [`${name} confirmed`] })]));
}

test('market data layer retries failures and caches normalized snapshots', async () => {
  let calls = 0;
  const layer = createMarketDataLayer({
    provider: { async fetchSnapshot(symbol) { calls += 1; if (calls === 1) throw new Error('temporary'); return { symbol, bars: [] }; } },
    maxRetries: 1,
    retryDelayMs: 1,
    cacheTtlMs: 1000,
  });
  const first = await layer.getSnapshot('aapl');
  const second = await layer.getSnapshot('AAPL');
  assert.equal(first.symbol, 'AAPL');
  assert.equal(second.cache, 'HIT');
  assert.equal(calls, 2);
});

test('scanner ranks accepted candidates and remains observation only', async () => {
  const marketData = createMarketDataLayer({ provider: { async fetchSnapshot(symbol) { return { symbol, bars: [] }; } } });
  const pipeline = createAnalysisPipeline({ analyzers: analyzersFor(82), minimumScore: 65 });
  const scanner = createScannerEngine({ marketData, pipeline, maxConcurrent: 2, resultLimit: 10 });
  const result = await scanner.scan(['MSFT', 'AAPL', 'MSFT']);
  assert.equal(result.scanned, 2);
  assert.equal(result.accepted, 2);
  assert.equal(result.observationOnly, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.candidates.every((candidate) => candidate.executionEnabled === false), true);
});

test('analysis pipeline explains rejection and blocks short entries', async () => {
  const pipeline = createAnalysisPipeline({ analyzers: analyzersFor(90, 'SHORT'), minimumScore: 65, longOnly: true });
  const result = await pipeline.analyze({ symbol: 'TSLA' });
  assert.equal(result.accepted, false);
  assert.equal(result.direction, 'SHORT');
  assert.equal(result.blockers.some((blocker) => blocker.includes('short entries are disabled')), true);
});

test('observation service never forwards an execution request', async () => {
  const values = new Map();
  let forwarded;
  const service = createObservationService({
    storage: { async put(key, value) { values.set(key, value); }, async get(key) { return values.get(key); } },
    candidateForwarder: async (payload) => { forwarded = payload; },
  });
  const envelope = await service.publish({
    observationOnly: true,
    executionEnabled: false,
    scanned: 1,
    completedAt: new Date().toISOString(),
    candidates: [{ symbol: 'AAPL', accepted: true, observationOnly: true, executionEnabled: false, score: 80 }],
  });
  assert.equal(envelope.executionEnabled, false);
  assert.equal(forwarded.executionRequested, false);
  assert.equal(forwarded.requiresTradingControlApproval, true);
  assert.deepEqual(await service.latest(), envelope);
});
