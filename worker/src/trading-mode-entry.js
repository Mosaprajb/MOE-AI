import entryWorker, { AlertCoordinator as BaseAlertCoordinator } from './entry.js';
import { htmlResponse as dashboardHtmlResponse } from './unified-dashboard.js';
import { getTradingMode, TRADING_MODES, updateTradingMode } from './trading-mode-service.js';
import { getLiveTradingReadiness, handleWebullLiveOrder } from './webull-live.js';
import { handleLiveCertification } from './live-certification.js';

const TRADING_MODE_PATH = '/api/trading/mode';
const LIVE_READINESS_PATH = '/api/trading/live/readiness';
const LIVE_CERTIFICATION_PATH = '/api/trading/live/certify';
const SCANNER_STATUS_PATH = '/api/scanner/status';
const ALL_TRADES_PATH = '/api/trades/all';
const SIGNAL_PATH = '/api/tradingview/signal';
const DASHBOARD_PAGE_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const TRADE_LEDGER_PATHS = new Set(['/trades', '/trades/']);

export class AlertCoordinator extends BaseAlertCoordinator {
  async getTradingMode() { return getTradingMode(this.ctx.storage, this.env); }
  async updateTradingMode(patch = {}) { return updateTradingMode(this.ctx.storage, patch, this.env); }
  async listAllTrades() {
    const trades = await this.ctx.storage.get('trade-history:v1');
    return Array.isArray(trades) ? trades.slice(0, 2000) : [];
  }
  async scannerStatus() {
    const subscriptions = (await this.ctx.storage.get('subscriptions')) || {};
    const active = Object.values(subscriptions).filter((item) => item?.enabled);
    const symbols = [...new Set(active.flatMap((item) => Array.isArray(item.symbols) ? item.symbols : []))].sort();
    const timeframes = [...new Set(active.map((item) => Number(item.timeframe)).filter(Number.isFinite))].sort((a, b) => a - b);
    const checks = active.map((item) => Number(item.lastCheckedAt || 0)).filter((value) => value > 0);
    const activity = active.flatMap((item) => Array.isArray(item.activity) ? item.activity : []);
    return {
      enabled: String(this.env.AUTO_SCANNER_ENABLED || '').toLowerCase() === 'true' || active.length > 0,
      activeSubscriptions: active.length,
      symbolCount: symbols.length,
      symbols,
      timeframes: timeframes.map((value) => value >= 60 ? `${value / 60}h` : `${value}m`),
      lastCheckedAt: checks.length ? new Date(Math.max(...checks)).toISOString() : null,
      activityCount: activity.length,
      recentActivity: activity.sort((a, b) => Number(b?.at || 0) - Number(a?.at || 0)).slice(0, 25),
    };
  }
}

function coordinator(env) { return env.ALERT_COORDINATOR.getByName('global'); }

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === env.APP_ORIGIN || origin === 'http://localhost:3000') return origin;
  return false;
}

function cors(origin) {
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, PUT, POST, OPTIONS',
    'access-control-allow-headers': 'content-type,x-moe-webhook-secret',
    vary: 'Origin',
  } : {};
}

function secureJson(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } });
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
  if (request.method === 'GET') return secureJson({ ok: true, tradingMode: await coordinator(env).getTradingMode(), storage: 'DURABLE_OBJECT' }, 200, headers);
  if (request.method === 'PUT') {
    if (!authorized(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);
    let payload;
    try { payload = await request.json(); } catch { return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400, headers); }
    try {
      const tradingMode = await coordinator(env).updateTradingMode(payload);
      return secureJson({ ok: true, tradingMode, storage: 'DURABLE_OBJECT' }, 200, headers);
    } catch (error) {
      return secureJson({ ok: false, blocked: true, error: error instanceof Error ? error.message : 'Trading mode update failed' }, 423, headers);
    }
  }
  return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
}

async function handleLiveReadiness(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  return secureJson({ ok: true, readiness: getLiveTradingReadiness(env), tradingMode: await coordinator(env).getTradingMode() }, 200, headers);
}

async function handleScannerStatus(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  return secureJson({ ok: true, scanner: await coordinator(env).scannerStatus(), storage: 'DURABLE_OBJECT' }, 200, headers);
}

async function handleAllTrades(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  const trades = await coordinator(env).listAllTrades();
  return secureJson({ ok: true, count: trades.length, trades, storage: 'DURABLE_OBJECT' }, 200, headers);
}

async function enforceTradingMode(request, env) {
  if (request.method !== 'POST' || new URL(request.url).pathname !== SIGNAL_PATH) return request;
  const mode = await coordinator(env).getTradingMode();
  if (mode.effectiveMode === TRADING_MODES.SANDBOX) return request;
  if (mode.effectiveMode === TRADING_MODES.LIVE) return handleWebullLiveOrder(request, env);
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return request;
  try {
    const payload = await request.clone().json();
    const headers = new Headers(request.headers);
    headers.set('content-type', 'application/json');
    return new Request(request.url, { method: request.method, headers, body: JSON.stringify({ ...payload, submitSandbox: false, submitLive: false, tradingMode: TRADING_MODES.DRY_RUN }) });
  } catch { return request; }
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (DASHBOARD_PAGE_PATHS.has(path)) return dashboardHtmlResponse();
    if (TRADE_LEDGER_PATHS.has(path)) return Response.redirect(new URL('/#trades', request.url).toString(), 302);
    if (path === TRADING_MODE_PATH) return handleTradingMode(request, env);
    if (path === LIVE_READINESS_PATH) return handleLiveReadiness(request, env);
    if (path === LIVE_CERTIFICATION_PATH) return handleLiveCertification(request, env);
    if (path === SCANNER_STATUS_PATH) return handleScannerStatus(request, env);
    if (path === ALL_TRADES_PATH) return handleAllTrades(request, env);
    if (path === '/api/webull/bootstrap') return secureJson({ ok: false, blocked: true, error: 'Remote token bootstrap is disabled. Configure broker credentials only as Cloudflare secrets.' }, 423);
    const enforcedRequest = await enforceTradingMode(request, env);
    if (enforcedRequest instanceof Response) return enforcedRequest;
    return entryWorker.fetch(enforcedRequest, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    let mode;
    try { mode = await coordinator(env).getTradingMode(); } catch { mode = { effectiveMode: TRADING_MODES.DRY_RUN }; }
    const scheduledEnv = mode.effectiveMode === TRADING_MODES.SANDBOX
      ? env
      : { ...env, AUTO_SCANNER_ENABLED: 'false', WEBULL_AUTOMATION_ARMED: 'false' };
    return entryWorker.scheduled(controller, scheduledEnv, ctx);
  },
};
