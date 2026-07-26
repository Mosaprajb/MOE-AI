import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { createSmartMoneySetupCandidate } from '../src/smart-money/setup-candidate.js';
import { evaluateAnalyticalPositionSize } from '../src/smart-money/position-sizing.js';
import { evaluateCandidateLifecycle } from '../src/smart-money/candidate-lifecycle.js';
import { evaluateSmartMoneyScannerBatch } from '../src/smart-money/scanner-adapter.js';

const now = Date.now();

function acceptedCandidateInput(overrides = {}) {
  return {
    symbol: 'AAPL',
    timeframe: '5m',
    strategyVersion: 'SMART_MONEY_TEST',
    setupFamily: 'BREAKER_RETEST',
    direction: 'BULLISH',
    confluence: { totalScore: 86, approvedForObservation: true, confirmations: ['STRUCTURE_BREAK'], failedConditions: [] },
    entryZone: { selected: { type: 'BREAKER_BLOCK', id: 'breaker-1', lower: 99, upper: 100, midpoint: 99.5 } },
    riskEvaluation: { status: 'OBSERVATION_ACCEPTED', entryPrice: 99.5, stopPrice: 98.5, targetPrice: 102.5, rewardRisk: 3, failedConditions: [] },
    createdAt: now,
    expiresAt: now + 60_000,
    invalidationReasons: [],
    ...overrides,
  };
}

test('setup candidate is deterministic and remains observation only', async () => {
  const first = await createSmartMoneySetupCandidate(acceptedCandidateInput());
  const second = await createSmartMoneySetupCandidate(acceptedCandidateInput());
  assert.equal(first.candidateId, second.candidateId);
  assert.equal(first.analyticalStatus, 'OBSERVATION_CANDIDATE');
  assert.equal(first.executionAllowed, false);
  assert.equal(first.automaticSubmissionAllowed, false);
  assert.equal(first.liveExecutionAllowed, false);
});

test('analytical position sizing respects risk and notional caps', () => {
  const result = evaluateAnalyticalPositionSize({
    accountEquity: 100000,
    maximumRiskPercent: 0.5,
    entryPrice: 100,
    stopPrice: 99,
    maximumNotionalPercent: 10,
  });
  assert.equal(result.status, 'ANALYTICAL_SIZE_AVAILABLE');
  assert.equal(result.riskLimitedShares, 500);
  assert.equal(result.notionalLimitedShares, 100);
  assert.equal(result.analyticalShares, 100);
  assert.equal(result.executionAllowed, false);
});

test('candidate lifecycle invalidates expired and stop-breached setups', async () => {
  const candidate = await createSmartMoneySetupCandidate(acceptedCandidateInput({ expiresAt: now - 1 }));
  const result = evaluateCandidateLifecycle({ candidate, latestPrice: 98.4, now });
  assert.equal(result.state, 'INVALIDATED');
  assert.ok(result.invalidationReasons.includes('CANDIDATE_EXPIRED'));
  assert.ok(result.invalidationReasons.includes('STOP_INVALIDATION_REACHED'));
  assert.equal(result.executionAllowed, false);
});

test('scanner adapter rejects missing data and never enables execution', async () => {
  const result = await evaluateSmartMoneyScannerBatch({
    symbols: ['AAPL', 'MSFT'],
    marketDataBySymbol: {},
    now,
  });
  assert.equal(result.observations.length, 0);
  assert.equal(result.rejected.length, 2);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.automaticSubmissionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
});
