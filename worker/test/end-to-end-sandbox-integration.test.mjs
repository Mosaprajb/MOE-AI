import assert from 'node:assert/strict';
import test from 'node:test';
import { createFusionEngineV2 } from '../src/core/fusion-engine-v2.js';
import { createLiveScannerSnapshot } from '../src/dashboard/live-scanner.js';
import { createMarketSnapshot } from '../src/market-data/market-snapshot.js';
import { createOpportunityManager } from '../src/opportunity/opportunity-manager.js';
import {
  finalizeOrderReservation,
  listOrderReservations,
  releaseOrderReservation,
  reserveOrderSubmission,
} from '../src/order-reservation.js';
import { createAnalysisPipelineV2 } from '../src/scanner/analysis-pipeline-v2.js';
import { createScannerEngine } from '../src/scanner/scanner-engine.js';
import { executeSelectedSandboxOpportunity } from '../src/trading-control/opportunity-sandbox-control.js';
import { handleWebullSandboxOrder } from '../src/webull-sandbox.js';

const NOW = Date.now();
const REQUIRED_ENGINES = Object.freeze([
  'SMART_MONEY',
  'LIQUIDITY_SWEEP',
  'INSTITUTIONAL_FLOW',
  'PORTFOLIO_CONSTRAINTS',
]);

function bars(count = 30) {
  return Array.from({ length: count }, (_, index) => {
    const open = 118 + index * 0.07;
    const close = open + 0.18;
    return {
      timestamp: NOW - (count - 1 - index) * 300_000,
      open,
      high: close + 0.15,
      low: open - 0.12,
      close,
      volume: 2_000 + index * 150,
    };
  });
}

function marketSnapshot() {
  return createMarketSnapshot({
    symbol: 'NVDA',
    timeframe: '5m',
    bars: bars(),
    quote: {
      bid: 119.98,
      ask: 120.02,
      last: 120,
      volume: 500_000,
      timestamp: NOW,
    },
    dataTimestamp: NOW,
    session: 'CORE',
    profile: {
      float: 2_400_000_000,
      sector: 'Technology',
      industry: 'Semiconductors',
    },
    news: [],
    options: {
      callVolume: 50_000,
      putVolume: 20_000,
      gammaExposure: 2_000_000,
    },
  }, { now: NOW });
}

function opportunity(id, score, validForMs) {
  return {
    id,
    symbol: 'NVDA',
    direction: 'LONG',
    timeframe: '5m',
    score,
    confidence: { value: score, source: 'e2e-sandbox-fixture' },
    entry: 120,
    stopLoss: 118,
    takeProfit: 124,
    createdAt: new Date(NOW).toISOString(),
    validForMs,
    reasons: ['FULL_E2E_SANDBOX_CANDIDATE'],
    metadata: {
      setupFamily: 'BREAKOUT',
      session: 'CORE',
      sector: 'Technology',
      higherTimeframe: '15m',
      universePriority: 95,
      validForMs,
    },
    context: {
      accountEquity: 25_000,
      riskPercent: 0.5,
      relativeVolume: 2,
      atr: 1,
      spreadPercent: 0.05,
      driftPercent: 0.05,
      marketScore: 90,
      marketRegime: 'TREND',
      sector: 'Technology',
      sectorScore: 90,
      trendScore: 92,
      higherTimeframeScore: 92,
      momentumScore: 95,
      volatilityScore: 88,
      liquidityScore: 92,
      timingScore: 90,
      htfAligned: true,
      sessionAllowed: true,
      newsBlocked: false,
      duplicateSignal: false,
    },
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
    liveExecutionAllowed: false,
  };
}

function analyzer(name, selectedOpportunity = null, score = 97) {
  return async (snapshot) => ({
    available: true,
    score,
    confidence: 97,
    direction: 'LONG',
    dataQuality: 98,
    observedAt: new Date(NOW).toISOString(),
    completedAt: new Date(NOW).toISOString(),
    reasons: [`${name}_CONFIRMED`],
    opportunity: selectedOpportunity,
    snapshotIdentityPreserved: snapshot.symbol === 'NVDA',
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
  });
}

function safeEnv(overrides = {}) {
  return {
    WEBULL_ENVIRONMENT: 'sandbox',
    WEBULL_API_BASE_URL: 'https://api.sandbox.webull.test',
    WEBULL_APP_KEY: 'sandbox-app-key',
    WEBULL_APP_SECRET: 'sandbox-app-secret',
    WEBULL_ACCESS_TOKEN: 'sandbox-access-token',
    WEBULL_ACCOUNT_ID: 'sandbox-account',
    WEBULL_SANDBOX_ENABLED: 'true',
    WEBULL_SANDBOX_ORDER_SUBMISSION: 'true',
    WEBULL_AUTO_SUBMIT_SANDBOX: 'true',
    WEBULL_AUTOMATION_ARMED: 'true',
    WEBULL_PROTECTED_ORDERS: 'true',
    WEBULL_READ_ONLY_SYNC: 'false',
    WEBULL_MAX_QUANTITY: '1',
    WEBULL_MAX_NOTIONAL: '1000',
    MOE_WEBHOOK_SECRET: 'e2e-secret',
    MOE_TRADING_CONTROL_MIN_SCORE: '68',
    MOE_TRADING_CONTROL_MIN_CONFIDENCE: '68',
    MOE_TEST_ACCOUNT_EQUITY: '25000',
    MOE_RISK_PER_TRADE_PERCENT: '0.5',
    MOE_MIN_CONFIDENCE_SCORE: '68',
    MOE_MIN_RISK_REWARD: '2',
    MOE_MAX_SPREAD_PERCENT: '0.5',
    MOE_AI_MIN_SCORE_CORE: '68',
    MOE_AI_MIN_RISK_REWARD: '2',
    MOE_DECISION_ENGINE_ENFORCE: 'true',
    MOE_DECISION_MIN_CONFIDENCE: '68',
    MOE_MAX_OPEN_POSITIONS: '2',
    MOE_MAX_DAILY_TRADES: '4',
    MOE_MAX_PORTFOLIO_RISK_PERCENT: '1',
    MOE_MAX_CORRELATED_POSITIONS: '1',
    MOE_MAX_SECTOR_POSITIONS: '1',
    MOE_CAPITAL_POLICY_ENFORCED_SANDBOX: 'false',
    MOE_LIVE_EXECUTION_IMPLEMENTED: 'false',
    MOE_LIVE_MODE_UNLOCKED: 'false',
    WEBULL_LIVE_TRADING: 'false',
    WEBULL_LIVE_ORDER_SUBMISSION: 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: 'false',
    WEBULL_LIVE_KILL_SWITCH: 'true',
    ...overrides,
  };
}

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
  };
}

function coordinatorFor(liveScanner, env, storage = memoryStorage()) {
  return {
    storage,
    async getLiveControlState() {
      return {
        sandboxAutomationEnabled: true,
        effectiveLiveUnlocked: false,
        effectiveLiveAutomationArmed: false,
      };
    },
    async liveScannerSnapshot() { return liveScanner; },
    async reserveOrderSubmission(payload) {
      return reserveOrderSubmission(storage, { ...payload, now: Date.now() }, env);
    },
    async finalizeOrderReservation(id, patch) {
      return finalizeOrderReservation(storage, id, patch, env);
    },
    async releaseOrderReservation(id, reason) {
      return releaseOrderReservation(storage, id, reason);
    },
  };
}

async function buildEndToEndSystem({ validForMs = 15 * 60_000 } = {}) {
  const primary = opportunity('raw-smart-money-nvda', 97, validForMs);
  const duplicate = opportunity('raw-liquidity-nvda', 95, validForMs);
  const pipeline = createAnalysisPipelineV2({
    analyzers: {
      smartMoney: analyzer('SMART_MONEY', primary, 98),
      liquiditySweep: analyzer('LIQUIDITY_SWEEP', duplicate, 97),
      institutionalFlow: analyzer('INSTITUTIONAL_FLOW', null, 97),
      portfolioConstraints: analyzer('PORTFOLIO_CONSTRAINTS', null, 99),
    },
    minimumScore: 68,
    minimumCoverage: 1,
    longOnly: true,
    now: () => new Date(NOW),
  });
  const fusionEngine = createFusionEngineV2({
    requiredEngines: REQUIRED_ENGINES,
    minimumCoverage: 1,
    minimumAgreement: 80,
    maximumConflict: 10,
    minimumConfidence: 80,
    minimumDataQuality: 80,
    minimumScore: 80,
    longOnly: true,
    now: () => new Date(NOW),
  });
  const opportunityManager = createOpportunityManager({
    topN: 1,
    defaultTtlMs: validForMs,
    maxTtlMs: 60 * 60_000,
    minimumScore: 68,
    minimumConfidence: 68,
    now: () => new Date(NOW),
  });
  const scanner = createScannerEngine({
    marketData: { getSnapshot: async () => marketSnapshot() },
    pipeline,
    fusionEngine,
    opportunityManager,
    maxConcurrent: 1,
    resultLimit: 5,
  });
  const scan = await scanner.scan([{ symbol: 'NVDA', priority: 95 }], {
    now: NOW,
    opportunityLimit: 1,
  });
  const liveScanner = createLiveScannerSnapshot(scan.opportunitySelection, {
    now: NOW,
    topN: 1,
  });
  return { scan, liveScanner, opportunityManager };
}

async function withBrokerFetch(responder, callback) {
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init = {}) => {
    calls.push({ url: String(input), init });
    return responder(input, init, calls);
  };
  try {
    return await callback(calls);
  } finally {
    globalThis.fetch = originalFetch;
  }
}

function successfulBrokerResponse() {
  return Response.json({ ok: true, order_id: 'sandbox-order-1' }, { status: 200 });
}

test('full Sandbox path scans, analyzes, fuses, deduplicates, reserves, and submits one protected Webull order', async () => {
  const env = safeEnv();
  const { scan, liveScanner } = await buildEndToEndSystem();

  assert.equal(scan.scanned, 1);
  assert.equal(scan.accepted, 1);
  assert.equal(scan.candidates[0].schema, 'MOE.AnalysisPipelineResult');
  assert.equal(scan.candidates[0].fusion.schema, 'MOE.FusionResult');
  assert.equal(scan.candidates[0].fusion.accepted, true);
  assert.equal(scan.candidates[0].fusion.direction, 'LONG');
  assert.equal(scan.opportunitySelection.schema, 'MOE.OpportunityManagerResult');
  assert.equal(scan.opportunitySelection.summary.duplicatesRemoved, 1);
  assert.equal(scan.opportunitySelection.selected.length, 1);
  assert.equal(scan.opportunitySelection.selected[0].opportunity.id, 'raw-smart-money-nvda');
  assert.equal(liveScanner.schema, 'MOE.DashboardLiveScannerSnapshot');
  assert.equal(liveScanner.rows.length, 1);
  assert.equal(liveScanner.executionEnabled, false);

  const coordinator = coordinatorFor(liveScanner, env);
  await withBrokerFetch(
    async () => successfulBrokerResponse(),
    async (brokerCalls) => {
      const result = await executeSelectedSandboxOpportunity({
        selector: { opportunityId: liveScanner.rows[0].id },
        confirm: true,
        env,
        coordinator,
        submitter: handleWebullSandboxOrder,
        now: NOW,
      });

      assert.equal(result.schema, 'MOE.SelectedOpportunitySandboxControl');
      assert.equal(result.status, 'SUBMITTED');
      assert.equal(result.submitted, true);
      assert.equal(result.liveFundsUsed, false);
      assert.equal(result.protectedOrder, true);
      assert.equal(result.order.symbol, 'NVDA');
      assert.equal(result.order.side, 'BUY');
      assert.equal(result.sandbox.mode, 'SANDBOX_SUBMITTED');
      assert.ok(result.sandbox.decisionPipeline.includes('SANDBOX_SUBMISSION'));
      assert.equal(brokerCalls.length, 1);
      assert.equal(new URL(brokerCalls[0].url).host, 'api.sandbox.webull.test');
      assert.notEqual(new URL(brokerCalls[0].url).host, 'api.webull.com');

      const brokerBody = JSON.parse(String(brokerCalls[0].init.body));
      assert.equal(brokerBody.account_id, 'sandbox-account');
      assert.equal(brokerBody.new_orders.length, 3);
      assert.deepEqual(
        brokerBody.new_orders.map((order) => order.combo_type),
        ['MASTER', 'STOP_PROFIT', 'STOP_LOSS'],
      );
      assert.equal('submitLive' in brokerBody, false);

      const reservations = await listOrderReservations(coordinator.storage, { status: 'SUBMITTED' });
      assert.equal(reservations.length, 1);
      assert.equal(reservations[0].symbol, 'NVDA');
      assert.equal(reservations[0].runtimeMode, 'SANDBOX');
    },
  );
});

test('expired Opportunity Manager selections stop before reservation and broker submission', async () => {
  const env = safeEnv();
  const { liveScanner } = await buildEndToEndSystem({ validForMs: 1_000 });
  const coordinator = coordinatorFor(liveScanner, env);
  let submitterCalls = 0;

  const result = await executeSelectedSandboxOpportunity({
    selector: { opportunityId: liveScanner.rows[0].id },
    confirm: true,
    env,
    coordinator,
    submitter: async (...args) => {
      submitterCalls += 1;
      return handleWebullSandboxOrder(...args);
    },
    now: NOW + 1_001,
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'OPPORTUNITY_EXPIRED');
  assert.equal(result.executionAttempted, false);
  assert.equal(submitterCalls, 0);
  assert.equal((await listOrderReservations(coordinator.storage)).length, 0);
});

test('a submitted opportunity cannot create a duplicate concurrent Sandbox order', async () => {
  const env = safeEnv();
  const { liveScanner } = await buildEndToEndSystem();
  const coordinator = coordinatorFor(liveScanner, env);

  await withBrokerFetch(
    async () => successfulBrokerResponse(),
    async (brokerCalls) => {
      const first = await executeSelectedSandboxOpportunity({
        selector: { opportunityId: liveScanner.rows[0].id },
        confirm: true,
        env,
        coordinator,
        submitter: handleWebullSandboxOrder,
        now: NOW,
      });
      const duplicate = await executeSelectedSandboxOpportunity({
        selector: { opportunityId: liveScanner.rows[0].id },
        confirm: true,
        env,
        coordinator,
        submitter: handleWebullSandboxOrder,
        now: NOW,
      });

      assert.equal(first.status, 'SUBMITTED');
      assert.equal(duplicate.status, 'BLOCKED');
      assert.equal(duplicate.code, 'DUPLICATE_ORDER_BLOCKED');
      assert.equal(duplicate.duplicate, true);
      assert.equal(duplicate.executionAttempted, false);
      assert.equal(brokerCalls.length, 1);
      assert.equal((await listOrderReservations(coordinator.storage, { status: 'SUBMITTED' })).length, 1);
    },
  );
});

test('broker failure releases the reservation and permits a protected retry', async () => {
  const env = safeEnv();
  const { liveScanner } = await buildEndToEndSystem();
  const coordinator = coordinatorFor(liveScanner, env);

  await withBrokerFetch(
    async () => { throw new Error('sandbox broker unavailable'); },
    async () => {
      const failed = await executeSelectedSandboxOpportunity({
        selector: { opportunityId: liveScanner.rows[0].id },
        confirm: true,
        env,
        coordinator,
        submitter: handleWebullSandboxOrder,
        now: NOW,
      });

      assert.equal(failed.status, 'REJECTED');
      assert.equal(failed.submitted, false);
      assert.equal(failed.executionAttempted, true);
      assert.match(failed.sandbox.error, /sandbox broker unavailable/i);
      const released = await listOrderReservations(coordinator.storage, { status: 'RELEASED' });
      assert.equal(released.length, 1);
      assert.match(released[0].releaseReason, /sandbox broker unavailable/i);
    },
  );

  await withBrokerFetch(
    async () => successfulBrokerResponse(),
    async (brokerCalls) => {
      const retry = await executeSelectedSandboxOpportunity({
        selector: { opportunityId: liveScanner.rows[0].id },
        confirm: true,
        env,
        coordinator,
        submitter: handleWebullSandboxOrder,
        now: NOW,
      });
      assert.equal(retry.status, 'SUBMITTED');
      assert.equal(brokerCalls.length, 1);
      assert.equal((await listOrderReservations(coordinator.storage, { status: 'SUBMITTED' })).length, 1);
    },
  );
});

test('any Live switch blocks the complete path before reservation or broker access', async () => {
  const env = safeEnv({
    MOE_LIVE_MODE_UNLOCKED: 'true',
    WEBULL_LIVE_TRADING: 'true',
    WEBULL_LIVE_ORDER_SUBMISSION: 'true',
    WEBULL_LIVE_AUTOMATION_ARMED: 'true',
    WEBULL_LIVE_KILL_SWITCH: 'false',
  });
  const { liveScanner } = await buildEndToEndSystem();
  const coordinator = coordinatorFor(liveScanner, env);
  let submitterCalls = 0;

  const result = await executeSelectedSandboxOpportunity({
    selector: { opportunityId: liveScanner.rows[0].id },
    confirm: true,
    env,
    coordinator,
    submitter: async (...args) => {
      submitterCalls += 1;
      return handleWebullSandboxOrder(...args);
    },
    now: NOW,
  });

  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'SANDBOX_CONTROL_BLOCKED');
  assert.ok(result.blockers.includes('LIVE_MODE_MUST_REMAIN_LOCKED'));
  assert.ok(result.blockers.includes('LIVE_TRADING_MUST_REMAIN_DISABLED'));
  assert.ok(result.blockers.includes('LIVE_SUBMISSION_MUST_REMAIN_DISABLED'));
  assert.ok(result.blockers.includes('LIVE_AUTOMATION_MUST_REMAIN_DISARMED'));
  assert.ok(result.blockers.includes('LIVE_KILL_SWITCH_MUST_REMAIN_ACTIVE'));
  assert.equal(result.executionAttempted, false);
  assert.equal(result.liveFundsUsed, false);
  assert.equal(submitterCalls, 0);
  assert.equal((await listOrderReservations(coordinator.storage)).length, 0);
});
