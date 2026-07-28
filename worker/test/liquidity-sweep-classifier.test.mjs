import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { createLiquiditySweepConfig } = await import('../src/liquidity-sweep/config.js');
const { createLiquidityPool } = await import('../src/liquidity-sweep/contracts.js');
const { normalizeMarketData } = await import('../src/liquidity-sweep/normalization.js');
const { detectLiquiditySweep } = await import('../src/liquidity-sweep/sweep-detector.js');
const { classifySweepEvent, reversalTradeAllowed } = await import('../src/liquidity-sweep/classifier.js');

const MINUTE = 60_000;
const config = createLiquiditySweepConfig({}, {
  dataQuality: {
    minimumBars: 20,
    maximumDelaySeconds: 600,
    maximumMissingBars: 1,
    atrPeriod: 5,
    volumeLookback: 5,
    realizedVolatilityLookback: 5,
  },
  sweep: {
    minimumPenetrationAtr: 0.05,
    maximumPenetrationAtr: 0.6,
    minimumPenetrationTicks: 1,
    maximumReclaimCandles: 3,
    maximumCandlesOutside: 3,
    minimumWickToBodyRatio: 1.25,
    minimumCloseLocation: 0.6,
    minimumRelativeVolume: 0.8,
  },
});

function baseBars() {
  const start = Date.parse('2026-07-24T13:30:00.000Z');
  return Array.from({ length: 20 }, (_, index) => {
    const close = 100.2 + Math.sin(index / 3) * 0.12;
    return {
      t: start + index * 5 * MINUTE,
      o: close - 0.03,
      h: close + 0.18,
      l: close - 0.18,
      c: close,
      v: 100000 + index * 1000,
      session: 'REGULAR',
      complete: true,
    };
  });
}

async function sellSidePool() {
  return createLiquidityPool({
    type: 'EQUAL_LOWS',
    side: 'SELL_SIDE',
    zoneLower: 99.95,
    zoneUpper: 100,
    referencePrice: 99.975,
    createdAt: Date.parse('2026-07-24T13:30:00.000Z'),
    lastTouchedAt: Date.parse('2026-07-24T14:30:00.000Z'),
    touchCount: 3,
    originTimeframe: '5m',
    originSession: 'REGULAR',
    relativeVolume: 1.2,
    importanceScore: 82,
    status: 'UNSWEPT',
    swept: false,
    reclaimed: false,
    expiresAt: Date.parse('2026-07-25T20:00:00.000Z'),
    evidence: ['VISIBLE_EQUAL_LIQUIDITY'],
  });
}

function snapshotWithTail(tail) {
  const bars = [...baseBars(), ...tail];
  return normalizeMarketData({
    bars,
    timeframe: '5m',
    now: bars.at(-1).t + 5 * MINUTE + 30_000,
    config,
  });
}

test('detects a sell-side penetration followed by fast reclaim', async () => {
  const start = baseBars().at(-1).t + 5 * MINUTE;
  const snapshot = snapshotWithTail([
    { t: start, o: 100.02, h: 100.08, l: 99.72, c: 100.01, v: 180000, session: 'REGULAR', complete: true },
    { t: start + 5 * MINUTE, o: 100.01, h: 100.22, l: 99.99, c: 100.18, v: 195000, session: 'REGULAR', complete: true },
  ]);
  const detected = await detectLiquiditySweep({ symbol: 'AAPL', snapshot, pool: await sellSidePool(), config });

  assert.equal(detected.eventCount, 1);
  assert.equal(detected.events[0].direction, 'LONG');
  assert.equal(detected.events[0].reclaimed, true);
  assert.ok(detected.events[0].penetrationAtr >= config.sweep.minimumPenetrationAtr);
  assert.ok(detected.events[0].evidence.includes('FAST_RECLAIM'));
});

test('classifies a reclaimed event with confirmation as a confirmed liquidity sweep', async () => {
  const start = baseBars().at(-1).t + 5 * MINUTE;
  const snapshot = snapshotWithTail([
    { t: start, o: 100.02, h: 100.08, l: 99.72, c: 100.01, v: 180000, session: 'REGULAR', complete: true },
    { t: start + 5 * MINUTE, o: 100.01, h: 100.25, l: 99.99, c: 100.22, v: 210000, session: 'REGULAR', complete: true },
  ]);
  const detected = await detectLiquiditySweep({ symbol: 'AAPL', snapshot, pool: await sellSidePool(), config });
  const classified = await classifySweepEvent(detected.events[0], {
    config,
    context: {
      confirmationPassed: true,
      opposingDisplacement: true,
      failedContinuation: true,
      retestRejected: true,
      reversalRelativeVolume: true,
      movingTowardOpposingLiquidity: true,
    },
  });

  assert.equal(classified.classification, 'CONFIRMED_LIQUIDITY_SWEEP');
  assert.ok(classified.rejectionScore >= config.classification.confirmedSweepRejectionMinimum);
  assert.equal(reversalTradeAllowed(classified), true);
});

test('classifies acceptance outside the pool as breakout and blocks reversal', async () => {
  const start = baseBars().at(-1).t + 5 * MINUTE;
  const snapshot = snapshotWithTail([
    { t: start, o: 100, h: 100.02, l: 99.7, c: 99.78, v: 180000, session: 'REGULAR', complete: true },
    { t: start + 5 * MINUTE, o: 99.8, h: 99.84, l: 99.55, c: 99.62, v: 210000, session: 'REGULAR', complete: true },
    { t: start + 10 * MINUTE, o: 99.64, h: 99.76, l: 99.5, c: 99.58, v: 220000, session: 'REGULAR', complete: true },
  ]);
  const detected = await detectLiquiditySweep({ symbol: 'AAPL', snapshot, pool: await sellSidePool(), config });
  const event = detected.events[0];
  const classified = await classifySweepEvent(event, {
    config,
    context: {
      bodyPercentBeyondPool: 0.8,
      timeOutsideBars: 3,
      successfulBreakoutRetest: true,
      continuationVolume: true,
      breakoutDisplacement: true,
      higherTimeframeAligned: true,
      distanceMaintainedAtr: 0.4,
      confirmationPassed: false,
    },
  });

  assert.equal(classified.classification, 'CONFIRMED_BREAKOUT');
  assert.ok(classified.acceptanceScore >= config.classification.confirmedBreakoutAcceptanceMinimum);
  assert.equal(reversalTradeAllowed(classified), false);
  assert.ok(classified.rejectionReasons.includes('REVERSAL_BLOCKED_BY_CONFIRMED_BREAKOUT'));
});

test('does not create an event when the pool is not meaningfully penetrated', async () => {
  const start = baseBars().at(-1).t + 5 * MINUTE;
  const snapshot = snapshotWithTail([
    { t: start, o: 100.1, h: 100.2, l: 99.99, c: 100.08, v: 140000, session: 'REGULAR', complete: true },
  ]);
  const detected = await detectLiquiditySweep({ symbol: 'AAPL', snapshot, pool: await sellSidePool(), config });
  assert.equal(detected.eventCount, 0);
});
