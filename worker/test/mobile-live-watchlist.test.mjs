import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'worker/src/sandbox-mobile-live-watchlist-entry.js'), 'utf8');
const config = JSON.parse(readFileSync(join(root, 'wrangler.sandbox.jsonc'), 'utf8'));

test('modern mobile watchlist is the deployed wrapper and preserves the Clean entry chain', () => {
  assert.equal(config.main, 'worker/src/sandbox-mobile-live-watchlist-entry.js');
  assert.match(source, /from '\.\/sandbox-moerand-clean-utbot-entry\.js'/);
  assert.match(source, /export \{ AlertCoordinator, SimulationDriver \}/);
  assert.match(source, /MOBILE_PATHS\.has\(pathname\)/);
});

test('watchlist reads multi-symbol Alpaca IEX snapshots without exposing credentials', () => {
  assert.match(source, /data\.alpaca\.markets\/v2\/stocks\/snapshots/);
  assert.match(source, /url\.searchParams\.set\('symbols', symbols\.join\(','\)\)/);
  assert.match(source, /url\.searchParams\.set\('feed', 'iex'\)/);
  assert.match(source, /APCA-API-KEY-ID/);
  assert.match(source, /APCA-API-SECRET-KEY/);
  assert.match(source, /\/api\/mobile\/watchlist\/quotes/);
  assert.match(source, /x-moe-mobile-client/);
  assert.match(source, /MAX_SYMBOLS = 30/);
  assert.match(source, /CACHE_SECONDS = 2/);
  assert.equal(source.includes('placeWebullSandboxOrder'), false);
  assert.equal(source.includes('placeWebullLiveOrder'), false);
  assert.equal(source.includes("WEBULL_LIVE_TRADING: 'true'"), false);
});

test('watchlist UI exposes modern rows, live prices, movers, extended hours, and detail metrics', () => {
  for (const token of [
    'moe-live-watchlist-script',
    'moe-watchlist-row',
    'Live prices · IEX',
    'Top movers',
    'Lowest price',
    'Premarket',
    'After hours',
    'Bid',
    'Ask',
    'Day range',
    'Volume',
    'MutationObserver',
    'data-watch-remove',
  ]) {
    assert.equal(source.includes(token), true, `missing live watchlist token: ${token}`);
  }
  assert.match(source, /setInterval\(function\(\)\{if\(!document\.hidden\)refresh\(false\);\},3000\)/);
  assert.match(source, /insertAdjacentElement\('afterend',root\)/);
});

test('embedded live watchlist browser script parses successfully', () => {
  const match = source.match(/const WATCHLIST_SCRIPT = String\.raw`[\s\S]*?<script[^>]*>\n([\s\S]*?)\n<\/script>`;/);
  assert.ok(match, 'embedded live watchlist script was not found');
  assert.doesNotThrow(() => new Function(match[1]));
});

test('live watchlist remains market-data-only and keeps Live funds locked', () => {
  assert.match(source, /liveTradingLocked: true/);
  assert.match(source, /liveFundsUsed: false/);
  assert.match(source, /sameOrigin\(request\)/);
  assert.match(source, /Mobile watchlist access denied/);
  assert.equal(source.includes('WEBULL_LIVE_ORDER_SUBMISSION'), false);
  assert.equal(source.includes('WEBULL_LIVE_AUTOMATION_ARMED'), false);
});
