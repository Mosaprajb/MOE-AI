// Additive simulation compatibility layer for close-based, dynamically trailed strategies.
// Existing FUSION_V2, MOERAND_SIMPLE_INTERNAL, and MOERAND_SCALP_INTERNAL behavior is untouched.

import {
  SIMULATION_STATE_KEY,
  completeHistoricalSimulation as completeBaseSimulation,
  readHistoricalSimulation as readBaseSimulation,
  readHistoricalSimulationReport as readBaseSimulationReport,
  startHistoricalSimulation as startBaseSimulation,
  stopHistoricalSimulation as stopBaseSimulation,
  tickHistoricalSimulation as tickBaseSimulation,
} from './simulation-engine.js';
import { MOERAND_CLEAN_STRATEGY_ID } from '../strategies/moerand-clean.js';

const DISABLED_STOP_SENTINEL = -Number.MAX_SAFE_INTEGER;
const DISABLED_TARGET_SENTINEL = Number.MAX_SAFE_INTEGER;

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  return Number(finite(value).toFixed(digits));
}

function outcomeFor(realizedR) {
  return realizedR > 0.01 ? 'WIN' : realizedR < -0.01 ? 'LOSS' : 'FLAT';
}

function metricBucket(outcome) {
  if (outcome === 'WIN') return 'wins';
  if (outcome === 'LOSS') return 'losses';
  return 'flat';
}

function cleanStateKey(symbol) {
  return `${MOERAND_CLEAN_STRATEGY_ID}:${symbol}`;
}

function ensureInitialRiskReference(trade) {
  if (Number.isFinite(Number(trade.strategyInitialStopLoss))) return trade;
  const initialStop = finite(trade.stopLoss, trade.entry - 0.01);
  return {
    ...trade,
    strategyInitialStopLoss: initialStop,
    strategyInitialRisk: Math.max(finite(trade.entry) - initialStop, 0.01),
    closePolicy: 'CLOSED_BAR_TRAILING_OR_SESSION_END_ONLY',
  };
}

async function prepareActiveCleanTrades(storage, { disableGenericLevels = true } = {}) {
  const state = await storage.get(SIMULATION_STATE_KEY);
  if (!state || typeof state !== 'object') return { state, activeIds: new Set(), closedIds: new Set() };
  const activeIds = new Set();
  let changed = false;
  for (const [key, rawTrade] of Object.entries(state.activeTrades || {})) {
    if (rawTrade?.sourceStrategy !== MOERAND_CLEAN_STRATEGY_ID) continue;
    activeIds.add(rawTrade.id);
    const trade = ensureInitialRiskReference(rawTrade);
    state.activeTrades[key] = {
      ...trade,
      stopLoss: disableGenericLevels ? DISABLED_STOP_SENTINEL : trade.strategyInitialStopLoss,
      takeProfit: DISABLED_TARGET_SENTINEL,
    };
    changed = true;
  }
  if (changed) await storage.put(SIMULATION_STATE_KEY, state);
  return {
    state,
    activeIds,
    closedIds: new Set((state.completedTrades || []).map((trade) => trade.id)),
  };
}

function restoreActiveCleanTradeDisplays(state) {
  for (const [key, rawTrade] of Object.entries(state.activeTrades || {})) {
    if (rawTrade?.sourceStrategy !== MOERAND_CLEAN_STRATEGY_ID) continue;
    const trade = ensureInitialRiskReference(rawTrade);
    const strategyState = state.strategyState?.[cleanStateKey(trade.symbol)] || {};
    state.activeTrades[key] = {
      ...trade,
      stopLoss: Number.isFinite(Number(strategyState.stopLevel))
        ? Number(strategyState.stopLevel)
        : trade.strategyInitialStopLoss,
      takeProfit: DISABLED_TARGET_SENTINEL,
      breakevenLocked: strategyState.breakevenLocked === true,
      dynamicTrailingStop: true,
    };
  }
}

function correctedTrade(trade) {
  const initialStop = finite(trade.strategyInitialStopLoss, trade.stopLoss);
  const risk = Math.max(finite(trade.strategyInitialRisk, finite(trade.entry) - initialStop), 0.01);
  const realizedR = round((finite(trade.exitPrice) - finite(trade.entry)) / risk, 3);
  return {
    ...trade,
    stopLoss: initialStop,
    initialStopLoss: initialStop,
    initialRisk: risk,
    takeProfit: null,
    fixedTargetEnabled: false,
    closePolicy: 'CLOSED_BAR_TRAILING_OR_SESSION_END_ONLY',
    realizedR,
    outcome: outcomeFor(realizedR),
  };
}

function replaceTrade(list, corrected) {
  if (!Array.isArray(list)) return list;
  return list.map((trade) => trade.id === corrected.id ? corrected : trade);
}

function adjustMetrics(metrics, before, after) {
  if (!metrics) return;
  metrics.realizedR = round(finite(metrics.realizedR) - finite(before.realizedR) + finite(after.realizedR), 3);
  const oldBucket = metricBucket(before.outcome);
  const newBucket = metricBucket(after.outcome);
  if (oldBucket !== newBucket) {
    metrics[oldBucket] = Math.max(0, finite(metrics[oldBucket]) - 1);
    metrics[newBucket] = finite(metrics[newBucket]) + 1;
  }
  const decided = finite(metrics.wins) + finite(metrics.losses);
  metrics.winRate = decided ? round((finite(metrics.wins) / decided) * 100, 2) : 0;
  metrics.averageR = finite(metrics.closed) ? round(finite(metrics.realizedR) / finite(metrics.closed), 3) : 0;
}

function correctNewlyClosedCleanTrades(state, previousClosedIds) {
  const newClosed = (state.completedTrades || []).filter((trade) => (
    trade.sourceStrategy === MOERAND_CLEAN_STRATEGY_ID
    && !previousClosedIds.has(trade.id)
  ));
  for (const rawTrade of newClosed) {
    const corrected = correctedTrade(rawTrade);
    state.completedTrades = replaceTrade(state.completedTrades, corrected);
    if (state.report) {
      state.report.trades = replaceTrade(state.report.trades, corrected);
      adjustMetrics(state.report.byStrategy?.[MOERAND_CLEAN_STRATEGY_ID], rawTrade, corrected);
    }
    state.timelineEvents = (state.timelineEvents || []).map((event) => (
      event.tradeId === corrected.id && event.type === 'SIMULATED_TRADE_CLOSED'
        ? { ...event, outcome: corrected.outcome, realizedR: corrected.realizedR, closePolicy: corrected.closePolicy }
        : event
    ));
  }
}

async function finalizeCompatibility(storage, previousClosedIds) {
  const state = await storage.get(SIMULATION_STATE_KEY);
  if (!state || typeof state !== 'object') return;
  restoreActiveCleanTradeDisplays(state);
  correctNewlyClosedCleanTrades(state, previousClosedIds);
  await storage.put(SIMULATION_STATE_KEY, state);
}

async function runProtected(storage, operation, options = {}) {
  const prepared = await prepareActiveCleanTrades(storage, options);
  await operation();
  await finalizeCompatibility(storage, prepared.closedIds);
  return readBaseSimulation(storage);
}

export function startHistoricalSimulation(storage, env, options = {}) {
  return startBaseSimulation(storage, env, options);
}

export function tickHistoricalSimulation(storage, env) {
  return runProtected(storage, () => tickBaseSimulation(storage, env), { disableGenericLevels: true });
}

export function completeHistoricalSimulation(storage, env = {}) {
  return runProtected(storage, () => completeBaseSimulation(storage, env), { disableGenericLevels: false });
}

export function stopHistoricalSimulation(storage, env = {}) {
  return runProtected(storage, () => stopBaseSimulation(storage, env), { disableGenericLevels: false });
}

export function readHistoricalSimulation(storage) {
  return readBaseSimulation(storage);
}

export function readHistoricalSimulationReport(storage) {
  return readBaseSimulationReport(storage);
}
