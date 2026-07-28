import worker, { AlertCoordinator } from './scanner-operational-repair-entry.js';
import {
  getWebullAccountSnapshot,
  getWebullOpenOrders,
  webullRequest,
} from './webull-client.js';
import { getWebullLiveOpenOrders } from './webull-live-client.js';

const DASHBOARD_PATH = '/api/trading/dashboard';
const CONNECTION_PATH = '/api/trading/connection';
const STREAM_PATH = '/api/trading/stream';
const PREFLIGHT_PATH = '/api/trading/preflight';
const ORDER_GUARD_PATH = '/api/trading/order-guard';
const BUILD_ID = 'trading-dashboard-webull-cloudflare-v5-20260727';

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function present(value) {
  return Boolean(String(value || '').trim());
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

function withTimeout(promise, timeoutMs, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
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

function normalizeDashboard({ mode, accountId, balance, positions, orders, safety }) {
  return {
    ok: true,
    build: BUILD_ID,
    provider: 'WEBULL',
    runtime: 'CLOUDFLARE_WORKERS',
    mode,
    readOnly: true,
    accountIdMasked: accountId ? `***${accountId.slice(-4)}` : null,
    account: objectFrom(balance, ['balance', 'account', 'summary', 'asset']),
    positions: arrayFrom(positions, ['positions', 'position_list', 'items', 'list']),
    orders: arrayFrom(orders, ['orders', 'order_list', 'items', 'list']),
    safety,
    fetchedAt: new Date().toISOString(),
  };
}

function connectionStatus(env = {}) {
  const sandbox = {
    environment: String(env.WEBULL_ENVIRONMENT || 'sandbox').toLowerCase(),
    accountConfigured: present(env.WEBULL_ACCOUNT_ID),
    appKeyConfigured: present(env.WEBULL_APP_KEY),
    appSecretConfigured: present(env.WEBULL_APP_SECRET),
    accessTokenConfigured: present(env.WEBULL_ACCESS_TOKEN),
    submissionEnabled: enabled(env.WEBULL_SANDBOX_ORDER_SUBMISSION),
    automationArmed: enabled(env.WEBULL_AUTOMATION_ARMED),
  };
  sandbox.ready = sandbox.environment !== 'production'
    && sandbox.accountConfigured
    && sandbox.appKeyConfigured
    && sandbox.appSecretConfigured
    && sandbox.accessTokenConfigured;

  const live = {
    accountConfigured: present(env.WEBULL_LIVE_ACCOUNT_ID),
    appKeyConfigured: present(env.WEBULL_LIVE_APP_KEY || env.WEBULL_APP_KEY),
    appSecretConfigured: present(env.WEBULL_LIVE_APP_SECRET || env.WEBULL_APP_SECRET),
    accessTokenConfigured: present(env.WEBULL_LIVE_ACCESS_TOKEN || env.WEBULL_ACCESS_TOKEN),
    tradingEnabled: enabled(env.WEBULL_LIVE_TRADING),
    submissionEnabled: enabled(env.WEBULL_LIVE_ORDER_SUBMISSION),
    automationArmed: enabled(env.WEBULL_LIVE_AUTOMATION_ARMED),
    killSwitch: enabled(env.WEBULL_LIVE_KILL_SWITCH),
    readOnlyDashboard: enabled(env.WEBULL_DASHBOARD_READ_ONLY),
    maximumQuantity: Number(env.WEBULL_LIVE_MAX_QUANTITY || 1),
    maximumNotional: Number(env.WEBULL_LIVE_MAX_NOTIONAL || env.MOE_LIVE_MAX_ORDER_NOTIONAL || 100),
  };
  live.readReady = live.accountConfigured
    && live.appKeyConfigured
    && live.appSecretConfigured
    && live.accessTokenConfigured
    && live.readOnlyDashboard;
  live.riskLimitsReady = Number.isFinite(live.maximumQuantity)
    && live.maximumQuantity > 0
    && Number.isFinite(live.maximumNotional)
    && live.maximumNotional > 0;
  live.executionReady = live.readReady
    && live.riskLimitsReady
    && live.tradingEnabled
    && live.submissionEnabled
    && live.automationArmed
    && !live.killSwitch;

  return {
    ok: true,
    build: BUILD_ID,
    cloudflare: {
      connected: true,
      durableObjectBound: Boolean(env.ALERT_COORDINATOR),
      environment: 'workers',
      streamingEnabled: true,
      preflightEnabled: true,
      orderGuardEnabled: true,
    },
    webull: { sandbox, live },
    safety: {
      liveExecutionLocked: !live.executionReady,
      sandboxProtectedOrders: enabled(env.WEBULL_PROTECTED_ORDERS),
      directionPolicy: String(env.MOE_DIRECTION_POLICY || 'LONG_ONLY').toUpperCase(),
    },
    checkedAt: new Date().toISOString(),
  };
}

function validateOrder(url, env) {
  const mode = String(url.searchParams.get('mode') || 'sandbox').trim().toLowerCase();
  const symbol = String(url.searchParams.get('symbol') || '').trim().toUpperCase();
  const side = String(url.searchParams.get('side') || 'BUY').trim().toUpperCase();
  const type = String(url.searchParams.get('type') || 'MARKET').trim().toUpperCase();
  const quantity = Number(url.searchParams.get('quantity'));
  const price = Number(url.searchParams.get('price'));
  const stopLoss = Number(url.searchParams.get('stopLoss'));
  const takeProfit = Number(url.searchParams.get('takeProfit'));
  const errors = [];

  if (!['sandbox', 'live'].includes(mode)) errors.push('mode must be sandbox or live');
  if (!/^[A-Z][A-Z0-9.\-]{0,9}$/.test(symbol)) errors.push('symbol is invalid');
  if (!['BUY', 'SELL'].includes(side)) errors.push('side must be BUY or SELL');
  if (!['MARKET', 'LIMIT', 'STOP', 'STOP_LIMIT'].includes(type)) errors.push('type is invalid');
  if (!Number.isInteger(quantity) || quantity <= 0) errors.push('quantity must be a positive integer');
  if (type !== 'MARKET' && (!Number.isFinite(price) || price <= 0)) errors.push('price is required for non-market orders');
  if (Number.isFinite(stopLoss) && stopLoss <= 0) errors.push('stopLoss must be positive');
  if (Number.isFinite(takeProfit) && takeProfit <= 0) errors.push('takeProfit must be positive');

  const referencePrice = Number.isFinite(price) && price > 0 ? price : 0;
  const estimatedNotional = referencePrice * (Number.isFinite(quantity) ? quantity : 0);
  const status = connectionStatus(env);

  if (mode === 'sandbox') {
    if (!status.webull.sandbox.ready) errors.push('sandbox credentials are not ready');
    if (!status.webull.sandbox.submissionEnabled) errors.push('sandbox submission is disabled');
    if (!status.webull.sandbox.automationArmed) errors.push('sandbox automation is not armed');
    if (!status.safety.sandboxProtectedOrders) errors.push('sandbox protected orders are disabled');
  }

  if (mode === 'live') {
    const live = status.webull.live;
    if (!live.readReady) errors.push('live credentials or read-only dashboard are not ready');
    if (!live.tradingEnabled) errors.push('live trading is disabled');
    if (!live.submissionEnabled) errors.push('live order submission is disabled');
    if (!live.automationArmed) errors.push('live automation is not armed');
    if (live.killSwitch) errors.push('live kill switch is active');
    if (Number.isFinite(quantity) && quantity > live.maximumQuantity) errors.push(`quantity exceeds live maximum of ${live.maximumQuantity}`);
    if (referencePrice <= 0) errors.push('price is required to verify live notional risk');
    if (estimatedNotional > live.maximumNotional) errors.push(`notional exceeds live maximum of ${live.maximumNotional}`);
  }

  if (side === 'BUY' && Number.isFinite(stopLoss) && referencePrice > 0 && stopLoss >= referencePrice) {
    errors.push('BUY stopLoss must be below entry price');
  }
  if (side === 'BUY' && Number.isFinite(takeProfit) && referencePrice > 0 && takeProfit <= referencePrice) {
    errors.push('BUY takeProfit must be above entry price');
  }

  return {
    ok: errors.length === 0,
    build: BUILD_ID,
    provider: 'WEBULL',
    runtime: 'CLOUDFLARE_WORKERS',
    dryRun: true,
    executionAttempted: false,
    mode: mode.toUpperCase(),
    order: { symbol, side, type, quantity, price: referencePrice || null, stopLoss: Number.isFinite(stopLoss) ? stopLoss : null, takeProfit: Number.isFinite(takeProfit) ? takeProfit : null },
    risk: {
      estimatedNotional,
      maximumQuantity: mode === 'live' ? status.webull.live.maximumQuantity : null,
      maximumNotional: mode === 'live' ? status.webull.live.maximumNotional : null,
      protectedOrdersRequired: true,
    },
    errors,
    validatedAt: new Date().toISOString(),
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
    safety: {
      submissionEnabled: enabled(env.WEBULL_SANDBOX_ORDER_SUBMISSION),
      automationArmed: enabled(env.WEBULL_AUTOMATION_ARMED),
      protectedOrders: enabled(env.WEBULL_PROTECTED_ORDERS),
    },
  });
}

async function liveDashboard(env) {
  if (!enabled(env.WEBULL_DASHBOARD_READ_ONLY)) throw new Error('Live dashboard read-only sync is disabled');
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
    mode: 'LIVE', accountId, balance, positions, orders,
    safety: {
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

async function getDashboard(mode, env) {
  return mode === 'live' ? liveDashboard(env) : sandboxDashboard(env);
}

async function preflightMode(mode, env) {
  const startedAt = Date.now();
  try {
    const dashboard = await withTimeout(getDashboard(mode, env), 8000, `${mode} Webull preflight`);
    return { mode: mode.toUpperCase(), ok: true, providerReachable: true, accountReadable: true, positionsReadable: Array.isArray(dashboard.positions), ordersReadable: Array.isArray(dashboard.orders), readOnly: true, latencyMs: Date.now() - startedAt, checkedAt: new Date().toISOString() };
  } catch (error) {
    return { mode: mode.toUpperCase(), ok: false, providerReachable: false, accountReadable: false, positionsReadable: false, ordersReadable: false, readOnly: true, latencyMs: Date.now() - startedAt, error: error instanceof Error ? error.message : 'Webull preflight failed', checkedAt: new Date().toISOString() };
  }
}

async function preflightStatus(env) {
  const configuration = connectionStatus(env);
  const [sandbox, live] = await Promise.all([preflightMode('sandbox', env), preflightMode('live', env)]);
  const liveSafetyPassed = configuration.webull.live.riskLimitsReady && configuration.webull.live.readOnlyDashboard;
  return {
    ok: sandbox.ok && live.ok && liveSafetyPassed,
    build: BUILD_ID,
    cloudflare: configuration.cloudflare,
    checks: { sandbox, live },
    safety: { liveSafetyPassed, liveExecutionLocked: configuration.safety.liveExecutionLocked, killSwitch: configuration.webull.live.killSwitch, riskLimitsReady: configuration.webull.live.riskLimitsReady, readOnlyDashboard: configuration.webull.live.readOnlyDashboard },
    checkedAt: new Date().toISOString(),
  };
}

function streamDashboard(mode, env, origin) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event, payload) => { if (!closed) controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`)); };
      const close = () => { if (!closed) { closed = true; controller.close(); } };
      for (let index = 0; index < 12 && !closed; index += 1) {
        try { send('dashboard', await getDashboard(mode, env)); }
        catch (error) { send('error', { ok: false, mode: mode.toUpperCase(), readOnly: true, error: error instanceof Error ? error.message : 'Streaming sync failed', fetchedAt: new Date().toISOString() }); }
        if (index < 11) await new Promise((resolve) => setTimeout(resolve, 5000));
      }
      close();
    },
    cancel() {},
  });
  return new Response(stream, { status: 200, headers: { ...headers(origin), 'content-type': 'text/event-stream; charset=utf-8', connection: 'keep-alive', 'x-accel-buffering': 'no' } });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (![DASHBOARD_PATH, CONNECTION_PATH, STREAM_PATH, PREFLIGHT_PATH, ORDER_GUARD_PATH].includes(url.pathname)) return worker.fetch(request, env, ctx);
    const origin = allowedOrigin(request, env);
    if (!origin) return json({ ok: false, error: 'Origin not allowed' }, 403, '*');
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: headers(origin) });
    if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405, origin);
    if (url.pathname === CONNECTION_PATH) return json(connectionStatus(env), 200, origin);
    if (url.pathname === PREFLIGHT_PATH) {
      const result = await preflightStatus(env);
      return json(result, result.ok ? 200 : 503, origin);
    }
    if (url.pathname === ORDER_GUARD_PATH) {
      const result = validateOrder(url, env);
      console.log(JSON.stringify({ event: 'ORDER_GUARD_VALIDATION', mode: result.mode, symbol: result.order.symbol, approved: result.ok, errors: result.errors, createdAt: result.validatedAt }));
      return json(result, result.ok ? 200 : 422, origin);
    }
    const mode = String(url.searchParams.get('mode') || 'sandbox').trim().toLowerCase();
    if (!['sandbox', 'live'].includes(mode)) return json({ ok: false, error: 'mode must be sandbox or live' }, 400, origin);
    if (url.pathname === STREAM_PATH) return streamDashboard(mode, env, origin);
    try {
      return json(await getDashboard(mode, env), 200, origin);
    } catch (error) {
      console.error(JSON.stringify({ event: 'TRADING_DASHBOARD_SYNC_FAILED', mode: mode.toUpperCase(), error: error instanceof Error ? error.message : 'Unknown dashboard error', createdAt: new Date().toISOString() }));
      return json({ ok: false, build: BUILD_ID, mode: mode.toUpperCase(), readOnly: true, error: error instanceof Error ? error.message : 'Trading dashboard sync failed', fetchedAt: new Date().toISOString() }, 503, origin);
    }
  },
  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
