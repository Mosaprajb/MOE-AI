import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tradingViewPnlControlPatch } from '../src/tradingview-only-pnl-control-patch.js';

const directory = dirname(fileURLToPath(import.meta.url));
const source = (name) => readFileSync(join(directory, '../src', name), 'utf8');

const inlinePattern = /<script\s+id=["']moe-pnl-control-script-v1["'][^>]*>([\s\S]*?)<\/script>/i;

test('P&L client is extracted from the inline patch into a JavaScript asset', () => {
  const patch = tradingViewPnlControlPatch();
  const match = patch.match(inlinePattern);

  assert.ok(match, 'inline P&L script must be present in the legacy patch');
  assert.match(match[1], /__MOE_PNL_CONTROL_V1__/);
  assert.match(match[1], /function render\(/);
  assert.match(match[1], /function refresh\(/);

  const externalized = `<html><head>${patch}</head><body><main></main></body></html>`
    .replace(inlinePattern, '')
    .replace('</body>', '<script id="moe-pnl-control-script-v2" src="/mobile/pnl-control-v2.js?v=test" defer></script></body>');

  assert.doesNotMatch(externalized, /<script\s+id=["']moe-pnl-control-script-v1/);
  assert.match(externalized, /src="\/mobile\/pnl-control-v2\.js\?v=test" defer/);
  assert.match(externalized, /moe-pnl-control-style-v1/);
});

test('deployment wrapper serves P&L as JavaScript and removes the inline payload', () => {
  const wrapper = source('sandbox-mobile-market-screener-resilient-entry-v2.js');

  assert.match(wrapper, /PNL_SCRIPT_PATH = '\/mobile\/pnl-control-v2\.js'/);
  assert.match(wrapper, /application\/javascript; charset=utf-8/);
  assert.match(wrapper, /source = source\.replace\(INLINE_PNL_SCRIPT_PATTERN, ''\)/);
  assert.match(wrapper, /moe-pnl-control-script-v2/);
  assert.match(wrapper, /x-moe-pnl-inline-removed/);
  assert.match(wrapper, /return externalizePnlClient\(request, response\)/);
});
