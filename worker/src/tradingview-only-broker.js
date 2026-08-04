import {
  getWebullAccountSnapshot,
  getWebullOrderDetail,
  getWebullPositions,
  webullRequest,
} from './webull-client.js';

const encoder = new TextEncoder();

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = finite(value, null);
    if (parsed != null) return parsed;
  }
  return null;
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'items', 'positions', 'position_list', 'list', 'orders', 'order_list']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function money(value) {
  return Number(Number(value).toFixed(4));
}

function requireText(value, field) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

async function compactId(seed, prefix) {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(String(seed || crypto.randomUUID())));
  const hex = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase();
  return `${prefix}${hex.slice(0, 31)}`;
}

export function brokerEnvironment(accountType, env = {}) {
  const normalized = String(accountType || 'DEMO').trim().toUpperCase();
  if (normalized === 'LIVE') {
    return {
      ...env,
      WEBULL_ENVIRONMENT: 'production',
      WEBULL_API_BASE_URL: env.WEBULL_LIVE_API_BASE_URL || 'https://api.webull.com',
      WEBULL_APP_KEY: env.WEBULL_LIVE_APP_KEY,
      WEBULL_APP_SECRET: env.WEBULL_LIVE_APP_SECRET,
      WEBULL_ACCESS_TOKEN: env.WEBULL_LIVE_ACCESS_TOKEN,
    };
  }
  return {
    ...env,
    WEBULL_ENVIRONMENT: 'sandbox',
    WEBULL_API_BASE_URL: env.WEBULL_API_BASE_URL || 'https://api.sandbox.webull.com',
  };
}

export function brokerAccountId(accountType, env = {}) {
  return String(accountType || 'DEMO').toUpperCase() === 'LIVE'
    ? String(env.WEBULL_LIVE_ACCOUNT_ID || '').trim()
    : String(env.WEBULL_ACCOUNT_ID || '').trim();
}

export function liveBrokerReadiness(env = {}) {
  const missingSecrets = [
    'WEBULL_LIVE_APP_KEY',
    'WEBULL_LIVE_APP_SECRET',
    'WEBULL_LIVE_ACCESS_TOKEN',
    'WEBULL_LIVE_ACCOUNT_ID',
  ].filter((key) => !String(env[key] || '').trim());
  const switches = {
    phaseEnabled: enabled(env.MOE_TRADINGVIEW_LIVE_ENABLED),
    liveTrading: enabled(env.WEBULL_LIVE_TRADING),
    submission: enabled(env.WEBULL_LIVE_ORDER_SUBMISSION),
    implementation: enabled(env.MOE_LIVE_EXECUTION_IMPLEMENTED),
    unlocked: enabled(env.MOE_LIVE_MODE_UNLOCKED),
    killSwitchClear: !enabled(env.WEBULL_LIVE_KILL_SWITCH),
  };
  return {
    ready: missingSecrets.length === 0 && Object.values(switches).every(Boolean),
    missingSecrets,
    switches,
  };
}

export function extractAccountSummary(snapshot = {}, accountType = 'DEMO') {
  const rawBalance = snapshot?.balance || {};
  const balance = rawBalance?.data && !Array.isArray(rawBalance.data) ? rawBalance.data : rawBalance;
  const usd = Array.isArray(balance.account_currency_assets)
    ? balance.account_currency_assets.find((item) => String(item.currency || '').toUpperCase() === 'USD')
      || balance.account_currency_assets[0]
      || {}
    : {};
  const positions = pickArray(snapshot?.positions).map((item) => {
    const quantity = firstFinite(item.quantity, item.qty, item.position, item.holding_quantity) || 0;
    return {
      symbol: String(item.symbol || item.ticker?.symbol || item.instrument?.symbol || '').trim().toUpperCase(),
      quantity,
      averagePrice: firstFinite(item.cost_price, item.average_price, item.averagePrice, item.avg_price),
      currentPrice: firstFinite(item.last_price, item.lastPrice, item.market_price, item.current_price),
      marketValue: firstFinite(item.market_value, item.marketValue, item.position_value),
      unrealizedPnl: firstFinite(item.unrealized_profit_loss, item.unrealizedPnl, item.unrealized_pl, item.profit_loss),
    };
  }).filter((item) => item.symbol && item.quantity !== 0);
  const totalPnl = positions.reduce((sum, item) => sum + (finite(item.unrealizedPnl, 0) || 0), 0);
  return {
    accountType: String(accountType || 'DEMO').toUpperCase(),
    connected: true,
    balance: firstFinite(usd.net_liquidation_value, balance.total_net_liquidation_value, balance.net_liquidation_value, balance.total_asset, balance.equity),
    cash: firstFinite(usd.cash_balance, balance.total_cash_balance, balance.cash_balance),
    buyingPower: firstFinite(usd.day_buying_power, balance.day_buying_power, usd.overnight_buying_power, balance.overnight_buying_power),
    openPositions: positions.length,
    totalPnl: money(totalPnl),
    positions,
    fetchedAt: snapshot?.fetchedAt || new Date().toISOString(),
  };
}

export async function getBrokerAccountSummary(accountType, env = {}) {
  const normalized = String(accountType || 'DEMO').toUpperCase();
  if (normalized === 'LIVE') {
    const readiness = liveBrokerReadiness(env);
    if (!readiness.ready) {
      return {
        accountType: 'LIVE',
        connected: false,
        locked: true,
        readiness,
        balance: null,
        cash: null,
        buyingPower: null,
        openPositions: 0,
        totalPnl: 0,
        positions: [],
        fetchedAt: new Date().toISOString(),
      };
    }
  }
  const accountId = brokerAccountId(normalized, env);
  if (!accountId) {
    return {
      accountType: normalized,
      connected: false,
      locked: normalized === 'LIVE',
      error: `${normalized} account is not configured`,
      balance: null,
      cash: null,
      buyingPower: null,
      openPositions: 0,
      totalPnl: 0,
      positions: [],
      fetchedAt: new Date().toISOString(),
    };
  }
  try {
    const snapshot = await getWebullAccountSnapshot(accountId, brokerEnvironment(normalized, env));
    return { ...extractAccountSummary(snapshot, normalized), locked: normalized === 'LIVE' && !liveBrokerReadiness(env).ready };
  } catch (error) {
    return {
      accountType: normalized,
      connected: false,
      locked: normalized === 'LIVE',
      error: error instanceof Error ? error.message : 'Broker account lookup failed',
      balance: null,
      cash: null,
      buyingPower: null,
      openPositions: 0,
      totalPnl: 0,
      positions: [],
      fetchedAt: new Date().toISOString(),
    };
  }
}

export async function getBrokerPositions(accountType, env = {}) {
  const accountId = requireText(brokerAccountId(accountType, env), 'Broker account id');
  return pickArray(await getWebullPositions(accountId, brokerEnvironment(accountType, env)));
}

export function positionQuantity(positions, symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  const item = pickArray(positions).find((position) => String(
    position?.symbol || position?.ticker?.symbol || position?.instrument?.symbol || '',
  ).trim().toUpperCase() === normalized);
  return firstFinite(item?.quantity, item?.qty, item?.position, item?.holding_quantity) || 0;
}

export function positionAveragePrice(positions, symbol) {
  const normalized = String(symbol || '').trim().toUpperCase();
  const item = pickArray(positions).find((position) => String(
    position?.symbol || position?.ticker?.symbol || position?.instrument?.symbol || '',
  ).trim().toUpperCase() === normalized);
  return firstFinite(item?.cost_price, item?.average_price, item?.averagePrice, item?.avg_price);
}

export async function placeProtectedSpotEntry({
  accountType,
  accountId,
  symbol,
  quantity,
  entryPrice,
  takeProfitPrice,
  stopLossPrice,
  signalId,
  session = 'ALL',
}, env = {}) {
  const ids = {
    combo: await compactId(`${signalId}:combo`, 'C'),
    entry: await compactId(`${signalId}:entry`, 'E'),
    takeProfit: await compactId(`${signalId}:tp`, 'T'),
    stopLoss: await compactId(`${signalId}:sl`, 'S'),
  };
  const common = {
    instrument_type: 'EQUITY',
    entrust_type: 'QTY',
    support_trading_session: String(session || 'ALL').toUpperCase(),
    symbol: requireText(symbol, 'symbol'),
    market: 'US',
    time_in_force: 'DAY',
    quantity: String(quantity),
  };
  const body = {
    account_id: requireText(accountId, 'account_id'),
    client_combo_order_id: ids.combo,
    new_orders: [
      {
        ...common,
        client_order_id: ids.entry,
        combo_type: 'MASTER',
        side: 'BUY',
        order_type: 'LIMIT',
        limit_price: String(money(entryPrice)),
      },
      {
        ...common,
        client_order_id: ids.takeProfit,
        combo_type: 'STOP_PROFIT',
        side: 'SELL',
        order_type: 'LIMIT',
        limit_price: String(money(takeProfitPrice)),
      },
      {
        ...common,
        client_order_id: ids.stopLoss,
        combo_type: 'STOP_LOSS',
        side: 'SELL',
        order_type: 'STOP_LOSS',
        stop_price: String(money(stopLossPrice)),
      },
    ],
  };
  const response = await webullRequest(
    'POST',
    '/openapi/trade/order/place',
    { body },
    brokerEnvironment(accountType, env),
  );
  return { ids, response, protected: true };
}

export async function placeSimpleSpotOrder({
  accountType,
  accountId,
  symbol,
  side,
  quantity,
  orderType,
  stopPrice = null,
  limitPrice = null,
  signalId,
  session = 'ALL',
}, env = {}) {
  const normalizedSide = String(side || '').toUpperCase();
  if (!['BUY', 'SELL'].includes(normalizedSide)) throw new Error('Only BUY and SELL equity orders are supported');
  const normalizedType = String(orderType || 'MARKET').toUpperCase();
  if (!['MARKET', 'LIMIT', 'STOP_LOSS'].includes(normalizedType)) throw new Error('Unsupported equity order type');
  const clientOrderId = await compactId(`${signalId}:${normalizedSide}:${normalizedType}`, normalizedSide === 'SELL' ? 'X' : 'B');
  const order = {
    client_order_id: clientOrderId,
    combo_type: 'NORMAL',
    instrument_type: 'EQUITY',
    entrust_type: 'QTY',
    support_trading_session: String(session || 'ALL').toUpperCase(),
    symbol: requireText(symbol, 'symbol'),
    market: 'US',
    side: normalizedSide,
    order_type: normalizedType,
    time_in_force: 'DAY',
    quantity: String(quantity),
    ...(normalizedType === 'LIMIT' ? { limit_price: String(money(limitPrice)) } : {}),
    ...(normalizedType === 'STOP_LOSS' ? { stop_price: String(money(stopPrice)) } : {}),
  };
  const response = await webullRequest(
    'POST',
    '/openapi/trade/order/place',
    { body: { account_id: requireText(accountId, 'account_id'), new_orders: [order] } },
    brokerEnvironment(accountType, env),
  );
  return { clientOrderId, response, order };
}

export async function cancelBrokerOrder(accountType, accountId, clientOrderId, env = {}) {
  if (!clientOrderId) return { skipped: true, reason: 'ORDER_ID_MISSING' };
  const response = await webullRequest(
    'POST',
    '/openapi/trade/order/cancel',
    { body: { account_id: requireText(accountId, 'account_id'), client_order_id: String(clientOrderId) } },
    brokerEnvironment(accountType, env),
  );
  return { skipped: false, response };
}

export async function getBrokerOrderDetail(accountType, accountId, clientOrderId, env = {}) {
  if (!clientOrderId) return null;
  return getWebullOrderDetail(
    requireText(accountId, 'account_id'),
    String(clientOrderId),
    brokerEnvironment(accountType, env),
  );
}

export function orderStatus(detail = {}) {
  const candidates = [
    detail?.status,
    detail?.order_status,
    detail?.data?.status,
    detail?.data?.order_status,
    detail?.order?.status,
  ];
  return String(candidates.find((value) => value != null) || '').trim().toUpperCase();
}

export function orderFillPrice(detail = {}) {
  return firstFinite(
    detail?.filled_avg_price,
    detail?.average_filled_price,
    detail?.avg_fill_price,
    detail?.filled_price,
    detail?.data?.filled_avg_price,
    detail?.data?.average_filled_price,
    detail?.data?.avg_fill_price,
    detail?.order?.filled_avg_price,
  );
}

export function isFilledStatus(status) {
  return ['FILLED', 'FULL_FILLED', 'EXECUTED'].includes(String(status || '').toUpperCase());
}

export function isTerminalFailureStatus(status) {
  return ['CANCELLED', 'CANCELED', 'FAILED', 'REJECTED', 'EXPIRED'].includes(String(status || '').toUpperCase());
}

export async function fetchAlpacaSpotQuote(symbol, env = {}) {
  const keyId = requireText(env.ALPACA_KEY_ID, 'ALPACA_KEY_ID');
  const secret = requireText(env.ALPACA_SECRET_KEY, 'ALPACA_SECRET_KEY');
  const url = new URL(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(symbol)}/snapshot`);
  url.searchParams.set('feed', 'iex');
  const response = await fetch(url.toString(), {
    headers: {
      'APCA-API-KEY-ID': keyId,
      'APCA-API-SECRET-KEY': secret,
      accept: 'application/json',
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.message || payload?.error || `Alpaca quote failed with HTTP ${response.status}`);
  const price = firstFinite(
    payload?.latestTrade?.p,
    payload?.latestQuote?.ap,
    payload?.minuteBar?.c,
    payload?.dailyBar?.c,
    payload?.latestQuote?.bp,
  );
  if (!(price > 0)) throw new Error('A current equity price is unavailable');
  return {
    symbol: String(symbol).toUpperCase(),
    price: money(price),
    bid: money(firstFinite(payload?.latestQuote?.bp, price)),
    ask: money(firstFinite(payload?.latestQuote?.ap, price)),
    timestamp: payload?.latestTrade?.t || payload?.latestQuote?.t || new Date().toISOString(),
    feed: 'IEX',
  };
}
