import assert from 'node:assert/strict';
import test from 'node:test';
import { strategyAnalyticsFromTrades } from '../src/trade-history.js';
import { buildActivePositionIntelligence } from '../src/trading-intelligence/active-position.js';

test('byStrategy calculates expectancy, deepest cumulative-R drawdown, and ordered history', () => {
  const trades = [
    { status: 'CLOSED', source: 'FUSION_V2', realizedR: 1, exitTime: '2026-08-01T14:00:00Z' },
    { status: 'CLOSED', source: 'FUSION_V2', realizedR: -1, exitTime: '2026-08-01T15:00:00Z' },
    { status: 'CLOSED', source: 'FUSION_V2', realizedR: 2, exitTime: '2026-08-01T16:00:00Z' },
    { status: 'CLOSED', source: 'FUSION_V2', realizedR: -3, exitTime: '2026-08-01T17:00:00Z' },
    { status: 'CLOSED', source: 'MOERAND_CLEAN_INTERNAL', realizedR: 0.5, exitTime: '2026-08-01T18:00:00Z' },
    { status: 'OPEN', source: 'FUSION_V2', realizedR: 99, exitTime: '2026-08-01T19:00:00Z' },
  ];
  const result = strategyAnalyticsFromTrades(trades);
  assert.equal(result[0].source, 'MOERAND_CLEAN_INTERNAL');
  const fusion = result.find((item) => item.source === 'FUSION_V2');
  assert.deepEqual(fusion, {
    source: 'FUSION_V2',
    trades: 4,
    wins: 2,
    expectancy: -0.25,
    maxDrawdownR: 3,
    history: [1, -1, 2, -3],
    totalR: -1,
  });
});

test('active position adds targetPrice and breakevenLocked from entry risk', () => {
  const position = buildActivePositionIntelligence({
    trades: [{
      id: 'trade-1',
      status: 'OPEN',
      source: 'FUSION_V2',
      symbol: 'AAPL',
      direction: 'LONG',
      entryPrice: 100,
      stopLoss: 98,
      trailingStop: 100,
      currentPrice: 103,
      quantity: 5,
      entryTime: '2026-08-03T14:00:00Z',
    }],
    takeProfitR: 2.5,
    now: Date.parse('2026-08-03T14:10:00Z'),
  });
  assert.equal(position.targetPrice, 105);
  assert.equal(position.stopPrice, 100);
  assert.equal(position.breakevenLocked, true);
  assert.equal(position.holdingSeconds, 600);
  assert.equal(position.source, 'FUSION_V2');
});


test('strategy analytics derives realized R for short trade records', () => {
  const result = strategyAnalyticsFromTrades([
    {
      status: 'CLOSED',
      source: 'SHORT_TEST',
      direction: 'SHORT',
      entryPrice: 100,
      exitPrice: 98,
      initialStopPrice: 101,
      exitTime: '2026-08-01T14:05:00.000Z',
    },
  ]);

  assert.equal(result.length, 1);
  assert.equal(result[0].expectancy, 2);
  assert.deepEqual(result[0].history, [2]);
});
