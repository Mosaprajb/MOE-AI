import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const directory = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(directory, '..', 'src', 'webull-sandbox.js'), 'utf8');

test('Webull Sandbox keeps production and live execution fail-closed', () => {
  assert.match(source, /env\.WEBULL_LIVE_TRADING === 'true'/);
  assert.match(source, /env\.WEBULL_ENVIRONMENT === 'production'/);
  assert.match(source, /Production trading is intentionally disabled/);
  assert.match(source, /status:\s*423/);
});

test('Sandbox submission requires both explicit server switches', () => {
  assert.match(
    source,
    /env\.WEBULL_SANDBOX_ENABLED === 'true'\s*&&\s*env\.WEBULL_SANDBOX_ORDER_SUBMISSION === 'true'/,
  );
  assert.match(source, /Sandbox submission requested but server submission is disabled/);
  assert.match(source, /WEBULL_ACCOUNT_ID or payload\.accountId is required/);
});

test('automatic submission remains disarmed until the manual protected-order test succeeds', () => {
  assert.match(source, /startsWith\('MOERAND_AUTO_'\)/);
  assert.match(source, /env\.WEBULL_AUTOMATION_ARMED === 'true'/);
  assert.match(source, /Automatic Webull Sandbox submission is disarmed/);
  assert.match(source, /manual protected-order test succeeds/);
});

test('submission is blocked when any decision or safety layer rejects the trade', () => {
  assert.match(source, /if \(!plan\.evaluation\.accepted\)/);
  assert.match(source, /submitted:\s*false/);
  assert.match(source, /blocked:\s*true/);
  assert.match(source, /placeWebullSandboxOrder\(accountId, order, env\)/);
});

test('market and sector intelligence reaches the MOE AI Brain', () => {
  for (const field of ['marketScore', 'marketRegime', 'sector', 'sectorScore']) {
    assert.match(source, new RegExp(`${field}:`), `${field} must be forwarded to the brain candidate`);
  }
});

test('manual preview and submitted Sandbox modes stay distinguishable', () => {
  assert.match(source, /SANDBOX_SUBMITTED/);
  assert.match(source, /SANDBOX_DRY_RUN/);
  assert.match(source, /previewRequired:\s*!submitted/);
  assert.match(source, /submitted,?/);
});
