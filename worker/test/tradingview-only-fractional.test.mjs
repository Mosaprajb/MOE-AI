import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const runtime = readFileSync(new URL('../src/tradingview-only-runtime-safety.js', import.meta.url), 'utf8');
const broker = readFileSync(new URL('../src/tradingview-only-broker.js', import.meta.url), 'utf8');

test('fixed-dollar entry sizing uses fractional equity quantity without margin', () => {
  assert.match(runtime, /function fractionalQuantity\(dollarAmount, sharePrice\)/);
  assert.match(runtime, /Math\.floor\(raw \* 1_000_000\) \/ 1_000_000/);
  assert.match(runtime, /account\.cash/);
  assert.match(runtime, /Spot-only cash check failed/);
  assert.match(runtime, /fractionalQuantity: true/);
  assert.match(runtime, /configuredPositionDollars/);
  assert.match(runtime, /estimatedNotional/);
  assert.match(broker, /instrument_type: 'EQUITY'/);
  assert.equal(broker.includes("side: 'SHORT'"), false);
  assert.equal(broker.includes("instrument_type: 'OPTION'"), false);
  assert.equal(broker.includes("instrument_type: 'FUTURE'"), false);
});
