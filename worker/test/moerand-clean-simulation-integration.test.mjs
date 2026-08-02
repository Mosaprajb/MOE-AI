import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SIMULATION_STRATEGIES,
  normalizeSimulationStrategies,
  runSimulationStrategies,
} from '../src/simulation/simulation-strategies-v2.js';
import {
  createSimulationStrategyLimits,
  evaluateSimulationStrategyCapacity,
  recordSimulationStrategyTrade,
} from '../src/simulation/simulation-strategy-capacity.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const dashboardSource = readFileSync(join(root, 'worker/src/simulation/simulation-dashboard-v2.js'), 'utf8');
const compatibilitySource = readFileSync(join(root, 'worker/src/simulation/simulation-engine-v2.js'), 'utf8');

function bars() {
  const start = Date.parse('2026-08-03T13:30:00.000Z');
  return Array.from({ length: 22 }, (_, index) => {
    const close = 100 + index * 0.25;
    return {
      t: start + index * 300_000,
      o: close - 0.1,
      h: close + 0.2,
      l: close - 0.2,
      c: close,
      v: index === 21 ? 50_000 : 10_000,
    };
  });
}

test('simulation registry selects MOERAND_CLEAN_INTERNAL independently', async () => {
  assert.equal(SIMULATION_STRATEGIES.MOERAND_CLEAN_INTERNAL, 'MOERAND_CLEAN_INTERNAL');
  assert.deepEqual(normalizeSimulationStrategies(['MOERAND_CLEAN_INTERNAL']), ['MOERAND_CLEAN_INTERNAL']);
  const data = bars();
  const execution = await runSimulationStrategies({
    selectedStrategies: ['MOERAND_CLEAN_INTERNAL'],
    symbol: 'TEST',
    bars: data,
    strategyState: {},
    env: {
      MOERAND_CLEAN_TREND_LEN: '2',
      MOERAND_CLEAN_BREAKOUT_LEN: '2',
      MOERAND_CLEAN_RVOL_PERIOD: '2',
      MOERAND_CLEAN_MIN_RVOL: '1.2',
      MOERAND_CLEAN_ATR_PERIOD: '2',
    },
    simulatedAt: data.at(-1).t,
  });
  assert.equal(execution.results.length, 1);
  assert.equal(execution.results[0].strategy, 'MOERAND_CLEAN_INTERNAL');
  assert.ok(Object.hasOwn(execution.strategyState, 'MOERAND_CLEAN_INTERNAL:TEST'));
});

test('MOERAND Clean has its own daily and concurrent simulation capacity', () => {
  const env = {
    MOE_STRATEGY_MOERAND_CLEAN_INTERNAL_MAX_DAILY_TRADES: '2',
    MOE_STRATEGY_MOERAND_CLEAN_INTERNAL_MAX_CONCURRENT_POSITIONS: '1',
  };
  const state = {
    selectedStrategies: ['MOERAND_CLEAN_INTERNAL'],
    strategyLimits: createSimulationStrategyLimits(['MOERAND_CLEAN_INTERNAL'], env),
    activeTrades: {},
  };
  const time = Date.parse('2026-08-03T15:00:00.000Z');
  assert.equal(evaluateSimulationStrategyCapacity(state, 'MOERAND_CLEAN_INTERNAL', 'AAPL', env, time).allowed, true);
  recordSimulationStrategyTrade(state, 'MOERAND_CLEAN_INTERNAL', env, time);
  recordSimulationStrategyTrade(state, 'MOERAND_CLEAN_INTERNAL', env, time);
  const blocked = evaluateSimulationStrategyCapacity(state, 'MOERAND_CLEAN_INTERNAL', 'NVDA', env, time);
  assert.equal(blocked.allowed, false);
  assert.equal(blocked.dailyTrades, 2);
  assert.equal(blocked.maxDailyTrades, 2);
});

test('dashboard and compatibility layer preserve purple badge and close-only trailing semantics', () => {
  assert.match(dashboardSource, /MOERAND_CLEAN_INTERNAL/);
  assert.match(dashboardSource, /sim-badge\.clean\{color:#c084fc\}/);
  assert.match(compatibilitySource, /CLOSED_BAR_TRAILING_OR_SESSION_END_ONLY/);
  assert.match(compatibilitySource, /DISABLED_TARGET_SENTINEL/);
  assert.match(compatibilitySource, /strategyInitialRisk/);
});
