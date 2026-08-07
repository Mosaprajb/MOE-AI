import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentTradingWindow,
  getTradingSettings,
  isCurrentTradingWindowAllowed,
  isTradingSettingsConfigured,
  protectionPreview,
  sanitizeTradingSettings,
  saveTradingSettings,
  trailingStopForPrice,
} from '../src/routes/trading-settings.ts';

class FakeKV {
  constructor() {
    this.values = new Map();
  }

  async get(key, type) {
    const value = this.values.get(key);
    if (value == null) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }

  async put(key, value) {
    this.values.set(key, value);
  }
}

test('Paper and Live trading settings persist independently', async () => {
  const env = { CONFIG: new FakeKV() };
  await saveTradingSettings(env, 'SANDBOX', {
    allowedSessions: ['CORE', 'EXTENDED'],
    timeInForce: 'GTC',
    shareQuantity: 12,
    maxTradeAmountUsd: 2500,
    stopLossPct: 1.25,
    takeProfitPct: 4.5,
    trailingTriggerCents: 7,
    trailingInitialStopProfitCents: 3,
    trailingTriggerStepCents: 6,
    trailingStopStepCents: 2,
  });
  await saveTradingSettings(env, 'LIVE', {
    allowedSessions: ['CORE'],
    timeInForce: 'DAY',
    shareQuantity: 3,
    maxTradeAmountUsd: 500,
    stopLossPct: 2.5,
    takeProfitPct: 6,
    trailingTriggerCents: 10,
    trailingInitialStopProfitCents: 4,
    trailingTriggerStepCents: 8,
    trailingStopStepCents: 1,
  });

  const paper = await getTradingSettings(env, 'SANDBOX');
  const live = await getTradingSettings(env, 'LIVE');
  assert.deepEqual(paper.allowedSessions, ['CORE', 'EXTENDED']);
  assert.equal(paper.timeInForce, 'GTC');
  assert.equal(paper.shareQuantity, 12);
  assert.equal(paper.maxTradeAmountUsd, 2500);
  assert.equal(paper.stopLossPct, 1.25);
  assert.equal(paper.takeProfitPct, 4.5);
  assert.equal(paper.trailingTriggerCents, 7);
  assert.equal(paper.trailingInitialStopProfitCents, 3);
  assert.equal(paper.trailingTriggerStepCents, 6);
  assert.equal(paper.trailingStopStepCents, 2);

  assert.deepEqual(live.allowedSessions, ['CORE']);
  assert.equal(live.timeInForce, 'DAY');
  assert.equal(live.shareQuantity, 3);
  assert.equal(live.maxTradeAmountUsd, 500);
  assert.equal(live.stopLossPct, 2.5);
  assert.equal(live.takeProfitPct, 6);
  assert.equal(live.trailingTriggerCents, 10);
  assert.equal(live.trailingInitialStopProfitCents, 4);
  assert.equal(live.trailingTriggerStepCents, 8);
  assert.equal(live.trailingStopStepCents, 1);
});

test('default trailing ladder matches the requested five-two-five-one behavior', () => {
  const settings = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 10,
    maxTradeAmountUsd: 1000,
  });

  assert.equal(trailingStopForPrice(settings, 10, 10.04).price, null);
  assert.equal(trailingStopForPrice(settings, 10, 10.05).price, 10.02);
  assert.equal(trailingStopForPrice(settings, 10, 10.09).price, 10.02);
  assert.equal(trailingStopForPrice(settings, 10, 10.10).price, 10.03);
  assert.equal(trailingStopForPrice(settings, 10, 10.15).price, 10.04);
  assert.equal(trailingStopForPrice(settings, 10, 10.20).price, 10.05);
});

test('custom trailing ladder uses account-specific configurable values', () => {
  const settings = sanitizeTradingSettings('LIVE', {
    allowedSessions: ['CORE'],
    shareQuantity: 1,
    maxTradeAmountUsd: 500,
    stopLossPct: 1,
    takeProfitPct: 2,
    trailingTriggerCents: 8,
    trailingInitialStopProfitCents: 3,
    trailingTriggerStepCents: 4,
    trailingStopStepCents: 2,
  });

  const first = protectionPreview(settings, 25, 25.08);
  assert.equal(first.stopLossPrice, 24.75);
  assert.equal(first.takeProfitPrice, 25.5);
  assert.equal(first.trailingTriggerPrice, 25.08);
  assert.equal(first.trailingInitialStopPrice, 25.03);
  assert.equal(first.trailingStopPrice, 25.03);

  assert.equal(trailingStopForPrice(settings, 25, 25.12).price, 25.05);
  assert.equal(trailingStopForPrice(settings, 25, 25.16).price, 25.07);
});

test('trailing settings are sanitized so the stop always remains below the trigger ladder', () => {
  const settings = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 1,
    maxTradeAmountUsd: 100,
    trailingTriggerCents: 5,
    trailingInitialStopProfitCents: 99,
    trailingTriggerStepCents: 5,
    trailingStopStepCents: 99,
  });

  assert.equal(settings.trailingInitialStopProfitCents, 4);
  assert.equal(settings.trailingStopStepCents, 4);
  assert.equal(isTradingSettingsConfigured(settings), true);
});

test('one, two, or all three trading windows can be configured', () => {
  for (const allowedSessions of [
    ['CORE'],
    ['CORE', 'EXTENDED'],
    ['CORE', 'EXTENDED', 'NIGHT'],
  ]) {
    const settings = sanitizeTradingSettings('SANDBOX', {
      allowedSessions,
      shareQuantity: 10,
      maxTradeAmountUsd: 1000,
    });
    assert.deepEqual(settings.allowedSessions, allowedSessions);
    assert.equal(isTradingSettingsConfigured(settings), true);
  }
});

test('overnight selection forces DAY because Webull NIGHT does not support GTC', () => {
  const overnight = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['NIGHT'],
    timeInForce: 'GTC',
    shareQuantity: 5,
    maxTradeAmountUsd: 500,
  });
  assert.equal(overnight.timeInForce, 'DAY');

  const extended = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE', 'EXTENDED'],
    timeInForce: 'GTC',
    shareQuantity: 5,
    maxTradeAmountUsd: 500,
  });
  assert.equal(extended.timeInForce, 'GTC');
});

test('New York market windows map to CORE, EXTENDED, and NIGHT', () => {
  const core = currentTradingWindow(new Date('2026-08-06T15:00:00Z'));
  const extended = currentTradingWindow(new Date('2026-08-06T12:00:00Z'));
  const night = currentTradingWindow(new Date('2026-08-07T01:00:00Z'));

  assert.equal(core.window, 'CORE');
  assert.equal(core.webullSession, 'CORE');
  assert.equal(extended.window, 'EXTENDED');
  assert.equal(extended.webullSession, 'ALL');
  assert.equal(night.window, 'NIGHT');
  assert.equal(night.webullSession, 'NIGHT');
});

test('current window must be explicitly selected', () => {
  const settings = sanitizeTradingSettings('LIVE', {
    allowedSessions: ['CORE'],
    shareQuantity: 1,
    maxTradeAmountUsd: 100,
  });
  const core = currentTradingWindow(new Date('2026-08-06T15:00:00Z'));
  const extended = currentTradingWindow(new Date('2026-08-06T12:00:00Z'));
  assert.equal(isCurrentTradingWindowAllowed(settings, core), true);
  assert.equal(isCurrentTradingWindowAllowed(settings, extended), false);
});
