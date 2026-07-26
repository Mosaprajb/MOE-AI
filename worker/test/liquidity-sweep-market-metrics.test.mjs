import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { createLiquiditySweepConfig } = await import('../src/liquidity-sweep/config.js');
const {
  calculateAtr,
  calculateRealizedVolatility,
  calculateRelativeVolume,
  inferTickSize,
  marketSessionAt,
  normalizeMarketData,
} = await import('../src/liquidity-sweep/normalization.js');

const MINUTE = 60_000;
const config = createLiquiditySweepConfig({}, {
  dataQuality: {
    minimumBars: 20,
    maximumDelaySeconds: 600,
    maximumMissingBars: 2,
    atrPeriod: 5,
    volumeLookback: 5,
    realizedVolatilityLookback: 5,
  },
});

function syntheticBars() {
  const bars = [];
  const priorStart = Date.parse('2026-07-23T13:30:00.000Z');
  for (let index = 0; index < 18; index += 1) {
    const base = 100 + Math.sin(index / 3) * 0.4;
    bars.push({
      t: priorStart + index * 5 * MINUTE,
      o: base,
      h: base + 0.35,
      l: base - 0.35,
      c: base + 0.05,
      v: 100000 + index * 1000,
      session: 'REGULAR',
      complete: true,
    });
  }
  const currentStart = Date.parse('2026-07-24T12:00:00.000Z');
  const lows = [99.8, 99.7, 99.72, 99.9, 99.71, 99.95, 100.1, 100.2, 100.05, 100.25, 100.15, 100.3];
  for (let index = 0; index < lows.length; index += 1) {
    const low = lows[index];
    const high = 100.7 + (index % 3) * 0.1;
    bars.push({
      t: currentStart + index * 5 * MINUTE,
      o: low + 0.2,
      h: high,
      l: low,
      c: low + 0.35,
      v: 150000 + index * 5000,
      session: index < 6 ? 'PREMARKET' : 'REGULAR',
      complete: true,
    });
  }
  return bars;
}

function metricSnapshot() {
  const bars = syntheticBars();
  return normalizeMarketData({ bars, timeframe: '5m', now: bars.at(-1).t + 5 * MINUTE + 30_000, config });
}

function assertApproximatelyEqual(actual, expected, tolerance = 1e-8) {
  assert.ok(Number.isFinite(actual), `Expected a finite actual value, received ${actual}`);
  assert.ok(Number.isFinite(expected), `Expected a finite expected value, received ${expected}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('validates market sessions, normalization, safety rejection, and metrics sequentially', () => {
  assert.equal(marketSessionAt(Date.parse('2026-07-24T12:00:00.000Z')), 'PREMARKET');
  assert.equal(marketSessionAt(Date.parse('2026-07-24T15:00:00.000Z')), 'REGULAR');
  assert.equal(marketSessionAt(Date.parse('2026-07-24T21:00:00.000Z')), 'AFTER_HOURS');

  const completedBars = syntheticBars();
  const barsWithIncomplete = [...completedBars, { ...completedBars.at(-1), t: completedBars.at(-1).t + 5 * MINUTE, complete: false }];
  const normalized = normalizeMarketData({
    bars: barsWithIncomplete,
    timeframe: '5m',
    now: completedBars.at(-1).t + 5 * MINUTE + 30_000,
    source: 'TEST',
    bid: 100.45,
    ask: 100.47,
    config,
  });
  assert.equal(normalized.quality.accepted, true);
  assert.equal(normalized.quality.excludedIncompleteBars, 1);
  assert.ok(normalized.atr > 0);
  assert.ok(normalized.relativeVolume > 0);
  assert.ok(normalized.realizedVolatilityPercent >= 0);
  assert.equal(normalized.tickSize, 0.01);
  assert.ok(normalized.spread.spreadPercent > 0);

  assert.throws(() => normalizeMarketData({
    bars: syntheticBars(),
    timeframe: '5m',
    now: completedBars.at(-1).t + 5 * MINUTE + 20 * MINUTE,
    config,
  }), /delayed/);
  assert.throws(() => normalizeMarketData({
    bars: syntheticBars(),
    timeframe: '5m',
    now: completedBars.at(-1).t + 5 * MINUTE + 30_000,
    bid: 99,
    ask: 101,
    config,
  }), /Spread/);

  const candles = [
    { high: 10, low: 9, close: 9.5 },
    { high: 11, low: 9.5, close: 10.5 },
    { high: 12, low: 10, close: 11 },
    { high: 11.5, low: 10.5, close: 11.25 },
  ];
  assert.equal(calculateAtr(candles, 3), 1.5);

  const snapshot = metricSnapshot();
  assertApproximatelyEqual(calculateRelativeVolume(snapshot.candles, 5), snapshot.relativeVolume, 1e-4);
  assertApproximatelyEqual(calculateRealizedVolatility(snapshot.candles, 5), snapshot.realizedVolatilityPercent, 1e-4);
  assert.equal(inferTickSize(100), 0.01);
  assert.equal(inferTickSize(0.5), 0.0001);
});
