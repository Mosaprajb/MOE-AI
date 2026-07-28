import test from 'node:test';
import assert from 'node:assert/strict';

import {
  evaluateInstitutionalConsensus,
  INSTITUTIONAL_CONSENSUS_VERSION,
} from '../src/institutional-consensus.js';

function strongCandidate(overrides = {}) {
  return {
    signal: { symbol: 'AAPL', side: 'BUY' },
    context: {
      marketScore: 88,
      sectorScore: 84,
      multiTimeframeScore: 90,
      liquidityScore: 92,
      orderFlowScore: 86,
      ...overrides.context,
    },
    brain: { accepted: true, score: 91, ...overrides.brain },
    plan: { evaluation: { accepted: true, score: 89 }, ...overrides.plan },
    portfolio: {
      accepted: true,
      allocation: { multiplier: 1 },
      metrics: { positionHeatPercent: 4, totalExposurePercent: 22 },
      ...overrides.portfolio,
    },
    accountSafety: { accepted: true, ...overrides.accountSafety },
  };
}

test('exports a stable institutional consensus version', () => {
  assert.equal(INSTITUTIONAL_CONSENSUS_VERSION, '1.0.0');
});

test('accepts a strong fully aligned candidate', () => {
  const result = evaluateInstitutionalConsensus(strongCandidate());

  assert.equal(result.accepted, true);
  assert.equal(result.classification, 'STRONG_CONSENSUS');
  assert.equal(result.direction, 'BUY');
  assert.equal(result.vetoes.length, 0);
  assert.ok(result.score >= 85);
  assert.equal(result.version, INSTITUTIONAL_CONSENSUS_VERSION);
});

test('vetoes a candidate rejected by Portfolio Intelligence', () => {
  const input = strongCandidate({ portfolio: { accepted: false } });
  const result = evaluateInstitutionalConsensus(input);

  assert.equal(result.accepted, false);
  assert.equal(result.classification, 'VETOED');
  assert.ok(result.vetoes.includes('Portfolio Intelligence rejected the candidate'));
});

test('vetoes unsafe account state even when market inputs are strong', () => {
  const input = strongCandidate({ accountSafety: { accepted: false } });
  const result = evaluateInstitutionalConsensus(input);

  assert.equal(result.accepted, false);
  assert.equal(result.classification, 'VETOED');
  assert.ok(result.vetoes.includes('Account safety rejected the candidate'));
});

test('blocks candidates below the configured consensus score', () => {
  const input = strongCandidate({
    context: {
      marketScore: 55,
      sectorScore: 52,
      multiTimeframeScore: 55,
      liquidityScore: 58,
      orderFlowScore: 50,
    },
    brain: { accepted: true, score: 57 },
    portfolio: {
      accepted: true,
      allocation: { multiplier: 0.75 },
      metrics: { positionHeatPercent: 18, totalExposurePercent: 55 },
    },
  });
  const result = evaluateInstitutionalConsensus(input, { MOE_CONSENSUS_MIN_SCORE: '75' });

  assert.equal(result.accepted, false);
  assert.equal(result.minimumScore, 75);
  assert.ok(result.score < 75);
  assert.equal(result.vetoes.length, 0);
  assert.match(result.rationale, /below 75/);
});

test('honors enforcement and normalized custom weights', () => {
  const result = evaluateInstitutionalConsensus(strongCandidate(), {
    MOE_CONSENSUS_ENFORCED_SANDBOX: 'true',
    MOE_CONSENSUS_WEIGHT_BRAIN: '2',
    MOE_CONSENSUS_WEIGHT_MARKET: '1',
    MOE_CONSENSUS_WEIGHT_SECTOR: '1',
    MOE_CONSENSUS_WEIGHT_MTF: '1',
    MOE_CONSENSUS_WEIGHT_LIQUIDITY: '1',
    MOE_CONSENSUS_WEIGHT_ORDER_FLOW: '1',
    MOE_CONSENSUS_WEIGHT_PORTFOLIO: '1',
  });

  const weightSum = Object.values(result.weights).reduce((sum, value) => sum + value, 0);
  assert.equal(result.enforce, true);
  assert.ok(Math.abs(weightSum - 1) < 0.001);
  assert.equal(result.weights.brain, 0.25);
});

test('derives liquidity and order-flow scores when explicit scores are absent', () => {
  const input = strongCandidate({
    context: {
      marketScore: 80,
      sectorScore: 78,
      multiTimeframeScore: 82,
      relativeVolume: 2.1,
      spreadPercent: 0.08,
      absorptionScore: 84,
      imbalanceScore: 79,
      stopRunScore: 72,
      liquidityScore: undefined,
      orderFlowScore: undefined,
    },
  });
  const result = evaluateInstitutionalConsensus(input);

  assert.ok(result.components.liquidity > 50);
  assert.ok(result.components.orderFlow > 70);
  assert.equal(result.vetoes.length, 0);
});
