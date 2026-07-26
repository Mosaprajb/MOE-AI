import { getWebullOpenOrders, getWebullOrderDetail, getWebullPositions } from './webull-client.js';

const TERMINAL_ORDER_STATES = new Set(['FILLED', 'CANCELLED', 'CANCELED', 'REJECTED', 'EXPIRED', 'FAILED']);
const WORKING_ORDER_STATES = new Set(['NEW', 'PENDING', 'PENDING_NEW', 'ACCEPTED', 'WORKING', 'OPEN', 'PARTIALLY_FILLED', 'PARTIAL_FILLED', 'TRIGGER_PENDING']);

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'items', 'orders', 'list', 'positions', 'position_list']) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (value.data && value.data !== value) return pickArray(value.data);
  return [];
}

function normalizeOrderStatus(value) {
  const raw = text(value, 'UNKNOWN').toUpperCase().replace(/[\s-]+/g, '_');
  const aliases = {
    PART_FILLED: 'PARTIALLY_FILLED',
    PARTIAL_FILL: 'PARTIALLY_FILLED',
    PARTIALLYFILLED: 'PARTIALLY_FILLED',
    CANCELED: 'CANCELLED',
    COMPLETE: 'FILLED',
    COMPLETED: 'FILLED',
    SUCCESS: 'FILLED',
    SUBMITTED: 'PENDING',
  };
  return aliases[raw] || raw;
}

function clientOrderId(value = {}) {
  return text(value.client_order_id ?? value.clientOrderId ?? value.client_orderid ?? value.order_client_id);
}

function brokerOrderId(value = {}) {
  return text(value.order_id ?? value.orderId ?? value.broker_order_id ?? value.brokerOrderId);
}

function orderStatus(value = {}) {
  return normalizeOrderStatus(value.status ?? value.order_status ?? value.orderStatus ?? value.state ?? value.order_state);
}

function normalizeOrder(value = {}, expectedClientOrderId = '') {
  const status = orderStatus(value);
  return {
    clientOrderId: clientOrderId(value) || expectedClientOrderId || null,
    brokerOrderId: brokerOrderId(value) || null,
    symbol: text(value.symbol ?? value.ticker?.symbol ?? value.instrument?.symbol).toUpperCase() || null,
    side: text(value.side ?? value.action).toUpperCase() || null,
    orderType: text(value.order_type ?? value.orderType ?? value.type).toUpperCase() || null,
    status,
    quantity: finite(value.quantity ?? value.qty ?? value.total_quantity),
    filledQuantity: finite(value.filled_quantity ?? value.filledQuantity ?? value.cum_quantity ?? value.executed_quantity, 0),
    averageFillPrice: finite(value.avg_fill_price ?? value.average_fill_price ?? value.averageFillPrice ?? value.filled_price),
    limitPrice: finite(value.limit_price ?? value.limitPrice),
    stopPrice: finite(value.stop_price ?? value.stopPrice),
    updatedAt: text(value.updated_at ?? value.update_time ?? value.updatedAt ?? value.last_update_time) || null,
    terminal: TERMINAL_ORDER_STATES.has(status),
    working: WORKING_ORDER_STATES.has(status),
  };
}

function findOrderObject(payload, expectedClientOrderId, depth = 0) {
  if (depth > 10 || payload == null) return null;
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const match = findOrderObject(item, expectedClientOrderId, depth + 1);
      if (match) return match;
    }
    return null;
  }
  if (typeof payload !== 'object') return null;
  const id = clientOrderId(payload);
  if (id && (!expectedClientOrderId || id === expectedClientOrderId)) return payload;
  for (const value of Object.values(payload)) {
    const match = findOrderObject(value, expectedClientOrderId, depth + 1);
    if (match) return match;
  }
  return null;
}

function normalizePosition(value = {}) {
  const quantity = finite(value.quantity ?? value.qty ?? value.position ?? value.holding_quantity, 0);
  return {
    symbol: text(value.symbol ?? value.ticker?.symbol ?? value.instrument?.symbol).toUpperCase(),
    quantity,
    averagePrice: finite(value.average_price ?? value.averagePrice ?? value.cost_price ?? value.avg_price),
    lastPrice: finite(value.last_price ?? value.lastPrice ?? value.market_price ?? value.current_price),
    side: quantity < 0 ? 'SHORT' : 'LONG',
  };
}

function tradeOrderIds(trade = {}) {
  const direct = trade.brokerOrderIds || trade.clientOrderIds || {};
  const replay = trade.decisionReplay?.execution?.submission?.clientOrderIds
    || trade.decisionReplay?.execution?.clientOrderIds
    || {};
  const source = Object.keys(direct).length ? direct : replay;
  return {
    combo: text(source.combo),
    entry: text(source.entry),
    takeProfit: text(source.takeProfit ?? source.take_profit),
    stopLoss: text(source.stopLoss ?? source.stop_loss),
  };
}

function uniqueOrderIds(trades = []) {
  const values = new Set();
  for (const trade of trades) {
    const ids = tradeOrderIds(trade);
    for (const id of [ids.entry, ids.takeProfit, ids.stopLoss]) if (id) values.add(id);
  }
  return [...values];
}

function indexOpenOrders(payload) {
  const map = new Map();
  for (const item of pickArray(payload)) {
    const normalized = normalizeOrder(item);
    if (normalized.clientOrderId) map.set(normalized.clientOrderId, normalized);
  }
  return map;
}

async function orderDetails(accountId, ids, env = {}) {
  const maximum = Math.max(1, Math.min(100, Number(env.WEBULL_LIFECYCLE_MAX_ORDER_DETAILS || 50)));
  const selected = ids.slice(0, maximum);
  const settled = await Promise.allSettled(selected.map(async (id) => {
    const payload = await getWebullOrderDetail(accountId, id, env);
    const match = findOrderObject(payload, id) || payload;
    return normalizeOrder(match, id);
  }));
  const details = new Map();
  const errors = [];
  settled.forEach((result, index) => {
    const id = selected[index];
    if (result.status === 'fulfilled') details.set(id, result.value);
    else errors.push({ clientOrderId: id, error: result.reason instanceof Error ? result.reason.message : String(result.reason || 'Order detail failed') });
  });
  return { details, errors, requested: selected.length, truncated: ids.length > selected.length };
}

export async function readSandboxLifecycleSnapshot(accountId, trades = [], env = {}) {
  if (!accountId) throw new Error('WEBULL_ACCOUNT_ID is required for lifecycle reconciliation');
  if (String(env.WEBULL_ENVIRONMENT || 'sandbox').toLowerCase() !== 'sandbox') throw new Error('Sandbox lifecycle reconciliation cannot run against production');
  if (String(env.WEBULL_LIVE_TRADING || '').toLowerCase() === 'true') throw new Error('Sandbox lifecycle reconciliation is blocked while live trading is configured');

  const [positionsResult, openOrdersResult] = await Promise.allSettled([
    getWebullPositions(accountId, env),
    getWebullOpenOrders(accountId, 100, env),
  ]);
  if (positionsResult.status === 'rejected') throw positionsResult.reason;
  if (openOrdersResult.status === 'rejected') throw openOrdersResult.reason;

  const positions = pickArray(positionsResult.value).map(normalizePosition).filter((item) => item.symbol && item.quantity !== 0);
  const openOrderMap = indexOpenOrders(openOrdersResult.value);
  const ids = uniqueOrderIds(trades);
  const detailResult = await orderDetails(accountId, ids, env);
  const orderMap = new Map(openOrderMap);
  for (const [id, detail] of detailResult.details.entries()) orderMap.set(id, detail);

  return {
    version: 1,
    mode: 'SANDBOX_READ_ONLY',
    fetchedAt: new Date().toISOString(),
    readOnly: true,
    noOrdersSubmitted: true,
    noOrdersModified: true,
    positions,
    orders: Object.fromEntries(orderMap),
    errors: detailResult.errors,
    metrics: {
      brokerPositions: positions.length,
      openOrders: openOrderMap.size,
      trackedOrderIds: ids.length,
      orderDetailsRequested: detailResult.requested,
      orderDetailsTruncated: detailResult.truncated,
    },
  };
}

function protectionState(entry, takeProfit, stopLoss, position) {
  const entryFilled = entry?.status === 'FILLED' || Number(entry?.filledQuantity || 0) > 0 || Boolean(position);
  const takeProfitWorking = Boolean(takeProfit?.working) || takeProfit?.status === 'FILLED';
  const stopLossWorking = Boolean(stopLoss?.working) || stopLoss?.status === 'FILLED';
  if (!entryFilled) return 'WAITING_FOR_ENTRY';
  if (takeProfitWorking && stopLossWorking) return 'PROTECTED';
  if (takeProfitWorking || stopLossWorking) return 'PARTIALLY_PROTECTED';
  return 'UNPROTECTED';
}

export function deriveTradeLifecycle(trade = {}, snapshot = {}) {
  const ids = tradeOrderIds(trade);
  const orders = snapshot.orders || {};
  const entry = ids.entry ? orders[ids.entry] || null : null;
  const takeProfit = ids.takeProfit ? orders[ids.takeProfit] || null : null;
  const stopLoss = ids.stopLoss ? orders[ids.stopLoss] || null : null;
  const symbol = text(trade.symbol).toUpperCase();
  const position = (snapshot.positions || []).find((item) => item.symbol === symbol) || null;
  const protectionStatus = protectionState(entry, takeProfit, stopLoss, position);
  const anomalies = [];
  if (!ids.entry) anomalies.push('ENTRY_ORDER_ID_MISSING');
  if (!ids.takeProfit) anomalies.push('TAKE_PROFIT_ORDER_ID_MISSING');
  if (!ids.stopLoss) anomalies.push('STOP_LOSS_ORDER_ID_MISSING');
  if (protectionStatus === 'UNPROTECTED') anomalies.push('FILLED_POSITION_HAS_NO_WORKING_PROTECTION');
  if (protectionStatus === 'PARTIALLY_PROTECTED') anomalies.push('FILLED_POSITION_IS_PARTIALLY_PROTECTED');

  let lifecycleStatus = 'SUBMITTED';
  if (entry?.status === 'REJECTED' || entry?.status === 'CANCELLED' || entry?.status === 'EXPIRED') lifecycleStatus = `ENTRY_${entry.status}`;
  else if (entry?.status === 'PARTIALLY_FILLED') lifecycleStatus = 'PARTIALLY_FILLED';
  else if (entry?.status === 'FILLED' || position) lifecycleStatus = protectionStatus === 'PROTECTED' ? 'FILLED_PROTECTED' : 'FILLED_REQUIRES_ATTENTION';
  else if (entry?.working) lifecycleStatus = 'PENDING_ENTRY';
  else if (!entry) lifecycleStatus = 'AWAITING_BROKER_CONFIRMATION';

  if (!position && takeProfit?.status === 'FILLED') lifecycleStatus = 'CLOSED_TAKE_PROFIT';
  if (!position && stopLoss?.status === 'FILLED') lifecycleStatus = 'CLOSED_STOP_LOSS';

  return {
    tradeId: trade.id || null,
    signalId: trade.signalId || null,
    symbol,
    checkedAt: snapshot.fetchedAt || new Date().toISOString(),
    lifecycleStatus,
    protectionStatus,
    position,
    orderIds: ids,
    orders: { entry, takeProfit, stopLoss },
    filledQuantity: finite(entry?.filledQuantity, position ? Math.abs(position.quantity) : 0),
    averageFillPrice: finite(entry?.averageFillPrice, position?.averagePrice ?? trade.entryPrice ?? null),
    currentPrice: finite(position?.lastPrice, trade.currentPrice ?? null),
    exitReason: lifecycleStatus === 'CLOSED_TAKE_PROFIT' ? 'TAKE_PROFIT' : lifecycleStatus === 'CLOSED_STOP_LOSS' ? 'STOP_LOSS' : null,
    anomalies,
    attentionRequired: anomalies.length > 0,
  };
}

export function buildLifecycleReport(trades = [], snapshot = {}) {
  const lifecycles = trades.map((trade) => deriveTradeLifecycle(trade, snapshot));
  return {
    version: 1,
    mode: snapshot.mode || 'SANDBOX_READ_ONLY',
    generatedAt: new Date().toISOString(),
    readOnly: true,
    noOrdersSubmitted: true,
    noOrdersModified: true,
    metrics: {
      tradesChecked: lifecycles.length,
      attentionRequired: lifecycles.filter((item) => item.attentionRequired).length,
      protectedPositions: lifecycles.filter((item) => item.protectionStatus === 'PROTECTED').length,
      unprotectedPositions: lifecycles.filter((item) => item.protectionStatus === 'UNPROTECTED').length,
      ...snapshot.metrics,
    },
    lifecycles,
    errors: snapshot.errors || [],
  };
}
