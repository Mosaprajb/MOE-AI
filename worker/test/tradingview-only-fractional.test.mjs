import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../src/tradingview-only-runtime-safety.js', import.meta.url), 'utf8');
const settings = readFileSync(new URL('../src/tradingview-only-settings-v2.js', import.meta.url), 'utf8');
const broker = readFileSync(new URL('../src/tradingview-only-broker.js', import.meta.url), 'utf8');

test('whole-trade sizing uses whole equity shares and long-only orders', () => {
  assert.match(runtime, /function wholeShareQuantity\(dollarAmount, sharePrice\)/);
  assert.match(runtime, /Math\.floor\(amount \/ priceValue\)/);
  assert.match(runtime, /takeProfitDollars \/ quantity/);
  assert.match(runtime, /stopLossDollars \/ quantity/);
  assert.match(settings, /wholeSharesOnly: true/);
  assert.match(settings, /wholeTradeTargets: true/);
  assert.match(broker, /instrument_type: 'EQUITY'/);
  assert.equal(broker.includes("side: 'SHORT'"), false);
  assert.equal(broker.includes("instrument_type: 'OPTION'"), false);
  assert.equal(broker.includes("instrument_type: 'FUTURE'"), false);
});

test('cash and margin-long modes remain separate and capped', () => {
  assert.match(runtime, /account\.buyingPower/);
  assert.match(runtime, /account\.cash/);
  assert.match(runtime, /maxBuyingPowerPercent/);
  assert.match(runtime, /Buying-power percentage cap would be exceeded/);
  assert.match(settings, /CASH_LONG_ONLY/);
  assert.match(settings, /CASH_PLUS_MARGIN_LONG/);
  assert.match(settings, /longOnly: true/);
});
