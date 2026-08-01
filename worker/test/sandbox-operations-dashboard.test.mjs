import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');
const source = readFileSync(join(root, 'worker/src/sandbox-operations-entry.js'), 'utf8');
const config = readFileSync(join(root, 'wrangler.sandbox.jsonc'), 'utf8');

test('sandbox Worker is wired through the operations dashboard entry', () => {
  assert.match(config, /"main": "worker\/src\/sandbox-operations-entry\.js"/);
  assert.match(config, /"MOE_SANDBOX_DEFAULT_CAPITAL": "25000"/);
  assert.match(config, /"MOE_SANDBOX_PILOT_ENABLED": "false"/);
  assert.match(config, /"WEBULL_LIVE_TRADING": "false"/);
  assert.match(config, /"WEBULL_LIVE_ORDER_SUBMISSION": "false"/);
  assert.match(config, /"WEBULL_LIVE_AUTOMATION_ARMED": "false"/);
  assert.match(config, /"WEBULL_LIVE_KILL_SWITCH": "true"/);
  assert.match(source, /from '\.\/sandbox-runtime-pilot-entry\.js'/);
});

test('browser dashboard polls sanitized same-origin observability views without storing secrets', () => {
  for (const path of [
    '/api/health?view=public',
    '/api/readiness?view=public',
    '/api/sandbox/audit?view=public',
    '/api/sandbox/orders/status?view=public',
  ]) {
    assert.ok(source.includes(path), `missing public polling path: ${path}`);
  }
  const browserScript = source.slice(source.indexOf('const SANDBOX_OPERATIONS_SCRIPT'));
  assert.equal(browserScript.includes('MOE_WEBHOOK_SECRET'), false);
  assert.equal(browserScript.includes('localStorage'), false);
  assert.equal(browserScript.includes('sessionStorage'), false);
  assert.equal(browserScript.includes('LIVE_TRADING'), false);
  assert.match(browserScript, /const pollMs=\$\{POLL_INTERVAL_MS\}/);
});

test('position sizing is fixed to one percent of the configured Sandbox capital', () => {
  assert.match(source, /const POSITION_RISK_PERCENT = 1;/);
  assert.match(source, /Math\.floor\(\(sandboxCapital\*0\.01\)\/risk\)/);
  assert.match(source, /entry-stop/);
});

test('session implementation includes Sunday NIGHT and regular CORE boundaries', () => {
  assert.match(source, /weekday === 'Sun' && minutes >= 20 \* 60/);
  assert.match(source, /minutes >= 9 \* 60 \+ 30 && minutes < 16 \* 60/);
  assert.match(source, /AUTO_SCANNER_OVERNIGHT_ENABLED/);
  assert.match(source, /return \{ current: 'NIGHT', open: true/);
  assert.match(source, /return \{ current: 'CORE', open: true/);
});

test('dashboard wrapper remains observation-only and delegates scheduled work', () => {
  assert.match(source, /return baseWorker\.scheduled\(controller, env, ctx\)/);
  assert.equal(source.includes('WEBULL_LIVE_TRADING = true'), false);
  assert.equal(source.includes('WEBULL_LIVE_ORDER_SUBMISSION = true'), false);
});
