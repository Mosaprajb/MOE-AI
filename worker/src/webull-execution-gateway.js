import {
  getWebullAccountSnapshot,
  placeWebullSandboxOrder,
  webullRequest,
} from './webull-client.js';
import {
  buildWebullInventory,
  evaluateWebullInventoryConflict,
} from './webull-inventory.js';

export const WebullExecutionMode = Object.freeze({
  SANDBOX: 'SANDBOX',
  LIVE: 'LIVE',
});

function enabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function requireValue(value, message) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(message);
  return normalized;
}

function normalizeMode(value) {
  const mode = String(value || WebullExecutionMode.SANDBOX).trim().toUpperCase();
  if (!Object.values(WebullExecutionMode).includes(mode)) throw new Error('Unsupported Webull execution mode');
  return mode;
}

function assertCommonOrder(order = {}) {
  if (!order.symbol) throw new Error('order.symbol is required');
  if (!['BUY', 'SELL'].includes(String(order.side || '').toUpperCase())) throw new Error('order.side must be BUY or SELL');
  if (!Number.isFinite(Number(order.quantity)) || Number(order.quantity) <= 0) throw new Error('order.quantity must be positive');
  if (!['MARKET', 'LIMIT'].includes(String(order.orderType || '').toUpperCase())) throw new Error('Only MARKET and LIMIT entries are supported');
  if (!Number.isFinite(Number(order.stopLoss)) || Number(order.stopLoss) <= 0) throw new Error('Protected order requires stopLoss');
  if (!Number.isFinite(Number(order.takeProfit)) || Number(order.takeProfit) <= 0) throw new Error('Protected order requires takeProfit');
  return order;
}

async function compactOrderIds(signalId) {
  const source = String(signalId || crypto.randomUUID());
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(source));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return {
    combo: `L${hex.slice(0, 31)}`,
    entry: `E${hex.slice(0, 31)}`,
    takeProfit: `T${hex.slice(0, 31)}`,
    stopLoss: `S${hex.slice(0, 31)}`,
  };
}

function buildProtectedOrders(order, ids) {
  const side = String(order.side).toUpperCase();
  const exitSide = side === 'BUY' ? 'SELL' : 'BUY';
  const common = {
    instrument_type: 'EQUITY',
    entrust_type: 'QTY',
    support_trading_session: order.session || 'CORE',
    symbol: String(order.symbol).toUpperCase(),
    market: 'US',
    time_in_force: order.timeInForce || 'DAY',
    quantity: String(order.quantity),
  };
  return [
    {
      ...common,
      client_order_id: ids.entry,
      combo_type: 'MASTER',
      side,
      order_type: order.orderType,
      ...(order.limitPrice ? { limit_price: String(order.limitPrice) } : {}),
    },
    {
      ...common,
      client_order_id: ids.takeProfit,
      combo_type: 'STOP_PROFIT',
      side: exitSide,
      order_type: 'LIMIT',
      limit_price: String(order.takeProfit),
    },
    {
      ...common,
      client_order_id: ids.stopLoss,
      combo_type: 'STOP_LOSS',
      side: exitSide,
      order_type: 'STOP_LOSS',
      stop_price: String(order.stopLoss),
    },
  ];
}

export function evaluateLiveArming({ confirmationToken = '' } = {}, env = {}) {
  const reasons = [];
  if (String(env.WEBULL_ENVIRONMENT || '').toLowerCase() !== 'production') reasons.push('WEBULL_ENVIRONMENT must be production');
  if (!enabled(env.WEBULL_LIVE_TRADING)) reasons.push('WEBULL_LIVE_TRADING is disabled');
  if (!enabled(env.WEBULL_LIVE_ORDER_SUBMISSION)) reasons.push('WEBULL_LIVE_ORDER_SUBMISSION is disabled');
  if (!enabled(env.WEBULL_LIVE_ARMED)) reasons.push('WEBULL_LIVE_ARMED is disabled');
  const expected = String(env.WEBULL_LIVE_CONFIRMATION_TOKEN || '').trim();
  if (!expected) reasons.push('WEBULL_LIVE_CONFIRMATION_TOKEN is not configured');
  else if (String(confirmationToken || '') !== expected) reasons.push('Live confirmation token is invalid');
  return { accepted: reasons.length === 0, reasons, mode: WebullExecutionMode.LIVE };
}

export async function placeWebullLiveOrder(accountId, order, { confirmationToken = '' } = {}, env = {}) {
  requireValue(accountId, 'account_id is required');
  assertCommonOrder(order);
  const arming = evaluateLiveArming({ confirmationToken }, env);
  if (!arming.accepted) throw new Error(`Live Webull order blocked: ${arming.reasons.join('; ')}`);

  const ids = await compactOrderIds(order.signalId);
  const response = await webullRequest('POST', '/openapi/trade/order/place', {
    body: {
      account_id: accountId,
      client_combo_order_id: ids.combo,
      new_orders: buildProtectedOrders(order, ids),
    },
  }, env);
  return {
    mode: WebullExecutionMode.LIVE,
    protected: true,
    clientOrderIds: ids,
    response,
  };
}

export async function prepareWebullExecution({
  accountId,
  order,
  mode = WebullExecutionMode.SANDBOX,
  confirmationToken = '',
  submit = false,
} = {}, env = {}) {
  const normalizedMode = normalizeMode(mode);
  requireValue(accountId, 'account_id is required');
  assertCommonOrder(order);

  const snapshot = await getWebullAccountSnapshot(accountId, env);
  if (!snapshot.openOrders) {
    throw new Error('Webull inventory snapshot must include openOrders before execution');
  }
  const inventory = buildWebullInventory(snapshot);
  const conflict = evaluateWebullInventoryConflict({ signal: order, inventory, env });
  const liveArming = normalizedMode === WebullExecutionMode.LIVE
    ? evaluateLiveArming({ confirmationToken }, env)
    : { accepted: true, reasons: [], mode: WebullExecutionMode.SANDBOX };
  const accepted = conflict.accepted && liveArming.accepted;

  const result = {
    accepted,
    submitted: false,
    mode: normalizedMode,
    order,
    inventory,
    conflict,
    liveArming,
    accountSnapshotFetchedAt: snapshot.fetchedAt,
    safetyPipeline: [
      'WEBULL_ACCOUNT_SYNC',
      'POSITION_INVENTORY',
      'OPEN_ORDER_INVENTORY',
      'DUPLICATE_ORDER_GUARD',
      'POSITION_CONFLICT_GUARD',
      ...(normalizedMode === WebullExecutionMode.LIVE ? ['LIVE_ENVIRONMENT_GUARD', 'LIVE_ARMING_GUARD', 'LIVE_CONFIRMATION_GUARD'] : ['SANDBOX_GUARD']),
    ],
  };

  if (!submit || !accepted) return result;

  const submission = normalizedMode === WebullExecutionMode.LIVE
    ? await placeWebullLiveOrder(accountId, order, { confirmationToken }, env)
    : await placeWebullSandboxOrder(accountId, order, env);

  return {
    ...result,
    submitted: true,
    submission,
    safetyPipeline: [...result.safetyPipeline, `${normalizedMode}_SUBMISSION`],
  };
}
