import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentSandboxSession } from '../src/sandbox-operations-entry.js';

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

test('Sunday 8 PM New York is NIGHT only when overnight Sandbox scanning is enabled', () => {
  const enabled = currentSandboxSession({
    AUTO_SCANNER_TRADING_HOURS: 'AUTO',
    AUTO_SCANNER_OVERNIGHT_ENABLED: 'true',
  }, new Date('2026-08-03T00:05:00.000Z'));
  assert.equal(enabled.current, 'NIGHT');
  assert.equal(enabled.open, true);

  const disabled = currentSandboxSession({
    AUTO_SCANNER_TRADING_HOURS: 'AUTO',
    AUTO_SCANNER_OVERNIGHT_ENABLED: 'false',
  }, new Date('2026-08-03T00:05:00.000Z'));
  assert.equal(disabled.current, 'CLOSED');
  assert.equal(disabled.open, false);
});

test('regular US market hours are reported as CORE', () => {
  const session = currentSandboxSession({
    AUTO_SCANNER_TRADING_HOURS: 'AUTO',
    AUTO_SCANNER_OVERNIGHT_ENABLED: 'true',
  }, new Date('2026-08-03T13:35:00.000Z'));
  assert.equal(session.current, 'CORE');
  assert.equal(session.open, true);
});
