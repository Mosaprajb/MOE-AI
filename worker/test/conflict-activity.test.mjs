import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivityFeed, buildConflictSummary, buildTradingCommandCenter } from '../src/trading-intelligence/conflict-activity.js';

function gauge(id, status, overrides = {}) {
  return {
    id,
    name: id.replaceAll('-', ' '),
    shortLabel: id,
    category: 'MARKET',
    score: 80,
    confidence: 80,
    direction: 'LONG',
    status,
    mandatory: false,
    blocksExecution: false,
    summary: `${id} ${status}`,
    blockers: [],
    penalties: [],
    confirmationReasons: status === 'CONFIRMED' ? [`${id.toUpperCase()}_CONFIRMED`] : [],
    metadata: {},
    ...overrides,
  };
}

function opportunity(overrides = {}) {
  const gauges = [
    gauge('higher-timeframe-bias', 'CONFIRMED', { mandatory: true }),
    gauge('relative-volume', 'CONFIRMED', { metadata: { relativeVolume: 1.7 } }),
    gauge('smt-divergence', 'UNAVAILABLE'),
    gauge('market-structure', 'REJECTED', { mandatory: true, blocksExecution: true, blockers: ['NO_CONFIRMED_STRUCTURE_EVENT'] }),
    gauge('execution-quality', 'BLOCKED', {
      mandatory: true,
      blocksExecution: true,
      metadata: { marketBlockers: [], safetyBlockers: ['OBSERVATION_ONLY', 'EXECUTION_PERMISSION_FALSE'] },
    }),
  ];
  return {
    symbol: 'AAPL',
    timeframe: '5m',
    evaluatedAt: '2026-07-26T15:00:00.000Z',
    direction: 'BULLISH',
    pipelineScore: 82,
    pipelinePassed: false,
    failedStage: 'STRUCTURE_CONFIRMATION',
    reason: 'STRUCTURE_CONFIRMATION_STAGE_REJECTED',
    tradingIntelligence: {
      direction: 'LONG',
      tradeReadiness: { score: 82, executionPermission: false },
      gauges,
    },
    ...overrides,
  };
}

test('conflict summary separates strongest support from mandatory blockers', () => {
  const summary = buildConflictSummary({ opportunity: opportunity() });
  assert.equal(summary.available, true);
  assert.equal(summary.status, 'BLOCKED');
  assert.equal(summary.strongestSupport.id, 'higher-timeframe-bias');
  assert.ok(summary.conflicts.some((item) => item.id === 'market-structure'));
  assert.ok(summary.conflicts.some((item) => item.category === 'SAFETY'));
  assert.ok(summary.counts.mandatoryConflicts >= 2);
  assert.equal(summary.executionAllowed, false);
  assert.equal(summary.liveExecutionAllowed, false);
});

test('optional unavailable gauge is not treated as a mandatory conflict', () => {
  const summary = buildConflictSummary({ opportunity: opportunity() });
  assert.equal(summary.conflicts.some((item) => item.id === 'smt-divergence'), false);
});

test('portfolio and active-position danger override weaker analytical conflicts', () => {
  const summary = buildConflictSummary({
    opportunity: opportunity(),
    portfolioRisk: {
      status: 'CRITICAL',
      blockers: ['DAILY_LOSS_LIMIT_REACHED'],
      capitalData: { coveragePercent: 100 },
    },
    activePosition: {
      available: true,
      symbol: 'MSFT',
      direction: 'LONG',
      riskState: 'CRITICAL',
      protectionStatus: 'UNPROTECTED',
    },
  });
  assert.equal(summary.status, 'BLOCKED');
  assert.ok(['PORTFOLIO', 'POSITION'].includes(summary.strongestConflict.category));
  assert.ok(summary.conflicts.some((item) => item.reasons.includes('DAILY_LOSS_LIMIT_REACHED')));
  assert.ok(summary.conflicts.some((item) => item.reasons.includes('POSITION_UNPROTECTED')));
});

test('activity feed emits transitions and deduplicates repeated conditions', () => {
  const first = opportunity({
    evaluatedAt: '2026-07-26T14:55:00.000Z',
    failedStage: 'ABSORPTION',
    tradingIntelligence: {
      direction: 'LONG',
      gauges: [
        gauge('relative-volume', 'DEVELOPING', { metadata: { relativeVolume: 1.2 } }),
        gauge('smt-divergence', 'UNAVAILABLE'),
        gauge('execution-quality', 'BLOCKED', { metadata: { marketBlockers: [], safetyBlockers: ['OBSERVATION_ONLY'] } }),
      ],
    },
  });
  const second = opportunity({
    evaluatedAt: '2026-07-26T15:00:00.000Z',
    pipelinePassed: true,
    failedStage: null,
    reason: 'INSTITUTIONAL_FLOW_OBSERVATION_ONLY',
    tradingIntelligence: {
      direction: 'LONG',
      gauges: [
        gauge('relative-volume', 'CONFIRMED', { metadata: { relativeVolume: 1.8 } }),
        gauge('smt-divergence', 'CONFIRMED', { metadata: { classification: 'BULLISH_SMT_DIVERGENCE' } }),
        gauge('execution-quality', 'BLOCKED', { metadata: { marketBlockers: ['SPREAD_TOO_WIDE'], safetyBlockers: ['OBSERVATION_ONLY'] } }),
      ],
    },
  });
  const repeated = structuredClone(second);
  repeated.evaluatedAt = '2026-07-26T15:05:00.000Z';
  const feed = buildActivityFeed({
    observationHistory: [
      { evaluatedAt: first.evaluatedAt, topOpportunities: [first] },
      { evaluatedAt: second.evaluatedAt, topOpportunities: [second] },
      { evaluatedAt: repeated.evaluatedAt, topOpportunities: [repeated] },
    ],
  });
  assert.ok(feed.events.some((item) => item.type === 'PIPELINE_CONFIRMED'));
  assert.ok(feed.events.some((item) => item.type === 'SMT_DIVERGENCE_CONFIRMED'));
  assert.ok(feed.events.some((item) => item.type === 'SESSION_RVOL_ELEVATED'));
  assert.ok(feed.events.some((item) => item.type === 'EXECUTION_QUALITY_DEGRADED'));
  assert.equal(feed.events.filter((item) => item.type === 'SMT_DIVERGENCE_CONFIRMED').length, 1);
  assert.equal(feed.deduplicated, true);
});

test('portfolio and position events are included without enabling execution', () => {
  const feed = buildActivityFeed({
    portfolioRisk: {
      status: 'BLOCKED',
      generatedAt: '2026-07-26T15:10:00.000Z',
      portfolioAcceptsNewRisk: false,
      blockers: ['OPEN_RISK_LIMIT_EXCEEDED'],
      warnings: ['DAILY_LOSS_LIMIT_NEAR'],
    },
    activePosition: {
      available: true,
      symbol: 'NVDA',
      tradeId: 'trade-1',
      lastUpdatedAt: '2026-07-26T15:11:00.000Z',
      riskState: 'DANGER',
      protectionStatus: 'PARTIALLY_PROTECTED',
      progress: { distanceToStopR: 0.2 },
    },
  });
  assert.ok(feed.events.some((item) => item.type === 'PORTFOLIO_RISK_GATE_BLOCKED'));
  assert.ok(feed.events.some((item) => item.type === 'POSITION_RISK_CHANGED'));
  assert.ok(feed.events.some((item) => item.type === 'POSITION_PROTECTION_INCOMPLETE'));
  assert.equal(feed.executionAllowed, false);
});

test('command center selects a requested scanner symbol and stays observation-only', () => {
  const msft = opportunity({ symbol: 'MSFT' });
  const center = buildTradingCommandCenter({
    observationStatus: {
      latest: { topOpportunities: [opportunity(), msft] },
      recentRuns: [{ topOpportunities: [opportunity(), msft], evaluatedAt: '2026-07-26T15:00:00.000Z' }],
    },
    selectedSymbol: 'MSFT',
  });
  assert.equal(center.selectedSymbol, 'MSFT');
  assert.deepEqual(center.availableSymbols, ['AAPL', 'MSFT']);
  assert.equal(center.conflictSummary.symbol, 'MSFT');
  assert.equal(center.executionAllowed, false);
  assert.equal(center.automaticSubmissionAllowed, false);
  assert.equal(center.liveExecutionAllowed, false);
});
