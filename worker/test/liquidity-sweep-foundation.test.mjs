import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  createLiquiditySweepConfig,
  validateLiquiditySweepConfig,
  LIQUIDITY_SWEEP_STRATEGY_VERSION,
} = await import('../src/liquidity-sweep/config.js');
const {
  assertExecutionPayloadSafe,
  createLiquidityPool,
  createSweepEvent,
  createTradeSetup,
  deterministicId,
  noTradeDecision,
  normalizeCandle,
  normalizeCandleSeries,
} = await import('../src/liquidity-sweep/contracts.js');
const {
  allowedSetupTransitions,
  canTransitionSetup,
  setupRequiresNewId,
  transitionSetup,
  validateSetupStateHistory,
} = await import('../src/liquidity-sweep/state-machine.js');

const detectedAt = Date.parse('2026-07-24T14:35:00.000Z');

async function fixtureSetup() {
  const pool = await createLiquidityPool({
    type: 'PREVIOUS_DAY_LOW',
    side: 'SELL_SIDE',
    zoneLower: 199.9,
    zoneUpper: 200,
    referencePrice: 199.95,
    createdAt: Date.parse('2026-07-23T20:00:00.000Z'),
    lastTouchedAt: Date.parse('2026-07-24T14:30:00.000Z'),
    touchCount: 3,
    originTimeframe: '5m',
    originSession: 'REGULAR',
    relativeVolume: 1.4,
    importanceScore: 88,
    status: 'FULLY_SWEPT',
    swept: true,
    reclaimed: false,
    expiresAt: Date.parse('2026-07-25T20:00:00.000Z'),
    evidence: ['PREVIOUS_DAY_LEVEL', 'MULTIPLE_CLEAN_TOUCHES'],
  });
  const sweep = await createSweepEvent({
    poolId: pool.poolId,
    symbol: 'AAPL',
    direction: 'LONG',
    detectedAt,
    extremePrice: 199.65,
    penetrationDistance: 0.25,
    penetrationAtr: 0.21,
    candlesOutside: 1,
    reclaimed: true,
    reclaimedAt: Date.parse('2026-07-24T14:40:00.000Z'),
    reclaimCandles: 1,
    wickToBodyRatio: 2.4,
    closeLocation: 0.82,
    acceptanceScore: 24,
    rejectionScore: 84,
    classification: 'CONFIRMED_LIQUIDITY_SWEEP',
    confidence: 87,
    evidence: ['FAST_RECLAIM', 'STRONG_LOWER_WICK', 'BULLISH_DISPLACEMENT'],
  });
  const setup = await createTradeSetup({
    symbol: 'AAPL',
    executionTimeframe: '5m',
    contextTimeframe: '1h',
    direction: 'LONG',
    marketSession: 'REGULAR',
    marketRegime: 'TRENDING_BULLISH',
    liquidityPool: pool,
    sweep,
    confirmation: { confirmed: true, score: 82 },
    tradePlan: { preferredEntry: 200.05, stopLoss: 199.5, takeProfit: 201.5 },
    quality: { totalScore: 89 },
    invalidationConditions: ['CLOSE_BELOW_SWEEP_EXTREME'],
    createdAt: detectedAt,
    expiresAt: Date.parse('2026-07-24T15:35:00.000Z'),
  });
  return { pool, sweep, setup };
}

test('creates a strict paper-only configuration with required timeframe mapping', () => {
  const config = createLiquiditySweepConfig();
  assert.equal(config.strategy.version, LIQUIDITY_SWEEP_STRATEGY_VERSION);
  assert.equal(config.strategy.mode, 'PAPER_TRADING');
  assert.equal(config.strategy.executionAllowed, false);
  assert.deepEqual(config.timeframes, {
    '1m': '15m',
    '5m': '1h',
    '15m': '4h',
    '4h': '1d',
    '1d': '1w',
  });
  assert.equal(Object.isFrozen(config), true);
});

test('rejects contradictory penetration thresholds', () => {
  assert.throws(() => createLiquiditySweepConfig({}, {
    sweep: { minimumPenetrationAtr: 0.6, maximumPenetrationAtr: 0.5 },
  }), /minimumPenetrationAtr/);
});

test('rejects attempts to enable live liquidity execution', () => {
  const config = createLiquiditySweepConfig();
  const unsafe = structuredClone(config);
  unsafe.strategy.liveExecutionAllowed = true;
  assert.throws(() => validateLiquiditySweepConfig(unsafe), /execution must remain disabled/);
});

test('normalizes only completed, internally consistent candles', () => {
  const candle = normalizeCandle({
    t: detectedAt,
    o: 200,
    h: 201,
    l: 199.5,
    c: 200.8,
    v: 100000,
    session: 'REGULAR',
    complete: true,
    source: 'ALPACA_IEX',
  });
  assert.equal(candle.close, 200.8);
  assert.throws(() => normalizeCandle({ ...candle, complete: false }), /Incomplete candle/);
  assert.throws(() => normalizeCandle({ ...candle, high: 199.9 }), /contain candle open and close/);
});

test('rejects candle series with duplicate or non-increasing timestamps', () => {
  const first = { timestamp: detectedAt, open: 100, high: 101, low: 99, close: 100.5, volume: 1000, session: 'REGULAR' };
  assert.throws(() => normalizeCandleSeries([first, { ...first }]), /strictly increasing/);
});

test('creates stable deterministic liquidity, sweep, and setup IDs', async () => {
  const left = await fixtureSetup();
  const right = await fixtureSetup();
  assert.equal(left.pool.poolId, right.pool.poolId);
  assert.equal(left.sweep.sweepId, right.sweep.sweepId);
  assert.equal(left.setup.setupId, right.setup.setupId);
  const manual = await deterministicId('setup', ['AAPL', '5m', 'LONG']);
  assert.match(manual, /^setup_[a-f0-9]{32}$/);
});

test('rejects a reclaimed sweep without reclaim timing evidence', async () => {
  await assert.rejects(() => createSweepEvent({
    poolId: 'pool-test',
    symbol: 'AAPL',
    direction: 'LONG',
    detectedAt,
    extremePrice: 199.5,
    reclaimed: true,
    reclaimCandles: 1,
  }), /requires reclaimedAt/);
});

test('rejects a setup whose sweep belongs to another liquidity pool', async () => {
  const { pool, sweep } = await fixtureSetup();
  await assert.rejects(() => createTradeSetup({
    symbol: 'AAPL',
    executionTimeframe: '5m',
    contextTimeframe: '1h',
    direction: 'LONG',
    liquidityPool: pool,
    sweep: { ...sweep, poolId: 'pool-other' },
    createdAt: detectedAt,
    expiresAt: detectedAt + 60_000,
  }), /IDs must match/);
});

test('enforces explicit valid state transitions and audit reasons', async () => {
  const { setup } = await fixtureSetup();
  assert.equal(canTransitionSetup('DETECTED', 'VALIDATING'), true);
  assert.equal(canTransitionSetup('DETECTED', 'FILLED'), false);
  assert.deepEqual(allowedSetupTransitions('DETECTED'), ['VALIDATING', 'INVALIDATED', 'EXPIRED', 'EXECUTION_ERROR']);

  const validating = transitionSetup(setup, 'VALIDATING', {
    reason: 'LIQUIDITY_POOL_PASSED_MINIMUM_IMPORTANCE',
    at: new Date(detectedAt + 1_000),
    module: 'LIQUIDITY_POOL_VALIDATOR',
  });
  const confirmed = transitionSetup(validating, 'CONFIRMED', {
    reason: 'REJECTION_DOMINATED_ACCEPTANCE_AND_CONFIRMATION_PASSED',
    at: new Date(detectedAt + 2_000),
    module: 'SWEEP_CLASSIFIER',
  });

  assert.equal(confirmed.state, 'CONFIRMED');
  assert.equal(confirmed.auditTrail.length, 2);
  assert.equal(validateSetupStateHistory(confirmed), true);
  assert.throws(() => transitionSetup(setup, 'FILLED', { reason: 'SKIP' }), /Invalid setup transition/);
  assert.throws(() => transitionSetup(setup, 'VALIDATING', {}), /requires a reason/);
});

test('terminal setups cannot return to an active state and require a new ID', async () => {
  const { setup } = await fixtureSetup();
  const invalidated = transitionSetup(setup, 'INVALIDATED', {
    reason: 'CONFIRMED_BREAKOUT_REPLACED_REVERSAL_THESIS',
    at: new Date(detectedAt + 1_000),
  });
  assert.equal(setupRequiresNewId(invalidated.state), true);
  assert.throws(() => transitionSetup(invalidated, 'VALIDATING', { reason: 'RETRY' }), /Terminal setup state/);
});

test('NO_TRADE output is explicit and never execution-enabled', () => {
  const decision = noTradeDecision('AMBIGUOUS_SWEEP_VERSUS_BREAKOUT', { acceptanceScore: 58, rejectionScore: 61 });
  assert.equal(decision.tradeDecision, 'NO_TRADE');
  assert.equal(decision.executionAllowed, false);
  assert.equal(decision.mode, 'PAPER_TRADING');
});

test('execution payload validation rejects null, NaN, and infinite values', () => {
  assert.equal(assertExecutionPayloadSafe({ entry: 100, stop: 99, target: 102 }), true);
  assert.throws(() => assertExecutionPayloadSafe({ entry: null }), /cannot be null/);
  assert.throws(() => assertExecutionPayloadSafe({ entry: Number.NaN }), /NaN or Infinity/);
  assert.throws(() => assertExecutionPayloadSafe({ entry: Number.POSITIVE_INFINITY }), /NaN or Infinity/);
});
