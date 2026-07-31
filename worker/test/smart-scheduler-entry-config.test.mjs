import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));

test('Smart Scheduler entry keeps live execution fail-closed', () => {
  assert.equal(config.main, 'worker/src/smart-scheduler-entry.js');
  assert.deepEqual(config.triggers.crons, ['* * * * *']);
  assert.equal(config.vars.SMART_SCANNER_SCHEDULER_ENABLED, 'true');
  assert.equal(config.vars.WEBULL_LIVE_TRADING, 'false');
  assert.equal(config.vars.WEBULL_LIVE_ORDER_SUBMISSION, 'false');
  assert.equal(config.vars.WEBULL_LIVE_AUTOMATION_ARMED, 'false');
  assert.equal(config.vars.WEBULL_LIVE_KILL_SWITCH, 'true');
});
