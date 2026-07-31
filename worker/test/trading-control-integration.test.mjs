import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  executeSelectedSandboxOpportunity,
  findSelectedOpportunity,
} from '../src/trading-control/opportunity-sandbox-control.js';

const NOW = Date.parse('2026-07-30T20:00:00.000Z');

function selectedRecord(overrides = {}) {
  const opportunity = {
    id: 'opp-nvda-5m',
    symbol: 'NVDA',
    direction: 'LONG',
    timeframe: '5m',
    score: 91,
    confidence: { value: 88 },
    createdAt: new Date(NOW - 60_000).toISOString(),
    entry: 120,
    stopLoss: 118,
    takeProfit: 124,
    metadata: { setupFamily: 'BREAKOUT', grade: 'AA', session: 'CORE' },
    ...(overrides.opportunity || {}),
  };
  return {
    id: 'managed-nvda',
    dedupeKey: 'NVDA|LONG|5m|BREAKOUT',
    status: 'ACTIVE',
    selected: true,
    rank: 1,
    symbol: 'NVDA',
    direction: 'LONG',
    timeframe: '5m',
    grade: 'AA',
    score: 91,
    confidence: 88,
    expiresAt: new Date(NOW + 10 * 60_000).toISOString(),
    opportunity,
    ...overrides,
  };
}

function snapshot(record = selectedRecord()) {
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
    observationOnly: true,
    executionEnabled: false,
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

function fakeCoordinator(record = selectedRecord(), reservation = { accepted: true, reservation: { id: 'reserve-1' } }) {
  const calls = { reserve: [], finalize: [], release: [] };
  return {
    calls,
    async getLiveControlState() {
      return {
        sandboxAutomationEnabled: true,
        effectiveLiveUnlocked: false,
        effectiveLiveAutomationArmed: false,
      };
    },
    async liveScannerSnapshot() { return snapshot(record); },
    async reserveOrderSubmission(payload) { calls.reserve.push(payload); return reservation; },
    async finalizeOrderReservation(id, patch) { calls.finalize.push({ id, patch }); return { updated: true, reservation: { id, status: 'SUBMITTED' } }; },
    async releaseOrderReservation(id, reason) { calls.release.push({ id, reason }); return { updated: true, reservation: { id, status: 'RELEASED' } }; },
  };
}

function submittedResponse() {
  return Response.json({
    ok: true,
    accepted: true,
    submitted: true,
    mode: 'SANDBOX_SUBMITTED',
    tradeId: 'trade-1',
    capitalPolicy: { capitalSource: 'CASH' },
    submission: { clientOrderIds: ['entry-1', 'stop-1', 'target-1'] },
  }, { status: 201 });
}

test('only a currently visible Opportunity Manager selection can enter trading control', () => {
  const record = selectedRecord();
  const found = findSelectedOpportunity(snapshot(record), { opportunityId: record.id }, NOW);
  assert.equal(found.ok, true);
  assert.equal(found.record.selected, true);
  assert.equal(found.record.symbol, 'NVDA');
  assert.equal(findSelectedOpportunity(snapshot(record), { opportunityId: 'not-selected' }, NOW).code, 'OPPORTUNITY_NOT_SELECTED');
});

test('preview builds a protected long-only order without reserving or submitting', async () => {
  const coordinator = fakeCoordinator();
  let submissions = 0;
  const result = await executeSelectedSandboxOpportunity({
    selector: { opportunityId: 'managed-nvda' },
    confirm: false,
    env: safeEnv(),
    coordinator,
    submitter: async () => { submissions += 1; return submittedResponse(); },
    now: NOW,
  });
  assert.equal(result.status, 'PREVIEW');
  assert.equal(result.confirmationRequired, true);
  assert.equal(result.executionAttempted, false);
  assert.equal(result.order.side, 'BUY');
  assert.equal(result.order.stopLoss, 118);
  assert.equal(result.order.takeProfit, 124);
  assert.equal(submissions, 0);
  assert.equal(coordinator.calls.reserve.length, 0);
});

test('confirmed selected opportunity reserves, submits through the protected Sandbox pipeline, and finalizes', async () => {
  const coordinator = fakeCoordinator();
  let submittedPayload;
  const result = await executeSelectedSandboxOpportunity({
    selector: { dedupeKey: 'NVDA|LONG|5m|BREAKOUT' },
    confirm: true,
    env: safeEnv(),
    coordinator,
    submitter: async (request) => {
      assert.equal(request.headers.get('x-moe-webhook-secret'), 'test-secret');
      submittedPayload = await request.json();
      return submittedResponse();
    },
    now: NOW,
  });
  assert.equal(result.status, 'SUBMITTED');
  assert.equal(result.submitted, true);
  assert.equal(result.liveFundsUsed, false);
  assert.equal(result.protectedOrder, true);
  assert.equal(submittedPayload.submitSandbox, true);
  assert.equal(submittedPayload.submitLive, false);
  assert.equal(submittedPayload.source, 'MOERAND_AUTO_OPPORTUNITY');
  assert.equal(submittedPayload.context.protectedOpportunitySelection, true);
  assert.equal(coordinator.calls.reserve.length, 1);
  assert.equal(coordinator.calls.finalize.length, 1);
  assert.equal(coordinator.calls.release.length, 0);
});

test('expired, inactive, and missing selections fail closed before reservation', async () => {
  const expired = selectedRecord({ expiresAt: new Date(NOW - 1).toISOString() });
  const coordinator = fakeCoordinator(expired);
  const result = await executeSelectedSandboxOpportunity({
    selector: { opportunityId: expired.id },
    confirm: true,
    env: safeEnv(),
    coordinator,
    submitter: async () => submittedResponse(),
    now: NOW,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'OPPORTUNITY_EXPIRED');
  assert.equal(result.executionAttempted, false);
  assert.equal(coordinator.calls.reserve.length, 0);
});

test('short, weak, or unprotected selected opportunities cannot produce an order', async () => {
  const short = selectedRecord({ direction: 'SHORT', opportunity: { direction: 'SHORT' } });
  const result = await executeSelectedSandboxOpportunity({
    selector: { opportunityId: short.id },
    confirm: true,
    env: safeEnv(),
    coordinator: fakeCoordinator(short),
    submitter: async () => submittedResponse(),
    now: NOW,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'OPPORTUNITY_ORDER_INVALID');
  assert.match(result.error, /short entries/i);
});

test('any live activation or disabled Sandbox gate blocks the integration', async () => {
  const coordinator = fakeCoordinator();
  const result = await executeSelectedSandboxOpportunity({
    selector: { opportunityId: 'managed-nvda' },
    confirm: true,
    env: safeEnv({ WEBULL_LIVE_TRADING: 'true', WEBULL_LIVE_KILL_SWITCH: 'false' }),
    coordinator,
    submitter: async () => submittedResponse(),
    now: NOW,
  });
  assert.equal(result.status, 'BLOCKED');
  assert.equal(result.code, 'SANDBOX_CONTROL_BLOCKED');
  assert.ok(result.blockers.includes('LIVE_TRADING_MUST_REMAIN_DISABLED'));
  assert.ok(result.blockers.includes('LIVE_KILL_SWITCH_MUST_REMAIN_ACTIVE'));
  assert.equal(coordinator.calls.reserve.length, 0);
});

test('duplicate reservations block broker submission and rejected submissions release reservations', async () => {
  const duplicateCoordinator = fakeCoordinator(selectedRecord(), { accepted: false, blocker: 'SIGNAL_ALREADY_RESERVED' });
  let duplicateSubmissions = 0;
  const duplicate = await executeSelectedSandboxOpportunity({
    selector: { opportunityId: 'managed-nvda' },
    confirm: true,
    env: safeEnv(),
    coordinator: duplicateCoordinator,
    submitter: async () => { duplicateSubmissions += 1; return submittedResponse(); },
    now: NOW,
  });
  assert.equal(duplicate.code, 'DUPLICATE_ORDER_BLOCKED');
  assert.equal(duplicateSubmissions, 0);

  const rejectedCoordinator = fakeCoordinator();
  const rejected = await executeSelectedSandboxOpportunity({
    selector: { opportunityId: 'managed-nvda' },
    confirm: true,
    env: safeEnv(),
    coordinator: rejectedCoordinator,
    submitter: async () => Response.json({ ok: false, accepted: false, submitted: false, message: 'Risk blocked' }, { status: 422 }),
    now: NOW,
  });
  assert.equal(rejected.status, 'REJECTED');
  assert.equal(rejectedCoordinator.calls.finalize.length, 0);
  assert.equal(rejectedCoordinator.calls.release.length, 1);
});

test('production entry requires authentication and routes Sandbox execution through selected opportunities', () => {
  const directory = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(join(directory, '..', 'src', 'trading-mode-control-v2-entry.js'), 'utf8');
  assert.match(source, /executeSelectedSandboxOpportunity/);
  assert.match(source, /OPPORTUNITY_MANAGER_SELECTED_ONLY/);
  assert.match(source, /if \(!authorized\(request, env\)\)/);
  assert.match(source, /submitter:\s*handleWebullSandboxOrder/);
  assert.doesNotMatch(source, /placeWebullSandboxOrder\(/);
  assert.match(source, /WEBULL_LIVE_KILL_SWITCH/);
});
