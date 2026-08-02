import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SIMULATION_STRATEGY_CONCURRENT_LIMIT_REASON,
  SIMULATION_STRATEGY_DAILY_LIMIT_REASON,
  SIMULATION_STRATEGY_SYMBOL_OPEN_REASON,
  createSimulationStrategyLimits,
  evaluateSimulationStrategyCapacity,
  recordSimulationStrategyTrade,
  simulationStrategyCapacitySnapshot,
} from '../src/simulation/simulation-strategy-capacity.js';
import {
  SIMULATION_STRATEGIES,
  normalizeSimulationStrategies,
  runSimulationStrategies,
} from '../src/simulation/simulation-strategies-v2.js';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');
const engineSource = readFileSync(join(root, 'worker/src/simulation/simulation-engine.js'), 'utf8');

const dayOne = Date.UTC(2026, 6, 30, 14, 0);
const dayTwo = Date.UTC(2026, 6, 31, 14, 0);

function state(strategyIds = Object.values(SIMULATION_STRATEGIES), env = {}) {
  return {
    selectedStrategies: strategyIds,
    strategyLimits: createSimulationStrategyLimits(strategyIds, env),
    strategyCapacity: null,
    activeTrades: {},
  };
}

function bars() {
  return Array.from({ length: 16 }, (_, index) => {
    const close = 100 + index * 0.2;
    return {
      t: dayOne + index * 300_000,
      o: close - 0.1,
      h: close + 0.3,
      l: close - 0.25,
      c: close,
      v: 10_000 + index * 100,
    };
  });
}

test('simulation strategy registry exposes the configured 1, 2, and 20 session limits', () => {
  const limits = createSimulationStrategyLimits(Object.values(SIMULATION_STRATEGIES));
  assert.equal(limits.FUSION_V2.maxDailyTrades, 1);
  assert.equal(limits.MOERAND_SIMPLE_INTERNAL.maxDailyTrades, 2);
  assert.equal(limits.MOERAND_SCALP_INTERNAL.maxDailyTrades, 20);
  assert.equal(limits.FUSION_V2.maxConcurrentPositions, 1);
  assert.equal(limits.MOERAND_SIMPLE_INTERNAL.maxConcurrentPositions, 1);
  assert.equal(limits.MOERAND_SCALP_INTERNAL.maxConcurrentPositions, 1);
});

test('daily trade decisions block each strategy exactly at its own session ceiling', () => {
  const value = state();
  const expected = {
    FUSION_V2: 1,
    MOERAND_SIMPLE_INTERNAL: 2,
    MOERAND_SCALP_INTERNAL: 20,
  };

  for (const [strategyId, maximum] of Object.entries(expected)) {
    for (let index = 0; index < maximum; index += 1) {
      const before = evaluateSimulationStrategyCapacity(value, strategyId, `SYM${index}`, {}, dayOne);
      assert.equal(before.allowed, true);
      recordSimulationStrategyTrade(value, strategyId, {}, dayOne);
    }
    const blocked = evaluateSimulationStrategyCapacity(value, strategyId, 'NEXT', {}, dayOne);
    assert.equal(blocked.allowed, false);
    assert.equal(blocked.reason, SIMULATION_STRATEGY_DAILY_LIMIT_REASON);
    assert.equal(blocked.dailyTrades, maximum);
    assert.equal(blocked.maxDailyTrades, maximum);
  }
});

test('per-strategy counters reset at the next America/New_York session boundary', () => {
  const value = state(['FUSION_V2']);
  recordSimulationStrategyTrade(value, 'FUSION_V2', {}, dayOne);
  assert.equal(
    evaluateSimulationStrategyCapacity(value, 'FUSION_V2', 'SPY', {}, dayOne).allowed,
    false,
  );

  const nextSession = evaluateSimulationStrategyCapacity(value, 'FUSION_V2', 'SPY', {}, dayTwo);
  assert.equal(nextSession.allowed, true);
  assert.equal(nextSession.dailyTrades, 0);
  const snapshot = simulationStrategyCapacitySnapshot(value, {}, dayTwo);
  assert.equal(snapshot.strategies[0].dailyTrades, 0);
  assert.equal(Object.keys(snapshot.sessions).length, 2);
});

test('open simulated positions enforce the strategy concurrent ceiling independently', () => {
  const value = state(['MOERAND_SIMPLE_INTERNAL']);
  value.activeTrades['MOERAND_SIMPLE_INTERNAL:SPY'] = {
    sourceStrategy: 'MOERAND_SIMPLE_INTERNAL',
    symbol: 'SPY',
    status: 'FILLED',
  };

  const sameSymbol = evaluateSimulationStrategyCapacity(
    value,
    'MOERAND_SIMPLE_INTERNAL',
    'SPY',
    {},
    dayOne,
  );
  assert.equal(sameSymbol.reason, SIMULATION_STRATEGY_SYMBOL_OPEN_REASON);

  const anotherSymbol = evaluateSimulationStrategyCapacity(
    value,
    'MOERAND_SIMPLE_INTERNAL',
    'QQQ',
    {},
    dayOne,
  );
  assert.equal(anotherSymbol.reason, SIMULATION_STRATEGY_CONCURRENT_LIMIT_REASON);
  assert.equal(anotherSymbol.openPositions, 1);
  assert.equal(anotherSymbol.maxConcurrentPositions, 1);
});

test('extended simulation registry accepts and runs MOERAND_SCALP_INTERNAL independently', async () => {
  const selected = normalizeSimulationStrategies([
    'FUSION_V2',
    'MOERAND_SIMPLE_INTERNAL',
    'MOERAND_SCALP_INTERNAL',
  ]);
  assert.deepEqual(selected, [
    'FUSION_V2',
    'MOERAND_SIMPLE_INTERNAL',
    'MOERAND_SCALP_INTERNAL',
  ]);

  const execution = await runSimulationStrategies({
    selectedStrategies: ['MOERAND_SCALP_INTERNAL'],
    symbol: 'SPY',
    bars: bars(),
    strategyState: {},
    env: {},
    simulatedAt: bars().at(-1).t,
  });
  assert.equal(execution.results.length, 1);
  assert.equal(execution.results[0].strategy, 'MOERAND_SCALP_INTERNAL');
  assert.ok(Object.hasOwn(execution.strategyState, 'MOERAND_SCALP_INTERNAL:SPY'));
});

test('historical engine converts capacity blocks into rejected audit events before order creation', () => {
  assert.match(engineSource, /evaluateSimulationStrategyCapacity/);
  assert.match(engineSource, /SIMULATION_STRATEGY_CAPACITY_BLOCKED/);
  assert.match(engineSource, /recordSimulationStrategyTrade/);
  assert.match(engineSource, /processExistingTrades\(state, symbol, current, closeInstructions\)/);
  assert.match(engineSource, /simulation-strategies-v2\.js/);
});
