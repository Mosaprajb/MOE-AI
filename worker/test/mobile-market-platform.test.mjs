import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const compatibilitySource = readFileSync(join(root, 'worker/src/sandbox-mobile-market-screener-resilient-entry.js'), 'utf8');
const source = readFileSync(join(root, 'worker/src/sandbox-market-platform-entry.js'), 'utf8');
const resilientCoreSource = readFileSync(join(root, 'worker/src/sandbox-mobile-market-screener-resilient-core.js'), 'utf8');
const config = JSON.parse(readFileSync(join(root, 'wrangler.sandbox.jsonc'), 'utf8'));

test('market platform is deployed through the compatible resilient entry', () => {
  assert.equal(config.main, 'worker/src/sandbox-mobile-market-screener-resilient-entry.js');
  assert.match(compatibilitySource, /from '\.\/sandbox-market-platform-entry\.js'/);
  assert.match(source, /from '\.\/sandbox-mobile-market-screener-resilient-core\.js'/);
  assert.match(resilientCoreSource, /from '\.\/sandbox-mobile-market-screener-entry\.js'/);
  assert.match(source, /export \{ AlertCoordinator, SimulationDriver \}/);
  assert.equal(config.vars.MOE_MARKET_PLATFORM_ENABLED, 'true');
  assert.equal(config.vars.MOE_FRED_MACRO_ENABLED, 'false');
});

test('scanner selection is verified with server read-back before reporting success', () => {
  for (const token of [
    '/api/mobile/scanner/selection',
    '/api/mobile/watchlist/state',
    '/api/scanner/source-mode',
    'SCANNER_SELECTION_NOT_PERSISTED',
    'SCANNER_RUNNING_SYMBOLS_LOCKED',
    'x-moe-scanner-selection-verified',
    'sameSymbols(verifiedState.symbols, symbols)',
    'maximumSymbols: MAX_SELECTED_SYMBOLS',
  ]) assert.equal(source.includes(token), true, `missing atomic selection token: ${token}`);
});

test('account and platform overview endpoints are read-only aggregations', () => {
  for (const token of [
    '/api/mobile/account/overview',
    '/api/mobile/platform/overview',
    '/api/trading-intelligence/portfolio-risk',
    '/api/health',
    '/api/trading/mode',
    'readOnly: account.readOnly !== false',
    'finiteNumber(account.cashBalance)',
    'callBaseSafely',
    'liveTradingLocked: true',
    'liveFundsUsed: false',
  ]) assert.equal(source.includes(token), true, `missing platform overview token: ${token}`);
  assert.equal(source.includes('placeWebullSandboxOrder'), false);
  assert.equal(source.includes('placeWebullLiveOrder'), false);
});

test('research catalog includes every user-provided market reference and enforces licensed ingestion', () => {
  for (const name of [
    'Finviz', 'Fiscal AI', 'Koyfin', 'Capitol Trades', 'TradingView',
    'StockAnalysis', 'Macrotrends', 'FRED', 'OneInsider', 'Simply Wall St',
    'Finchat', 'Investing.com', 'Investopedia', 'Quiver Quantitative', 'WhaleWisdom',
  ]) assert.equal(source.includes(`name: '${name}'`), true, `missing research source: ${name}`);
  assert.match(source, /OFFICIAL_OR_LICENSED_DATA_ONLY/);
  assert.match(source, /official API or explicit license/);
});

test('FRED macro layer is optional, cached, and never creates an execution signal', () => {
  for (const token of [
    'https://api.stlouisfed.org/fred/series/observations',
    "id: 'DFF'",
    "id: 'DGS10'",
    "id: 'VIXCLS'",
    "id: 'UNRATE'",
    'FRED_API_KEY',
    'MOE_FRED_MACRO_ENABLED',
    'executionSignal: false',
    'FRED_CACHE_SECONDS = 900',
  ]) assert.equal(source.includes(token), true, `missing FRED safety token: ${token}`);
});

test('mobile enhancement refreshes the selected watchlist after verified writes', () => {
  assert.match(source, /window\.__moeRefreshSelectedWatchlist/);
  assert.match(source, /moe:screener-symbols-saved/);
  assert.match(source, /touch-action:manipulation/);
  const match = source.match(/const PLATFORM_SCRIPT = String\.raw`\n<script[^>]*>\n([\s\S]*?)\n<\/script>`;/);
  assert.ok(match, 'embedded platform script was not found');
  assert.doesNotThrow(() => new Function(match[1]));
});
