import entryWorker, { AlertCoordinator as BaseAlertCoordinator } from './entry.js';
import { htmlResponse as dashboardHtmlResponse } from './moe-dashboard-v3.js';
import { getTradingMode, TRADING_MODES, updateTradingMode } from './trading-mode-service.js';

const TRADING_MODE_PATH = '/api/trading/mode';
const SIGNAL_PATH = '/api/tradingview/signal';
const DASHBOARD_PAGE_PATHS = new Set([
  '/',
  '/moe-ai',
  '/moe-ai/',
  '/dashboard',
  '/dashboard/',
]);

export class AlertCoordinator extends BaseAlertCoordinator {
  async getTradingMode() {
    return getTradingMode(this.ctx.storage, this.env);
  }

  async updateTradingMode(patch = {}) {
    return updateTradingMode(this.ctx.storage, patch, this.env);
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === env.APP_ORIGIN || origin === 'http://localhost:3000') return origin;
  return false;
}

function cors(origin) {
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type,x-moe-webhook-secret',
    vary: 'Origin',
  } : {};
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

function authorized(request, env) {
  const supplied = request.headers.get('x-moe-webhook-secret') || '';
  return Boolean(env.MOE_WEBHOOK_SECRET) && supplied === env.MOE_WEBHOOK_SECRET;
}

async function handleTradingMode(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin || null);

  if (request.method === 'OPTIONS') {
    if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
    return new Response(null, { status: 204, headers });
  }

  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);

  if (request.method === 'GET') {
    return secureJson({ ok: true, tradingMode: await coordinator(env).getTradingMode(), storage: 'DURABLE_OBJECT' }, 200, headers);
  }

  if (request.method === 'PUT') {
    if (!authorized(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);

    let payload;
    try {
      payload = await request.json();
    } catch {
      return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400, headers);
    }

    try {
      const tradingMode = await coordinator(env).updateTradingMode(payload);
      return secureJson({ ok: true, tradingMode, storage: 'DURABLE_OBJECT' }, 200, headers);
    } catch (error) {
      return secureJson({ ok: false, blocked: true, error: error instanceof Error ? error.message : 'Trading mode update failed' }, 423, headers);
    }
  }

  return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
}

async function enforceTradingMode(request, env) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== SIGNAL_PATH) return request;

  const mode = await coordinator(env).getTradingMode();
  if (mode.effectiveMode === TRADING_MODES.SANDBOX) return request;

  if (mode.effectiveMode === TRADING_MODES.LIVE) {
    return secureJson({
      ok: false,
      blocked: true,
      submitted: false,
      tradingMode: mode,
      error: 'Live execution is not implemented or approved.',
    }, 423);
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return request;

  try {
    const payload = await request.clone().json();
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    return new Request(request.url, {
      method: request.method,
      headers,
      body: JSON.stringify({ ...payload, submitSandbox: false, tradingMode: TRADING_MODES.DRY_RUN }),
    });
  } catch {
    return request;
  }
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (DASHBOARD_PAGE_PATHS.has(path)) return dashboardHtmlResponse();
    if (path === TRADING_MODE_PATH) return handleTradingMode(request, env);

    const enforcedRequest = await enforceTradingMode(request, env);
    if (enforcedRequest instanceof Response) return enforcedRequest;
    return entryWorker.fetch(enforcedRequest, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return entryWorker.scheduled(controller, env, ctx);
  },
};
