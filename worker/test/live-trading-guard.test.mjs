import assert from 'node:assert/strict';
import { evaluateLiveTradingGuard, LIVE_TRADING_GUARD_VERSION } from '../src/live-trading-guard.js';

const approved = {
  brain: { accepted: true },
  decision: { accepted: true },
  portfolio: { accepted: true },
  consensus: { accepted: true },
  capitalPolicy: { accepted: true },
  accountSafety: { accepted: true },
};

const env = {
  WEBULL_ENVIRONMENT: 'production',
  WEBULL_LIVE_TRADING: 'true',
  WEBULL_LIVE_ORDER_SUBMISSION: 'true',
  WEBULL_LIVE_AUTOMATION_ARMED: 'true',
  WEBULL_LIVE_KILL_SWITCH: 'false',
  WEBULL_LIVE_CONFIRMATION: 'MOE_LIVE_TRADING_CONFIRMED',
  WEBULL_LIVE_MAX_QUANTITY: '5',
  WEBULL_LIVE_MAX_NOTIONAL: '1000',
  WEBULL_LIVE_MAX_DAILY_LOSS: '100',
  WEBULL_LIVE_MAX_OPEN_POSITIONS: '3',
};

const safeOrder = {
  symbol: 'AAPL',
  side: 'BUY',
  quantity: 2,
  limitPrice: 200,
  stopLoss: 195,
  takeProfit: 215,
};

assert.equal(LIVE_TRADING_GUARD_VERSION, '1.0.0');

{
  const result = evaluateLiveTradingGuard({
    ...approved,
    order: safeOrder,
    accountSnapshot: { dailyPnl: 25, openPositions: [] },
  }, env);
  assert.equal(result.accepted, true);
  assert.equal(result.state, 'ARMED');
  assert.deepEqual(result.blockers, []);
}

{
  const result = evaluateLiveTradingGuard({
    ...approved,
    order: safeOrder,
    accountSnapshot: { dailyPnl: 25, openPositions: [] },
  }, { ...env, WEBULL_LIVE_KILL_SWITCH: 'true' });
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.includes('Live trading kill switch is active'));
}

{
  const result = evaluateLiveTradingGuard({
    ...approved,
    consensus: { accepted: false },
    order: safeOrder,
    accountSnapshot: { dailyPnl: 25, openPositions: [] },
  }, env);
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.includes('Institutional Consensus did not approve the trade'));
}

{
  const result = evaluateLiveTradingGuard({
    ...approved,
    order: { ...safeOrder, quantity: 6 },
    accountSnapshot: { dailyPnl: 25, openPositions: [] },
  }, env);
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.some((reason) => reason.includes('quantity exceeds live maximum')));
}

{
  const result = evaluateLiveTradingGuard({
    ...approved,
    order: safeOrder,
    accountSnapshot: { dailyPnl: -100, openPositions: [] },
  }, env);
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.some((reason) => reason.includes('Daily loss limit')));
}

{
  const result = evaluateLiveTradingGuard({
    ...approved,
    order: safeOrder,
    accountSnapshot: { dailyPnl: 0, openPositions: [{}, {}, {}] },
  }, env);
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.some((reason) => reason.includes('Maximum open positions')));
}

{
  const result = evaluateLiveTradingGuard({
    ...approved,
    order: { ...safeOrder, stopLoss: 205 },
    accountSnapshot: { dailyPnl: 0, openPositions: [] },
  }, env);
  assert.equal(result.accepted, false);
  assert.ok(result.blockers.includes('Stop loss must be below the entry price'));
}

console.log('live-trading-guard tests passed');
