import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createMobilePasscodeHash,
  handleMobilePasscode,
  readMobileConfig,
  serveMobileDashboard,
  updateMobileConfig,
  verifyMobilePasscode,
} from '../src/dashboard/mobile-dashboard.js';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return this.values.get(key); }
  async put(key, value) {
    if (key && typeof key === 'object' && value === undefined) {
      for (const [name, item] of Object.entries(key)) this.values.set(name, structuredClone(item));
      return;
    }
    this.values.set(key, structuredClone(value));
  }
}

const limits = {
  MOE_MAX_PORTFOLIO_RISK_PERCENT: '2',
  MOE_MAX_OPEN_RISK_PERCENT: '1.5',
  MOE_MAX_DAILY_TRADES: '8',
  MOE_MAX_DAILY_LOSS_PERCENT: '4',
  MOE_MOBILE_MAX_TAKE_PROFIT_R: '6',
};

test('/m serves the standalone no-store page without dashboard overlays or setup fallback', async () => {
  const response = serveMobileDashboard(new Request('https://example.test/m'));
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const html = await response.text();
  assert.match(html, /<title>MOE Control<\/title>/);
  assert.equal(html.includes('setupWarn'), false);
  assert.equal(html.includes('SETUP FALLBACK'), false);
  assert.equal(html.includes('opening unlocked'), false);
  for (const overlayId of [
    'moerandScanModeSelector',
    'portfolioRiskOverlay',
    'smartMoneyDashboardOverlay',
    'conflictActivityOverlay',
  ]) assert.equal(html.includes(overlayId), false);

  const entry = readFileSync(join(root, 'worker/src/sandbox-scan-mode-entry.js'), 'utf8');
  const routeIndex = entry.indexOf('if (isMobileDashboardPath(pathname)) return serveMobileDashboard(request)');
  const overlayIndex = entry.indexOf('enhanceScanModeDashboard(response)');
  assert.ok(routeIndex >= 0 && overlayIndex > routeIndex);
  assert.match(entry, /const DASHBOARD_PATHS = new Set\(\['\/', '\/dashboard'/);
  assert.equal(/DASHBOARD_PATHS[^;]+['"]\/m['"]/.test(entry), false);
});

test('mobile config validates and persists all six supported fields', async () => {
  const storage = new MemoryStorage();
  const patch = {
    cashAllocationPercent: 40,
    marginAllocationPercent: 20,
    takeProfitR: 3.5,
    riskPerTradePercent: 1.25,
    maxDailyTrades: 7,
    maxDailyLossPercent: 3.25,
  };
  assert.deepEqual(await updateMobileConfig(storage, patch, limits), patch);
  assert.deepEqual(await readMobileConfig(storage, limits), patch);
  await assert.rejects(
    updateMobileConfig(storage, { riskPerTradePercent: 1.75 }, limits),
    /riskPerTradePercent exceeds the server-side ceiling of 1\.5/,
  );
  assert.deepEqual(await readMobileConfig(storage, limits), patch);
});

test('mobile passcode rejects wrong codes, locks out, and issues a secure session cookie on success', async () => {
  const salt = Uint8Array.from({ length: 16 }, (_, index) => index + 1);
  const hash = await createMobilePasscodeHash('123456', { salt, iterations: 100_000 });
  const env = {
    MOE_MOBILE_PASSCODE_HASH: hash,
    MOE_MOBILE_SESSION_SECRET: 'test-session-secret-with-at-least-thirty-two-characters',
    MOE_LIVE_PIN_MAX_ATTEMPTS: '3',
    MOE_LIVE_PIN_LOCKOUT_MINUTES: '15',
  };
  const storage = new MemoryStorage();
  const now = Date.parse('2026-08-03T05:00:00.000Z');

  await assert.rejects(verifyMobilePasscode(storage, '000000', env, now), /Wrong passcode/i);
  await assert.rejects(verifyMobilePasscode(storage, '000000', env, now + 1), /Wrong passcode/i);
  await assert.rejects(verifyMobilePasscode(storage, '000000', env, now + 2), /Wrong passcode.*locked/i);
  await assert.rejects(verifyMobilePasscode(storage, '123456', env, now + 3), /temporarily locked/i);

  const unlockedStorage = new MemoryStorage();
  const request = new Request('https://example.test/api/trading/mode', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://example.test' },
    body: JSON.stringify({ action: 'verifyPasscode', passcode: '123456' }),
  });
  let forwardedSecurity = null;
  const response = await handleMobilePasscode(request, env, {
    verifyMobilePasscode: (passcode, security) => {
      forwardedSecurity = security;
      return verifyMobilePasscode(unlockedStorage, passcode, {
        ...env,
        MOE_MOBILE_PASSCODE_HASH: security.passcodeHash,
        MOE_LIVE_PIN_MAX_ATTEMPTS: String(security.maximumAttempts),
        MOE_LIVE_PIN_LOCKOUT_MINUTES: String(security.lockoutMinutes),
      }, now);
    },
  });
  assert.equal(forwardedSecurity.passcodeHash, hash);
  assert.equal(forwardedSecurity.maximumAttempts, 3);
  assert.equal(forwardedSecurity.lockoutMinutes, 15);
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /^moe_mobile_session=/);
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.equal(cookie.includes('123456'), false);

  const router = readFileSync(join(root, 'worker/src/router.js'), 'utf8');
  assert.match(router, /security\.passcodeHash/);
  assert.match(router, /MOE_MOBILE_PASSCODE_HASH/);
});
