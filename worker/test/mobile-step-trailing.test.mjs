import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { workerDirectory } from '../scripts/generate-wrangler-config.mjs';

async function source(path) {
  return readFile(resolve(workerDirectory, path), 'utf8');
}

test('TradingView BUY uses saved bracket protection instead of alert-provided exits', async () => {
  const [webhook, webull] = await Promise.all([
    source('src/routes/webhook.ts'),
    source('src/lib/webull.ts'),
  ]);

  assert.match(webhook, /settings\.stopLossPct/);
  assert.match(webhook, /settings\.takeProfitPct/);
  assert.match(webhook, /placeBracketEntry/);
  assert.doesNotMatch(webhook, /payload\.stop\s*\?\?/);
  assert.doesNotMatch(webhook, /payload\.takeProfit\s*\?\?/);

  assert.match(webull, /combo_type:\s*'MASTER'/);
  assert.match(webull, /combo_type:\s*'STOP_PROFIT'/);
  assert.match(webull, /combo_type:\s*'STOP_LOSS'/);
  assert.match(webull, /client_combo_order_id/);
  assert.match(webull, /\/openapi\/trade\/order\/replace/);
});

test('custom step trailing activates from entry lock and advances by configurable staircase', async () => {
  const coordinator = await source('src/lib/step-trailing-coordinator.ts');

  assert.match(coordinator, /entryPrice \+ managed\.trailingInitialLockCents \/ 100/);
  assert.match(coordinator, /managed\.trailingActivationCents \/ 100/);
  assert.match(coordinator, /managed\.trailingStepTriggerCents \/ 100/);
  assert.match(coordinator, /steps \* managed\.trailingStepMoveCents \/ 100/);
  assert.match(coordinator, /cancelOrder\(managed\.takeProfitClientOrderId\)/);
  assert.match(coordinator, /cancelOrder\(managed\.stopLossClientOrderId\)/);
  assert.match(coordinator, /fallback-stop/);
  assert.match(coordinator, /POLL_INTERVAL_MS = 2_500/);
});

test('step trailing is a dedicated bound Durable Object and Live safety flags stay fail closed', async () => {
  const config = JSON.parse(
    (await source('wrangler.jsonc')).replace(/\/\/.*$/gm, ''),
  );

  assert.deepEqual(config.exports.StepTrailingCoordinator, {
    type: 'durable-object',
    storage: 'sqlite',
  });
  assert.deepEqual(config.durable_objects.bindings, [{
    name: 'STEP_TRAILING_COORDINATOR',
    class_name: 'StepTrailingCoordinator',
  }]);

  const production = config.env.production.vars;
  assert.equal(production.MOE_EXECUTION_POLICY, 'live-read-only');
  assert.equal(production.MOE_LIVE_READ_ONLY, 'true');
  assert.equal(production.MOE_LIVE_EXECUTION_IMPLEMENTED, 'false');
  assert.equal(production.MOE_LIVE_WEBHOOK_EXECUTION_ENABLED, 'false');
  assert.equal(production.WEBULL_LIVE_ORDER_SUBMISSION, 'false');
  assert.equal(production.WEBULL_LIVE_KILL_SWITCH, 'true');
});
