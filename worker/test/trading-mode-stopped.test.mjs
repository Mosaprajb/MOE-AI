import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getTradingMode,
  TRADING_MODES,
  updateTradingMode,
} from '../src/trading-mode-service.js';

function storage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    async get(key) { return values.get(key); },
    async put(key, value) {
      if (typeof key === 'object' && key !== null) {
        Object.entries(key).forEach(([name, item]) => values.set(name, item));
      } else {
        values.set(key, value);
      }
    },
  };
}

const sandboxEnv = {
  MOE_TRADING_MODE_DEFAULT: 'SANDBOX',
  WEBULL_ENVIRONMENT: 'sandbox',
  WEBULL_SANDBOX_ENABLED: 'true',
  WEBULL_SANDBOX_ORDER_SUBMISSION: 'true',
  WEBULL_AUTOMATION_ARMED: 'true',
  WEBULL_LIVE_TRADING: 'false',
  WEBULL_LIVE_ORDER_SUBMISSION: 'false',
  WEBULL_LIVE_KILL_SWITCH: 'true',
  MOE_LIVE_MODE_UNLOCKED: 'false',
  MOE_LIVE_EXECUTION_IMPLEMENTED: 'true',
  WEBULL_PROTECTED_ORDERS: 'true',
};

test('only demo and live are exposed as selectable trading modes', async () => {
  const mode = await getTradingMode(storage(), sandboxEnv);
  assert.deepEqual(mode.modes.map((item) => item.id), [TRADING_MODES.SANDBOX, TRADING_MODES.LIVE]);
  assert.equal(mode.modes.some((item) => item.id === 'DRY_RUN' || item.id === 'PREVIEW'), false);
});

test('legacy dry run records migrate to stopped safety state', async () => {
  const mode = await getTradingMode(storage({
    'moe-trading-mode': { selectedMode: 'DRY_RUN' },
  }), sandboxEnv);
  assert.equal(mode.selectedMode, TRADING_MODES.STOPPED);
  assert.equal(mode.effectiveMode, TRADING_MODES.STOPPED);
  assert.equal(mode.stopped, true);
  assert.equal(mode.automationArmed, false);
});

test('stopped and preview cannot be selected as user trading modes', async () => {
  await assert.rejects(
    updateTradingMode(storage(), { mode: 'STOPPED' }, sandboxEnv),
    /cannot be selected/i,
  );
  await assert.rejects(
    updateTradingMode(storage(), { mode: 'DRY_RUN' }, sandboxEnv),
    /cannot be selected/i,
  );
  await assert.rejects(
    updateTradingMode(storage(), { mode: 'PREVIEW' }, sandboxEnv),
    /cannot be selected/i,
  );
});
