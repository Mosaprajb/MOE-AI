import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  pendingStopProtectionOrderIds,
  prioritizeStopCancellationTransitions,
  stopProtectionOrderIdsForPhase,
} from '../src/lib/trade-protection-stop-verification.ts';

test('stop verification targets both OCO legs before initial protection is closed', () => {
  const ids = {
    takeProfitClientOrderId: 'tp-1',
    stopLossClientOrderId: 'sl-1',
    trailingStopClientOrderId: 'tr-1',
  };
  assert.deepEqual(stopProtectionOrderIdsForPhase('INITIAL_PROTECTION', ids), ['tp-1', 'sl-1']);
  assert.deepEqual(stopProtectionOrderIdsForPhase('CANCELLING_INITIAL_PROTECTION', ids), ['tp-1', 'sl-1']);
});

test('stop verification targets only the active trailing stop in trailing phase', () => {
  const ids = {
    takeProfitClientOrderId: 'tp-1',
    stopLossClientOrderId: 'sl-1',
    trailingStopClientOrderId: 'tr-1',
  };
  assert.deepEqual(stopProtectionOrderIdsForPhase('TRAILING', ids), ['tr-1']);
  assert.deepEqual(stopProtectionOrderIdsForPhase('WAITING_POSITION', ids), []);
});

test('a protection stop remains pending until every broker order is terminal', () => {
  const ids = ['tp-1', 'sl-1'];
  assert.deepEqual(pendingStopProtectionOrderIds(ids, {}), ids);
  assert.deepEqual(
    pendingStopProtectionOrderIds(ids, { 'tp-1': 'CANCELLED', 'sl-1': 'WORKING' }),
    ['sl-1'],
  );
  assert.deepEqual(
    pendingStopProtectionOrderIds(ids, { 'tp-1': 'FILLED', 'sl-1': 'FAILED' }),
    [],
  );
});

test('stop cancellation reconciliation is prioritized ahead of other transitions', () => {
  const trades = [
    { symbol: 'AAPL', phase: 'INITIAL_PROTECTION' },
    { symbol: 'MSFT', phase: 'CANCELLING_INITIAL_PROTECTION' },
    { symbol: 'TSLA', phase: 'CANCELLING_ALL_PROTECTION' },
  ];
  assert.deepEqual(
    prioritizeStopCancellationTransitions(trades).map(trade => trade.symbol),
    ['TSLA', 'MSFT', 'AAPL'],
  );
});

test('coordinator no longer closes broker-protected trades directly from stop()', () => {
  const source = fs.readFileSync(new URL('../src/lib/trade-protection-coordinator.ts', import.meta.url), 'utf8');
  const stopMethod = source.slice(
    source.indexOf('private async stop('),
    source.indexOf('private async reconcileStopCancellation('),
  );
  assert.match(stopMethod, /CANCELLING_ALL_PROTECTION/);
  assert.match(stopMethod, /stopOrderClientIds/);
  assert.match(stopMethod, /status: 202/);
});
