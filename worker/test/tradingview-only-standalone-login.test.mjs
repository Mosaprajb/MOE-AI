import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const entry = readFileSync(join(directory, '../src/tradingview-only-cloudflare-entry.js'), 'utf8');

test('standalone mobile login is server rendered and does not require JavaScript', () => {
  assert.match(entry, /STANDALONE_LOGIN_PATH = '\/mobile\/login-v2'/);
  assert.match(entry, /NATIVE_UNLOCK_PATH = '\/mobile\/unlock'/);
  assert.match(entry, /<form method="post" action="\$\{NATIVE_UNLOCK_PATH\}"/);
  assert.match(entry, /فتح لوحة التحكم/);
  assert.match(entry, /بعد نجاح الرمز تُثبَّت الجلسة أولًا/);
  assert.match(entry, /cache-control': 'no-store, no-cache, must-revalidate'/);
  assert.match(entry, /form-action 'self'/);

  const standaloneStart = entry.indexOf('function standaloneLoginHtml');
  const standaloneEnd = entry.indexOf('function standaloneLoginResponse');
  assert.ok(standaloneStart >= 0 && standaloneEnd > standaloneStart);
  const standaloneSection = entry.slice(standaloneStart, standaloneEnd);
  assert.doesNotMatch(standaloneSection, /<script/i);
});

test('successful native login stabilizes the Safari cookie before dashboard navigation', () => {
  assert.match(entry, /function sessionTransitionResponse/);
  assert.match(entry, /x-moe-session-handoff/);
  assert.match(entry, /تم تسجيل الدخول بنجاح/);
  assert.match(entry, /جاري تثبيت الجلسة الآمنة/);
  assert.match(entry, /nativeResponse\.headers\.get\('set-cookie'\)/);
  assert.match(entry, /location\.includes\('unlocked=1'\)/);
});

test('existing sessions resume without requesting the control PIN again', () => {
  assert.match(entry, /async function sessionIsActive/);
  assert.match(entry, /return response\.status !== 401 && response\.status !== 403/);
  assert.match(entry, /if \(await sessionIsActive\(request, env, ctx\)\)/);
  assert.match(entry, /\/mobile\?resume=1/);
  assert.match(entry, /استعادة الجلسة الحالية/);
});

test('mobile dashboard loads versioned same-origin client assets with retries and fallback controls', () => {
  assert.match(entry, /MOBILE_BOOT_PATH = '\/mobile\/boot-v4\.js'/);
  assert.match(entry, /MOBILE_CLIENT_PATH = '\/mobile\/client-v4\.js'/);
  assert.match(entry, /MOBILE_ASSET_VERSION = '\d{8}-\d+'/);
  assert.match(entry, /script-src 'self'/);
  assert.match(entry, /x-moe-mobile-assets/);
  assert.match(entry, /__MOE_MAIN_CLIENT_READY__/);
  assert.match(entry, /__MOE_FALLBACK_BOUND__/);
  assert.match(entry, /credentials: 'same-origin'/);
  assert.match(entry, /currentAttempt < 4/);
});

test('expired dashboard sessions retain a native iPhone login form independent of JavaScript', () => {
  assert.match(entry, /function installNativeDashboardLogin/);
  assert.match(entry, /id="moeNativeLoginForm" method="post" action="\$\{NATIVE_UNLOCK_PATH\}"/);
  assert.match(entry, /id="nativePin" name="pin" type="password"/);
  assert.match(entry, /id="nativeLoginButton" type="submit"/);
  assert.match(entry, /touch-action:manipulation/);
  assert.match(entry, /body = installNativeDashboardLogin\(body\)/);
  assert.match(entry, /x-moe-native-login', 'dashboard-form-v1'/);
});
