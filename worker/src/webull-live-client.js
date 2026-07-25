import { webullRequest } from './webull-client.js';

const encoder = new TextEncoder();

function positive(value, field) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${field} must be a positive number`);
  return parsed;
}

async function compactOrderIds(signalId) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(signalId || crypto.randomUUID())));
  const hex = [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return {
    combo: `C${hex.slice(0, 31)}`,
    entry: `E${hex.slice(0, 31)}`,
    takeProfit: `T${hex.slice(0, 31)}`,
    stopLoss: `S${hex.slice(0, 31)}`,
  };
}

function validateProtectedLongOrder(order = {}) {
  const symbol = String(order.symbol || '').trim().toUpperCase();
  const side = String(order.side || '').trim().toUpperCase();
  const orderType = String(order.orderType || 'LIMIT').trim().toUpperCase();
  const session = String(order.session || 'CORE').trim().toUpperCase();
  const quantity = Math.floor(positive(order.quantity, 'quantity'));
  const limitPrice = orderType === 'LIMIT' ? positive(order.limitPrice, 'limitPrice') : null;
  const referencePrice = limitPrice || positive(order.marketPrice, 'marketPrice');
  const stopLoss = positive(order.stopLoss, 'stopLoss');
  const takeProfit = positive(order.takeProfit, 'takeProfit');

  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('Invalid symbol');
  if (side !== 'BUY') throw new Error('Protected live execution currently supports BUY entries only');
  if (!['LIMIT', 'MARKET'].includes(orderType)) throw new Error('Live execution supports LIMIT and MARKET entries only');
  if (!['CORE', 'ALL'].includes(session)) throw new Error('Unsupported live trading session');
  if (stopLoss >= referencePrice) throw new Error('Live BUY stopLoss must be below the entry price');
  if (takeProfit <= referencePrice) throw new Error('Live BUY takeProfit must be above the entry price');

  return { symbol, side, orderType, session, quantity, limitPrice, referencePrice, stopLoss, takeProfit };
}

async function protectedPayload(accountId, order) {
  if (!accountId) throw new Error('WEBULL_LIVE_ACCOUNT_ID is required');
  const normalized = validateProtectedLongOrder(order);
  const ids = await compactOrderIds(order.signalId);
  const common = {
    instrument_type: 'EQUITY',
    entrust_type: 'QTY',
    support_trading_session: normalized.session,
    symbol: normalized.symbol,
    market: 'US',
    time_in_force: 'DAY',
    quantity: String(normalized.quantity),
  };
  const entry = {
    ...common,
    client_order_id: ids.entry,
    combo_type: 'MASTER',
    side: 'BUY',
    order_type: normalized.orderType,
    ...(normalized.limitPrice ? { limit_price: String(normalized.limitPrice) } : {}),
  };
  const takeProfit = {
    ...common,
    client_order_id: ids.takeProfit,
    combo_type: 'STOP_PROFIT',
    side: 'SELL',
    order_type: 'LIMIT',
    limit_price: String(normalized.takeProfit),
  };
  const stopLoss = {
    ...common,
    client_order_id: ids.stopLoss,
    combo_type: 'STOP_LOSS',
    side: 'SELL',
    order_type: 'STOP_LOSS',
    stop_price: String(normalized.stopLoss),
  };
  return {
    ids,
    normalized,
    body: {
      account_id: accountId,
      client_combo_order_id: ids.combo,
      new_orders: [entry, takeProfit, stopLoss],
    },
    previewBody: {
      account_id: accountId,
      new_orders: [{ ...entry, combo_type: 'NORMAL' }],
    },
  };
}

export async function previewWebullLiveOrder(accountId, order, env = {}) {
  const payload = await protectedPayload(accountId, order);
  const response = await webullRequest('POST', '/openapi/trade/order/preview', { body: payload.previewBody }, env);
  return { clientOrderId: payload.ids.entry, response };
}

export async function placeWebullLiveOrder(accountId, order, env = {}) {
  const payload = await protectedPayload(accountId, order);
  const response = await webullRequest('POST', '/openapi/trade/order/place', { body: payload.body }, env);
  return { protected: true, clientOrderIds: payload.ids, response };
}

export function getWebullLiveOpenOrders(accountId, options = {}, env = {}) {
  if (!accountId) throw new Error('WEBULL_LIVE_ACCOUNT_ID is required');
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || 100));
  return webullRequest('GET', '/openapi/trade/order/open', {
    query: {
      account_id: accountId,
      page_size: pageSize,
      last_client_order_id: options.lastClientOrderId || '',
    },
  }, env);
}

export function getWebullLiveOrderHistory(accountId, options = {}, env = {}) {
  if (!accountId) throw new Error('WEBULL_LIVE_ACCOUNT_ID is required');
  const pageSize = Math.max(1, Math.min(100, Number(options.pageSize) || 100));
  return webullRequest('GET', '/openapi/trade/order/history', {
    query: {
      account_id: accountId,
      start_time: options.startTime || '',
      end_time: options.endTime || '',
      page_size: pageSize,
      last_client_order_id: options.lastClientOrderId || '',
    },
  }, env);
}

export function getWebullLiveOrderDetail(accountId, clientOrderId, env = {}) {
  if (!accountId) throw new Error('WEBULL_LIVE_ACCOUNT_ID is required');
  if (!clientOrderId) throw new Error('client_order_id is required');
  return webullRequest('GET', '/openapi/trade/order/detail', {
    query: { account_id: accountId, client_order_id: clientOrderId },
  }, env);
}

export function cancelWebullLiveOrder(accountId, clientOrderId, env = {}) {
  if (!accountId) throw new Error('WEBULL_LIVE_ACCOUNT_ID is required');
  if (!clientOrderId) throw new Error('client_order_id is required');
  return webullRequest('POST', '/openapi/trade/order/cancel', {
    body: { account_id: accountId, client_order_id: clientOrderId },
  }, env);
}

export function replaceWebullLiveOrder(accountId, clientOrderId, patch = {}, env = {}) {
  if (!accountId) throw new Error('WEBULL_LIVE_ACCOUNT_ID is required');
  if (!clientOrderId) throw new Error('client_order_id is required');
  const modify = { client_order_id: clientOrderId };
  if (patch.quantity != null) modify.quantity = String(Math.floor(positive(patch.quantity, 'quantity')));
  if (patch.limitPrice != null) modify.limit_price = String(positive(patch.limitPrice, 'limitPrice'));
  if (patch.stopPrice != null) modify.stop_price = String(positive(patch.stopPrice, 'stopPrice'));
  if (Object.keys(modify).length === 1) throw new Error('At least one replace field is required');
  return webullRequest('POST', '/openapi/trade/order/replace', {
    body: { account_id: accountId, modify_orders: [modify] },
  }, env);
}
