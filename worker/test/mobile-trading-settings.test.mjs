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
  stopLossPct: 2,
  takeProfitPct: 3,
  trailingEnabled: true,
  trailActivationUsd: 0.05,
  trailInitialStopOffsetUsd: 0.02,
  trailTriggerStepUsd: 0.05,
  trailStopMoveUsd: 0.01,
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
    ...protection,
    stopLossPct: 1.25,
    takeProfitPct: 4,
    trailActivationUsd: 0.08,
  });

  const paper = await getTradingSettings(env, 'SANDBOX');
  const live = await getTradingSettings(env, 'LIVE');
  assert.deepEqual(paper.allowedSessions, ['CORE', 'EXTENDED']);
  assert.equal(paper.timeInForce, 'GTC');
  assert.equal(paper.shareQuantity, 12);
  assert.equal(paper.maxTradeAmountUsd, 2500);
  assert.equal(paper.protectionConfigured, true);
  assert.equal(paper.stopLossPct, 2);
  assert.equal(paper.takeProfitPct, 3);
  assert.equal(paper.trailActivationUsd, 0.05);
  assert.deepEqual(live.allowedSessions, ['CORE']);
  assert.equal(live.timeInForce, 'DAY');
  assert.equal(live.shareQuantity, 3);
  assert.equal(live.maxTradeAmountUsd, 500);
  assert.equal(live.protectionConfigured, true);
  assert.equal(live.stopLossPct, 1.25);
  assert.equal(live.takeProfitPct, 4);
  assert.equal(live.trailActivationUsd, 0.08);
});

test('one, two, or all three trading windows can be configured after explicit protection setup', () => {
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
    assert.equal(settings.protectionConfigured, true);
    assert.equal(isTradingSettingsConfigured(settings), true);
  }
});

test('legacy quantity and session settings cannot arm until protection is explicitly saved', () => {
  const legacy = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 10,
    maxTradeAmountUsd: 1000,
  });
  assert.equal(legacy.protectionConfigured, false);
  assert.equal(isTradingSettingsConfigured(legacy), false);

  const configured = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 10,
    maxTradeAmountUsd: 1000,
    ...protection,
  });
  assert.equal(configured.protectionConfigured, true);
  assert.equal(isTradingSettingsConfigured(configured), true);
});

test('partial sizing edits preserve previously approved protection settings', () => {
  const configured = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 10,
    maxTradeAmountUsd: 1000,
    ...protection,
  });
  const edited = sanitizeTradingSettings('SANDBOX', {
    shareQuantity: 15,
    maxTradeAmountUsd: 1500,
  }, configured);

  assert.equal(edited.shareQuantity, 15);
  assert.equal(edited.maxTradeAmountUsd, 1500);
  assert.equal(edited.protectionConfigured, true);
  assert.equal(edited.stopLossPct, protection.stopLossPct);
  assert.equal(edited.takeProfitPct, protection.takeProfitPct);
  assert.equal(edited.trailingEnabled, true);
  assert.equal(edited.trailActivationUsd, protection.trailActivationUsd);
  assert.equal(edited.trailInitialStopOffsetUsd, protection.trailInitialStopOffsetUsd);
  assert.equal(edited.trailTriggerStepUsd, protection.trailTriggerStepUsd);
  assert.equal(edited.trailStopMoveUsd, protection.trailStopMoveUsd);
});

test('invalid stepped trailing relationships fail closed', () => {
  const invalidFirstStop = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 10,
    maxTradeAmountUsd: 1000,
    ...protection,
    trailInitialStopOffsetUsd: 0.05,
  });
  assert.equal(isTradingSettingsConfigured(invalidFirstStop), false);

  const invalidMove = sanitizeTradingSettings('SANDBOX', {
    allowedSessions: ['CORE'],
    shareQuantity: 10,
    maxTradeAmountUsd: 1000,
    ...protection,
    trailStopMoveUsd: 0.06,
  });
  assert.equal(isTradingSettingsConfigured(invalidMove), false);
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
