// Extended simulation strategy registry.
//
// This wrapper preserves the existing FUSION_V2 and MOERAND_SIMPLE_INTERNAL implementations
// while adding MOERAND_SCALP_INTERNAL as an independently tracked strategy.

import {
  SIMULATION_STRATEGIES as BASE_STRATEGIES,
  runSimulationStrategies as runBaseSimulationStrategies,
} from './simulation-strategies.js';
import {
  MOERAND_SCALP_STRATEGY_ID,
  runMoerandScalpStrategy,
} from './moerand-scalp-strategy.js';

export const SIMULATION_STRATEGIES = Object.freeze({
  ...BASE_STRATEGIES,
  MOERAND_SCALP_INTERNAL: MOERAND_SCALP_STRATEGY_ID,
});

const STRATEGY_VALUES = Object.freeze(Object.values(SIMULATION_STRATEGIES));

export function normalizeSimulationStrategies(value) {
  const source = Array.isArray(value) ? value : [value];
  const selected = [...new Set(source
    .map((item) => String(item || '').trim().toUpperCase())
    .filter((item) => STRATEGY_VALUES.includes(item)))];
  if (!selected.length) throw new Error('Select at least one supported simulation strategy.');
  return Object.freeze(selected);
}

export async function runSimulationStrategies({
  selectedStrategies,
  symbol,
  bars,
  strategyState = {},
  env = {},
  simulatedAt = Date.now(),
} = {}) {
  const selected = normalizeSimulationStrategies(selectedStrategies);
  const baseSelected = selected.filter((strategy) => strategy !== MOERAND_SCALP_STRATEGY_ID);
  let nextState = { ...strategyState };
  const byStrategy = new Map();

  if (baseSelected.length) {
    const base = await runBaseSimulationStrategies({
      selectedStrategies: baseSelected,
      symbol,
      bars,
      strategyState: nextState,
      env,
      simulatedAt,
    });
    nextState = base.strategyState;
    for (const result of base.results) byStrategy.set(result.strategy, result);
  }

  if (selected.includes(MOERAND_SCALP_STRATEGY_ID)) {
    const key = `${MOERAND_SCALP_STRATEGY_ID}:${symbol}`;
    const result = runMoerandScalpStrategy({
      symbol,
      bars,
      previousState: nextState[key],
      env,
      simulatedAt,
    });
    nextState[key] = result.nextState;
    byStrategy.set(MOERAND_SCALP_STRATEGY_ID, result);
  }

  return {
    results: selected.map((strategy) => byStrategy.get(strategy)).filter(Boolean),
    strategyState: nextState,
  };
}
