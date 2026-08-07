import test from 'node:test';
import assert from 'node:assert/strict';
import {
  currentTradingWindow,
  getTradingSettings,
  isCurrentTradingWindowAllowed,
  isTradingSettingsConfigured,
  sanitizeTradingSettings,
  saveTradingSettings,
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
  });
  await saveTradingSettings(env, 'LIVE', {
    allowedSessions: ['CORE'],
    timeInForce: 'DAY',
    shareQuantity: 3,
    maxTradeAmountUsd: 500,
  });

  const paper = await getTradingSettings(env, 'SANDBOX');
  const live = await getTradingSettings(env, 'LIVE');
  assert.deepEqual(paper.allowedSessions, ['CORE', 'EXTENDED']);
  assert.equal(paper.timeInForce, 'GTC');
  assert.equal(paper.shareQuantity, 12);
  assert.equal(paper.maxTradeAmountUsd, 2500);
  assert.deepEqual(live.allowedSessions, ['CORE']);
  assert.equal(live.timeInForce, 'DAY');
  assert.equal(live.shareQuantity, 3);
  assert.equal(live.maxTradeAmountUsd, 500);
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
