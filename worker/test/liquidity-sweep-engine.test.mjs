import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const { createLiquiditySweepConfig } = await import('../src/liquidity-sweep/config.js');
const { createLiquidityPool, createSweepEvent } = await import('../src/liquidity-sweep/contracts.js');
const { normalizeMarketData } = await import('../src/liquidity-sweep/normalization.js');
const { analyzeHigherTimeframe } = await import('../src/liquidity-sweep/higher-timeframe.js');
const { evaluatePostSweepConfirmation } = await import('../src/liquidity-sweep/confirmation.js');
const { classifySweepEvent } = await import('../src/liquidity-sweep/classifier.js');
const { buildLiquidityTradePlan } = await import('../src/liquidity-sweep/trade-plan.js');
const { scoreLiquiditySweepOpportunity } = await import('../src/liquidity-sweep/scoring.js');
const { explainLiquiditySweepDecision } = await import('../src/liquidity-sweep/explainability.js');
const { evaluateLiquiditySweepEngine } = await import('../src/liquidity-sweep/engine.js');

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
  confirmation: {
    minimumScore: 50,
    minimumDisplacementAtr: 0.25,
    retestMaximumBars: 5,
    maximumEntryExtensionAtr: 1.5,
    requireStructureShift: false,
    requireRetest: false,
  },
  scoring: {
    minimumAutomaticScore: 70,
    minimumValidScore: 60,
    watchlistScore: 50,
    countertrendMinimumScore: 85,
  },
});

function fixtureBars() {
  const start = Date.parse('2026-07-24T13:30:00.000Z');
  const bars = Array.from({ length: 24 }, (_, index) => {
    const base = 100.15 + index * 0.012 + Math.sin(index / 3) * 0.05;
    return {
      t: start + index * 5 * MINUTE,
      o: base - 0.03,
      h: base + 0.13,
      l: base - 0.13,
      c: base + 0.02,
      v: 100000 + index * 2500,
      session: 'REGULAR',
      complete: true,
    };
  });
  const next = bars.at(-1).t + 5 * MINUTE;
  bars.push(
    { t: next, o: 100.03, h: 100.08, l: 99.68, c: 100.02, v: 220000, session: 'REGULAR', complete: true },
    { t: next + 5 * MINUTE, o: 100.02, h: 100.48, l: 100.00, c: 100.43, v: 260000, session: 'REGULAR', complete: true },
    { t: next + 10 * MINUTE, o: 100.42, h: 100.55, l: 100.10, c: 100.36, v: 180000, session: 'REGULAR', complete: true },
    { t: next + 15 * MINUTE, o: 100.35, h: 100.70, l: 100.31, c: 100.66, v: 240000, session: 'REGULAR', complete: true },
  );
  return bars;
}

async function fixture() {
  const bars = fixtureBars();
  const snapshot = normalizeMarketData({
    bars,
    timeframe: '5m',
    now: bars.at(-1).t + 5 * MINUTE + 30_000,
    bid: 100.65,
    ask: 100.67,
    config,
  });
  const pool = await createLiquidityPool({
    type: 'EQUAL_LOWS',
    side: 'SELL_SIDE',
    zoneLower: 99.95,
    zoneUpper: 100,
    referencePrice: 99.975,
    createdAt: bars[4].t,
    lastTouchedAt: bars[18].t,
    touchCount: 3,
    originTimeframe: '5m',
    originSession: 'REGULAR',
    relativeVolume: 1.4,
    importanceScore: 88,
    status: 'RECLAIMED',
    swept: true,
    reclaimed: true,
    expiresAt: bars.at(-1).t + 100 * 5 * MINUTE,
    evidence: ['VISIBLE_EQUAL_LIQUIDITY'],
  });
  const sweep = await createSweepEvent({
    poolId: pool.poolId,
    symbol: 'AAPL',
    direction: 'LONG',
    detectedAt: bars[24].t,
    extremePrice: 99.68,
    penetrationDistance: 0.27,
    penetrationAtr: 0.5,
    candlesOutside: 0,
    reclaimed: true,
    reclaimedAt: bars[24].t,
    reclaimCandles: 0,
    wickToBodyRatio: 3.5,
    closeLocation: 0.85,
    classification: 'PROBABLE_LIQUIDITY_SWEEP',
    evidence: ['FAST_RECLAIM', 'STRONG_LOWER_WICK'],
  });
  return { bars, snapshot, pool, sweep };
}

test('confirms displacement after a reclaimed sell-side sweep', async () => {
  const { snapshot, pool, sweep } = await fixture();
  const confirmation = evaluatePostSweepConfirmation({ snapshot, pool, sweep, config });
  assert.equal(confirmation.passed, true);
  assert.ok(confirmation.score >= config.confirmation.minimumScore);
  assert.ok(confirmation.evidence.includes('POST_SWEEP_DISPLACEMENT'));
  assert.equal(confirmation.failedContinuation, true);
});

test('builds a protected paper-only trade plan targeting opposing liquidity', async () => {
  const { snapshot, pool, sweep } = await fixture();
  const confirmation = evaluatePostSweepConfirmation({ snapshot, pool, sweep, config });
  const classified = await classifySweepEvent(sweep, {
    config,
    context: {
      ...confirmation.context,
      confirmationPassed: true,
      retestRejected: true,
      reversalRelativeVolume: true,
      movingTowardOpposingLiquidity: true,
    },
  });
  const targetPool = await createLiquidityPool({
    type: 'PREVIOUS_DAY_HIGH',
    side: 'BUY_SIDE',
    zoneLower: 101.8,
    zoneUpper: 101.85,
    referencePrice: 101.825,
    createdAt: snapshot.candles[0].timestamp,
    lastTouchedAt: snapshot.candles[10].timestamp,
    touchCount: 2,
    originTimeframe: '1d',
    originSession: 'REGULAR',
    relativeVolume: 1,
    importanceScore: 90,
    expiresAt: snapshot.latest.timestamp + 100 * snapshot.timeframeMs,
  });
  const plan = buildLiquidityTradePlan({ snapshot, pool, sweep: classified, confirmation, liquidityPools: [pool, targetPool], config });
  assert.equal(plan.valid, true);
  assert.equal(plan.executionAllowed, false);
  assert.ok(plan.stopLoss < plan.entry);
  assert.ok(plan.takeProfit > plan.entry);
  assert.ok(plan.rewardToRisk >= config.risk.minimumRewardToRisk);
});

test('scores and explains an approved setup without enabling execution', async () => {
  const { snapshot, pool, sweep } = await fixture();
  const confirmation = evaluatePostSweepConfirmation({ snapshot, pool, sweep, config });
  const classified = await classifySweepEvent(sweep, {
    config,
    context: { ...confirmation.context, confirmationPassed: true, retestRejected: true, reversalRelativeVolume: true },
  });
  const higherTimeframe = analyzeHigherTimeframe(snapshot, { direction: 'LONG' });
  const plan = buildLiquidityTradePlan({ snapshot, pool, sweep: classified, confirmation, liquidityPools: [], config });
  const quality = scoreLiquiditySweepOpportunity({ pool, sweep: classified, confirmation, higherTimeframe, tradePlan: plan, snapshot, config });
  const explanation = explainLiquiditySweepDecision({ symbol: 'AAPL', pool, sweep: classified, confirmation, higherTimeframe, tradePlan: plan, quality });
  assert.ok(quality.total >= 0 && quality.total <= 100);
  assert.equal(quality.executionAllowed, false);
  assert.equal(explanation.executionAllowed, false);
  assert.ok(explanation.summary.includes('AAPL'));
});

test('engine safely returns NO_TRADE when no confirmed sweep exists', async () => {
  const bars = fixtureBars().slice(0, 24);
  const result = await evaluateLiquiditySweepEngine({
    symbol: 'MSFT',
    bars,
    timeframe: '5m',
    now: bars.at(-1).t + 5 * MINUTE + 30_000,
    config,
  });
  assert.equal(result.tradeDecision, 'NO_TRADE');
  assert.equal(result.executionAllowed, false);
  assert.equal(result.mode, 'PAPER_TRADING');
});
