import test from 'node:test';
import assert from 'node:assert/strict';
import { createSmartMoneyConfig } from '../src/smart-money/config.js';
import { transitionSmartMoneySetup } from '../src/smart-money/state-machine.js';
import { detectConfirmedSwings, detectStructuralEvents } from '../src/smart-money/market-structure.js';
import { evaluateDisplacementAt } from '../src/smart-money/displacement.js';
import { detectFairValueGaps } from '../src/smart-money/fair-value-gap.js';
import { buildActiveDealingRange } from '../src/smart-money/dealing-range.js';
import { evaluateSmartMoneyFoundation } from '../src/smart-money/engine.js';

const timeframeMs = 5 * 60_000;
const start = Date.UTC(2026, 6, 24, 14, 30);

function candlesFrom(values) {
  return values.map((value, index) => ({
    timestamp: start + index * timeframeMs,
    open: value[0], high: value[1], low: value[2], close: value[3], volume: value[4] ?? 1000,
    session: 'REGULAR', complete: true, source: 'TEST',
  }));
}

function snapshot(candles, overrides = {}) {
  return {
    timeframe: '5m', timeframeMs, tickSize: 0.01, atr: 1,
    relativeVolume: 1.5, latest: candles.at(-1), candles,
    quality: { accepted: true, score: 100 },
    ...overrides,
  };
}

const config = createSmartMoneyConfig({
  structure: {
    pivotLeftBars: 1,
    pivotRightBars: 1,
    externalWindowBars: 5,
    minimumSwingProminenceAtr: 0.05,
    minimumBosPenetrationAtr: 0.05,
    minimumBosPenetrationTicks: 1,
    minimumBreakBodyAtr: 0.2,
    minimumDirectionalCloseLocation: 0.6,
    minimumBreakRelativeVolume: 0.8,
  },
  fvg: { minimumSizeAtr: 0.05, minimumSizeTicks: 1, minimumDisplacementScore: 45 },
  dealingRange: { minimumRangeAtr: 0.5 },
});

test('Smart Money config cannot enable execution', () => {
  assert.throws(() => createSmartMoneyConfig({ strategy: { executionAllowed: true } }), /safety locks/);
});

test('confirmed swing uses right-side confirmation delay', async () => {
  const candles = candlesFrom([
    [10, 10.2, 9.8, 10, 1000],
    [10, 11.5, 9.9, 11, 1200],
    [11, 11.1, 10.3, 10.5, 1000],
    [10.5, 10.8, 9.4, 9.7, 1000],
    [9.7, 10.1, 9.6, 10, 1000],
  ]);
  const swings = await detectConfirmedSwings({ symbol: 'AAPL', snapshot: snapshot(candles), config });
  const high = swings.find((item) => item.type === 'SWING_HIGH');
  assert.ok(high);
  assert.equal(high.confirmationIndex, high.index + 1);
  assert.equal(high.confirmedAt, candles[high.confirmationIndex].timestamp);
});

test('wick-only penetration is rejected and close-confirmed BOS is accepted', async () => {
  const candles = candlesFrom([
    [10, 10.2, 9.8, 10, 1000],
    [10, 11, 9.9, 10.7, 1000],
    [10.7, 10.8, 10, 10.2, 1000],
    [10.2, 11.2, 10.1, 10.7, 1000],
    [10.7, 11.7, 10.6, 11.6, 1800],
    [11.6, 11.9, 11.4, 11.8, 1200],
  ]);
  const result = await detectStructuralEvents({ symbol: 'AAPL', snapshot: snapshot(candles), config });
  assert.ok(result.rejectedEvents.some((item) => item.reason === 'WICK_ONLY_FALSE_BREAK'));
  assert.ok(result.events.some((item) => item.eventType === 'BREAK_OF_STRUCTURE' && item.direction === 'BULLISH'));
});

test('displacement distinguishes strong body from weak candle', async () => {
  const candles = candlesFrom([
    [10, 10.2, 9.9, 10.05, 1000],
    [10.05, 11.5, 10, 11.4, 2200],
  ]);
  const strong = await evaluateDisplacementAt({ symbol: 'AAPL', snapshot: snapshot(candles), index: 1, config });
  assert.ok(['STRONG', 'EXCEPTIONAL'].includes(strong.classification));
  const weak = await evaluateDisplacementAt({ symbol: 'AAPL', snapshot: snapshot(candles), index: 0, config });
  assert.ok(['NONE', 'WEAK'].includes(weak.classification));
});

test('valid bullish FVG is detected and tiny gap is rejected', async () => {
  const valid = candlesFrom([
    [10, 10.2, 9.8, 10.1, 1000],
    [10.1, 11.4, 10.05, 11.3, 2200],
    [11.35, 11.8, 11.25, 11.7, 1500],
  ]);
  const validResult = await detectFairValueGaps({ symbol: 'AAPL', snapshot: snapshot(valid), config, structureEvents: [] });
  assert.ok(validResult.gaps.some((gap) => gap.direction === 'BULLISH'));

  const tiny = candlesFrom([
    [10, 10.2, 9.8, 10.1, 1000],
    [10.1, 11.2, 10.05, 11.1, 2200],
    [10.205, 11.3, 10.201, 11.2, 1500],
  ]);
  const tinyResult = await detectFairValueGaps({ symbol: 'AAPL', snapshot: snapshot(tiny), config, structureEvents: [] });
  assert.ok(tinyResult.rejected.some((item) => item.reason === 'TINY_INVALID_FVG'));
});

test('dealing range classifies premium and discount using external swings', async () => {
  const candles = candlesFrom([[10, 10.2, 9.8, 10, 1000], [10, 10.5, 9.9, 10.4, 1000]]);
  const swings = [
    { swingId: 'low', type: 'SWING_LOW', scope: 'EXTERNAL', price: 9, confirmedAt: start },
    { swingId: 'high', type: 'SWING_HIGH', scope: 'EXTERNAL', price: 13, confirmedAt: start + timeframeMs },
  ];
  const result = await buildActiveDealingRange({ symbol: 'AAPL', snapshot: snapshot(candles, { latest: { ...candles.at(-1), close: 12.5 } }), config, swings });
  assert.equal(result.range.position, 'EXTREME_PREMIUM');
});

test('terminal Smart Money state cannot reactivate', () => {
  const setup = { setupId: 'sm_test', state: 'INVALIDATED', updatedAt: start, auditTrail: [] };
  assert.throws(() => transitionSmartMoneySetup(setup, 'CONTEXT_DETECTED'), /cannot leave/);
});

test('foundation engine remains observation-only and returns NO_TRADE', async () => {
  const bars = [];
  for (let index = 0; index < 90; index += 1) {
    const base = 100 + Math.sin(index / 3) * 2 + index * 0.03;
    bars.push({
      timestamp: start + index * timeframeMs,
      open: base - 0.15,
      high: base + 0.45,
      low: base - 0.4,
      close: base + 0.2,
      volume: 1000 + index * 10,
      session: 'REGULAR', complete: true,
    });
  }
  const now = bars.at(-1).timestamp + timeframeMs + 10_000;
  const result = await evaluateSmartMoneyFoundation({ symbol: 'AAPL', bars, timeframe: '5m', now });
  assert.equal(result.tradeDecision, 'NO_TRADE');
  assert.equal(result.reason, 'SMART_MONEY_FOUNDATION_OBSERVATION_ONLY');
  assert.equal(result.executionAllowed, false);
  assert.equal(result.automaticSubmissionAllowed, false);
});
