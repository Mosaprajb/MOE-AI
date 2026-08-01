import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  runMoerandHeikinStrategy,
  toHeikinAshiBars,
} from '../src/simulation/moerand-heikin-strategy.js';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');
const registrySource = readFileSync(join(root, 'worker/src/simulation/simulation-strategies.js'), 'utf8');

function bar(t, o, h, l, c, v = 1000) {
  return { t, o, h, l, c, v };
}

const start = Date.UTC(2026, 6, 31, 13, 30);

function risingCrossBars() {
  return [
    bar(start, 98, 99, 97, 98),
    bar(start + 300_000, 98, 100, 97, 99),
    bar(start + 600_000, 100, 103, 99, 102),
  ];
}

function fallingCrossBars() {
  return [
    bar(start, 102, 103, 101, 102),
    bar(start + 300_000, 102, 103, 100, 101),
    bar(start + 600_000, 99, 100, 96, 97),
  ];
}

test('Heikin Ashi conversion uses canonical open, high, low, and close formulas', () => {
  const converted = toHeikinAshiBars([
    bar(start, 100, 104, 98, 102),
    bar(start + 300_000, 102, 106, 100, 104),
  ]);

  assert.equal(converted.length, 2);
  assert.equal(converted[0].c, 101);
  assert.equal(converted[0].o, 101);
  assert.equal(converted[0].h, 104);
  assert.equal(converted[0].l, 98);
  assert.equal(converted[1].c, 103);
  assert.equal(converted[1].o, 101);
  assert.equal(converted[1].h, 106);
  assert.equal(converted[1].l, 100);
});

test('MOERAND BUY requires a bullish rising Heikin Ashi crossover and reports 5m fidelity', () => {
  const result = runMoerandHeikinStrategy({
    symbol: 'AAPL',
    bars: risingCrossBars(),
    previousState: { trailingStop: 100, inPosition: false },
    env: {
      MOERAND_SIMULATION_ATR_PERIOD: '3',
      MOERAND_SIMULATION_KEY_VALUE: '1',
      MOERAND_SIMULATION_MIN_REENTRY_BARS: '2',
      MOERAND_SIMULATION_REQUIRE_BULLISH_CONFIRMATION: 'true',
    },
    simulatedAt: start + 600_000,
  });

  assert.equal(result.detected, true);
  assert.equal(result.accepted, true);
  assert.equal(result.diagnostics.signal, 'BUY');
  assert.equal(result.diagnostics.candleSource, 'HEIKIN_ASHI');
  assert.equal(result.diagnostics.timeframe, '5m');
  assert.equal(result.diagnostics.bullish, true);
  assert.equal(result.diagnostics.rising, true);
  assert.equal(result.opportunity.metadata.candleSource, 'HEIKIN_ASHI');
  assert.equal(result.opportunity.metadata.buyConfirmation, 'BULLISH_AND_RISING_HEIKIN_ASHI');
  assert.equal(result.opportunity.metadata.minimumReentryBars, 2);
});

test('MOERAND SELL is emitted on the simulated signal bar and cooldown blocks an immediate re-entry', () => {
  const sell = runMoerandHeikinStrategy({
    symbol: 'AAPL',
    bars: fallingCrossBars(),
    previousState: { trailingStop: 100, inPosition: true },
    env: { MOERAND_SIMULATION_ATR_PERIOD: '3' },
    simulatedAt: start + 600_000,
  });

  assert.equal(sell.diagnostics.signal, 'SELL');
  assert.equal(sell.closeInstruction.immediate, true);
  assert.equal(sell.closeInstruction.reason, 'HEIKIN_ASHI_ATR_TRAILING_STOP_SIGNAL');
  assert.equal(sell.nextState.inPosition, false);
  assert.equal(sell.nextState.lastExitBarTime, start + 600_000);

  const blocked = runMoerandHeikinStrategy({
    symbol: 'AAPL',
    bars: risingCrossBars(),
    previousState: {
      trailingStop: 100,
      inPosition: false,
      lastExitBarTime: start + 300_000,
    },
    env: {
      MOERAND_SIMULATION_ATR_PERIOD: '3',
      MOERAND_SIMULATION_MIN_REENTRY_BARS: '2',
    },
    simulatedAt: start + 600_000,
  });

  assert.equal(blocked.detected, false);
  assert.equal(blocked.diagnostics.cooldownPassed, false);
});

test('simulation registry routes MOERAND_SIMPLE_INTERNAL through the Heikin Ashi implementation', () => {
  assert.match(registrySource, /runMoerandHeikinStrategy/);
  assert.match(registrySource, /\.\/moerand-heikin-strategy\.js/);
});
