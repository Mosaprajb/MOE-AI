import assert from 'node:assert/strict';
import test from 'node:test';
import { extractAccountSummary } from '../src/tradingview-only-broker.js';
import { tradingViewPnlControlPatch } from '../src/tradingview-only-pnl-control-patch.js';

test('broker account summary uses broker day P&L when no positions are open', () => {
  const summary = extractAccountSummary({
    balance: {
      total_net_liquidation_value: '1000191.53',
      total_day_profit_loss: '191.53',
      total_unrealized_profit_loss: '0',
      buying_power: '4000766.12',
    },
    positions: [],
    fetchedAt: '2026-08-04T20:00:00.000Z',
  }, 'DEMO');

  assert.equal(summary.balance, 1000191.53);
  assert.equal(summary.buyingPower, 4000766.12);
  assert.equal(summary.openPositions, 0);
  assert.equal(summary.totalPnl, 191.53);
  assert.equal(summary.dayPnl, 191.53);
  assert.equal(summary.realizedPnl, 191.53);
  assert.equal(summary.unrealizedPnl, 0);
  assert.equal(summary.pnlSource, 'BROKER_DAY_PNL');
  assert.equal(summary.pnlReliable, true);
});

test('broker account summary separates realized and unrealized day P&L', () => {
  const summary = extractAccountSummary({
    balance: {
      total_net_liquidation_value: '1000200.00',
      total_day_profit_loss: '200.00',
      total_unrealized_profit_loss: '8.47',
      buying_power: '4000000.00',
    },
    positions: [{
      symbol: 'PATH',
      quantity: '1',
      unrealized_profit_loss: '8.47',
    }],
  }, 'DEMO');

  assert.equal(summary.totalPnl, 200);
  assert.equal(summary.realizedPnl, 191.53);
  assert.equal(summary.unrealizedPnl, 8.47);
  assert.equal(summary.positionUnrealizedPnl, 8.47);
});

test('mobile patch includes interactive P&L and reliability controls', () => {
  const patch = tradingViewPnlControlPatch();
  assert.match(patch, /moe-pnl-control-style-v1/);
  assert.match(patch, /moe-pnl-control-script-v1/);
  assert.match(patch, /Broker day P&L is the source of truth/);
  assert.match(patch, /Realized P\/L/);
  assert.match(patch, /Unrealized P\/L/);
  assert.match(patch, /P&L by symbol/);
  assert.match(patch, /Trading scorecard/);
  assert.match(patch, /System reliability controls/);
  assert.match(patch, /Refresh broker \+ positions/);
  assert.match(patch, /Reconcile all protection/);
  assert.match(patch, /Today P\/L/);
  const scripts = [...patch.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach((script) => assert.doesNotThrow(() => new Function(script)));
});
