import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const entry = readFileSync(join(directory, '../src/tradingview-only-cloudflare-entry.js'), 'utf8');

test('standalone mobile login is server rendered and does not require JavaScript', () => {
  assert.match(entry, /STANDALONE_LOGIN_PATH = '\/mobile\/login-v2'/);
  assert.match(entry, /<form method="post" action="\/mobile\/unlock"/);
  assert.match(entry, /فتح لوحة التحكم/);
  assert.match(entry, /لا تستخدم JavaScript/);
  assert.match(entry, /cache-control': 'no-store, no-cache, must-revalidate'/);
  assert.match(entry, /form-action 'self'/);

  const standaloneStart = entry.indexOf('function standaloneLoginHtml');
  const standaloneEnd = entry.indexOf('function standaloneLoginResponse');
  assert.ok(standaloneStart >= 0 && standaloneEnd > standaloneStart);
  const standaloneSection = entry.slice(standaloneStart, standaloneEnd);
  assert.doesNotMatch(standaloneSection, /<script/i);
});

test('mobile dashboard loads versioned same-origin client assets with a fallback controller', () => {
  assert.match(entry, /MOBILE_BOOT_PATH = '\/mobile\/boot-v3\.js'/);
  assert.match(entry, /MOBILE_CLIENT_PATH = '\/mobile\/client-v3\.js'/);
  assert.match(entry, /script-src 'self'/);
  assert.match(entry, /x-moe-mobile-assets/);
  assert.match(entry, /__MOE_MAIN_CLIENT_READY__/);
  assert.match(entry, /__MOE_FALLBACK_BOUND__/);
  assert.match(entry, /credentials: 'same-origin'/);
});
