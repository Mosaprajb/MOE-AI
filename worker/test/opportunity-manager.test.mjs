import test from 'node:test';
import assert from 'node:assert/strict';

import {
  OPPORTUNITY_MANAGER_SCHEMA,
  OpportunityStatus,
  createOpportunityManager,
  manageOpportunities,
} from '../src/opportunity/opportunity-manager.js';
import { createScannerEngine } from '../src/scanner/scanner-engine.js';

const NOW = Date.parse('2026-07-30T15:00:00.000Z');

function opportunity({
  id,
  symbol = 'AAPL',
  direction = 'LONG',
  timeframe = '5m',
  score = 80,
  confidence = score,
  createdAt = NOW,
  validForMs = 15 * 60_000,
  family = 'BREAKOUT',
  universePriority = 0,
} = {}) {
  return {
    id: id || `${symbol}-${score}`,
    symbol,
    direction,
    timeframe,
    entry: 100,
    stopLoss: 99,
    takeProfit: 103,
    score,
    confidence: { value: confidence, source: 'fusion' },
    reasons: [`${symbol}_${family}`],
    metadata: {
      setupFamily: family,
      validForMs,
      universePriority,
    },
    createdAt: new Date(createdAt).toISOString(),
  };
}

function fusion({
  symbol = 'AAPL',
  direction = 'LONG',
  grade = 'A',
  score = 80,
  confidence = score,
  quality = 80,
  agreement = 80,
  conflict = 10,
  coverage = 0.8,
  accepted = true,
  evaluatedAt = NOW,
  blockers = [],
} = {}) {
  return {
    schema: 'MOE.FusionResult',
    schemaVersion: '2.0.0',
    symbol,
    direction,
    grade,
    score,
    confidence,
    agreementScore: agreement,
    conflictScore: conflict,
    dataQuality: { score: quality },
    coverage,
    accepted,
    blockers,
    reasons: accepted ? ['LONG_FUSION_CONSENSUS'] : ['FUSION_REJECTED'],
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
    evaluatedAt: new Date(evaluatedAt).toISOString(),
  };
}

test('deduplicates the same symbol, direction, timeframe, and setup family while retaining the stronger observation', () => {
  const manager = createOpportunityManager({ now: () => NOW });
  const first = { opportunity: opportunity({ id: 'weak', score: 72 }), fusion: fusion({ grade: 'BBB', score: 72 }) };
  const second = { opportunity: opportunity({ id: 'strong', score: 91, confidence: 90 }), fusion: fusion({ grade: 'AA', score: 91, confidence: 90, quality: 92 }) };

  const result = manager.manage([first, second], { now: NOW });

  assert.equal(result.schema, OPPORTUNITY_MANAGER_SCHEMA);
  assert.equal(result.selected.length, 1);
  assert.equal(result.summary.active, 1);
  assert.equal(result.summary.duplicatesRemoved, 1);
  assert.equal(result.selected[0].opportunity.id, 'strong');
  assert.equal(result.selected[0].duplicateCount, 1);
  assert.equal(result.selected[0].confirmationCount, 2);
  assert.deepEqual([...result.selected[0].sourceIds].sort(), ['strong', 'weak']);
  assert.equal(result.executionAllowed, false);
});

test('expires opportunities at explicit validity boundaries and excludes them from selection', () => {
  const manager = createOpportunityManager({ defaultTtlMs: 60_000, now: () => NOW });
  manager.ingest({ opportunity: opportunity({ id: 'short-lived', validForMs: 30_000 }), fusion: fusion() }, { now: NOW });

  assert.equal(manager.select(5, { now: NOW + 29_999 }).selected.length, 1);
  const result = manager.select(5, { now: NOW + 30_000 });
  const stored = manager.list({ now: NOW + 30_000 });

  assert.equal(result.selected.length, 0);
  assert.equal(result.summary.expired, 1);
  assert.equal(stored[0].status, OpportunityStatus.EXPIRED);
  assert.ok(stored[0].lifecycleReasons.includes('OPPORTUNITY_EXPIRED'));
});

test('a newer rejected Fusion observation invalidates the active duplicate', () => {
  const manager = createOpportunityManager({ now: () => NOW });
  manager.ingest({ opportunity: opportunity({ id: 'accepted' }), fusion: fusion() }, { now: NOW });
  manager.ingest({
    opportunity: opportunity({ id: 'rejected', createdAt: NOW + 5_000 }),
    fusion: fusion({ accepted: false, grade: 'REJECT', evaluatedAt: NOW + 5_000, blockers: ['LOW_DATA_QUALITY'] }),
  }, { now: NOW + 5_000 });

  const result = manager.select(5, { now: NOW + 5_000 });
  const stored = manager.list({ now: NOW + 5_000 });

  assert.equal(result.selected.length, 0);
  assert.equal(stored.length, 1);
  assert.equal(stored[0].status, OpportunityStatus.INVALIDATED);
  assert.ok(stored[0].lifecycleReasons.includes('FUSION_REJECTED_OPPORTUNITY'));
});

test('returns only the best configured N opportunities using grade, score, quality, conflict, freshness, and universe priority', () => {
  const manager = createOpportunityManager({ topN: 2, now: () => NOW });
  const inputs = [
    { opportunity: opportunity({ id: 'msft', symbol: 'MSFT', score: 88, family: 'REVERSAL' }), fusion: fusion({ symbol: 'MSFT', grade: 'AA', score: 88, quality: 90, conflict: 8 }) },
    { opportunity: opportunity({ id: 'nvda', symbol: 'NVDA', score: 94, family: 'BREAKOUT' }), fusion: fusion({ symbol: 'NVDA', grade: 'AAA', score: 94, quality: 95, conflict: 4 }) },
    { opportunity: opportunity({ id: 'tsla', symbol: 'TSLA', score: 83, family: 'BREAKOUT', universePriority: 80 }), fusion: fusion({ symbol: 'TSLA', grade: 'A', score: 83, quality: 86, conflict: 12 }) },
    { opportunity: opportunity({ id: 'amd', symbol: 'AMD', score: 75, family: 'BREAKOUT' }), fusion: fusion({ symbol: 'AMD', grade: 'BBB', score: 75, quality: 70, conflict: 25 }) },
  ];

  const result = manager.manage(inputs, { now: NOW });

  assert.equal(result.selected.length, 2);
  assert.deepEqual(result.selected.map((item) => item.symbol), ['NVDA', 'MSFT']);
  assert.deepEqual(result.selected.map((item) => item.rank), [1, 2]);
  assert.equal(result.summary.active, 4);
  assert.equal(result.summary.omitted, 2);
  assert.equal(result.summary.topN, 2);
});

test('manual invalidation and closure are terminal and never appear in selected opportunities', () => {
  const manager = createOpportunityManager({ now: () => NOW });
  const result = manager.manage([
    { opportunity: opportunity({ id: 'aapl' }), fusion: fusion() },
    { opportunity: opportunity({ id: 'msft', symbol: 'MSFT', family: 'REVERSAL' }), fusion: fusion({ symbol: 'MSFT' }) },
  ], { now: NOW });
  const [first, second] = result.selected;

  assert.equal(manager.invalidate(first.id, 'STRUCTURE_BROKEN', { now: NOW + 1_000 }), true);
  assert.equal(manager.close(second.id, 'TRADE_WINDOW_CLOSED', { now: NOW + 1_000 }), true);
  assert.equal(manager.select(5, { now: NOW + 1_000 }).selected.length, 0);
  assert.equal(manager.get(first.id, { now: NOW + 1_000 }).status, OpportunityStatus.INVALIDATED);
  assert.equal(manager.get(second.id, { now: NOW + 1_000 }).status, OpportunityStatus.CLOSED);
  assert.equal(manager.invalidate(first.id, 'SECOND_ATTEMPT', { now: NOW + 2_000 }), false);
});

test('rejects execution-enabled opportunities and Fusion envelopes', () => {
  const manager = createOpportunityManager({ now: () => NOW });

  assert.throws(
    () => manager.ingest({ ...opportunity({ id: 'unsafe' }), executionAllowed: true }, { now: NOW }),
    /rejects execution-enabled input/,
  );
  assert.throws(
    () => manager.ingest({ opportunity: opportunity({ id: 'unsafe-fusion' }), fusion: { ...fusion(), executionEnabled: true } }, { now: NOW }),
    /rejects execution-enabled input/,
  );
});

test('one-shot helper remains immutable and observation-only', () => {
  const result = manageOpportunities(
    [{ opportunity: opportunity({ id: 'single' }), fusion: fusion() }],
    { topN: 1, now: () => NOW, context: { now: NOW } },
  );

  assert.equal(result.selected.length, 1);
  assert.equal(result.observationOnly, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.selected), true);
  assert.equal(Object.isFrozen(result.selected[0]), true);
});

test('scanner optionally routes Fusion opportunities through the manager and exposes only top N', async () => {
  const manager = createOpportunityManager({ topN: 2, now: () => NOW });
  const scanner = createScannerEngine({
    marketData: { getSnapshot: async (symbol) => ({ symbol }) },
    pipeline: {
      analyze: async (snapshot) => ({
        symbol: snapshot.symbol,
        accepted: true,
        score: snapshot.symbol === 'NVDA' ? 95 : 85,
        confidence: 90,
        direction: 'LONG',
        opportunities: snapshot.symbol === 'NVDA'
          ? [
            opportunity({ id: 'nvda-weak', symbol: 'NVDA', score: 80 }),
            opportunity({ id: 'nvda-strong', symbol: 'NVDA', score: 95 }),
          ]
          : [opportunity({ id: snapshot.symbol.toLowerCase(), symbol: snapshot.symbol, score: snapshot.symbol === 'MSFT' ? 90 : 70 })],
        engineResults: [],
        runs: [],
        coverage: 1,
        observationOnly: true,
        executionEnabled: false,
        executionAllowed: false,
      }),
    },
    fusionEngine: {
      fuse: (analysis, context) => fusion({
        symbol: context.symbol,
        grade: context.symbol === 'NVDA' ? 'AAA' : context.symbol === 'MSFT' ? 'AA' : 'BBB',
        score: analysis.score,
        confidence: analysis.confidence,
      }),
    },
    opportunityManager: manager,
  });

  const result = await scanner.scan(['AMD', 'MSFT', 'NVDA'], { now: NOW, opportunityLimit: 2 });

  assert.equal(result.accepted, 3);
  assert.equal(result.opportunities.length, 2);
  assert.deepEqual(result.opportunities.map((item) => item.symbol), ['NVDA', 'MSFT']);
  assert.equal(result.opportunitySelection.summary.duplicatesRemoved, 1);
  assert.equal(result.opportunitySelection.observationOnly, true);
  assert.equal(result.executionEnabled, false);
});
