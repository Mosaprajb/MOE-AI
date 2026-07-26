import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const {
  finalizeOrderReservation,
  listOrderReservations,
  releaseOrderReservation,
  reserveOrderSubmission,
} = await import('../src/order-reservation.js');

class MemoryStorage {
  constructor(seed = {}) {
    this.values = new Map(Object.entries(seed));
  }

  async get(key) {
    return structuredClone(this.values.get(key));
  }

  async put(keyOrEntries, value) {
    if (typeof keyOrEntries === 'object' && keyOrEntries !== null && value === undefined) {
      for (const [key, item] of Object.entries(keyOrEntries)) this.values.set(key, structuredClone(item));
      return;
    }
    this.values.set(keyOrEntries, structuredClone(value));
  }
}

const testNow = Date.now();
const baseSignal = {
  signalId: 'signal-1',
  accountId: 'sandbox-account-a',
  symbol: 'AAPL',
  side: 'BUY',
  runtimeMode: 'SANDBOX',
  requestedCapitalMode: 'CASH',
  source: 'MOERAND_AUTO_TEST',
  now: testNow,
};

const env = {
  MOE_ORDER_RESERVATION_SECONDS: '180',
  MOE_SUBMITTED_RESERVATION_HOURS: '72',
};

test('blocks a repeated signal before broker submission', async () => {
  const storage = new MemoryStorage();
  const first = await reserveOrderSubmission(storage, baseSignal, env);
  const second = await reserveOrderSubmission(storage, baseSignal, env);

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.idempotentRetry, true);
  assert.equal(second.blocker, 'SIGNAL_ALREADY_RESERVED');
});

test('blocks a concurrent signal for the same account, symbol, and direction', async () => {
  const storage = new MemoryStorage();
  const first = await reserveOrderSubmission(storage, baseSignal, env);
  const second = await reserveOrderSubmission(storage, { ...baseSignal, signalId: 'signal-2' }, env);

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, false);
  assert.equal(second.blocker, 'SYMBOL_DIRECTION_ALREADY_RESERVED');
});

test('allows the same symbol on a separate broker account scope', async () => {
  const storage = new MemoryStorage();
  const first = await reserveOrderSubmission(storage, baseSignal, env);
  const second = await reserveOrderSubmission(storage, {
    ...baseSignal,
    signalId: 'signal-2',
    accountId: 'sandbox-account-b',
  }, env);

  assert.equal(first.accepted, true);
  assert.equal(second.accepted, true);
  assert.notEqual(first.reservation.accountScope, second.reservation.accountScope);
});

test('allows the opposite direction to use an independent reservation', async () => {
  const storage = new MemoryStorage();
  const buy = await reserveOrderSubmission(storage, baseSignal, env);
  const sell = await reserveOrderSubmission(storage, {
    ...baseSignal,
    signalId: 'signal-sell',
    side: 'SELL',
  }, env);

  assert.equal(buy.accepted, true);
  assert.equal(sell.accepted, true);
});

test('releases a failed pipeline reservation so a later retry may proceed', async () => {
  const storage = new MemoryStorage();
  const first = await reserveOrderSubmission(storage, baseSignal, env);
  const released = await releaseOrderReservation(storage, first.reservation.id, 'ORDER_REJECTED');
  const retry = await reserveOrderSubmission(storage, { ...baseSignal, signalId: 'signal-retry', now: Date.now() }, env);

  assert.equal(released.updated, true);
  assert.equal(released.reservation.status, 'RELEASED');
  assert.equal(retry.accepted, true);
});

test('finalizes a submitted reservation with capital source and trade linkage', async () => {
  const storage = new MemoryStorage();
  const first = await reserveOrderSubmission(storage, baseSignal, env);
  const finalized = await finalizeOrderReservation(storage, first.reservation.id, {
    capitalSource: 'CASH',
    tradeId: 'trade-123',
    brokerOrderIds: { entry: 'entry-1', takeProfit: 'tp-1', stopLoss: 'sl-1' },
  }, env);
  const reservations = await listOrderReservations(storage, { status: 'SUBMITTED' });

  assert.equal(finalized.updated, true);
  assert.equal(finalized.reservation.status, 'SUBMITTED');
  assert.equal(finalized.reservation.capitalSource, 'CASH');
  assert.equal(finalized.reservation.tradeId, 'trade-123');
  assert.equal(reservations.length, 1);
});

test('blocks an existing open trade with the same symbol, direction, and capital source', async () => {
  const storage = new MemoryStorage({
    'trade-history:v1': [{
      id: 'trade-open',
      signalId: 'old-signal',
      symbol: 'AAPL',
      direction: 'BUY',
      capitalSource: 'CASH',
      lifecycleStatus: 'FILLED_PROTECTED',
      status: 'OPEN',
    }],
  });

  const result = await reserveOrderSubmission(storage, baseSignal, env);
  assert.equal(result.accepted, false);
  assert.equal(result.blocker, 'OPEN_TRADE_EXISTS');
  assert.equal(result.existingTrade.tradeId, 'trade-open');
});
