import test from 'node:test';
import assert from 'node:assert/strict';
import {
  claimOcoCancellationTransition,
  createOcoCancellationCycleGuard,
  prioritizeOcoCancellationTransitions,
} from '../src/lib/trade-protection-transition-guard.ts';

test('only one new OCO cancellation transition may start in an alarm cycle', () => {
  const guard = createOcoCancellationCycleGuard([
    'INITIAL_PROTECTION',
    'INITIAL_PROTECTION',
  ]);

  assert.equal(claimOcoCancellationTransition(guard), true);
  assert.equal(claimOcoCancellationTransition(guard), false);
});

test('no new OCO cancellation starts while one existed at cycle start', () => {
  const guard = createOcoCancellationCycleGuard([
    'INITIAL_PROTECTION',
    'CANCELLING_INITIAL_PROTECTION',
    'INITIAL_PROTECTION',
  ]);

  assert.equal(claimOcoCancellationTransition(guard), false);
  assert.equal(claimOcoCancellationTransition(guard), false);
});

test('existing OCO cancellations are reconciled before untouched protected trades', () => {
  const trades = [
    { symbol: 'AAPL', phase: 'INITIAL_PROTECTION' },
    { symbol: 'MSFT', phase: 'CANCELLING_INITIAL_PROTECTION' },
    { symbol: 'NVDA', phase: 'TRAILING' },
    { symbol: 'TSLA', phase: 'CANCELLING_INITIAL_PROTECTION' },
  ];

  const ordered = prioritizeOcoCancellationTransitions(trades);
  assert.deepEqual(
    ordered.map(trade => trade.symbol),
    ['MSFT', 'TSLA', 'AAPL', 'NVDA'],
  );
  assert.deepEqual(trades.map(trade => trade.symbol), ['AAPL', 'MSFT', 'NVDA', 'TSLA']);
});
