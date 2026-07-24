import routerWorker, { AlertCoordinator } from './router.js';
import { runAutoScanner } from './auto-scanner.js';
import { buildDashboardSnapshot, htmlResponse } from './moe-dashboard.js';
import { getWebullAccountSnapshot } from './webull-client.js';

export { AlertCoordinator };

const AUTO_SUBMIT_PATHS = new Set([
  '/api/tradingview/signal',
  '/api/tradingview/webull-preview',
]);

const DASHBOARD_PAGE_PATHS = new Set([
  '/',
  '/moe-ai',
  '/moe-ai/',
  '/dashboard',
  '/dashboard/',
]);

function firstFinite(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'items', 'positions', 'position_list', 'list']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function normalizeAccountSnapshot(snapshot) {
  if (!snapshot) return { enabled: false, connected: false, readOnly: true, positions: [] };
  const rawBalance = snapshot.balance || {};
  const balance = rawBalance?.data && !Array.isArray(rawBalance.data) ? rawBalance.data : rawBalance;
  const usd = Array.isArray(balance.account_currency_assets)
    ? balance.account_currency_assets.find((item) => String(item.currency || '').toUpperCase() === 'USD') || balance.account_currency_assets[0] || {}
    : {};
  const positions = pickArray(snapshot.positions).map((item) => {
    const quantity = firstFinite(item.quantity, item.qty, item.position, item.holding_quantity) || 0;
    const marketValue = firstFinite(item.market_value, item.marketValue, item.position_value, item.market_value_amount);
    const unrealizedPnl = firstFinite(item.unrealized_profit_loss, item.unrealizedPnl, item.unrealized_pl, item.profit_loss);
    const unrealizedPnlPercent = firstFinite(item.unrealized_profit_loss_rate, item.unrealizedPnlPercent, item.unrealized_pl_rate, item.profit_loss_rate);
    return {
      symbol: String(item.symbol || item.ticker?.symbol || item.instrument?.symbol || '').trim().toUpperCase(),
      quantity,
      averagePrice: firstFinite(item.cost_price, item.average_price, item.averagePrice, item.avg_price),
      lastPrice: firstFinite(item.last_price, item.lastPrice, item.market_price, item.current_price),
      marketValue,
      unrealizedPnl,
      unrealizedPnlPercent,
      side: quantity < 0 ? 'SHORT' : 'LONG',
    };
  }).filter((item) => item.symbol && item.quantity !== 0);
  const unrealizedPnl = positions.reduce((sum, item) => sum + (Number(item.unrealizedPnl) || 0), 0);
  const marketValue = positions.reduce((sum, item) => sum + (Number(item.marketValue) || 0), 0);
  return {
    enabled: true,
    connected: true,
    readOnly: true,
    accountIdMasked: snapshot.accountId ? `••••${String(snapshot.accountId).slice(-4)}` : null,
    fetchedAt: snapshot.fetchedAt,
    equity: firstFinite(usd.net_liquidation_value, balance.total_net_liquidation_value, balance.net_liquidation_value, balance.total_asset, balance.equity),
    cash: firstFinite(usd.cash_balance, balance.total_cash_balance, balance.cash_balance),
    dayBuyingPower: firstFinite(usd.day_buying_power, balance.day_buying_power),
    overnightBuyingPower: firstFinite(usd.overnight_buying_power, balance.overnight_buying_power),
    maintenanceMargin: firstFinite(balance.maintenance_margin),
    marketValue: Number(marketValue.toFixed(2)),
    unrealizedPnl: Number(unrealizedPnl.toFixed(2)),
    positionCount: positions.length,
    positions,
  };
}

async function withSandboxSubmission(request, env) {
  if (
    request.method !== 'POST'
    || !AUTO_SUBMIT_PATHS.has(new URL(request.url).pathname)
    || env.WEBULL_ENVIRONMENT !== 'sandbox'
    || env.WEBULL_SANDBOX_ENABLED !== 'true'
    || env.WEBULL_SANDBOX_ORDER_SUBMISSION !== 'true'
    || env.WEBULL_AUTO_SUBMIT_SANDBOX !== 'true'
  ) return request;

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return request;
  let payload;
  try { payload = await request.clone().json(); } catch { return request; }
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  return new Request(request.url, { method: request.method, headers, body: JSON.stringify({ ...payload, submitSandbox: true }) });
}

async function dashboardData(request, env, ctx) {
  if (request.method !== 'GET') return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });

  const incomingUrl = new URL(request.url);
  const decisionsUrl = new URL('/api/tradingview/decisions', incomingUrl.origin);
  decisionsUrl.searchParams.set('limit', '100');
  const headers = new Headers();
  headers.set('origin', env.APP_ORIGIN || 'http://localhost:3000');
  const internalRequest = new Request(decisionsUrl.toString(), { method: 'GET', headers });
  const response = await routerWorker.fetch(internalRequest, env, ctx);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Dashboard storage lookup failed' }));
    return Response.json({ ok: false, ...error }, { status: response.status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
  }

  const payload = await response.json();
  const snapshot = buildDashboardSnapshot(payload.decisions || []);
  let account = { enabled: env.WEBULL_READ_ONLY_SYNC === 'true', connected: false, readOnly: true, positions: [] };
  let accountError = null;
  if (env.WEBULL_READ_ONLY_SYNC === 'true' && env.WEBULL_ACCOUNT_ID) {
    try {
      account = normalizeAccountSnapshot(await getWebullAccountSnapshot(env.WEBULL_ACCOUNT_ID, env));
    } catch (error) {
      accountError = error instanceof Error ? error.message : 'Webull account sync failed';
      account = { ...account, error: accountError };
    }
  }

  return Response.json({
    ok: true,
    ...snapshot,
    storage: payload.storage || 'DURABLE_OBJECT',
    brainVersion: '2.0.0',
    environment: env.WEBULL_ENVIRONMENT || 'sandbox',
    liveTrading: env.WEBULL_LIVE_TRADING === 'true',
    account,
    accountError,
  }, { headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (DASHBOARD_PAGE_PATHS.has(url.pathname)) return htmlResponse();
    if (url.pathname === '/api/moe-ai/dashboard') return dashboardData(request, env, ctx);
    const effectiveRequest = await withSandboxSubmission(request, env);
    return routerWorker.fetch(effectiveRequest, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(Promise.allSettled([
      routerWorker.scheduled(controller, env, ctx),
      runAutoScanner(env, controller.scheduledTime),
    ]));
  },
};
