import { webullRequest } from './webull-client.js';

function compactId(value, suffix = '') {
  const clean = String(value || crypto.randomUUID()).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  let hash = 2166136261;
  for (let index = 0; index < clean.length; index += 1) {
    hash ^= clean.charCodeAt(index);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  const tail = hash.toString(36).toUpperCase().padStart(7, '0').slice(-7);
  const suffixText = String(suffix).replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 4);
  const prefixLength = Math.max(1, 32 - tail.length - suffixText.length);
  return `${clean.slice(0, prefixLength)}${tail}${suffixText}`.slice(0, 32);
}

function baseLeg(order, overrides = {}) {
  return {
    symbol: order.symbol,
    instrument_type: 'EQUITY',
    market: 'US',
    quantity: String(order.quantity),
    time_in_force: 'DAY',
    support_trading_session: order.session || 'CORE',
    entrust_type: 'QTY',
    ...overrides,
  };
}

export async function placeWebullSandboxBracketOrder(accountId, order, env = {}) {
  if (env.WEBULL_ENVIRONMENT === 'production' || env.WEBULL_LIVE_TRADING === 'true') {
    throw new Error('Protected bracket submission is sandbox-only');
  }
  if (env.WEBULL_SANDBOX_ORDER_SUBMISSION !== 'true') throw new Error('Sandbox order submission is disabled');
  if (!accountId) throw new Error('WEBULL_ACCOUNT_ID is required');
  if (!order || order.side !== 'BUY') throw new Error('Phase 1 bracket orders support BUY entries only');
  if (!(Number(order.stopLoss) < Number(order.limitPrice) && Number(order.takeProfit) > Number(order.limitPrice))) {
    throw new Error('Invalid bracket prices');
  }

  const comboId = compactId(order.signalId, 'C');
  const masterId = compactId(order.signalId, 'M');
  const targetId = compactId(order.signalId, 'TP');
  const stopId = compactId(order.signalId, 'SL');
  const master = baseLeg(order, {
    client_order_id: masterId,
    combo_type: 'MASTER',
    side: 'BUY',
    order_type: order.orderType || 'LIMIT',
    ...(order.limitPrice ? { limit_price: String(order.limitPrice) } : {}),
  });
  const target = baseLeg(order, {
    client_order_id: targetId,
    combo_type: 'STOP_PROFIT',
    side: 'SELL',
    order_type: 'LIMIT',
    limit_price: String(order.takeProfit),
  });
  const stop = baseLeg(order, {
    client_order_id: stopId,
    combo_type: 'STOP_LOSS',
    side: 'SELL',
    order_type: 'STOP_LOSS',
    stop_price: String(order.stopLoss),
  });

  return webullRequest('POST', '/openapi/trade/order/place', {
    body: {
      account_id: accountId,
      client_combo_order_id: comboId,
      new_orders: [master, target, stop],
    },
  }, env);
}
