import entryWorker, { AlertCoordinator as BaseAlertCoordinator } from './entry.js';
import { htmlResponse as dashboardHtmlResponse } from './unified-dashboard.js';
import { getTradingMode, TRADING_MODES, updateTradingMode } from './trading-mode-service.js';
import { getLiveTradingReadiness, handleWebullLiveOrder } from './webull-live.js';
import { handleLiveCertification } from './live-certification.js';
import { AUTO_SCANNER_SYMBOLS, activeTradingWindow, scannerProfiles } from './auto-scanner.js';
import { applyRuntimeLiveControl, getLiveControlState, updateLiveControlState } from './live-control-service.js';

const TRADING_MODE_PATH = '/api/trading/mode';
const LIVE_READINESS_PATH = '/api/trading/live/readiness';
const LIVE_CERTIFICATION_PATH = '/api/trading/live/certify';
const LIVE_CONTROL_PATH = '/api/trading/live/control';
const SCANNER_STATUS_PATH = '/api/scanner/status';
const ALL_TRADES_PATH = '/api/trades/all';
const SIGNAL_PATH = '/api/tradingview/signal';
const DASHBOARD_PAGE_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const TRADE_LEDGER_PATHS = new Set(['/trades', '/trades/']);
const BOT_STATUS_KEY = 'bot-status:v2';
const BOT_HISTORY_KEY = 'bot-status-history:v2';

export class AlertCoordinator extends BaseAlertCoordinator {
  async getTradingMode() { return getTradingMode(this.ctx.storage, this.env); }
  async updateTradingMode(patch = {}) { return updateTradingMode(this.ctx.storage, patch, this.env); }
  async getLiveControlState() { return getLiveControlState(this.ctx.storage, this.env); }
  async updateLiveControlState(patch = {}) { return updateLiveControlState(this.ctx.storage, patch, this.env); }
  async listAllTrades() {
    const trades = await this.ctx.storage.get('trade-history:v1');
    return Array.isArray(trades) ? trades.slice(0, 2000) : [];
  }
  async recordBotStatus(record = {}) {
    const normalized = { ...record, recordedAt: new Date().toISOString() };
    const history = await this.ctx.storage.get(BOT_HISTORY_KEY);
    const next = [normalized, ...(Array.isArray(history) ? history : [])].slice(0, 100);
    await this.ctx.storage.put({ [BOT_STATUS_KEY]: normalized, [BOT_HISTORY_KEY]: next });
    return normalized;
  }
  async scannerStatus() {
    const subscriptions = (await this.ctx.storage.get('subscriptions')) || {};
    const active = Object.values(subscriptions).filter((item) => item?.enabled);
    const notificationSymbols = [...new Set(active.flatMap((item) => Array.isArray(item.symbols) ? item.symbols : []))].sort();
    const notificationTimeframes = [...new Set(active.map((item) => Number(item.timeframe)).filter(Number.isFinite))].sort((a, b) => a - b);
    const checks = active.map((item) => Number(item.lastCheckedAt || 0)).filter((value) => value > 0);
    const activity = active.flatMap((item) => Array.isArray(item.activity) ? item.activity : []);
    const bot = await this.ctx.storage.get(BOT_STATUS_KEY) || null;
    const history = await this.ctx.storage.get(BOT_HISTORY_KEY) || [];
    const control = await getLiveControlState(this.ctx.storage, this.env);
    const window = activeTradingWindow(new Date(), this.env);
    const lastHeartbeat = bot?.completedAt || bot?.recordedAt || null;
    const heartbeatAgeSeconds = lastHeartbeat ? Math.max(0, Math.floor((Date.now() - Date.parse(lastHeartbeat)) / 1000)) : null;
    const scannerConfigured = String(this.env.AUTO_SCANNER_ENABLED || '').toLowerCase() === 'true';
    const scannerEnabled = scannerConfigured && control.sandboxAutomationEnabled === true;
    const automationArmed = String(this.env.WEBULL_AUTOMATION_ARMED || '').toLowerCase() === 'true' && control.sandboxAutomationEnabled === true;
    const sandbox = this.env.WEBULL_ENVIRONMENT === 'sandbox' && this.env.WEBULL_LIVE_TRADING !== 'true';
    return {
      state: !scannerEnabled ? 'DISABLED' : !sandbox ? 'SAFETY_BLOCKED' : heartbeatAgeSeconds != null && heartbeatAgeSeconds <= 180 ? 'ONLINE' : 'WAITING_FOR_HEARTBEAT',
      enabled: scannerEnabled,
      configured: scannerConfigured,
      automationArmed,
      sandboxSafetyLock: sandbox,
      liveTrading: this.env.WEBULL_LIVE_TRADING === 'true',
      environment: this.env.WEBULL_ENVIRONMENT || 'sandbox',
      universeSize: AUTO_SCANNER_SYMBOLS.length,
      symbols: AUTO_SCANNER_SYMBOLS,
      configuredProfiles: scannerProfiles(this.env).map((item) => `${item.primaryMinutes >= 60 ? `${item.primaryMinutes / 60}h` : `${item.primaryMinutes}m`} -> ${item.higherMinutes >= 60 ? `${item.higherMinutes / 60}h` : `${item.higherMinutes}m`}`),
      tradingHoursMode: String(this.env.AUTO_SCANNER_TRADING_HOURS || 'CORE').toUpperCase(),
      activeSession: window,
      lastHeartbeat,
      heartbeatAgeSeconds,
      lastRun: bot,
      recentRuns: Array.isArray(history) ? history.slice(0, 20) : [],
      activeSubscriptions: active.length,
      notificationSymbolCount: notificationSymbols.length,
      notificationSymbols,
      notificationTimeframes: notificationTimeframes.map((value) => value >= 60 ? `${value / 60}h` : `${value}m`),
      lastNotificationScanAt: checks.length ? new Date(Math.max(...checks)).toISOString() : null,
      notificationActivityCount: activity.length,
      recentNotificationActivity: activity.sort((a, b) => Number(b?.at || 0) - Number(a?.at || 0)).slice(0, 25),
      limits: {
        maximumOpenPositions: Number(this.env.MOE_MAX_OPEN_POSITIONS || 4),
        maximumDailyTrades: Number(this.env.MOE_MAX_DAILY_TRADES || 4),
        maximumSubmissionsPerRun: Number(this.env.AUTO_SCANNER_MAX_SUBMISSIONS_PER_RUN || 1),
        maximumQuantityPerOrder: Number(this.env.WEBULL_MAX_QUANTITY || 1),
        maximumNotionalPerOrder: Number(this.env.WEBULL_MAX_NOTIONAL || 1000),
      },
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

async function runtimeEnv(env) {
  const control = await coordinator(env).getLiveControlState();
  return { env: applyRuntimeLiveControl(env, control), control };
}

async function handleTradingMode(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin || null);
  if (request.method === 'OPTIONS') {
    if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
    return new Response(null, { status: 204, headers });
  }
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  const runtime = await runtimeEnv(env);
  if (request.method === 'GET') return secureJson({ ok: true, tradingMode: await getTradingMode(coordinator(env), runtime.env), storage: 'DURABLE_OBJECT' }, 200, headers);
  if (request.method === 'PUT') {
    if (!authorized(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);
    let payload;
    try { payload = await request.json(); } catch { return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400, headers); }
    try {
      if (String(payload.mode || '').toUpperCase() === TRADING_MODES.LIVE && !runtime.control.effectiveLiveUnlocked) {
        throw new Error('Live controls must be unlocked by PIN and the kill switch must be cleared first.');
      }
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
  const runtime = await runtimeEnv(env);
  return secureJson({ ok: true, readiness: getLiveTradingReadiness(runtime.env), control: runtime.control, tradingMode: await coordinator(env).getTradingMode() }, 200, headers);
}

async function handleLiveControl(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method === 'GET') return secureJson({ ok: true, control: await coordinator(env).getLiveControlState(), storage: 'DURABLE_OBJECT' }, 200, headers);
  if (request.method === 'PUT') {
    let payload;
    try { payload = await request.json(); } catch { return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400, headers); }
    try {
      const control = await coordinator(env).updateLiveControlState(payload);
      return secureJson({ ok: true, control, storage: 'DURABLE_OBJECT' }, 200, headers);
    } catch (error) {
      return secureJson({ ok: false, blocked: true, error: error instanceof Error ? error.message : 'Live control update failed' }, 423, headers);
    }
  }
  return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
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
  const runtime = await runtimeEnv(env);
  const mode = await coordinator(env).getTradingMode();
  if (mode.effectiveMode === TRADING_MODES.SANDBOX) return request;
  if (mode.effectiveMode === TRADING_MODES.LIVE) {
    if (!runtime.control.effectiveLiveUnlocked) return secureJson({ ok: false, blocked: true, submitted: false, error: 'Live controls are locked or the kill switch is active.' }, 423);
    return handleWebullLiveOrder(request, runtime.env);
  }
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
    if (path === LIVE_CONTROL_PATH) return handleLiveControl(request, env);
    if (path === SCANNER_STATUS_PATH) return handleScannerStatus(request, env);
    if (path === ALL_TRADES_PATH) return handleAllTrades(request, env);
    if (path === '/api/webull/bootstrap') return secureJson({ ok: false, blocked: true, error: 'Remote token bootstrap is disabled. Configure broker credentials only as Cloudflare secrets.' }, 423);
    const enforcedRequest = await enforceTradingMode(request, env);
    if (enforcedRequest instanceof Response) return enforcedRequest;
    return entryWorker.fetch(enforcedRequest, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    let mode;
    let control;
    try {
      [mode, control] = await Promise.all([coordinator(env).getTradingMode(), coordinator(env).getLiveControlState()]);
    } catch {
      mode = { effectiveMode: TRADING_MODES.DRY_RUN };
      control = { sandboxAutomationEnabled: false, effectiveLiveAutomationArmed: false };
    }
    if (mode.effectiveMode === TRADING_MODES.SANDBOX && control.sandboxAutomationEnabled) return entryWorker.scheduled(controller, env, ctx);
    if (mode.effectiveMode === TRADING_MODES.LIVE && control.effectiveLiveAutomationArmed) {
      const liveEnv = applyRuntimeLiveControl(env, control);
      return entryWorker.scheduled(controller, liveEnv, ctx);
    }
    return entryWorker.scheduled(controller, { ...env, AUTO_SCANNER_ENABLED: 'false', WEBULL_AUTOMATION_ARMED: 'false', WEBULL_LIVE_AUTOMATION_ARMED: 'false' }, ctx);
  },
};
