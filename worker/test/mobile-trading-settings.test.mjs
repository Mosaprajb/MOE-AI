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

const protection = {
  stopLossEnabled: true,
  stopLossPct: 1.5,
  takeProfitEnabled: true,
  takeProfitPct: 2.5,
  trailingEnabled: true,
  trailingActivationCents: 5,
  trailingInitialLockCents: 2,
  trailingStepTriggerCents: 5,
  trailingStepMoveCents: 1,
};

test('Paper and Live trading settings persist independently', async () => {
  const env = { CONFIG: new FakeKV() };
  await saveTradingSettings(env, 'SANDBOX', {
    allowedSessions: ['CORE', 'EXTENDED'],
    timeInForce: 'GTC',
    shareQuantity: 12,
    maxTradeAmountUsd: 2500,
    ...protection,
  });
  await saveTradingSettings(env, 'LIVE', {
    allowedSessions: ['CORE'],
    timeInForce: 'DAY',
    shareQuantity: 3,
    maxTradeAmountUsd: 500,
    stopLossEnabled: true,
    stopLossPct: 0.75,
    takeProfitEnabled: true,
    takeProfitPct: 1.25,
    trailingEnabled: true,
    trailingActivationCents: 8,
    trailingInitialLockCents: 3,
    trailingStepTriggerCents: 4,
    trailingStepMoveCents: 2,
  });

  const paper = await getTradingSettings(env, 'SANDBOX');
  const live = await getTradingSettings(env, 'LIVE');
  assert.deepEqual(paper.allowedSessions, ['CORE', 'EXTENDED']);
  assert.equal(paper.timeInForce, 'GTC');
  assert.equal(paper.shareQuantity, 12);
  assert.equal(paper.maxTradeAmountUsd, 2500);
  assert.equal(paper.stopLossPct, 1.5);
  assert.equal(paper.takeProfitPct, 2.5);
  assert.equal(paper.trailingActivationCents, 5);
  assert.equal(paper.trailingInitialLockCents, 2);
  assert.equal(paper.trailingStepTriggerCents, 5);
  assert.equal(paper.trailingStepMoveCents, 1);

  assert.deepEqual(live.allowedSessions, ['CORE']);
  assert.equal(live.timeInForce, 'DAY');
  assert.equal(live.shareQuantity, 3);
  assert.equal(live.maxTradeAmountUsd, 500);
  assert.equal(live.stopLossPct, 0.75);
  assert.equal(live.takeProfitPct, 1.25);
  assert.equal(live.trailingActivationCents, 8);
  assert.equal(live.trailingInitialLockCents, 3);
  assert.equal(live.trailingStepTriggerCents, 4);
  assert.equal(live.trailingStepMoveCents, 2);
});

test('one, two, or all three trading windows can be configured with exit protection', () => {
  for (const allowedSessions of [
    ['CORE'],
    ['CORE', 'EXTENDED'],
    ['CORE', 'EXTENDED', 'NIGHT'],
  ]) {
    const settings = sanitizeTradingSettings('SANDBOX', {
      allowedSessions,
      shareQuantity: 10,
      maxTradeAmountUsd: 1000,
      ...protection,
    });
    assert.deepEqual(settings.allowedSessions, allowedSessions);
    assert.equal(isTradingSettingsConfigured(settings), true);
  }
});

test('accounts saved before take-profit support fail closed until protection is explicitly saved', () => {
  const legacy = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 10,
    maxTradeAmountUsd: 1000,
  });
  assert.equal(legacy.takeProfitEnabled, false);
  assert.equal(isTradingSettingsConfigured(legacy), false);

  const protectedSettings = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 10,
    maxTradeAmountUsd: 1000,
    ...protection,
  });
  assert.equal(protectedSettings.takeProfitEnabled, true);
  assert.equal(isTradingSettingsConfigured(protectedSettings), true);
});

test('step trailing sanitization keeps stop levels below their trigger and never moves faster than price', () => {
  const settings = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 1,
    maxTradeAmountUsd: 100,
    ...protection,
    trailingActivationCents: 5,
    trailingInitialLockCents: 9,
    trailingStepTriggerCents: 5,
    trailingStepMoveCents: 9,
  });

  assert.equal(settings.trailingActivationCents, 5);
  assert.equal(settings.trailingInitialLockCents, 4.99);
  assert.equal(settings.trailingStepTriggerCents, 5);
  assert.equal(settings.trailingStepMoveCents, 5);
  assert.equal(isTradingSettingsConfigured(settings), true);
});

test('overnight selection forces DAY because Webull NIGHT does not support GTC', () => {
  const overnight = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['NIGHT'],
    timeInForce: 'GTC',
    shareQuantity: 5,
    maxTradeAmountUsd: 500,
    ...protection,
  });
  assert.equal(overnight.timeInForce, 'DAY');

  const extended = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE', 'EXTENDED'],
    timeInForce: 'GTC',
    shareQuantity: 5,
    maxTradeAmountUsd: 500,
    ...protection,
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
    ...protection,
  });
  const core = currentTradingWindow(new Date('2026-08-06T15:00:00Z'));
  const extended = currentTradingWindow(new Date('2026-08-06T12:00:00Z'));
  assert.equal(isCurrentTradingWindowAllowed(settings, core), true);
  assert.equal(isCurrentTradingWindowAllowed(settings, extended), false);
});
