import test from 'node:test';
import assert from 'node:assert/strict';
import { applyRuntimeLiveControl, getLiveControlState, updateLiveControlState } from '../src/live-control-service.js';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(keyOrEntries, value) {
    if (typeof keyOrEntries === 'object' && keyOrEntries !== null) {
      for (const [key, entry] of Object.entries(keyOrEntries)) this.values.set(key, entry);
      return;
    }
    this.values.set(keyOrEntries, value);
  }
}

const readyEnv = {
  AUTO_SCANNER_ENABLED: 'true',
  WEBULL_AUTOMATION_ARMED: 'true',
  MOE_LIVE_PIN_CONTROL_ENABLED: 'true',
  MOE_LIVE_CONTROL_PIN: 'test-only-pin',
  MOE_LIVE_PIN_MAX_ATTEMPTS: '5',
  MOE_LIVE_PIN_LOCKOUT_MINUTES: '15',
  MOE_LIVE_EXECUTION_IMPLEMENTED: 'true',
  WEBULL_PROTECTED_ORDERS: 'true',
  WEBULL_LIVE_APP_KEY: 'key',
  WEBULL_LIVE_APP_SECRET: 'secret',
  WEBULL_LIVE_ACCESS_TOKEN: 'token',
  WEBULL_LIVE_ACCOUNT_ID: 'account',
  WEBULL_ENVIRONMENT: 'sandbox',
  WEBULL_LIVE_TRADING: 'false',
  WEBULL_LIVE_ORDER_SUBMISSION: 'false',
  WEBULL_LIVE_AUTOMATION_ARMED: 'false',
  WEBULL_LIVE_KILL_SWITCH: 'true',
};

test('live activation remains locked until the exact PIN and confirmation are supplied', async () => {
  const storage = new MemoryStorage();
  const initial = await getLiveControlState(storage, readyEnv);
  assert.equal(initial.liveTradingEnabled, false);
  assert.equal(initial.killSwitch, true);
  assert.equal(initial.staticLiveCapability.buildReady, true);

  await assert.rejects(
    updateLiveControlState(storage, {
      pin: 'test-only-pin',
      action: 'ACTIVATE_LIVE_FULLY',
      confirmation: 'WRONG',
    }, readyEnv),
    /ACTIVATE_LIVE_TRADING/,
  );
});

test('full live activation is atomic and forces the live runtime environment', async () => {
  const storage = new MemoryStorage();
  const activated = await updateLiveControlState(storage, {
    pin: 'test-only-pin',
    action: 'ACTIVATE_LIVE_FULLY',
    confirmation: 'ACTIVATE_LIVE_TRADING',
    actor: 'TEST',
  }, readyEnv);

  assert.equal(activated.sandboxAutomationEnabled, false);
  assert.equal(activated.liveControlsUnlocked, true);
  assert.equal(activated.liveAutomationArmed, true);
  assert.equal(activated.killSwitch, false);
  assert.equal(activated.liveTradingEnabled, true);
  assert.equal(activated.effectiveLiveAutomationArmed, true);

  const runtime = applyRuntimeLiveControl(readyEnv, activated);
  assert.equal(runtime.WEBULL_ENVIRONMENT, 'production');
  assert.equal(runtime.WEBULL_LIVE_TRADING, 'true');
  assert.equal(runtime.WEBULL_LIVE_ORDER_SUBMISSION, 'true');
  assert.equal(runtime.MOE_LIVE_MODE_UNLOCKED, 'true');
  assert.equal(runtime.WEBULL_LIVE_AUTOMATION_ARMED, 'true');
  assert.equal(runtime.WEBULL_LIVE_KILL_SWITCH, 'false');
});

test('return to sandbox atomically disables live and restores the kill switch', async () => {
  const storage = new MemoryStorage();
  await updateLiveControlState(storage, {
    pin: 'test-only-pin',
    action: 'ACTIVATE_LIVE_FULLY',
    confirmation: 'ACTIVATE_LIVE_TRADING',
  }, readyEnv);

  const sandbox = await updateLiveControlState(storage, {
    pin: 'test-only-pin',
    action: 'RETURN_TO_SANDBOX',
    confirmation: 'RETURN_TO_SANDBOX',
  }, readyEnv);

  assert.equal(sandbox.sandboxAutomationEnabled, true);
  assert.equal(sandbox.liveControlsUnlocked, false);
  assert.equal(sandbox.liveAutomationArmed, false);
  assert.equal(sandbox.killSwitch, true);
  assert.equal(sandbox.liveTradingEnabled, false);

  const runtime = applyRuntimeLiveControl(readyEnv, sandbox);
  assert.equal(runtime.WEBULL_ENVIRONMENT, 'sandbox');
  assert.equal(runtime.WEBULL_LIVE_TRADING, 'false');
  assert.equal(runtime.WEBULL_LIVE_ORDER_SUBMISSION, 'false');
  assert.equal(runtime.WEBULL_LIVE_AUTOMATION_ARMED, 'false');
  assert.equal(runtime.WEBULL_LIVE_KILL_SWITCH, 'true');
});

test('missing production credentials block live activation', async () => {
  const storage = new MemoryStorage();
  const incomplete = { ...readyEnv, WEBULL_LIVE_ACCESS_TOKEN: '' };
  await assert.rejects(
    updateLiveControlState(storage, {
      pin: 'test-only-pin',
      action: 'ACTIVATE_LIVE_FULLY',
      confirmation: 'ACTIVATE_LIVE_TRADING',
    }, incomplete),
    /WEBULL_LIVE_ACCESS_TOKEN/,
  );
});
