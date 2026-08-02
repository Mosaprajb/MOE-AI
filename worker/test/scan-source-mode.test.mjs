import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SCAN_SOURCE_MODE_AUDIT_KEY,
  SCAN_SOURCE_MODES,
  createScanFilteredFetch,
  readScanSourceMode,
  selectedScanSymbols,
  updateScanSourceMode,
  validateScanSymbols,
} from '../src/scanner/scan-source-mode.js';

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    values,
    async get(key) { return values.get(key); },
    async put(key, value) { values.set(key, value); },
  };
}

test('Full Universe remains the default and preserves all existing symbols', async () => {
  const storage = memoryStorage();
  const mode = await readScanSourceMode(storage, { fullUniverseSize: 306 });
  assert.equal(mode.mode, SCAN_SOURCE_MODES.FULL_UNIVERSE);
  assert.equal(mode.defaultMode, SCAN_SOURCE_MODES.FULL_UNIVERSE);
  assert.equal(mode.activeSymbolCount, 306);
  assert.deepEqual(selectedScanSymbols(mode, ['SPY', 'QQQ', 'NVDA']), ['SPY', 'QQQ', 'NVDA']);
});

test('Curated Universe persists a validated user-maintained symbol list and audit event', async () => {
  const storage = memoryStorage();
  const result = await updateScanSourceMode(storage, {
    mode: SCAN_SOURCE_MODES.CURATED_UNIVERSE,
    symbols: 'aapl, NVDA aapl msft',
  }, { now: Date.parse('2026-08-02T18:00:00.000Z'), actor: 'TEST' });
  assert.equal(result.scanMode.mode, SCAN_SOURCE_MODES.CURATED_UNIVERSE);
  assert.deepEqual(result.scanMode.curatedSymbols, ['AAPL', 'NVDA', 'MSFT']);
  assert.deepEqual(selectedScanSymbols(result.scanMode, ['SPY']), ['AAPL', 'NVDA', 'MSFT']);
  const reread = await readScanSourceMode(storage);
  assert.deepEqual(reread.curatedSymbols, ['AAPL', 'NVDA', 'MSFT']);
  const audit = await storage.get(SCAN_SOURCE_MODE_AUDIT_KEY);
  assert.equal(audit[0].type, 'SCAN_MODE_CHANGED');
  assert.equal(audit[0].mode, SCAN_SOURCE_MODES.CURATED_UNIVERSE);
  assert.equal(audit[0].riskGatesBypassed, false);
  assert.equal(audit[0].liveLockBypassed, false);
});

test('Focused Scan accepts a single ticker, is temporary, and expires back to Full Universe', async () => {
  const storage = memoryStorage();
  const now = Date.parse('2026-08-02T18:00:00.000Z');
  const result = await updateScanSourceMode(storage, {
    mode: SCAN_SOURCE_MODES.FOCUSED_SCAN,
    symbols: ['tsla'],
    ttlMs: 5 * 60_000,
  }, { now });
  assert.deepEqual(result.scanMode.focusedSymbols, ['TSLA']);
  assert.deepEqual(selectedScanSymbols(result.scanMode, ['SPY']), ['TSLA']);

  const expired = await readScanSourceMode(storage, { now: now + 5 * 60_000 + 1, fullUniverseSize: 306 });
  assert.equal(expired.mode, SCAN_SOURCE_MODES.FULL_UNIVERSE);
  assert.deepEqual(expired.focusedSymbols, []);
  assert.equal(expired.activeSymbolCount, 306);
});

test('basic ticker validation rejects malformed manual symbols', async () => {
  const checked = validateScanSymbols(['AAPL', '$BAD', 'TOO-LONG-SYMBOL']);
  assert.equal(checked.valid, false);
  assert.deepEqual(checked.symbols, ['AAPL']);
  assert.deepEqual(checked.invalid, ['$BAD', 'TOO-LONG-SYMBOL']);

  await assert.rejects(
    updateScanSourceMode(memoryStorage(), {
      mode: SCAN_SOURCE_MODES.FOCUSED_SCAN,
      symbols: ['$BAD'],
    }),
    /valid ticker/i,
  );
});

test('manual scan filter changes only Alpaca universe-bar symbol batches', async () => {
  const calls = [];
  const fakeFetch = async (input) => {
    const url = new URL(typeof input === 'string' ? input : input.url);
    calls.push(url.toString());
    return Response.json({ bars: Object.fromEntries((url.searchParams.get('symbols') || '').split(',').filter(Boolean).map((symbol) => [symbol, []])) });
  };
  const filtered = createScanFilteredFetch(fakeFetch, ['NVDA']);

  const matching = await filtered('https://data.alpaca.markets/v2/stocks/bars?symbols=AAPL,NVDA,MSFT&timeframe=5Min');
  assert.equal(matching.ok, true);
  assert.match(calls[0], /symbols=NVDA/);
  assert.doesNotMatch(calls[0], /AAPL/);

  const before = calls.length;
  const empty = await filtered('https://data.alpaca.markets/v2/stocks/bars?symbols=AAPL,MSFT&timeframe=5Min');
  assert.deepEqual(await empty.json(), { bars: {}, next_page_token: null });
  assert.equal(calls.length, before);

  await filtered('https://data.alpaca.markets/v2/stocks/NVDA/snapshot?feed=iex');
  assert.equal(calls.length, before + 1);
  assert.match(calls.at(-1), /snapshot/);
});

test('scan mode contract explicitly isolates symbol routing from strategy and safety logic', async () => {
  const result = await updateScanSourceMode(memoryStorage(), {
    mode: SCAN_SOURCE_MODES.CURATED_UNIVERSE,
    symbols: ['AAPL'],
  });
  assert.equal(result.scanMode.symbolSelectionOnly, true);
  assert.equal(result.scanMode.strategyLogicAffected, false);
  assert.equal(result.scanMode.positionSizingAffected, false);
  assert.equal(result.scanMode.riskGatesAffected, false);
  assert.equal(result.scanMode.liveLockAffected, false);
});
