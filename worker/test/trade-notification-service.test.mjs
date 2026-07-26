import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isConfirmedEntry,
  isConfirmedExit,
  modeFromTrade,
} from '../src/trade-notification-service.js';

test('unfilled opportunity or submitted order is not a confirmed entry', () => {
  assert.equal(isConfirmedEntry({
    id: 'trade_pending',
    symbol: 'AAPL',
    status: 'OPEN',
    entryPrice: 214.5,
    lifecycleStatus: 'SUBMITTED',
    brokerEntryStatus: 'NEW',
    filledQuantity: 0,
    brokerPositionSeen: false,
  }), false);
});

test('filled or broker-visible position is a confirmed entry', () => {
  assert.equal(isConfirmedEntry({
    id: 'trade_filled',
    symbol: 'AAPL',
    status: 'OPEN',
    entryPrice: 214.5,
    lifecycleStatus: 'POSITION_OPEN',
    brokerEntryStatus: 'FILLED',
    filledQuantity: 1,
    brokerPositionSeen: true,
  }), true);
});

test('exit requires a closed trade and valid execution price', () => {
  assert.equal(isConfirmedExit({ status: 'OPEN', exitPrice: 218.2 }), false);
  assert.equal(isConfirmedExit({ status: 'CLOSED', exitPrice: null }), false);
  assert.equal(isConfirmedExit({ status: 'CLOSED', exitPrice: 218.2 }), true);
});

test('trade account context separates demo and live notifications', () => {
  assert.equal(modeFromTrade({ environment: 'production' }), 'live');
  assert.equal(modeFromTrade({ capitalSource: 'WEBULL_PRODUCTION' }), 'live');
  assert.equal(modeFromTrade({ environment: 'sandbox' }), 'demo');
  assert.equal(modeFromTrade({ capitalSource: 'WEBULL_SANDBOX' }), 'demo');
});
