import {
  getWebullOpenOrders,
  getWebullOrderDetail,
  getWebullPositions,
} from './webull-client.js';
import {
  ExecutionEvent,
  ExecutionState,
  canTransitionExecution,
  isTerminalExecutionState,
  transitionExecution,
} from './execution-state-machine.js';

const FILLED_STATUSES = new Set(['FILLED', 'FULL_FILLED', 'COMPLETED']);
const PARTIAL_STATUSES = new Set(['PARTIALLY_FILLED', 'PARTIAL_FILLED']);
const CANCELLED_STATUSES = new Set(['CANCELLED', 'CANCELED', 'EXPIRED']);
const REJECTED_STATUSES = new Set(['REJECTED', 'FAILED']);
const ACTIVE_STATUSES = new Set(['NEW', 'PENDING', 'PENDING_NEW', 'SUBMITTED', 'WORKING', 'OPEN', 'TRIGGER_PENDING']);

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase().replaceAll(' ', '_');
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickArray(value, keys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) if (Array.isArray(value[key])) return value[key];
  if (Array.isArray(value.data)) return value.data;
  if (value.data && typeof value.data === 'object') {
    for (const key of keys) if (Array.isArray(value.data[key])) return value.data[key];
  }
  return [];
}

function unwrapOrderDetail(payload) {
  if (!payload || typeof payload !== 'object') return {};
  if (payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)) return payload.data;
  if (payload.order && typeof payload.order === 'object') return payload.order;
  return payload;
}

function normalizeBrokerOrder(payload = {}) {
  const item = unwrapOrderDetail(payload);
  return {
    clientOrderId: String(item.client_order_id || item.clientOrderId || '').trim() || null,
    brokerOrderId: String(item.order_id || item.orderId || '').trim() || null,
    comboOrderId: String(item.combo_order_id || item.comboOrderId || '').trim() || null,
    status: normalizeStatus(item.status || item.order_status || item.orderStatus),
    quantity: firstFinite(item.quantity, item.qty, item.total_quantity, item.order_quantity) || 0,
    filledQuantity: firstFinite(item.filled_quantity, item.filledQuantity, item.cumulative_quantity, item.cum_qty) || 0,
    averagePrice: firstFinite(item.average_price, item.averagePrice, item.avg_fill_price, item.filled_avg_price),
    side: String(item.side || item.action || '').trim().toUpperCase(),
    comboType: String(item.combo_type || item.comboType || '').trim().toUpperCase(),
    raw: item,
  };
}

function normalizePositionQuantity(payload, symbol) {
  const positions = pickArray(payload, ['positions', 'position_list', 'list', 'items']);
  const target = String(symbol || '').toUpperCase();
  const item = positions.find((position) => String(
    position.symbol || position.ticker?.symbol || position.instrument?.symbol || '',
  ).toUpperCase() === target);
  return item
    ? firstFinite(item.quantity, item.qty, item.position, item.holding_quantity, item.position_quantity) || 0
    : 0;
}

function orderIds(record) {
  const ids = record?.broker?.clientOrderIds || {};
  return {
    entry: ids.entry || null,
    takeProfit: ids.takeProfit || null,
    stopLoss: ids.stopLoss || null,
  };
}

async function fetchKnownOrders(record, env) {
  const ids = orderIds(record);
  const entries = Object.entries(ids).filter(([, clientOrderId]) => clientOrderId);
  const settled = await Promise.all(entries.map(async ([role, clientOrderId]) => {
    try {
      const payload = await getWebullOrderDetail(record.accountId, clientOrderId, env);
      return [role, normalizeBrokerOrder(payload), null];
    } catch (error) {
      return [role, null, error instanceof Error ? error.message : String(error)];
    }
  }));
  return Object.fromEntries(settled.map(([role, order, error]) => [role, { order, error }]));
}

function transitionIfAllowed(record, event, details, now) {
  if (!canTransitionExecution(record.state, event)) return record;
  return transitionExecution(record, event, details, now);
}

function applyEntryState(record, entry, now) {
  if (!entry) return record;
  const details = {
    filledQuantity: entry.filledQuantity,
    averagePrice: entry.averagePrice,
    broker: {
      comboOrderId: entry.comboOrderId || record.broker?.comboOrderId || null,
      brokerOrderIds: entry.brokerOrderId ? [entry.brokerOrderId] : [],
    },
  };

  if (PARTIAL_STATUSES.has(entry.status) && entry.filledQuantity > 0) {
    return transitionIfAllowed(record, ExecutionEvent.PARTIAL_FILL_REPORTED, details, now);
  }
  if (FILLED_STATUSES.has(entry.status)) {
    const fullQuantity = entry.filledQuantity || Number(record.fills?.requestedQuantity || record.quantity || 0);
    return transitionIfAllowed(record, ExecutionEvent.ENTRY_FILLED, { ...details, filledQuantity: fullQuantity }, now);
  }
  if (CANCELLED_STATUSES.has(entry.status)) {
    let next = record;
    next = transitionIfAllowed(next, ExecutionEvent.CANCELLATION_REQUESTED, { brokerStatus: entry.status }, now);
    return transitionIfAllowed(next, ExecutionEvent.CANCELLATION_CONFIRMED, { brokerStatus: entry.status }, now);
  }
  if (REJECTED_STATUSES.has(entry.status)) {
    return transitionIfAllowed(record, ExecutionEvent.REJECTION_REPORTED, { brokerStatus: entry.status }, now);
  }
  return record;
}

function applyExitState(record, takeProfit, stopLoss, positionQuantity, now) {
  let next = record;
  if (next.state === ExecutionState.FILLED && (takeProfit || stopLoss)) {
    next = transitionIfAllowed(next, ExecutionEvent.EXIT_ARMED, {}, now);
  }

  if (takeProfit && FILLED_STATUSES.has(takeProfit.status)) {
    next = transitionIfAllowed(next, ExecutionEvent.TAKE_PROFIT_REPORTED, {
      price: takeProfit.averagePrice,
      brokerStatus: takeProfit.status,
      broker: { brokerOrderIds: takeProfit.brokerOrderId ? [takeProfit.brokerOrderId] : [] },
    }, now);
  } else if (stopLoss && FILLED_STATUSES.has(stopLoss.status)) {
    next = transitionIfAllowed(next, ExecutionEvent.STOP_LOSS_REPORTED, {
      price: stopLoss.averagePrice,
      brokerStatus: stopLoss.status,
      broker: { brokerOrderIds: stopLoss.brokerOrderId ? [stopLoss.brokerOrderId] : [] },
    }, now);
  }

  if (positionQuantity === 0 && [
    ExecutionState.FILLED,
    ExecutionState.EXIT_PENDING,
    ExecutionState.TAKE_PROFIT_FILLED,
    ExecutionState.STOP_LOSS_FILLED,
  ].includes(next.state)) {
    next = transitionIfAllowed(next, ExecutionEvent.POSITION_CLOSED, {
      reason: next.exit?.reason || 'BROKER_POSITION_CLOSED',
      price: next.exit?.price,
    }, now);
  }
  return next;
}

export async function pollWebullExecution(record, env = {}, now = new Date()) {
  if (!record?.accountId) throw new Error('Execution record accountId is required');
  if (!record?.symbol) throw new Error('Execution record symbol is required');
  if (isTerminalExecutionState(record.state)) {
    return { changed: false, record, diagnostics: { skipped: 'TERMINAL_STATE' } };
  }

  const [knownOrders, positionsPayload, openOrdersPayload] = await Promise.all([
    fetchKnownOrders(record, env),
    getWebullPositions(record.accountId, env),
    getWebullOpenOrders(record.accountId, 100, env),
  ]);

  const entry = knownOrders.entry?.order || null;
  const takeProfit = knownOrders.takeProfit?.order || null;
  const stopLoss = knownOrders.stopLoss?.order || null;
  const positionQuantity = normalizePositionQuantity(positionsPayload, record.symbol);

  let next = applyEntryState(record, entry, now);
  next = applyExitState(next, takeProfit, stopLoss, positionQuantity, now);

  const openOrders = pickArray(openOrdersPayload, ['orders', 'order_list', 'list', 'items'])
    .map(normalizeBrokerOrder)
    .filter((order) => order.clientOrderId);
  const trackedIds = new Set(Object.values(orderIds(record)).filter(Boolean));
  const trackedOpenOrders = openOrders.filter((order) => trackedIds.has(order.clientOrderId));

  return {
    changed: next.state !== record.state || next.updatedAt !== record.updatedAt,
    record: next,
    diagnostics: {
      checkedAt: now instanceof Date ? now.toISOString() : new Date(now).toISOString(),
      positionQuantity,
      trackedOpenOrderCount: trackedOpenOrders.length,
      knownOrders,
      brokerStatuses: {
        entry: entry?.status || null,
        takeProfit: takeProfit?.status || null,
        stopLoss: stopLoss?.status || null,
      },
      activeStatusSet: [...ACTIVE_STATUSES],
      readOnly: true,
    },
  };
}

export function recommendedLifecyclePollSeconds(record, env = {}) {
  const configured = Math.max(5, Math.min(300, Number(env.WEBULL_LIFECYCLE_POLL_SECONDS) || 15));
  if (!record || isTerminalExecutionState(record.state)) return null;
  if ([ExecutionState.SUBMITTING, ExecutionState.SUBMITTED, ExecutionState.PARTIALLY_FILLED].includes(record.state)) {
    return Math.min(configured, 10);
  }
  return configured;
}
