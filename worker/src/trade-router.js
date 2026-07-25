import routerWorker, { AlertCoordinator as BaseAlertCoordinator } from './router.js';
import { closeTrade, listTrades, tradeAnalytics, upsertTrade } from './trade-history.js';

export class AlertCoordinator extends BaseAlertCoordinator {
  async listTrades(options = {}) {
    return listTrades(this.ctx.storage, options);
  }

  async upsertTrade(payload) {
    return upsertTrade(this.ctx.storage, payload);
  }

  async closeTrade(id, payload = {}) {
    return closeTrade(this.ctx.storage, id, payload);
  }

  async tradeAnalytics() {
    return tradeAnalytics(this.ctx.storage);
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function secureJson(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === env.APP_ORIGIN || origin === 'http://localhost:3000') return origin;
  return null;
}

function cors(origin) {
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type,x-moe-webhook-secret',
    vary: 'Origin',
  } : {};
}

function authorizedWrite(request, env) {
  const supplied = request.headers.get('x-moe-webhook-secret') || '';
  return Boolean(env.MOE_WEBHOOK_SECRET) && supplied === env.MOE_WEBHOOK_SECRET;
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('Invalid JSON payload');
  }
}

async function handleTrades(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!origin) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);

  const stub = coordinator(env);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const trades = await stub.listTrades({
      limit: url.searchParams.get('limit') || 100,
      status: url.searchParams.get('status') || '',
      symbol: url.searchParams.get('symbol') || '',
    });
    return secureJson({ ok: true, count: trades.length, trades, storage: 'DURABLE_OBJECT' }, 200, headers);
  }

  if (request.method === 'POST') {
    if (!authorizedWrite(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);
    const trade = await stub.upsertTrade(await parseJson(request));
    return secureJson({ ok: true, trade, storage: 'DURABLE_OBJECT' }, 200, headers);
  }

  return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
}

async function handleTradeClose(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!origin) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  if (!authorizedWrite(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);

  const payload = await parseJson(request);
  const id = String(payload.id || payload.tradeId || '').trim();
  if (!id) return secureJson({ ok: false, error: 'Trade id is required' }, 400, headers);
  const trade = await coordinator(env).closeTrade(id, payload);
  return secureJson({ ok: true, trade, storage: 'DURABLE_OBJECT' }, 200, headers);
}

async function handleTradeAnalytics(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!origin) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);

  const analytics = await coordinator(env).tradeAnalytics();
  return secureJson({ ok: true, analytics, storage: 'DURABLE_OBJECT' }, 200, headers);
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/trades') return await handleTrades(request, env);
      if (path === '/api/trades/close') return await handleTradeClose(request, env);
      if (path === '/api/trades/analytics') return await handleTradeAnalytics(request, env);
      return routerWorker.fetch(request, env, ctx);
    } catch (error) {
      return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Trade history request failed' }, 400);
    }
  },

  async scheduled(controller, env, ctx) {
    return routerWorker.scheduled(controller, env, ctx);
  },
};
