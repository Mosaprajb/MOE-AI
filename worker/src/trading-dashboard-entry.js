import worker, { AlertCoordinator } from './scanner-operational-repair-entry.js';
import {
  getWebullAccountSnapshot,
  getWebullOpenOrders,
} from './webull-client.js';
import { getWebullLiveOpenOrders } from './webull-live-client.js';
import { webullRequest } from './webull-client.js';

const DASHBOARD_PATH = '/api/trading/dashboard';

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  const configured = String(env.APP_ORIGIN || '').replace(/\/$/, '');
  if (!origin) return configured || '*';
  if (origin === configured || origin === 'http://localhost:3000') return origin;
  return null;
}

function headers(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type',
    'access-control-max-age': '86400',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'x-content-type-options': 'nosniff',
    vary: 'Origin',
  };
}

function json(payload, status, origin) {
  return Response.json(payload, { status, headers: headers(origin) });
}

function requireValue(env, key) {
  const value = String(env[key] || '').trim();
  if (!value) throw new Error(`${key} is not configured`);
  return value;
}

function liveReadEnvironment(env) {
  return {
    ...env,
    WEBULL_ENVIRONMENT: 'production',
    WEBULL_API_BASE_URL: String(env.WEBULL_LIVE_API_BASE_URL || 'https://api.webull.com').trim(),
    WEBULL_APP_KEY: env.WEBULL_LIVE_APP_KEY || env.WEBULL_APP_KEY,
    WEBULL_APP_SECRET: env.WEBULL_LIVE_APP_SECRET || env.WEBULL_APP_SECRET,
    WEBULL_ACCESS_TOKEN: env.WEBULL_LIVE_ACCESS_TOKEN || env.WEBULL_ACCESS_TOKEN,
  };
}

function arrayFrom(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
    if (Array.isArray(payload?.data?.[key])) return payload.data[key];
  }
  if (Array.isArray(payload?.data)) return payload.data;
  return [];
}

function objectFrom(payload, keys) {
  if (!payload || typeof payload !== 'object') return {};
  for (const key of keys) {
    const value = payload[key] || payload.data?.[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return payload.data && typeof payload.data === 'object' && !Array.isArray(payload.data)
    ? payload.data
    : payload;
}

function normalizeDashboard({ mode, accountId, balance, positions, orders, liveSafety }) {
  return {
    ok: true,
    mode,
    readOnly: true,
    accountIdMasked: accountId ? `***${accountId.slice(-4)}` : null,
    account: objectFrom(balance, ['balance', 'account', 'summary', 'asset']),
    positions: arrayFrom(positions, ['positions', 'position_list', 'items', 'list']),
    orders: arrayFrom(orders, ['orders', 'order_list', 'items', 'list']),
    safety: liveSafety,
    fetchedAt: new Date().toISOString(),
  };
}

async function sandboxDashboard(env) {
  if (String(env.WEBULL_ENVIRONMENT || '').trim().toLowerCase() === 'production') {
    throw new Error('Sandbox dashboard cannot use production Webull credentials');
  }
  const accountId = requireValue(env, 'WEBULL_ACCOUNT_ID');
  const [snapshot, orders] = await Promise.all([
    getWebullAccountSnapshot(accountId, env),
    getWebullOpenOrders(accountId, 100, env),
  ]);
  return normalizeDashboard({
    mode: 'SANDBOX',
    accountId,
    balance: snapshot.balance,
    positions: snapshot.positions,
    orders,
    liveSafety: {
      submissionEnabled: enabled(env.WEBULL_SANDBOX_ORDER_SUBMISSION),
      automationArmed: enabled(env.WEBULL_AUTOMATION_ARMED),
      protectedOrders: enabled(env.WEBULL_PROTECTED_ORDERS),
    },
  });
}

async function liveDashboard(env) {
  const accountId = requireValue(env, 'WEBULL_LIVE_ACCOUNT_ID');
  const liveEnv = liveReadEnvironment(env);
  requireValue(liveEnv, 'WEBULL_APP_KEY');
  requireValue(liveEnv, 'WEBULL_APP_SECRET');
  requireValue(liveEnv, 'WEBULL_ACCESS_TOKEN');

  const [balance, positions, orders] = await Promise.all([
    webullRequest('GET', '/openapi/assets/balance', { query: { account_id: accountId } }, liveEnv),
    webullRequest('GET', '/openapi/assets/positions', { query: { account_id: accountId } }, liveEnv),
    getWebullLiveOpenOrders(accountId, { pageSize: 100 }, liveEnv),
  ]);

  return normalizeDashboard({
    mode: 'LIVE',
    accountId,
    balance,
    positions,
    orders,
    liveSafety: {
      readOnlySync: true,
      liveTradingEnabled: enabled(env.WEBULL_LIVE_TRADING),
      submissionEnabled: enabled(env.WEBULL_LIVE_ORDER_SUBMISSION),
      automationArmed: enabled(env.WEBULL_LIVE_AUTOMATION_ARMED),
      killSwitch: enabled(env.WEBULL_LIVE_KILL_SWITCH),
      maximumQuantity: Number(env.WEBULL_LIVE_MAX_QUANTITY || 1),
      maximumNotional: Number(env.WEBULL_LIVE_MAX_NOTIONAL || env.MOE_LIVE_MAX_ORDER_NOTIONAL || 100),
    },
  });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== DASHBOARD_PATH) return worker.fetch(request, env, ctx);

    const origin = allowedOrigin(request, env);
    if (!origin) return json({ ok: false, error: 'Origin not allowed' }, 403, '*');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405, origin);

    const mode = String(url.searchParams.get('mode') || 'sandbox').trim().toLowerCase();
    if (!['sandbox', 'live'].includes(mode)) {
      return json({ ok: false, error: 'mode must be sandbox or live' }, 400, origin);
    }

    try {
      const dashboard = mode === 'live' ? await liveDashboard(env) : await sandboxDashboard(env);
      return json(dashboard, 200, origin);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'TRADING_DASHBOARD_SYNC_FAILED',
        mode: mode.toUpperCase(),
        error: error instanceof Error ? error.message : 'Unknown dashboard error',
        createdAt: new Date().toISOString(),
      }));
      return json({
        ok: false,
        mode: mode.toUpperCase(),
        readOnly: true,
        error: error instanceof Error ? error.message : 'Trading dashboard sync failed',
        fetchedAt: new Date().toISOString(),
      }, 503, origin);
    }
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
