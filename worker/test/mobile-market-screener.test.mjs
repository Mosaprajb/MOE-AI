import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const compatibilitySource = readFileSync(join(root, 'worker/src/sandbox-mobile-market-screener-resilient-entry.js'), 'utf8');
const platformSource = readFileSync(join(root, 'worker/src/sandbox-market-platform-entry.js'), 'utf8');
const resilientCoreSource = readFileSync(join(root, 'worker/src/sandbox-mobile-market-screener-resilient-core.js'), 'utf8');
const source = readFileSync(join(root, 'worker/src/sandbox-mobile-market-screener-entry.js'), 'utf8');
const watchlistSource = readFileSync(join(root, 'worker/src/sandbox-mobile-live-watchlist-entry.js'), 'utf8');
const config = JSON.parse(readFileSync(join(root, 'wrangler.sandbox.jsonc'), 'utf8'));

test('mobile market platform preserves the compatible protected screener chain', () => {
  assert.equal(config.main, 'worker/src/sandbox-mobile-market-screener-resilient-entry.js');
  assert.match(compatibilitySource, /from '\.\/sandbox-market-platform-entry\.js'/);
  assert.match(platformSource, /from '\.\/sandbox-mobile-market-screener-resilient-core\.js'/);
  assert.match(resilientCoreSource, /from '\.\/sandbox-mobile-market-screener-entry\.js'/);
  assert.match(source, /from '\.\/sandbox-mobile-live-watchlist-entry\.js'/);
  assert.match(source, /export \{ AlertCoordinator, SimulationDriver \}/);
  assert.match(watchlistSource, /from '\.\/sandbox-moerand-clean-utbot-entry\.js'/);
});

test('screener reads live IEX quotes through resilient independent batches', () => {
  for (const token of [
    '/api/mobile/market-screener',
    '/api/mobile/watchlist/quotes',
    'PRIMARY_BATCH_SIZE = 20',
    'RETRY_BATCH_SIZE = 5',
    'Promise.allSettled',
    'AUTO_SCANNER_SYMBOLS',
    "'x-moe-mobile-client': '1'",
    "feed: 'IEX'",
    'liveTradingLocked: true',
    'liveFundsUsed: false',
  ]) assert.equal(resilientCoreSource.includes(token), true, `missing resilient data token: ${token}`);
  assert.equal(resilientCoreSource.includes('placeWebullSandboxOrder'), false);
  assert.equal(resilientCoreSource.includes('placeWebullLiveOrder'), false);
});

test('Yahoo and Webull style mobile screener exposes filters, sorting, live columns, and multi-select', () => {
  for (const token of [
    'Market Screener',
    'Screener filters',
    'Search ticker or company',
    'All prices',
    'Under $10',
    '$10–$50',
    'Gainers',
    'Losers',
    'Highest volume',
    'Top gainers',
    'Select visible',
    'Add to scanner (0)',
    'data-screener-symbol',
    'Price',
    'Change',
    'Volume',
    'In scanner',
    'openSymbols',
  ]) assert.equal(source.includes(token), true, `missing screener UI token: ${token}`);
});

test('selected rows use verified persistence and remain locked while trading', () => {
  for (const token of [
    '/api/mobile/scanner/selection',
    '/api/scanner/source-mode',
    "mode: 'CURATED_UNIVERSE'",
    'SCANNER_SELECTION_NOT_PERSISTED',
    'SCANNER_RUNNING_SYMBOLS_LOCKED',
    'x-moe-scanner-selection-verified',
    'window.__moeRefreshSelectedWatchlist',
    'moe:screener-symbols-saved',
  ]) assert.equal(platformSource.includes(token), true, `missing verified selection token: ${token}`);
  assert.match(source, /saved\.size\+pending\.size>=30/);
  assert.match(source, /locked=payload\.locked===true/);
});

test('embedded market screener browser script parses successfully', () => {
  const match = source.match(/const SCREENER_SCRIPT = String\.raw`[\s\S]*?<script[^>]*>\n([\s\S]*?)\n<\/script>`;/);
  assert.ok(match, 'embedded market screener script was not found');
  assert.doesNotThrow(() => new Function(match[1]));
});
