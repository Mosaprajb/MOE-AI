// Historical simulation strategy-capacity enforcement.
//
// This layer mirrors the per-strategy registry limits while remaining fully isolated from
// broker submission. Counts reset on the same America/New_York session boundary used by the
// trading system. Existing simulated positions remain managed after an entry limit is reached.

import { getStrategyDefinition } from '../strategy/strategy-registry.js';

export const SIMULATION_STRATEGY_DAILY_LIMIT_REASON = 'SIMULATION_STRATEGY_MAX_DAILY_TRADES';
export const SIMULATION_STRATEGY_CONCURRENT_LIMIT_REASON = 'SIMULATION_STRATEGY_MAX_CONCURRENT_POSITIONS';
export const SIMULATION_STRATEGY_SYMBOL_OPEN_REASON = 'SIMULATION_STRATEGY_SYMBOL_POSITION_OPEN';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finiteInteger(value, fallback = 0) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.max(0, parsed) : fallback;
}

function nySessionKey(value) {
  const date = value instanceof Date ? value : new Date(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function strategyLimits(state, strategyId, env = {}) {
  const stored = state?.strategyLimits?.[strategyId];
  if (stored) return stored;
  const definition = getStrategyDefinition(strategyId, env);
  return {
    id: definition.id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    maxDailyTrades: definition.maxDailyTrades,
    maxConcurrentPositions: definition.maxConcurrentPositions,
  };
}

function ensureCapacityState(state, simulatedAt) {
  const sessionKey = nySessionKey(simulatedAt);
  const previous = state.strategyCapacity && typeof state.strategyCapacity === 'object'
    ? state.strategyCapacity
    : {};
  const sessions = previous.sessions && typeof previous.sessions === 'object'
    ? { ...previous.sessions }
    : {};
  if (!sessions[sessionKey] || typeof sessions[sessionKey] !== 'object') sessions[sessionKey] = {};
  state.strategyCapacity = {
    schema: 'MOE.SimulationStrategyCapacity',
    schemaVersion: '1.0.0',
    sessionKey,
    sessions,
  };
  return state.strategyCapacity;
}

function activeTradesForStrategy(state, strategyId) {
  return Object.values(state?.activeTrades || {}).filter((trade) => (
    trade?.sourceStrategy === strategyId
    && (trade.status === 'SUBMITTED' || trade.status === 'FILLED')
  ));
}

export function createSimulationStrategyLimits(strategyIds = [], env = {}) {
  return Object.fromEntries(strategyIds.map((strategyId) => {
    const definition = getStrategyDefinition(strategyId, env);
    return [strategyId, {
      id: definition.id,
      label: definition.label,
      shortLabel: definition.shortLabel,
      maxDailyTrades: definition.maxDailyTrades,
      maxConcurrentPositions: definition.maxConcurrentPositions,
    }];
  }));
}

export function evaluateSimulationStrategyCapacity(
  state,
  strategyId,
  symbol,
  env = {},
  simulatedAt = Date.now(),
) {
  const capacity = ensureCapacityState(state, simulatedAt);
  const limits = strategyLimits(state, strategyId, env);
  const sessionCounts = capacity.sessions[capacity.sessionKey];
  const dailyTrades = finiteInteger(sessionCounts[strategyId]);
  const activeTrades = activeTradesForStrategy(state, strategyId);
  const openPositions = activeTrades.length;
  const sameSymbolOpen = activeTrades.some((trade) => text(trade.symbol).toUpperCase() === text(symbol).toUpperCase());

  let reason = null;
  if (dailyTrades >= limits.maxDailyTrades) reason = SIMULATION_STRATEGY_DAILY_LIMIT_REASON;
  else if (sameSymbolOpen) reason = SIMULATION_STRATEGY_SYMBOL_OPEN_REASON;
  else if (openPositions >= limits.maxConcurrentPositions) reason = SIMULATION_STRATEGY_CONCURRENT_LIMIT_REASON;

  return {
    allowed: reason === null,
    reason,
    strategyId,
    symbol: text(symbol).toUpperCase(),
    sessionKey: capacity.sessionKey,
    dailyTrades,
    maxDailyTrades: limits.maxDailyTrades,
    remainingDailyTrades: Math.max(0, limits.maxDailyTrades - dailyTrades),
    openPositions,
    maxConcurrentPositions: limits.maxConcurrentPositions,
  };
}

export function recordSimulationStrategyTrade(
  state,
  strategyId,
  env = {},
  simulatedAt = Date.now(),
) {
  const capacity = ensureCapacityState(state, simulatedAt);
  const sessionCounts = capacity.sessions[capacity.sessionKey];
  sessionCounts[strategyId] = finiteInteger(sessionCounts[strategyId]) + 1;
  return evaluateSimulationStrategyCapacity(state, strategyId, '', env, simulatedAt);
}

export function simulationStrategyCapacitySnapshot(state, env = {}, simulatedAt = Date.now()) {
  const capacity = ensureCapacityState(state, simulatedAt);
  const strategyIds = Array.isArray(state.selectedStrategies) ? state.selectedStrategies : [];
  return {
    schema: capacity.schema,
    schemaVersion: capacity.schemaVersion,
    sessionKey: capacity.sessionKey,
    sessions: capacity.sessions,
    strategies: strategyIds.map((strategyId) => {
      const limits = strategyLimits(state, strategyId, env);
      const dailyTrades = finiteInteger(capacity.sessions[capacity.sessionKey]?.[strategyId]);
      const openPositions = activeTradesForStrategy(state, strategyId).length;
      return {
        id: strategyId,
        label: limits.label,
        shortLabel: limits.shortLabel,
        dailyTrades,
        maxDailyTrades: limits.maxDailyTrades,
        remainingDailyTrades: Math.max(0, limits.maxDailyTrades - dailyTrades),
        openPositions,
        maxConcurrentPositions: limits.maxConcurrentPositions,
        dailyLimitReached: dailyTrades >= limits.maxDailyTrades,
        concurrentLimitReached: openPositions >= limits.maxConcurrentPositions,
      };
    }),
  };
}
