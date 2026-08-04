import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const marketScreener = readFileSync(join(root, 'worker/src/sandbox-mobile-market-screener-entry.js'), 'utf8');
const liveWatchlist = readFileSync(join(root, 'worker/src/sandbox-mobile-live-watchlist-entry.js'), 'utf8');
const wrapper = readFileSync(join(root, 'worker/src/sandbox-moerand-clean-utbot-entry.js'), 'utf8');
const scanner = readFileSync(join(root, 'worker/src/auto-scanner.js'), 'utf8');
const config = readFileSync(join(root, 'wrangler.sandbox.jsonc'), 'utf8');

test('mobile Clean controls are layered over the latest Sandbox account dashboard', () => {
  assert.match(marketScreener, /sandbox-mobile-live-watchlist-entry\.js/);
  assert.match(liveWatchlist, /sandbox-moerand-clean-utbot-entry\.js/);
  assert.match(wrapper, /sandbox-mobile-account-balances-entry\.js/);
  assert.match(wrapper, /\/api\/strategy\/moerand-clean\/settings/);
  assert.match(wrapper, /cleanKeyValue/);
  assert.match(wrapper, /cleanAtrPeriod/);
  assert.match(wrapper, /cleanTimeframe/);
  assert.match(wrapper, /cleanHeikin/);
  assert.match(wrapper, /CANDLE_CLOSE_ONLY/);
  assert.match(wrapper, /timeframeMinutes, 1, 15/);
});

test('selected Clean settings are applied to scheduled scanner cycles', () => {
  assert.match(wrapper, /MOE_ACTIVE_STRATEGY: CLEAN_STRATEGY/);
  assert.match(wrapper, /MOERAND_CLEAN_KEY_VALUE/);
  assert.match(wrapper, /MOERAND_CLEAN_USE_HEIKIN_ASHI/);
  assert.match(wrapper, /AUTO_SCANNER_PROFILES/);
  assert.match(scanner, /createMoerandCleanCandidate/);
  assert.match(scanner, /MOERAND_AUTO_CLEAN_/);
});

test('Sandbox deployment points through the market screener, live watchlist, and Clean UT Bot wrapper chain', () => {
  assert.match(config, /"main": "worker\/src\/sandbox-mobile-market-screener-resilient-entry\.js"/);
  assert.match(marketScreener, /from '\.\/sandbox-mobile-live-watchlist-entry\.js'/);
  assert.match(marketScreener, /\/api\/mobile\/market-screener/);
  assert.match(liveWatchlist, /from '\.\/sandbox-moerand-clean-utbot-entry\.js'/);
  assert.match(liveWatchlist, /\/api\/mobile\/watchlist\/quotes/);
  assert.match(config, /"MOERAND_CLEAN_KEY_VALUE": "1"/);
  assert.match(config, /"MOERAND_CLEAN_USE_HEIKIN_ASHI": "false"/);
});
