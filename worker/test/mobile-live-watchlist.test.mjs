import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const source = readFileSync(join(root, 'worker/src/sandbox-mobile-live-watchlist-entry.js'), 'utf8');
const scanModeSource = readFileSync(join(root, 'worker/src/sandbox-scan-mode-entry.js'), 'utf8');
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

test('watchlist UI is guaranteed server-side and exposes modern live rows and quote details', () => {
  for (const token of [
    'moe-live-watchlist-script',
    'data-moe-watchlist-root',
    'moe-watchlist-row',
    'Direct IEX market prices',
    'Top movers',
    'Lowest price',
    'Premarket',
    'After hours',
    'Bid',
    'Ask',
    'Spread',
    'Day range',
    'Volume',
    'Quote age',
    'MutationObserver',
    'data-watch-remove',
    'guaranteeRoots',
    'insertAfterElementById',
    'data-view="main"',
    'data-view="sheet"',
    'openSymbols',
    'symInput2',
  ]) {
    assert.equal(source.includes(token), true, `missing live watchlist token: ${token}`);
  }
  assert.match(source, /insertAfterElementById\(html, 'chips', WATCHLIST_ROOT\)/);
  assert.match(source, /insertAfterElementById\(output, 'chips2', WATCHLIST_SHEET_ROOT\)/);
  assert.match(source, /setInterval\(function\(\)\{if\(!document\.hidden\)refresh\(false\);\},3000\)/);
});

test('mobile symbol picker commits taps reliably on iPhone and gives explicit save feedback', () => {
  for (const token of [
    'symbol-add-action',
    'symbol-picker-feedback',
    'Tap to select',
    "list.addEventListener('pointerdown',chooseFromEvent,true)",
    "list.addEventListener('touchend',chooseFromEvent,{capture:true,passive:false})",
    "list.addEventListener('click',chooseFromEvent,true)",
    "addButton.addEventListener('pointerdown',addFromEvent,true)",
    "await api(API.scanMode",
    'state.symbols=previous',
    'added to the scanner',
    'Stop trading to edit',
  ]) {
    assert.equal(scanModeSource.includes(token), true, `missing touch-safe picker token: ${token}`);
  }
  assert.match(scanModeSource, /event\.stopImmediatePropagation\(\)/);
  assert.match(scanModeSource, /MOE_SYMBOL_UNIVERSE\.includes\(symbol\)/);
  const match = scanModeSource.match(/const MOBILE_CONNECTION_SCRIPT = `\n([\s\S]*?)\n`;/);
  assert.ok(match, 'embedded mobile connection script was not found');
  const browserScript = match[1].replace('${JSON.stringify(AUTO_SCANNER_SYMBOLS)}', '[]');
  assert.doesNotThrow(() => new Function(browserScript));
});

test('scanner activation freezes the original symbol list in both browser and server', () => {
  for (const token of [
    '/api/mobile/watchlist/state',
    'SCANNER_RUNNING_SYMBOLS_LOCKED',
    'LOCKED_WHILE_SCANNER_RUNNING',
    'Stop trading before adding or removing symbols',
    'symInput:disabled',
    'symInput2:disabled',
    'data-watch-locked-action',
    'blockSymbolMutationWhileRunning',
    'x-moe-symbol-lock',
    'Scanner active — selected symbols are frozen',
  ]) {
    assert.equal(source.includes(token), true, `missing symbol-lock token: ${token}`);
  }
  assert.match(source, /if \(pathname === SCAN_SOURCE_MODE_PATH\)/);
  assert.match(source, /return json\([\s\S]*SCANNER_RUNNING_SYMBOLS_LOCKED[\s\S]*409/);
  assert.match(source, /event\.stopImmediatePropagation\(\)/);
  assert.match(source, /runtime = await coordinator\(env\)\.mobileDashboardRuntime\(\)/);
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
  assert.equal(source.includes('placeWebullSandboxOrder'), false);
  assert.equal(source.includes('placeWebullLiveOrder'), false);
  assert.equal(source.includes("WEBULL_LIVE_TRADING: 'true'"), false);
  assert.equal(source.includes("WEBULL_LIVE_ORDER_SUBMISSION: 'true'"), false);
  assert.equal(source.includes("WEBULL_LIVE_AUTOMATION_ARMED: 'true'"), false);
});
