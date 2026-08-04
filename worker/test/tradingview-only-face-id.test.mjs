import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const source = (name) => readFileSync(join(directory, '../src', name), 'utf8');

test('Face ID is primary and PIN remains the fallback', () => {
  const ui = source('tradingview-only-passkey-ui.js');
  assert.match(ui, /الدخول باستخدام Face ID/);
  assert.match(ui, /الرمز السري الاحتياطي/);
  assert.match(ui, /method="post" action="\/mobile\/unlock"/);
  assert.match(ui, /navigator\.credentials\.get/);
  assert.match(ui, /navigator\.credentials\.create/);
});

test('dashboard uses one guarded login page instead of the old overlay', () => {
  const entry = source('tradingview-only-face-id-entry.js');
  assert.match(entry, /LOGIN_PATH = '\/mobile\/login-v2'/);
  assert.match(entry, /if \(!response\.ok\) return false/);
  assert.match(entry, /DASHBOARD_PATHS\.has\(path\)/);
  assert.match(entry, /return redirect\(request, `\$\{LOGIN_PATH\}/);
  assert.match(entry, /return page\(setupPageHtml\(destination\)/);
});

test('passkey requires platform user verification and server signature verification', () => {
  const entry = source('tradingview-only-face-id-entry.js');
  const verify = source('tradingview-only-passkey-verify.js');
  assert.match(entry, /authenticatorAttachment: 'platform'/);
  assert.match(entry, /residentKey: 'required'/);
  assert.match(entry, /userVerification: 'required'/);
  assert.match(entry, /attestation: 'none'/);
  assert.match(verify, /flags & 0x04/);
  assert.match(verify, /derToP1363/);
  assert.match(verify, /crypto\.subtle\.verify/);
  assert.match(verify, /Face ID signature verification failed/);
});

test('passkey and dashboard records are protected by signed secure cookies', () => {
  const token = source('tradingview-only-passkey-token.js');
  assert.match(token, /MOE_TRADINGVIEW_PASSKEY/);
  assert.match(token, /createSignedToken/);
  assert.match(token, /HttpOnly; Secure; SameSite=Lax/);
  assert.match(token, /MOE_MOBILE_SESSION_SECRET/);
});
