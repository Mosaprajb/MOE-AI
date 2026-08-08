import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  liquidationOrderOutcome,
  prioritizeLiquidationTransitions,
} from '../src/lib/trade-protection-liquidation-verification.ts';
import {
  prioritizeStopCancellationTransitions,
} from '../src/lib/trade-protection-stop-verification.ts';

function detail(status, filledQuantity = 0, totalQuantity = 1) {
  return {
    clientOrderId: 'close-1',
    orderId: 'order-1',
    symbol: 'AAPL',
    status,
    filledQuantity,
    totalQuantity,
  };
}

test('liquidation closes only when the broker position is absent', () => {
  assert.equal(
    liquidationOrderOutcome(false),
    'POSITION_CLOSED',
  );
});

test('a filled exit waits for position disappearance before CLOSED', () => {
  assert.equal(
    liquidationOrderOutcome(true, detail('FILLED', 1, 1)),
    'FILLED_WAITING_POSITION',
  );

  assert.equal(
    liquidationOrderOutcome(true, detail('CANCELLED', 1, 1)),
    'FILLED_WAITING_POSITION',
  );
});

test('working liquidation order remains pending', () => {
  assert.equal(
    liquidationOrderOutcome(true, detail('WORKING', 0, 1)),
    'PENDING',
  );
});

test('terminal non-filled liquidation order permits controlled retry', () => {
  assert.equal(
    liquidationOrderOutcome(true, detail('CANCELLED', 0, 1)),
    'RETRY',
  );

  assert.equal(
    liquidationOrderOutcome(true, detail('FAILED', 0, 1)),
    'RETRY',
  );
});

test('liquidating positions are reconciled before other phases', () => {
  const trades = [
    { symbol: 'AAPL', phase: 'INITIAL_PROTECTION' },
    { symbol: 'MSFT', phase: 'CANCELLING_ALL_PROTECTION' },
    { symbol: 'TSLA', phase: 'LIQUIDATING_POSITION' },
  ];

  const stopPrioritized =
    prioritizeStopCancellationTransitions(trades);

  assert.deepEqual(
    prioritizeLiquidationTransitions(stopPrioritized)
      .map(trade => trade.symbol),
    ['TSLA', 'MSFT', 'AAPL'],
  );
});

test('new liquidation submission is never immediately marked CLOSED', () => {
  const source = fs.readFileSync(
    new URL('../src/lib/trade-protection-coordinator.ts', import.meta.url),
    'utf8',
  );

  assert.match(source, /LIQUIDATING_POSITION/);
  assert.match(source, /liquidationSubmissionConfirmed/);
  assert.match(source, /reconcileLiquidation/);

  const emergencyExit = source.slice(
    source.indexOf('if (refreshedPrice <= refreshedDesired.price)'),
    source.indexOf('const trailing = await client.placeProtectiveStop'),
  );

  assert.match(emergencyExit, /LIQUIDATING_POSITION/);
  assert.match(emergencyExit, /persistTradeSnapshot/);
  assert.match(emergencyExit, /submitLiquidationOrder/);
  assert.doesNotMatch(emergencyExit, /trade\.phase = 'CLOSED'/);
});

test('uncertain liquidation checks Order Detail before resubmission', () => {
  const source = fs.readFileSync(
    new URL('../src/lib/trade-protection-coordinator.ts', import.meta.url),
    'utf8',
  );

  const start =
    source.indexOf('private async reconcileLiquidation(');

  const end =
    source.indexOf('private async reconcileTrade(', start);

  assert.ok(start >= 0);
  assert.ok(end > start);

  const reconcile = source.slice(start, end);

  const detailLookup =
    reconcile.indexOf(
      'const rows = await getWebullOrderDetail',
    );

  const uncertainBranch =
    reconcile.indexOf(
      'if (!trade.liquidationSubmissionConfirmed && !detail)',
    );

  const retrySubmission =
    reconcile.indexOf(
      'await this.submitLiquidationOrder(',
      uncertainBranch,
    );

  assert.ok(detailLookup >= 0);
  assert.ok(uncertainBranch > detailLookup);
  assert.ok(retrySubmission > uncertainBranch);

  assert.match(
    reconcile,
    /SUBMISSION_NOT_OBSERVED/,
  );

  assert.doesNotMatch(
    reconcile,
    /if \(!trade\.liquidationSubmissionConfirmed\) \{\s*await this\.submitLiquidationOrder/,
  );
});
