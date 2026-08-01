import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  STRATEGY_CAPACITY_AUDIT_KEY,
  STRATEGY_CAPACITY_BLOCKERS,
  STRATEGY_CAPACITY_LEASE_KEY,
  applyStrategyCapacityToSelection,
  buildStrategyCapacitySnapshot,
  releaseStrategyOrderReservation,
  reserveStrategyOrderSubmission,
  strategyCapacityDateKey,
} from '../src/strategy/strategy-capacity.js';
import {
  STRATEGY_IDS,
  strategyRegistry,
} from '../src/strategy/strategy-registry.js';
import { executeSelectedSandboxOpportunity } from '../src/trading-control/opportunity-sandbox-control.js';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');
const config = JSON.parse(readFileSync(join(root, 'wrangler.sandbox.jsonc'), 'utf8'));
const portfolioRiskSource = readFileSync(join(root, 'worker/src/trading-intelligence/portfolio-risk.js'), 'utf8');
const selectorSource = readFileSync(join(root, 'worker/src/dashboard/strategy-selector.js'), 'utf8');
const sandboxEntrySource = readFileSync(join(root, 'worker/src/sandbox-simulation-entry.js'), 'utf8');

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) {
      if (key && typeof key === 'object' && !Array.isArray(key)) {
        for (const [itemKey, itemValue] of Object.entries(key)) values.set(itemKey, itemValue);
        return;
      }
      values.set(key, value);
    },
  };
}

function lease({
  id,
  strategyId,
  status = 'SUBMITTED',
  createdAt,
  submittedAt = createdAt,
  expiresAt,
  tradeId = null,
  signalId = null,
  symbol = 'SPY',
}) {
  return {
    id,
    reservationId: `reservation-${id}`,
    strategyId,
    status,
    createdAt,
    submittedAt,
    updatedAt: submittedAt || createdAt,
    expiresAt,
    tradeId,
    signalId,
    symbol,
  };
}

function selectedRecord(strategyId = STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL, symbol = 'AAPL') {
  const now = Date.parse('2026-08-01T16:00:00.000Z');
  return {
    id: `managed-${symbol}`,
    dedupeKey: `${symbol}|LONG|5m|${strategyId}`,
    status: 'ACTIVE',
    selected: true,
    rank: 1,
    symbol,
    direction: 'LONG',
    timeframe: '5m',
    grade: 'AA',
    score: 91,
    confidence: 88,
    expiresAt: new Date(now + 10 * 60_000).toISOString(),
    opportunity: {
      id: `opp-${symbol}`,
      symbol,
      direction: 'LONG',
      timeframe: '5m',
      score: 91,
      confidence: { value: 88 },
      createdAt: new Date(now - 60_000).toISOString(),
      entry: 120,
      stopLoss: 118,
      takeProfit: 124,
      metadata: { setupFamily: strategyId, sourceStrategy: strategyId, grade: 'AA', session: 'CORE' },
    },
  };
}

function snapshot(record) {
  return {
    rows: [{
      id: record.id,
      dedupeKey: record.dedupeKey,
      symbol: record.symbol,
      direction: record.direction,
      timeframe: record.timeframe,
      grade: record.grade,
      score: record.score,
      confidence: record.confidence,
      status: record.status,
      rank: record.rank,
      expiresAt: record.expiresAt,
    }],
    opportunitySelection: { selected: [record] },
  };
}

function safeEnv(overrides = {}) {
  return {
    WEBULL_ENVIRONMENT: 'sandbox',
    WEBULL_SANDBOX_ENABLED: 'true',
    WEBULL_SANDBOX_ORDER_SUBMISSION: 'true',
    WEBULL_AUTO_SUBMIT_SANDBOX: 'true',
    WEBULL_AUTOMATION_ARMED: 'true',
    WEBULL_PROTECTED_ORDERS: 'true',
    WEBULL_ACCOUNT_ID: 'sandbox-account',
    MOE_WEBHOOK_SECRET: 'test-secret',
    MOE_LIVE_EXECUTION_IMPLEMENTED: 'false',
    MOE_LIVE_MODE_UNLOCKED: 'false',
    WEBULL_LIVE_TRADING: 'false',
    WEBULL_LIVE_ORDER_SUBMISSION: 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: 'false',
    WEBULL_LIVE_KILL_SWITCH: 'true',
    MOE_TRADING_CONTROL_MIN_SCORE: '68',
    MOE_TRADING_CONTROL_MIN_CONFIDENCE: '68',
    ...overrides,
  };
}

test('registry resolves configurable limits for all three Sandbox strategies', () => {
  const registry = strategyRegistry({
    MOE_STRATEGY_MOERAND_SCALP_INTERNAL_MAX_DAILY_TRADES: '25',
    MOE_STRATEGY_MOERAND_SCALP_INTERNAL_MAX_CONCURRENT_POSITIONS: '2',
  });
  const byId = Object.fromEntries(registry.strategies.map((strategy) => [strategy.id, strategy]));

  assert.equal(byId.FUSION_V2.maxDailyTrades, 1);
  assert.equal(byId.MOERAND_SIMPLE_INTERNAL.maxDailyTrades, 2);
  assert.equal(byId.MOERAND_SCALP_INTERNAL.maxDailyTrades, 25);
  assert.equal(byId.MOERAND_SCALP_INTERNAL.maxConcurrentPositions, 2);
  assert.equal(registry.longOnly, true);
  assert.equal(registry.spotEquitiesOnly, true);
});

test('strategy daily reset uses the same America/New_York date boundary as portfolio risk', () => {
  assert.equal(strategyCapacityDateKey('2026-08-01T03:59:59.000Z'), '2026-07-31');
  assert.equal(strategyCapacityDateKey('2026-08-01T04:00:00.000Z'), '2026-08-01');
  assert.match(portfolioRiskSource, /const EXCHANGE_TIME_ZONE = 'America\/New_York'/);
  assert.match(portfolioRiskSource, /exchangeDateKey/);
});

test('daily counts are separated by strategy and closed positions still count for the day', async () => {
  const now = Date.parse('2026-08-01T16:00:00.000Z');
  const expiresAt = now + 60 * 60_000;
  const storage = memoryStorage({
    [STRATEGY_CAPACITY_LEASE_KEY]: {
      f1: lease({ id: 'f1', strategyId: STRATEGY_IDS.FUSION_V2, createdAt: '2026-08-01T14:00:00.000Z', expiresAt, tradeId: 'trade-f1' }),
      s1: lease({ id: 's1', strategyId: STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL, createdAt: '2026-08-01T14:05:00.000Z', expiresAt, tradeId: 'trade-s1' }),
      s2: lease({ id: 's2', strategyId: STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL, createdAt: '2026-08-01T14:10:00.000Z', expiresAt, tradeId: 'trade-s2' }),
      old: lease({ id: 'old', strategyId: STRATEGY_IDS.MOERAND_SCALP_INTERNAL, createdAt: '2026-07-31T14:00:00.000Z', expiresAt, tradeId: 'trade-old' }),
    },
    'trade-history:v1': [
      { id: 'trade-f1', status: 'CLOSED' },
      { id: 'trade-s1', status: 'CLOSED' },
      { id: 'trade-s2', status: 'OPEN' },
      { id: 'trade-old', status: 'CLOSED' },
    ],
  });

  const capacity = await buildStrategyCapacitySnapshot(storage, {}, { now });
  assert.equal(capacity.byStrategy.FUSION_V2.dailyTrades, 1);
  assert.equal(capacity.byStrategy.MOERAND_SIMPLE_INTERNAL.dailyTrades, 2);
  assert.equal(capacity.byStrategy.MOERAND_SCALP_INTERNAL.dailyTrades, 0);
  assert.equal(capacity.byStrategy.FUSION_V2.concurrentPositions, 0);
  assert.equal(capacity.byStrategy.MOERAND_SIMPLE_INTERNAL.concurrentPositions, 1);
  assert.equal(capacity.byStrategy.MOERAND_SIMPLE_INTERNAL.dailyLimitReached, true);
  assert.equal(capacity.byStrategy.MOERAND_SIMPLE_INTERNAL.existingPositionsManaged, true);
});

test('daily strategy limit blocks before order reservation and records a distinct audit reason', async () => {
  const now = Date.parse('2026-08-01T16:00:00.000Z');
  const storage = memoryStorage({
    [STRATEGY_CAPACITY_LEASE_KEY]: {
      s1: lease({ id: 's1', strategyId: STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL, createdAt: '2026-08-01T14:05:00.000Z', expiresAt: now + 60_000, tradeId: 'trade-s1' }),
      s2: lease({ id: 's2', strategyId: STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL, createdAt: '2026-08-01T14:10:00.000Z', expiresAt: now + 60_000, tradeId: 'trade-s2' }),
    },
    'trade-history:v1': [
      { id: 'trade-s1', status: 'CLOSED' },
      { id: 'trade-s2', status: 'CLOSED' },
    ],
  });

  const result = await reserveStrategyOrderSubmission(storage, {
    strategyId: STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL,
    signalId: 'signal-3',
    accountId: 'sandbox-account',
    symbol: 'NVDA',
    side: 'BUY',
    runtimeMode: 'SANDBOX',
    now,
  }, {});

  assert.equal(result.accepted, false);
  assert.equal(result.blocker, STRATEGY_CAPACITY_BLOCKERS.DAILY);
  assert.equal(result.globalPortfolioRiskBypassed, false);
  const audit = await storage.get(STRATEGY_CAPACITY_AUDIT_KEY);
  assert.equal(audit[0].code, 'STRATEGY_MAX_DAILY_TRADES_REACHED');
  assert.equal(audit[0].strategyId, STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL);
});

test('concurrent strategy limit blocks a second strategy position but release restores capacity', async () => {
  const now = Date.now();
  const storage = memoryStorage();
  const env = {
    MOE_STRATEGY_FUSION_V2_MAX_DAILY_TRADES: '5',
    MOE_STRATEGY_FUSION_V2_MAX_CONCURRENT_POSITIONS: '1',
  };

  const first = await reserveStrategyOrderSubmission(storage, {
    strategyId: STRATEGY_IDS.FUSION_V2,
    signalId: 'fusion-1',
    accountId: 'sandbox-account',
    symbol: 'AAPL',
    side: 'BUY',
    runtimeMode: 'SANDBOX',
    now,
  }, env);
  assert.equal(first.accepted, true);

  const blocked = await reserveStrategyOrderSubmission(storage, {
    strategyId: STRATEGY_IDS.FUSION_V2,
    signalId: 'fusion-2',
    accountId: 'sandbox-account',
    symbol: 'MSFT',
    side: 'BUY',
    runtimeMode: 'SANDBOX',
    now: now + 1,
  }, env);
  assert.equal(blocked.accepted, false);
  assert.equal(blocked.blocker, STRATEGY_CAPACITY_BLOCKERS.CONCURRENT);

  await releaseStrategyOrderReservation(storage, first.reservation.id, 'TEST_RELEASE');
  const restored = await buildStrategyCapacitySnapshot(storage, env, { now: now + 2 });
  assert.equal(restored.byStrategy.FUSION_V2.concurrentPositions, 0);
});

test('Opportunity Manager selection removes only new entries for a capped strategy', () => {
  const simple = selectedRecord(STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL, 'AAPL');
  const scalp = selectedRecord(STRATEGY_IDS.MOERAND_SCALP_INTERNAL, 'TSLA');
  const capacity = {
    byStrategy: {
      [STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL]: {
        dailyLimitReached: true,
        concurrentLimitReached: false,
        dailyTrades: 2,
        maxDailyTrades: 2,
        concurrentPositions: 0,
        maxConcurrentPositions: 1,
      },
      [STRATEGY_IDS.MOERAND_SCALP_INTERNAL]: {
        dailyLimitReached: false,
        concurrentLimitReached: false,
        dailyTrades: 7,
        maxDailyTrades: 20,
        concurrentPositions: 0,
        maxConcurrentPositions: 1,
      },
    },
  };
  const filtered = applyStrategyCapacityToSelection({ selected: [simple, scalp], summary: { selected: 2 } }, capacity);
  assert.deepEqual(filtered.selection.selected.map((item) => item.strategyId), [STRATEGY_IDS.MOERAND_SCALP_INTERNAL]);
  assert.equal(filtered.blocked[0].code, STRATEGY_CAPACITY_BLOCKERS.DAILY);
  assert.equal(filtered.blocked[0].existingPositionsManaged, true);
});

test('Trading Control preserves a distinct per-strategy blocker instead of reporting a duplicate', async () => {
  const record = selectedRecord(STRATEGY_IDS.MOERAND_SCALP_INTERNAL, 'TSLA');
  const coordinator = {
    async getLiveControlState() {
      return { sandboxAutomationEnabled: true, effectiveLiveUnlocked: false, effectiveLiveAutomationArmed: false };
    },
    async liveScannerSnapshot() { return snapshot(record); },
    async reserveOrderSubmission() {
      return {
        accepted: false,
        blocker: STRATEGY_CAPACITY_BLOCKERS.DAILY,
        strategyCapacity: { dailyTrades: 20, maxDailyTrades: 20 },
      };
    },
    async finalizeOrderReservation() { throw new Error('not expected'); },
    async releaseOrderReservation() { throw new Error('not expected'); },
  };
  const result = await executeSelectedSandboxOpportunity({
    selector: { opportunityId: record.id },
    confirm: true,
    env: safeEnv(),
    coordinator,
    submitter: async () => { throw new Error('not expected'); },
    now: Date.parse('2026-08-01T16:00:00.000Z'),
  });
  assert.equal(result.code, 'STRATEGY_MAX_DAILY_TRADES_REACHED');
  assert.equal(result.blockerLayer, 'PER_STRATEGY');
  assert.equal(result.duplicate, undefined);
  assert.equal(result.existingPositionsManaged, true);
});

test('dashboard exposes X/max counts and global 0.5 percent ceilings remain unchanged', () => {
  assert.match(selectorSource, /trades today/);
  assert.match(selectorSource, /dailyTrades/);
  assert.match(selectorSource, /maxDailyTrades/);
  assert.match(selectorSource, /Existing open positions remain visible and managed/);
  assert.match(sandboxEntrySource, /STRATEGY_CAPACITY_API_PATH/);
  assert.match(sandboxEntrySource, /recordStrategyCapacityAudit/);

  assert.equal(config.vars.MOE_STRATEGY_FUSION_V2_MAX_DAILY_TRADES, '1');
  assert.equal(config.vars.MOE_STRATEGY_MOERAND_SIMPLE_INTERNAL_MAX_DAILY_TRADES, '2');
  assert.equal(config.vars.MOE_STRATEGY_MOERAND_SCALP_INTERNAL_MAX_DAILY_TRADES, '20');
  assert.equal(config.vars.MOE_MAX_PORTFOLIO_RISK_PERCENT, '0.5');
  assert.equal(config.vars.MOE_MAX_DAILY_LOSS_PERCENT, '0.5');
  assert.equal(config.vars.MOE_MAX_OPEN_RISK_PERCENT, '0.5');
  assert.equal(config.vars.MOE_MAX_OPEN_POSITIONS, '1');
  assert.equal(config.vars.MOE_SANDBOX_PILOT_MAX_SUBMISSIONS_TOTAL, '1');
  assert.match(portfolioRiskSource, /DAILY_LOSS_LIMIT_REACHED/);
  assert.match(portfolioRiskSource, /MAXIMUM_OPEN_POSITIONS_REACHED/);
  assert.match(portfolioRiskSource, /OPEN_RISK_LIMIT_EXCEEDED/);
});
