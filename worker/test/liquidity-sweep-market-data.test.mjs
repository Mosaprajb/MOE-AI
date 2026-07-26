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
const { mapLiquidityPools } = await import('../src/liquidity-sweep/liquidity-map.js');

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
  liquidityPools: {
    minimumImportanceScore: 55,
    maximumAgeBars: 200,
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
  return normalizeMarketData({
    bars,
    timeframe: '5m',
    now: bars.at(-1).t + 5 * MINUTE + 30_000,
    config,
  });
}

async function liquidityFixture() {
  const bars = syntheticBars();
  const snapshot = normalizeMarketData({
    bars,
    timeframe: '5m',
    now: bars.at(-1).t + 5 * MINUTE + 30_000,
    config,
  });
  return mapLiquidityPools(snapshot, { originTimeframe: '5m', config });
}

function mappingSummary(liquidity) {
  return JSON.stringify({
    poolCount: liquidity.poolCount,
    buySide: liquidity.buySide.length,
    sellSide: liquidity.sellSide.length,
    pools: liquidity.pools.map((pool) => ({
      type: pool.type,
      side: pool.side,
      referencePrice: pool.referencePrice,
      importanceScore: pool.importanceScore,
    })),
  });
}

function assertApproximatelyEqual(actual, expected, tolerance = 1e-8) {
  assert.ok(Number.isFinite(actual), `Expected a finite actual value, received ${actual}`);
  assert.ok(Number.isFinite(expected), `Expected a finite expected value, received ${expected}`);
  assert.ok(Math.abs(actual - expected) <= tolerance, `Expected ${actual} to be within ${tolerance} of ${expected}`);
}

test('identifies exchange sessions correctly', () => {
  assert.equal(marketSessionAt(Date.parse('2026-07-24T12:00:00.000Z')), 'PREMARKET');
  assert.equal(marketSessionAt(Date.parse('2026-07-24T15:00:00.000Z')), 'REGULAR');
  assert.equal(marketSessionAt(Date.parse('2026-07-24T21:00:00.000Z')), 'AFTER_HOURS');
});

test('normalizes only completed bars and calculates volatility metrics', () => {
  const bars = syntheticBars();
  bars.push({ ...bars.at(-1), t: bars.at(-1).t + 5 * MINUTE, complete: false });
  const now = bars.at(-2).t + 5 * MINUTE + 30_000;
  const snapshot = normalizeMarketData({
    bars,
    timeframe: '5m',
    now,
    source: 'TEST',
    bid: 100.45,
    ask: 100.47,
    config,
  });

  assert.equal(snapshot.quality.accepted, true);
  assert.equal(snapshot.quality.excludedIncompleteBars, 1);
  assert.ok(snapshot.atr > 0);
  assert.ok(snapshot.relativeVolume > 0);
  assert.ok(snapshot.realizedVolatilityPercent >= 0);
  assert.equal(snapshot.tickSize, 0.01);
  assert.ok(snapshot.spread.spreadPercent > 0);
});

test('rejects delayed and abnormally wide-spread market data', () => {
  const bars = syntheticBars();
  const staleNow = bars.at(-1).t + 5 * MINUTE + 20 * MINUTE;
  assert.throws(() => normalizeMarketData({ bars, timeframe: '5m', now: staleNow, config }), /delayed/);

  const currentNow = bars.at(-1).t + 5 * MINUTE + 30_000;
  assert.throws(() => normalizeMarketData({
    bars,
    timeframe: '5m',
    now: currentNow,
    bid: 99,
    ask: 101,
    config,
  }), /Spread/);
});

test('calculates ATR deterministically', () => {
  const snapshot = metricSnapshot();
  assertApproximatelyEqual(calculateAtr(snapshot.candles, 5), snapshot.atr);
});

test('calculates relative volume deterministically', () => {
  const snapshot = metricSnapshot();
  assertApproximatelyEqual(calculateRelativeVolume(snapshot.candles, 5), snapshot.relativeVolume, 1e-4);
});

test('calculates realized volatility deterministically', () => {
  const snapshot = metricSnapshot();
  assertApproximatelyEqual(calculateRealizedVolatility(snapshot.candles, 5), snapshot.realizedVolatilityPercent, 1e-4);
});

test('infers equity tick sizes conservatively', () => {
  assert.equal(inferTickSize(100), 0.01);
  assert.equal(inferTickSize(0.5), 0.0001);
});

test('liquidity mapping returns at least one meaningful pool', async () => {
  const liquidity = await liquidityFixture();
  assert.ok(liquidity.poolCount > 0, mappingSummary(liquidity));
});

test('liquidity mapping returns buy-side pools', async () => {
  const liquidity = await liquidityFixture();
  assert.ok(liquidity.buySide.length > 0, mappingSummary(liquidity));
});

test('liquidity mapping returns sell-side pools', async () => {
  const liquidity = await liquidityFixture();
  assert.ok(liquidity.sellSide.length > 0, mappingSummary(liquidity));
});

test('liquidity mapping applies the configured importance threshold', async () => {
  const liquidity = await liquidityFixture();
  assert.ok(
    liquidity.pools.every((pool) => pool.importanceScore >= config.liquidityPools.minimumImportanceScore),
    mappingSummary(liquidity),
  );
});

test('liquidity mapping retains at least one major session or equal-level source', async () => {
  const liquidity = await liquidityFixture();
  const majorTypes = new Set(['PREVIOUS_DAY_HIGH', 'PREVIOUS_DAY_LOW', 'PREMARKET_HIGH', 'PREMARKET_LOW', 'EQUAL_LOWS', 'EQUAL_HIGHS']);
  assert.ok(liquidity.pools.some((pool) => majorTypes.has(pool.type)), mappingSummary(liquidity));
});
