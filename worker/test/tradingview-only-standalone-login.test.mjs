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
  assert.doesNotMatch(entry, /<script/i);
});
