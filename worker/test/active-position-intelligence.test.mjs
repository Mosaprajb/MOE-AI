import test from 'node:test';
import assert from 'node:assert/strict';
import { buildActivePositionIntelligence } from '../src/trading-intelligence/active-position.js';

function report(lifecycle) {
  return {
    mode: 'SANDBOX_READ_ONLY',
    generatedAt: '2026-07-26T16:00:00.000Z',
    lifecycles: [lifecycle],
  };
}

test('long position progress is normalized between stop and target', () => {
  const active = buildActivePositionIntelligence({
    now: Date.parse('2026-07-26T16:10:00.000Z'),
    trades: [{ id: 'T1', symbol: 'NVDA', direction: 'LONG', status: 'OPEN', entryTime: '2026-07-26T16:00:00.000Z', stopLoss: 170, takeProfit: 176, quantity: 10 }],
    lifecycleReport: report({
      tradeId: 'T1', symbol: 'NVDA', lifecycleStatus: 'FILLED_PROTECTED', protectionStatus: 'PROTECTED',
      position: { symbol: 'NVDA', quantity: 10, averagePrice: 172, lastPrice: 174, side: 'LONG' },
      averageFillPrice: 172, currentPrice: 174, anomalies: [], attentionRequired: false,
      orders: { entry: { status: 'FILLED' }, takeProfit: { status: 'WORKING', working: true, limitPrice: 176 }, stopLoss: { status: 'WORKING', working: true, stopPrice: 170 } },
    }),
  });
  assert.equal(active.available, true);
  assert.equal(active.direction, 'LONG');
  assert.equal(active.positionStatus, 'MANAGING');
  assert.equal(active.riskState, 'NORMAL');
  assert.equal(active.progress.progressToTargetPercent, 50);
  assert.equal(active.progress.rangeProgressPercent, 66.67);
  assert.equal(active.progress.entryMarkerPercent, 33.33);
  assert.equal(active.progress.rewardRisk, 2);
  assert.equal(active.timeInTradeSeconds, 600);
  assert.equal(active.executionAllowed, false);
});

test('short position calculations invert correctly', () => {
  const active = buildActivePositionIntelligence({
    trades: [{ id: 'T2', symbol: 'TSLA', direction: 'SHORT', status: 'OPEN', stopLoss: 205, takeProfit: 190 }],
    lifecycleReport: report({
      tradeId: 'T2', symbol: 'TSLA', lifecycleStatus: 'FILLED_PROTECTED', protectionStatus: 'PROTECTED',
      position: { symbol: 'TSLA', quantity: -5, averagePrice: 200, lastPrice: 195, side: 'SHORT' },
      averageFillPrice: 200, currentPrice: 195, anomalies: [], attentionRequired: false,
      orders: { entry: { status: 'FILLED' }, takeProfit: { status: 'WORKING', working: true, limitPrice: 190 }, stopLoss: { status: 'WORKING', working: true, stopPrice: 205 } },
    }),
  });
  assert.equal(active.direction, 'SHORT');
  assert.equal(active.progress.progressToTargetPercent, 50);
  assert.equal(active.progress.rangeProgressPercent, 66.67);
  assert.equal(active.progress.distanceToStopR, 2);
  assert.equal(active.progress.rewardRisk, 2);
});

test('position near stop produces danger state', () => {
  const active = buildActivePositionIntelligence({
    trades: [{ id: 'T3', symbol: 'AAPL', direction: 'LONG', status: 'OPEN', stopLoss: 100, takeProfit: 112 }],
    lifecycleReport: report({
      tradeId: 'T3', symbol: 'AAPL', lifecycleStatus: 'FILLED_PROTECTED', protectionStatus: 'PROTECTED',
      position: { symbol: 'AAPL', quantity: 1, averagePrice: 104, lastPrice: 101, side: 'LONG' },
      averageFillPrice: 104, currentPrice: 101, anomalies: [], attentionRequired: false,
      orders: { entry: { status: 'FILLED' }, takeProfit: { status: 'WORKING', working: true, limitPrice: 112 }, stopLoss: { status: 'WORKING', working: true, stopPrice: 100 } },
    }),
  });
  assert.equal(active.riskState, 'DANGER');
  assert.equal(active.progress.distanceToStopR, 0.25);
  assert.equal(active.attentionRequired, true);
});

test('missing prices never produce fake progress', () => {
  const active = buildActivePositionIntelligence({
    trades: [{ id: 'T4', symbol: 'AMD', direction: 'LONG', status: 'OPEN' }],
    lifecycleReport: report({ tradeId: 'T4', symbol: 'AMD', lifecycleStatus: 'AWAITING_BROKER_CONFIRMATION', protectionStatus: 'WAITING_FOR_ENTRY', orders: {}, anomalies: [] }),
  });
  assert.equal(active.available, true);
  assert.equal(active.progress.valid, false);
  assert.equal(active.progress.progressToTargetPercent, null);
  assert.ok(active.progress.missing.includes('STOP_PRICE_MISSING'));
  assert.equal(active.riskState, 'UNKNOWN');
});

test('no active trade returns an explicit empty state', () => {
  const active = buildActivePositionIntelligence({ trades: [], lifecycleReport: null });
  assert.equal(active.available, false);
  assert.equal(active.positionStatus, 'NO_ACTIVE_POSITION');
  assert.equal(active.executionAllowed, false);
  assert.equal(active.liveExecutionAllowed, false);
});
