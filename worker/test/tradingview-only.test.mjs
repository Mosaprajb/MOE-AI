import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTradingViewAlert,
  normalizeTradingViewSettings,
  tradingViewSignalId,
} from '../src/tradingview-only-runtime.js';

test('TradingView settings accept fixed-dollar values and force spot long-only rules', () => {
  const settings = normalizeTradingViewSettings({
    accountType: 'DEMO',
    positionSizeDollars: 250,
    takeProfitDollars: 0.25,
    stopLossDollars: 0.10,
    maxDailyLossDollars: 50,
    maxOpenPositions: 3,
    trailingEnabled: true,
  });
  assert.equal(settings.configured, true);
  assert.equal(settings.positionSizeDollars, 250);
  assert.equal(settings.takeProfitDollars, 0.25);
  assert.equal(settings.stopLossDollars, 0.10);
  assert.equal(settings.maxDailyLossDollars, 50);
  assert.equal(settings.maxOpenPositions, 3);
  assert.equal(settings.spotOnly, true);
  assert.equal(settings.longOnly, true);
  assert.equal(settings.breakEvenTriggerDollars, 0.02);
  assert.equal(settings.trailRiseStepDollars, 0.05);
  assert.equal(settings.trailStopStepDollars, 0.01);
});

test('percentage, margin, leverage, short, and derivative fields are rejected', () => {
  for (const key of ['riskPercent', 'marginAmount', 'leverage', 'allowShort', 'derivativeMode']) {
    assert.throws(() => normalizeTradingViewSettings({
      accountType: 'DEMO',
      positionSizeDollars: 100,
      takeProfitDollars: 0.25,
      stopLossDollars: 0.10,
      maxDailyLossDollars: 25,
      maxOpenPositions: 1,
      [key]: 1,
    }), /forbidden/i);
  }
});

test('TradingView alert schema maps ticker and signal aliases without allowing shorts', () => {
  const buy = normalizeTradingViewAlert({
    ticker: 'aapl',
    signal: 'long',
    price: 190.15,
    indicator: 'MOERAND',
    timestamp: '2026-08-03T20:00:00Z',
  });
  assert.equal(buy.symbol, 'AAPL');
  assert.equal(buy.signal, 'BUY');
  assert.equal(buy.price, 190.15);
  const sell = normalizeTradingViewAlert({ symbol: 'MSFT', action: 'close', close: 420.12 });
  assert.equal(sell.signal, 'SELL');
  assert.throws(() => normalizeTradingViewAlert({ symbol: 'TSLA', signal: 'SHORT', price: 200 }), /BUY or SELL/);
});

test('signal fingerprint is deterministic and explicit alert ids win', async () => {
  const alert = normalizeTradingViewAlert({
    symbol: 'NVDA',
    signal: 'BUY',
    price: 125.34,
    indicator: 'UT BOT',
    timestamp: '2026-08-03T20:01:00Z',
  });
  assert.equal(await tradingViewSignalId(alert), await tradingViewSignalId(alert));
  assert.equal(await tradingViewSignalId({ ...alert, explicitId: 'tv-123' }), 'tv-123');
});
