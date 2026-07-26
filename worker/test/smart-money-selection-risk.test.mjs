import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySmartMoneySetupFamily } from '../src/smart-money/setup-families.js';
import { selectSmartMoneyEntryZone } from '../src/smart-money/entry-zone.js';
import { evaluateSmartMoneyRisk } from '../src/smart-money/risk-evaluation.js';

test('breaker zone outranks weaker order block and FVG', () => {
  const result = selectSmartMoneyEntryZone({
    direction: 'BULLISH',
    currentPrice: 101,
    breakers: [{ breakerId: 'br1', direction: 'BULLISH', state: 'ACTIVE', lower: 99, upper: 100, midpoint: 99.5, invalidationLevel: 99, qualityScore: 82 }],
    orderBlocks: [{ blockId: 'ob1', direction: 'BULLISH', state: 'ACTIVE', lower: 98, upper: 99, midpoint: 98.5, invalidationLevel: 98, qualityScore: 76, mitigationCount: 0 }],
    fairValueGaps: [{ fvgId: 'fvg1', direction: 'BULLISH', state: 'ACTIVE', lower: 100, upper: 100.4, midpoint: 100.2, invalidationLevel: 100, displacementScore: 70 }],
  });
  assert.equal(result.selected.type, 'BREAKER_BLOCK');
  assert.equal(result.selected.id, 'br1');
});

test('setup family classifies breaker retest', () => {
  const family = classifySmartMoneySetupFamily({
    confluence: { direction: 'BEARISH', entryZone: { type: 'BREAKER_BLOCK' } },
    structure: { latestEvent: { eventType: 'MARKET_STRUCTURE_SHIFT' } },
  });
  assert.equal(family.family, 'BREAKER_RETEST');
  assert.equal(family.classified, true);
  assert.equal(family.executionAllowed, false);
});

test('risk evaluation accepts observation only with valid RR', () => {
  const result = evaluateSmartMoneyRisk({
    direction: 'BULLISH',
    entryZone: { midpoint: 100, invalidationLevel: 99 },
    confluence: { mandatoryPassed: true },
    setupFamily: { classified: true },
    atr: 1,
    opposingLiquidityTarget: 103,
    minimumRewardRisk: 2,
    maximumStopAtr: 2.5,
  });
  assert.equal(result.observationAccepted, true);
  assert.equal(result.rewardRisk, 3);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
});

test('risk evaluation rejects missing target and weak confluence', () => {
  const result = evaluateSmartMoneyRisk({
    direction: 'BEARISH',
    entryZone: { midpoint: 100, invalidationLevel: 101 },
    confluence: { mandatoryPassed: false },
    setupFamily: { classified: true },
    atr: 1,
    opposingLiquidityTarget: null,
  });
  assert.equal(result.observationAccepted, false);
  assert.ok(result.failedConditions.includes('CONFLUENCE_MANDATORY_CONDITIONS_FAILED'));
  assert.ok(result.failedConditions.includes('NO_VALID_OPPOSING_LIQUIDITY_TARGET'));
  assert.equal(result.automaticSubmissionAllowed, false);
});
