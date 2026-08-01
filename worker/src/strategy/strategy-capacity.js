// Per-strategy Sandbox entry-capacity enforcement.
//
// This module adds a stricter strategy layer before the existing portfolio-wide risk pipeline.
// It never grants execution authority and never changes the global portfolio risk ceilings.

import {
  finalizeOrderReservation,
  releaseOrderReservation,
  reserveOrderSubmission,
} from '../order-reservation.js';
import {
  STRATEGY_IDS,
  getStrategyDefinition,
  strategyIdFromRecord,
  strategyRegistry,
} from './strategy-registry.js';

export const STRATEGY_CAPACITY_SCHEMA = 'MOE.StrategyCapacity';
export const STRATEGY_CAPACITY_VERSION = '1.0.0';
export const STRATEGY_CAPACITY_API_PATH = '/api/strategies/capacity';
export const STRATEGY_CAPACITY_LEASE_KEY = 'strategy-capacity:leases:v1';
export const STRATEGY_CAPACITY_AUDIT_KEY = 'strategy-capacity:audit:v1';

export const STRATEGY_CAPACITY_BLOCKERS = Object.freeze({
  DAILY: 'STRATEGY_MAX_DAILY_TRADES_REACHED',
  CONCURRENT: 'STRATEGY_MAX_CONCURRENT_POSITIONS_REACHED',
  STRATEGY_REQUIRED: 'STRATEGY_ID_REQUIRED',
});

const EXCHANGE_TIME_ZONE = 'America/New_York';
const TRADE_KEY = 'trade-history:v1';
const MAX_LEASES = 2_000;
const MAX_AUDIT_EVENTS = 1_000;
const RESERVED_STATUS = 'RESERVED';
const SUBMITTED_STATUS = 'SUBMITTED';
const RELEASED_STATUS = 'RELEASED';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function timestamp(value, fallback = Date.now()) {
  const parsed = value instanceof Date ? value.getTime() : new Date(value ?? fallback).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

export function strategyCapacityDateKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EXCHANGE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function normalizedLeases(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter(([, lease]) => lease && typeof lease === 'object'));
}

async function readLeases(storage) {
  return normalizedLeases(await storage.get(STRATEGY_CAPACITY_LEASE_KEY));
}

async function writeLeases(storage, leases) {
  const ordered = Object.values(normalizedLeases(leases))
    .sort((left, right) => timestamp(right.updatedAt || right.createdAt, 0) - timestamp(left.updatedAt || left.createdAt, 0))
    .slice(0, MAX_LEASES);
  const output = Object.fromEntries(ordered.map((lease) => [lease.id, lease]));
  await storage.put(STRATEGY_CAPACITY_LEASE_KEY, output);
  return output;
}

async function readTrades(storage) {
  const trades = await storage.get(TRADE_KEY);
  return Array.isArray(trades) ? trades : [];
}

function tradeForLease(lease, trades) {
  if (!lease) return null;
  return trades.find((trade) => (
    (lease.tradeId && text(trade?.id) === text(lease.tradeId))
    || (lease.signalId && text(trade?.signalId) === text(lease.signalId))
  )) || null;
}

function leaseIsSubmittedToday(lease, day) {
  if (text(lease?.status).toUpperCase() !== SUBMITTED_STATUS) return false;
  return strategyCapacityDateKey(lease.submittedAt || lease.updatedAt || lease.createdAt) === day;
}

function leaseUsesConcurrentSlot(lease, trades, nowMs) {
  const status = text(lease?.status).toUpperCase();
  if (status === RESERVED_STATUS) return finite(lease.expiresAt, 0) > nowMs;
  if (status !== SUBMITTED_STATUS) return false;

  const trade = tradeForLease(lease, trades);
  if (trade) return text(trade.status).toUpperCase() === 'OPEN';
  // Fail closed while the submitted broker order is waiting for trade-history reconciliation.
  return finite(lease.expiresAt, 0) > nowMs;
}

function publicLease(lease) {
  if (!lease) return null;
  return {
    id: lease.id,
    reservationId: lease.reservationId || null,
    strategyId: lease.strategyId,
    signalId: lease.signalId || null,
    symbol: lease.symbol || null,
    status: lease.status,
    createdAt: lease.createdAt,
    submittedAt: lease.submittedAt || null,
    updatedAt: lease.updatedAt,
    expiresAt: lease.expiresAt,
    tradeId: lease.tradeId || null,
    releaseReason: lease.releaseReason || null,
  };
}

function publicGlobalLimits(env = {}) {
  return deepFreeze({
    maximumOpenPositions: Math.max(1, Math.floor(finite(env.MOE_MAX_OPEN_POSITIONS, 4))),
    maximumDailyTrades: Math.max(1, Math.floor(finite(env.MOE_MAX_DAILY_TRADES, 4))),
    maximumDailyLossPercent: Math.max(0, finite(env.MOE_MAX_DAILY_LOSS_PERCENT, 0)),
    maximumPortfolioRiskPercent: Math.max(0, finite(env.MOE_MAX_PORTFOLIO_RISK_PERCENT, 0)),
    maximumOpenRiskPercent: Math.max(0, finite(env.MOE_MAX_OPEN_RISK_PERCENT, 0)),
    sandboxPilotMaximumSubmissionsTotal: Math.max(0, Math.floor(finite(env.MOE_SANDBOX_PILOT_MAX_SUBMISSIONS_TOTAL, 0))),
    authoritative: true,
    perStrategyLimitsCanBypass: false,
  });
}

export async function buildStrategyCapacitySnapshot(storage, env = {}, { now = Date.now() } = {}) {
  const nowMs = timestamp(now);
  const day = strategyCapacityDateKey(nowMs);
  const [leases, trades] = await Promise.all([readLeases(storage), readTrades(storage)]);
  const registry = strategyRegistry(env);
  const strategies = registry.strategies.map((definition) => {
    const strategyLeases = Object.values(leases).filter((lease) => lease.strategyId === definition.id);
    const dailyTrades = strategyLeases.filter((lease) => leaseIsSubmittedToday(lease, day)).length;
    const concurrentPositions = strategyLeases.filter((lease) => leaseUsesConcurrentSlot(lease, trades, nowMs)).length;
    const dailyLimitReached = dailyTrades >= definition.maxDailyTrades;
    const concurrentLimitReached = concurrentPositions >= definition.maxConcurrentPositions;
    const blockReason = dailyLimitReached
      ? STRATEGY_CAPACITY_BLOCKERS.DAILY
      : concurrentLimitReached
        ? STRATEGY_CAPACITY_BLOCKERS.CONCURRENT
        : null;
    return deepFreeze({
      id: definition.id,
      label: definition.label,
      shortLabel: definition.shortLabel,
      enabled: definition.enabled,
      longOnly: true,
      spotEquitiesOnly: true,
      dailyTrades,
      maxDailyTrades: definition.maxDailyTrades,
      remainingDailyTrades: Math.max(0, definition.maxDailyTrades - dailyTrades),
      concurrentPositions,
      maxConcurrentPositions: definition.maxConcurrentPositions,
      remainingConcurrentPositions: Math.max(0, definition.maxConcurrentPositions - concurrentPositions),
      dailyLimitReached,
      concurrentLimitReached,
      entryEnabled: definition.enabled && !dailyLimitReached && !concurrentLimitReached,
      blockReason,
      existingPositionsManaged: true,
      display: `${dailyTrades} / ${definition.maxDailyTrades}`,
      configuration: definition.configuration,
    });
  });

  return deepFreeze({
    schema: STRATEGY_CAPACITY_SCHEMA,
    schemaVersion: STRATEGY_CAPACITY_VERSION,
    day,
    resetBoundary: {
      timeZone: EXCHANGE_TIME_ZONE,
      sharedWithPortfolioDailyLimits: true,
      secondResetScheduleIntroduced: false,
    },
    updatedAt: iso(nowMs),
    strategies,
    byStrategy: Object.freeze(Object.fromEntries(strategies.map((strategy) => [strategy.id, strategy]))),
    globalPortfolioLimits: publicGlobalLimits(env),
    globalPortfolioGatesRemainAuthoritative: true,
    longOnly: true,
    spotEquitiesOnly: true,
  });
}

export async function recordStrategyCapacityAudit(storage, event = {}) {
  const createdAt = iso(event.createdAt);
  const normalized = deepFreeze({
    id: text(event.id, `strategy-audit-${crypto.randomUUID()}`),
    type: text(event.type, 'STRATEGY_CAPACITY_EVENT').toUpperCase(),
    code: text(event.code, 'STRATEGY_CAPACITY_EVENT').toUpperCase(),
    reason: text(event.reason, event.code || 'STRATEGY_CAPACITY_EVENT'),
    strategyId: strategyIdFromRecord(event, STRATEGY_IDS.FUSION_V2),
    symbol: text(event.symbol).toUpperCase() || null,
    opportunityId: text(event.opportunityId) || null,
    reservationId: text(event.reservationId) || null,
    tradeId: text(event.tradeId) || null,
    dailyTrades: event.dailyTrades == null ? null : finite(event.dailyTrades),
    maxDailyTrades: event.maxDailyTrades == null ? null : finite(event.maxDailyTrades),
    concurrentPositions: event.concurrentPositions == null ? null : finite(event.concurrentPositions),
    maxConcurrentPositions: event.maxConcurrentPositions == null ? null : finite(event.maxConcurrentPositions),
    globalPortfolioRiskBypassed: false,
    liveFundsUsed: false,
    createdAt,
  });
  const existing = await storage.get(STRATEGY_CAPACITY_AUDIT_KEY);
  await storage.put(
    STRATEGY_CAPACITY_AUDIT_KEY,
    [normalized, ...(Array.isArray(existing) ? existing : [])].slice(0, MAX_AUDIT_EVENTS),
  );
  console.log(JSON.stringify({ event: 'STRATEGY_CAPACITY_AUDIT', ...normalized }));
  return normalized;
}

export async function listStrategyCapacityAudit(storage, { limit = 100 } = {}) {
  const events = await storage.get(STRATEGY_CAPACITY_AUDIT_KEY);
  return (Array.isArray(events) ? events : []).slice(0, Math.max(1, Math.min(500, finite(limit, 100))));
}

function capacityBlock(strategy) {
  if (!strategy) return STRATEGY_CAPACITY_BLOCKERS.STRATEGY_REQUIRED;
  if (strategy.dailyLimitReached) return STRATEGY_CAPACITY_BLOCKERS.DAILY;
  if (strategy.concurrentLimitReached) return STRATEGY_CAPACITY_BLOCKERS.CONCURRENT;
  return null;
}

export function applyStrategyCapacityToSelection(selection = {}, capacitySnapshot) {
  const selected = Array.isArray(selection?.selected) ? selection.selected : [];
  const allowed = [];
  const blocked = [];
  for (const record of selected) {
    const strategyId = strategyIdFromRecord(record, STRATEGY_IDS.FUSION_V2);
    const capacity = capacitySnapshot?.byStrategy?.[strategyId] || null;
    const code = capacityBlock(capacity);
    if (!code) {
      allowed.push({
        ...record,
        strategyId,
        opportunity: record?.opportunity && typeof record.opportunity === 'object'
          ? {
            ...record.opportunity,
            metadata: {
              ...(record.opportunity.metadata || {}),
              strategyId,
              sourceStrategy: record.opportunity.metadata?.sourceStrategy || strategyId,
            },
          }
          : record?.opportunity,
      });
      continue;
    }
    blocked.push({
      code,
      strategyId,
      symbol: text(record?.symbol ?? record?.opportunity?.symbol).toUpperCase() || null,
      opportunityId: text(record?.id ?? record?.opportunity?.id) || null,
      dailyTrades: capacity?.dailyTrades ?? null,
      maxDailyTrades: capacity?.maxDailyTrades ?? null,
      concurrentPositions: capacity?.concurrentPositions ?? null,
      maxConcurrentPositions: capacity?.maxConcurrentPositions ?? null,
      existingPositionsManaged: true,
    });
  }

  const summary = selection?.summary && typeof selection.summary === 'object' ? selection.summary : {};
  return {
    selection: {
      ...selection,
      selected: allowed,
      strategyCapacityBlocked: blocked,
      summary: {
        ...summary,
        selected: allowed.length,
        strategyCapacityBlocked: blocked.length,
      },
    },
    blocked,
  };
}

async function updateLease(storage, matcher, patch) {
  const leases = await readLeases(storage);
  const entry = Object.entries(leases).find(([, lease]) => matcher(lease));
  if (!entry) return null;
  const [id, lease] = entry;
  leases[id] = { ...lease, ...patch, id, updatedAt: iso() };
  await writeLeases(storage, leases);
  return leases[id];
}

export async function reserveStrategyOrderSubmission(storage, input = {}, env = {}) {
  const strategyId = strategyIdFromRecord(input, STRATEGY_IDS.FUSION_V2);
  const definition = getStrategyDefinition(strategyId, env);
  const capacitySnapshot = await buildStrategyCapacitySnapshot(storage, env, { now: input.now ?? Date.now() });
  const capacity = capacitySnapshot.byStrategy[strategyId];
  const blocker = capacityBlock(capacity);

  if (blocker) {
    const audit = await recordStrategyCapacityAudit(storage, {
      type: 'STRATEGY_ENTRY_BLOCKED',
      code: blocker,
      reason: blocker,
      strategyId,
      symbol: input.symbol,
      opportunityId: input.opportunityId,
      dailyTrades: capacity?.dailyTrades,
      maxDailyTrades: capacity?.maxDailyTrades,
      concurrentPositions: capacity?.concurrentPositions,
      maxConcurrentPositions: capacity?.maxConcurrentPositions,
    });
    return {
      accepted: false,
      duplicate: false,
      blocker,
      strategyId,
      strategyCapacity: capacity,
      audit,
      globalPortfolioRiskBypassed: false,
    };
  }

  // Persist a short provisional lease before the existing reservation call. A second concurrent
  // RPC sees this lease and cannot oversubscribe the strategy's position capacity.
  const nowMs = timestamp(input.now);
  const provisionalId = `strategy-lease-${crypto.randomUUID()}`;
  const leases = await readLeases(storage);
  leases[provisionalId] = {
    id: provisionalId,
    reservationId: null,
    strategyId,
    signalId: text(input.signalId),
    opportunityId: text(input.opportunityId) || null,
    symbol: text(input.symbol).toUpperCase(),
    status: RESERVED_STATUS,
    createdAt: iso(nowMs),
    submittedAt: null,
    updatedAt: iso(nowMs),
    expiresAt: nowMs + 5 * 60_000,
    tradeId: null,
    releaseReason: null,
  };
  await writeLeases(storage, leases);

  let reservation;
  try {
    reservation = await reserveOrderSubmission(storage, input, env);
  } catch (error) {
    await updateLease(storage, (lease) => lease.id === provisionalId, {
      status: RELEASED_STATUS,
      releaseReason: error instanceof Error ? error.message : 'ORDER_RESERVATION_FAILED',
      expiresAt: Date.now() + 24 * 60 * 60_000,
    });
    throw error;
  }

  if (!reservation?.accepted) {
    await updateLease(storage, (lease) => lease.id === provisionalId, {
      status: RELEASED_STATUS,
      releaseReason: text(reservation?.blocker, 'ORDER_RESERVATION_REJECTED'),
      expiresAt: Date.now() + 24 * 60 * 60_000,
    });
    return { ...reservation, strategyId, strategyCapacity: capacity };
  }

  const baseReservation = reservation.reservation || {};
  const linked = await updateLease(storage, (lease) => lease.id === provisionalId, {
    reservationId: baseReservation.id || null,
    signalId: baseReservation.signalId || text(input.signalId),
    symbol: baseReservation.symbol || text(input.symbol).toUpperCase(),
    expiresAt: finite(baseReservation.expiresAt, nowMs + 5 * 60_000),
  });

  return {
    ...reservation,
    strategyId,
    strategyCapacity: capacity,
    strategyLease: publicLease(linked),
    globalPortfolioRiskBypassed: false,
  };
}

export async function finalizeStrategyOrderReservation(storage, id, patch = {}, env = {}) {
  const finalized = await finalizeOrderReservation(storage, id, patch, env);
  if (!finalized?.updated) return finalized;
  const baseReservation = finalized.reservation || {};
  const submittedAt = iso();
  const lease = await updateLease(storage, (item) => item.reservationId === id, {
    status: SUBMITTED_STATUS,
    submittedAt,
    signalId: baseReservation.signalId || null,
    symbol: baseReservation.symbol || null,
    tradeId: text(patch.tradeId) || baseReservation.tradeId || null,
    expiresAt: finite(baseReservation.expiresAt, Date.now() + 72 * 60 * 60_000),
    releaseReason: null,
  });
  if (lease) {
    const definition = getStrategyDefinition(lease.strategyId, env);
    const snapshot = await buildStrategyCapacitySnapshot(storage, env);
    const capacity = snapshot.byStrategy[lease.strategyId];
    await recordStrategyCapacityAudit(storage, {
      type: 'STRATEGY_TRADE_SUBMITTED',
      code: 'STRATEGY_DAILY_TRADE_RECORDED',
      reason: 'STRATEGY_DAILY_TRADE_RECORDED',
      strategyId: lease.strategyId,
      symbol: lease.symbol,
      reservationId: id,
      tradeId: lease.tradeId,
      dailyTrades: capacity?.dailyTrades,
      maxDailyTrades: definition.maxDailyTrades,
      concurrentPositions: capacity?.concurrentPositions,
      maxConcurrentPositions: definition.maxConcurrentPositions,
    });
  }
  return { ...finalized, strategyLease: publicLease(lease) };
}

export async function releaseStrategyOrderReservation(storage, id, reason = 'RELEASED') {
  const released = await releaseOrderReservation(storage, id, reason);
  const lease = await updateLease(storage, (item) => item.reservationId === id, {
    status: RELEASED_STATUS,
    releaseReason: text(reason, 'RELEASED').slice(0, 160),
    expiresAt: Date.now() + 24 * 60 * 60_000,
  });
  return { ...released, strategyLease: publicLease(lease) };
}
