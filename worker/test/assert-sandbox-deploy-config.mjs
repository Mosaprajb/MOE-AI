import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync(new URL('../../wrangler.sandbox.jsonc', import.meta.url), 'utf8'));
const expected = {
  MOE_SANDBOX_PILOT_ENABLED: 'false',
  MOE_LIVE_MODE_UNLOCKED: 'false',
  MOE_LIVE_EXECUTION_IMPLEMENTED: 'false',
  WEBULL_LIVE_TRADING: 'false',
  WEBULL_LIVE_ORDER_SUBMISSION: 'false',
  WEBULL_LIVE_AUTOMATION_ARMED: 'false',
  WEBULL_LIVE_KILL_SWITCH: 'true',
};

assert.equal(config.main, 'worker/src/sandbox-mobile-account-balances-entry.js');
for (const [key, value] of Object.entries(expected)) {
  assert.equal(config.vars?.[key], value, `${key} must remain ${value}`);
}

console.log(JSON.stringify({ sandboxEntry: config.main, ...expected }, null, 2));
