import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartMoneyConfig } from '../src/smart-money/config.js';
import { detectOrderBlocks } from '../src/smart-money/order-block.js';
import { detectBreakerBlocks } from '../src/smart-money/breaker-block.js';
import { evaluateSmartMoneyConfluence } from '../src/smart-money/confluence.js';

const timeframeMs = 5 * 60_000;
const start = Date.UTC(2026, 6, 24, 14, 30);

function candle(index, open, high, low, close, volume = 1000) {
  return {
    timestamp: start + index * timeframeMs,
    open, high, low, close, volume,
    session: 'REGULAR', complete: true, source: 'TEST',
  };
}

function snapshot(candles) {
  return {
    timeframe: '5m',
    timeframeMs,
    atr: 1,
    tickSize: 0.01,
    relativeVolume: 1.5,
    candles,
    latest: candles.at(-1),
    quality: { accepted: true, score: 100 },
  };
}

const config = createSmartMoneyConfig({
  orderBlock: {
    minimumStructureScore: 50,
    minimumDisplacementScore: 50,
    requireFvg: true,
    maximumWidthAtr: 2,
    preferredMaximumWidthAtr: 1,
    maximumMitigations: 2,
    minimumQualityScore: 60,
  },
  breaker: {
    minimumOriginalBlockScore: 60,
    minimumOppositeStructureScore: 60,
    minimumQualityScore: 65,
    maximumRetestBars: 10,
  },
  confluence: {
    minimumMandatoryScore: 70,
    minimumStructureScore: 50,
    minimumDisplacementScore: 50,
    minimumZoneScore: 60,
  },
});

function bullishEvent(index = 1) {
  return {
    eventId: 'structure_bull',
    eventType: 'BREAK_OF_STRUCTURE',
    direction: 'BULLISH',
    scope: 'EXTERNAL',
    index,
    qualityScore: 90,
  };
}

function bullishDisplacement(index = 1) {
  return {
    displacementId: 'displacement_bull',
    direction: 'BULLISH',
    index,
    score: 90,
    classification: 'STRONG',
    timestamp: start + index * timeframeMs,
  };
}

function bullishFvg(index = 2) {
  return {
    fvgId: 'fvg_bull',
    direction: 'BULLISH',
    creationIndex: index,
    displacementScore: 90,
    state: 'ACTIVE',
    lower: 10.2,
    upper: 10.5,
  };
}

test('validated order block requires structure displacement and FVG', async () => {
  const candles = [
    candle(0, 10, 10.2, 9.5, 9.7),
    candle(1, 9.7, 11.1, 9.6, 10.9, 2200),
    candle(2, 10.8, 11.4, 10.6, 11.2, 1400),
  ];
  const result = await detectOrderBlocks({
    symbol: 'AAPL',
    snapshot: snapshot(candles),
    config,
    structureEvents: [bullishEvent()],
    displacements: [bullishDisplacement()],
    fairValueGaps: [bullishFvg()],
  });
  assert.equal(result.blocks.length, 1);
  assert.equal(result.blocks[0].direction, 'BULLISH');
  assert.equal(result.blocks[0].state, 'ACTIVE');
  assert.ok(result.blocks[0].qualityScore >= 60);
  assert.equal(result.blocks[0].executionAllowed, false);
});

test('order block is rejected without qualifying displacement', async () => {
  const candles = [
    candle(0, 10, 10.2, 9.5, 9.7),
    candle(1, 9.7, 11.1, 9.6, 10.9),
    candle(2, 10.8, 11.4, 10.6, 11.2),
  ];
  const result = await detectOrderBlocks({
    symbol: 'AAPL',
    snapshot: snapshot(candles),
    config,
    structureEvents: [bullishEvent()],
    displacements: [{ ...bullishDisplacement(), score: 30, classification: 'WEAK' }],
    fairValueGaps: [bullishFvg()],
  });
  assert.equal(result.blocks.length, 0);
  assert.ok(result.rejected.some((item) => item.reason === 'ORDER_BLOCK_WITHOUT_VALID_DISPLACEMENT'));
});

test('failed order block becomes breaker only after opposite structure and retest rejection', async () => {
  const candles = [
    candle(0, 10, 10.2, 9.5, 9.7),
    candle(1, 9.7, 11.1, 9.6, 10.9, 2200),
    candle(2, 10.7, 10.8, 9.1, 9.3, 2400),
    candle(3, 9.8, 10, 9.2, 9.3, 1800),
    candle(4, 9.3, 9.4, 8.8, 8.9, 1600),
  ];
  const snap = snapshot(candles);
  const original = await detectOrderBlocks({
    symbol: 'AAPL',
    snapshot: snap,
    config,
    structureEvents: [bullishEvent()],
    displacements: [bullishDisplacement()],
    fairValueGaps: [bullishFvg()],
  });
  assert.equal(original.blocks[0].state, 'INVALIDATED');

  const oppositeEvent = {
    eventId: 'structure_bear',
    eventType: 'MARKET_STRUCTURE_SHIFT',
    direction: 'BEARISH',
    scope: 'EXTERNAL',
    index: 2,
    qualityScore: 92,
  };
  const breaker = await detectBreakerBlocks({
    symbol: 'AAPL',
    snapshot: snap,
    config,
    orderBlocks: original.blocks,
    structureEvents: [bullishEvent(), oppositeEvent],
  });
  assert.equal(breaker.breakers.length, 1);
  assert.equal(breaker.breakers[0].direction, 'BEARISH');
  assert.equal(breaker.breakers[0].state, 'ACTIVE');
  assert.ok(breaker.breakers[0].qualityScore >= 65);
  assert.equal(breaker.breakers[0].executionAllowed, false);
});

test('confluence applies premium-long penalty and remains observation only', () => {
  const structureEvent = bullishEvent(5);
  const result = evaluateSmartMoneyConfluence({
    structure: { latestEvent: structureEvent },
    displacement: [{ ...bullishDisplacement(5), score: 85 }],
    fairValueGaps: [],
    orderBlocks: [{
      blockId: 'ob_active', direction: 'BULLISH', state: 'ACTIVE', qualityScore: 85,
      mitigationCount: 0, lower: 99, upper: 100, midpoint: 99.5,
    }],
    breakers: [],
    dealingRange: { range: { position: 'EXTREME_PREMIUM' } },
    config,
  });
  assert.equal(result.direction, 'BULLISH');
  assert.ok(result.penalties.some((item) => item.code === 'LONG_ENTRY_IN_PREMIUM'));
  assert.equal(result.executionAllowed, false);
  assert.equal(result.automaticSubmissionAllowed, false);
});

test('confluence rejects an entry zone that is below minimum quality', () => {
  const result = evaluateSmartMoneyConfluence({
    structure: { latestEvent: bullishEvent(5) },
    displacement: [bullishDisplacement(5)],
    fairValueGaps: [{ ...bullishFvg(5), displacementScore: 40 }],
    orderBlocks: [],
    breakers: [],
    dealingRange: { range: { position: 'DISCOUNT' } },
    config,
  });
  assert.equal(result.approvedForObservation, false);
  assert.ok(result.failedConditions.includes('NO_QUALIFYING_ENTRY_ZONE'));
});
