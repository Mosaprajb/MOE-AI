import entryWorker, { AlertCoordinator as BaseAlertCoordinator } from './entry.js';
import { htmlResponse as dashboardHtmlResponse } from './unified-dashboard.js';
import { getTradingMode, TRADING_MODES, updateTradingMode } from './trading-mode-service.js';
import { getLiveTradingReadiness, handleWebullLiveOrder } from './webull-live.js';
import { handleLiveCertification } from './live-certification.js';
import { AUTO_SCANNER_SYMBOLS, activeTradingWindow, scannerProfiles } from './auto-scanner.js';
import {
  applyRuntimeLiveControl,
  forceSafeDisarmFromAuthenticatedSession,
  getLiveControlState,
  setSandboxAutomationFromAuthenticatedSession,
  updateLiveControlState,
  verifyLiveControlPin,
} from './live-control-service.js';
import { marketSessionStatus } from './market-session.js';
import { runReadOnlyProductionAudit } from './live-production-audit.js';
import { buildLifecycleReport, readSandboxLifecycleSnapshot } from './order-lifecycle.js';
import { finalizeOrderReservation, listOrderReservations, releaseOrderReservation, reserveOrderSubmission } from './order-reservation.js';
import { applyLifecycleReport, getLatestLifecycleReport, listTrades } from './trade-history.js';

const PATHS = {
  mode: '/api/trading/mode', readiness: '/api/trading/live/readiness', certification: '/api/trading/live/certify',
  control: '/api/trading/live/control', audit: '/api/trading/live/audit', session: '/api/market/session',
  scanner: '/api/scanner/status', trades: '/api/trades/all', lifecycle: '/api/trades/lifecycle', reservations: '/api/trades/reservations', signal: '/api/tradingview/signal',
};
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const TRADE_PATHS = new Set(['/trades', '/trades/']);
const BOT_STATUS_KEY = 'bot-status:v2';
const BOT_HISTORY_KEY = 'bot-status-history:v2';

export class AlertCoordinator extends BaseAlertCoordinator {
  async getLiveControlState() { return getLiveControlState(this.ctx.storage, this.env); }
  async updateLiveControlState(patch = {}) { return updateLiveControlState(this.ctx.storage, patch, this.env); }
  async verifyLiveControlPin(pin) { return verifyLiveControlPin(this.ctx.storage, pin, this.env); }
  async setSandboxAutomationFromMobile(armed, actor = 'MOBILE_DASHBOARD') { return setSandboxAutomationFromAuthenticatedSession(this.ctx.storage, armed, actor, this.env); }
  async forceSafeDisarmFromMobile(actor = 'MOBILE_DASHBOARD') { return forceSafeDisarmFromAuthenticatedSession(this.ctx.storage, actor, this.env); }
  async getTradingMode() { const control = await this.getLiveControlState(); return getTradingMode(this.ctx.storage, applyRuntimeLiveControl(this.env, control)); }
  async updateTradingMode(patch = {}) { const control = await this.getLiveControlState(); return updateTradingMode(this.ctx.storage, patch, applyRuntimeLiveControl(this.env, control)); }
  async listAllTrades() { const trades = await this.ctx.storage.get('trade-history:v1'); return Array.isArray(trades) ? trades.slice(0, 2000) : []; }
  async listLifecycleTrades() { return listTrades(this.ctx.storage, { status: 'OPEN', limit: 500 }); }
  async applyLifecycleReport(report = {}) { return applyLifecycleReport(this.ctx.storage, report); }
  async latestLifecycleReport() { return getLatestLifecycleReport(this.ctx.storage); }
  async reserveOrderSubmission(payload = {}) { return reserveOrderSubmission(this.ctx.storage, payload, this.env); }
  async finalizeOrderReservation(id, patch = {}) { return finalizeOrderReservation(this.ctx.storage, id, patch, this.env); }
  async releaseOrderReservation(id, reason = 'RELEASED') { return releaseOrderReservation(this.ctx.storage, id, reason); }
  async listOrderReservations(options = {}) { return listOrderReservations(this.ctx.storage, options); }
  async recordBotStatus(record = {}) {
    const normalized = { ...record, recordedAt: new Date().toISOString() };
    const history = await this.ctx.storage.get(BOT_HISTORY_KEY);
    await this.ctx.storage.put({ [BOT_STATUS_KEY]: normalized, [BOT_HISTORY_KEY]: [normalized, ...(Array.isArray(history) ? history : [])].slice(0, 100) });
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
    const control = await this.getLiveControlState();
    const window = activeTradingWindow(new Date(), this.env);
    const lastHeartbeat = bot?.completedAt || bot?.recordedAt || null;
    const heartbeatAgeSeconds = lastHeartbeat ? Math.max(0, Math.floor((Date.now() - Date.parse(lastHeartbeat)) / 1000)) : null;
    const configured = String(this.env.AUTO_SCANNER_ENABLED || '').toLowerCase() === 'true';
    const enabled = configured && control.sandboxAutomationEnabled === true;
    const automationArmed = String(this.env.WEBULL_AUTOMATION_ARMED || '').toLowerCase() === 'true' && enabled;
    const sandbox = this.env.WEBULL_ENVIRONMENT === 'sandbox' && this.env.WEBULL_LIVE_TRADING !== 'true';
    return {
      state: !enabled ? 'DISABLED' : !sandbox ? 'SAFETY_BLOCKED' : heartbeatAgeSeconds != null && heartbeatAgeSeconds <= 180 ? 'ONLINE' : 'WAITING_FOR_HEARTBEAT',
      enabled, configured, automationArmed, sandboxSafetyLock: sandbox, liveTrading: this.env.WEBULL_LIVE_TRADING === 'true',
      environment: this.env.WEBULL_ENVIRONMENT || 'sandbox', universeSize: AUTO_SCANNER_SYMBOLS.length, symbols: AUTO_SCANNER_SYMBOLS,
      configuredProfiles: scannerProfiles(this.env).map((item) => `${item.primaryMinutes >= 60 ? `${item.primaryMinutes / 60}h` : `${item.primaryMinutes}m`} -> ${item.higherMinutes >= 60 ? `${item.higherMinutes / 60}h` : `${item.higherMinutes}m`}`),
      tradingHoursMode: String(this.env.AUTO_SCANNER_TRADING_HOURS || 'CORE').toUpperCase(), activeSession: window,
      lastHeartbeat, heartbeatAgeSeconds, lastRun: bot, recentRuns: Array.isArray(history) ? history.slice(0, 20) : [],
      activeSubscriptions: active.length, notificationSymbolCount: notificationSymbols.length, notificationSymbols,
      notificationTimeframes: notificationTimeframes.map((value) => value >= 60 ? `${value / 60}h` : `${value}m`),
      lastNotificationScanAt: checks.length ? new Date(Math.max(...checks)).toISOString() : null,
      notificationActivityCount: activity.length,
      recentNotificationActivity: activity.sort((a, b) => Number(b?.at || 0) - Number(a?.at || 0)).slice(0, 25),
      limits: {
        maximumOpenPositions: Number(this.env.MOE_MAX_OPEN_POSITIONS || 4), maximumDailyTrades: Number(this.env.MOE_MAX_DAILY_TRADES || 4),
        maximumSubmissionsPerRun: Number(this.env.AUTO_SCANNER_MAX_SUBMISSIONS_PER_RUN || 1), maximumQuantityPerOrder: Number(this.env.WEBULL_MAX_QUANTITY || 1),
        maximumNotionalPerOrder: Number(this.env.WEBULL_MAX_NOTIONAL || 1000),
      },
    };
  }
}

function coordinator(env) { return env.ALERT_COORDINATOR.getByName('global'); }
function allowedOrigin(request, env) {
  const origin = request.headers.get('origin'); if (!origin) return null;
  const requestOrigin = new URL(request.url).origin;
  const appOrigin = String(env.APP_ORIGIN || '').replace(/\/$/, '');
  let appUrlOrigin = ''; try { appUrlOrigin = env.APP_URL ? new URL(env.APP_URL).origin : ''; } catch { appUrlOrigin = ''; }
  if (origin === requestOrigin || origin === appOrigin || origin === appUrlOrigin || origin === 'http://localhost:3000') return origin;
  return false;
}
function cors(origin) { return origin ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, PUT, POST, OPTIONS', 'access-control-allow-headers': 'content-type,x-moe-webhook-secret', vary: 'Origin' } : {}; }
function secureJson(data, status = 200, headers = {}) { return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers } }); }
function authorized(request, env) { return Boolean(env.MOE_WEBHOOK_SECRET) && (request.headers.get('x-moe-webhook-secret') || '') === env.MOE_WEBHOOK_SECRET; }
async function runtime(env) { const control = await coordinator(env).getLiveControlState(); return { control, env: applyRuntimeLiveControl(env, control) }; }

async function signalFingerprint(payload = {}) {
  const explicit = String(payload.signalId || payload.signal_id || '').trim();
  if (explicit) return explicit.slice(0, 64);
  const raw = [payload.symbol, payload.side, payload.timeframe || payload.interval, payload.barTime || payload.time || payload.timestamp, payload.limitPrice || payload.marketPrice, payload.stopLoss, payload.takeProfit].map((value) => String(value ?? '')).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 64);
}

function sandboxSubmissionExpected(payload, env, control) {
  if (payload.submitSandbox === false) return false;
  if (payload.submitSandbox === true) return true;
  return env.WEBULL_ENVIRONMENT === 'sandbox'
    && env.WEBULL_SANDBOX_ENABLED === 'true'
    && env.WEBULL_SANDBOX_ORDER_SUBMISSION === 'true'
    && env.WEBULL_AUTO_SUBMIT_SANDBOX === 'true'
    && control.sandboxAutomationEnabled === true;
}

async function runSandboxLifecycle(env) {
  if (String(env.WEBULL_ENVIRONMENT || 'sandbox').toLowerCase() !== 'sandbox' || String(env.WEBULL_LIVE_TRADING || '').toLowerCase() === 'true') {
    return { skipped: true, reason: 'SANDBOX_LIFECYCLE_SAFETY_LOCK' };
  }
  if (String(env.WEBULL_LIFECYCLE_ENABLED || 'true').toLowerCase() === 'false') return { skipped: true, reason: 'WEBULL_LIFECYCLE_DISABLED' };
  const accountId = String(env.WEBULL_ACCOUNT_ID || '').trim();
  if (!accountId) return { skipped: true, reason: 'WEBULL_ACCOUNT_ID_MISSING' };
  const stub = coordinator(env);
  const trades = await stub.listLifecycleTrades();
  const snapshot = await readSandboxLifecycleSnapshot(accountId, trades, env);
  const report = buildLifecycleReport(trades, snapshot, env);
  return stub.applyLifecycleReport(report);
}

async function handleMode(request, env) {
  const origin = allowedOrigin(request, env); const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method === 'GET') return secureJson({ ok: true, tradingMode: await coordinator(env).getTradingMode(), storage: 'DURABLE_OBJECT' }, 200, headers);
  if (request.method !== 'PUT') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  if (!authorized(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);
  let payload; try { payload = await request.json(); } catch { return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400, headers); }
  try {
    const control = await coordinator(env).getLiveControlState();
    if (String(payload.mode || '').toUpperCase() === TRADING_MODES.LIVE && !control.effectiveLiveUnlocked) throw new Error('Live controls must be unlocked by PIN and the kill switch must be cleared first.');
    return secureJson({ ok: true, tradingMode: await coordinator(env).updateTradingMode(payload), storage: 'DURABLE_OBJECT' }, 200, headers);
  } catch (error) { return secureJson({ ok: false, blocked: true, error: error instanceof Error ? error.message : 'Trading mode update failed' }, 423, headers); }
}

async function handleReadiness(request, env) {
  const origin = allowedOrigin(request, env); const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  const live = await runtime(env);
  return secureJson({ ok: true, readiness: getLiveTradingReadiness(live.env), control: live.control, tradingMode: await coordinator(env).getTradingMode() }, 200, headers);
}

async function handleControl(request, env) {
  const origin = allowedOrigin(request, env); const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method === 'GET') return secureJson({ ok: true, control: await coordinator(env).getLiveControlState(), storage: 'DURABLE_OBJECT' }, 200, headers);
  if (request.method !== 'PUT') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  let payload; try { payload = await request.json(); } catch { return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400, headers); }
  try { return secureJson({ ok: true, control: await coordinator(env).updateLiveControlState(payload), storage: 'DURABLE_OBJECT' }, 200, headers); }
  catch (error) { return secureJson({ ok: false, blocked: true, error: error instanceof Error ? error.message : 'Live control update failed' }, 423, headers); }
}

async function handleAudit(request, env) {
  const origin = allowedOrigin(request, env); const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  let payload; try { payload = await request.json(); } catch { return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400, headers); }
  try {
    await coordinator(env).verifyLiveControlPin(payload.pin);
    return secureJson({ ok: true, audit: await runReadOnlyProductionAudit(env) }, 200, headers);
  } catch (error) { return secureJson({ ok: false, blocked: true, error: error instanceof Error ? error.message : 'Production audit failed' }, 423, headers); }
}

async function handleScanner(request, env) {
  const origin = allowedOrigin(request, env); const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  return secureJson({ ok: true, scanner: await coordinator(env).scannerStatus(), storage: 'DURABLE_OBJECT' }, 200, headers);
}

async function handleTrades(request, env) {
  const origin = allowedOrigin(request, env); const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  const trades = await coordinator(env).listAllTrades();
  return secureJson({ ok: true, count: trades.length, trades, storage: 'DURABLE_OBJECT' }, 200, headers);
}

async function handleLifecycle(request, env) {
  const origin = allowedOrigin(request, env); const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method === 'GET') return secureJson({ ok: true, lifecycle: await coordinator(env).latestLifecycleReport(), storage: 'DURABLE_OBJECT' }, 200, headers);
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  if (!authorized(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);
  const lifecycle = await runSandboxLifecycle(env);
  return secureJson({ ok: true, lifecycle, storage: 'DURABLE_OBJECT' }, 200, headers);
}

async function handleReservations(request, env) {
  const origin = allowedOrigin(request, env); const headers = cors(origin || null);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  const url = new URL(request.url);
  const reservations = await coordinator(env).listOrderReservations({ status: url.searchParams.get('status') || '', symbol: url.searchParams.get('symbol') || '', limit: url.searchParams.get('limit') || 100 });
  return secureJson({ ok: true, count: reservations.length, reservations, storage: 'DURABLE_OBJECT' }, 200, headers);
}

async function executeSignalWithReservation(request, env, ctx) {
  let payload;
  try { payload = await request.clone().json(); } catch { return entryWorker.fetch(request, env, ctx); }
  const [mode, live] = await Promise.all([coordinator(env).getTradingMode(), runtime(env)]);
  const runtimeMode = mode.effectiveMode;
  const submissionExpected = runtimeMode === TRADING_MODES.SANDBOX
    ? sandboxSubmissionExpected(payload, env, live.control)
    : runtimeMode === TRADING_MODES.LIVE && payload.submitLive === true;

  if (runtimeMode === TRADING_MODES.LIVE && !live.control.effectiveLiveUnlocked) {
    return secureJson({ ok: false, blocked: true, submitted: false, error: 'Live controls are locked or the kill switch is active.' }, 423);
  }

  if (!submissionExpected) {
    if (runtimeMode === TRADING_MODES.LIVE) return handleWebullLiveOrder(request, live.env);
    if (runtimeMode === TRADING_MODES.SANDBOX) return entryWorker.fetch(request, env, ctx);
    const headers = new Headers(request.headers); headers.set('content-type', 'application/json');
    return entryWorker.fetch(new Request(request.url, { method: request.method, headers, body: JSON.stringify({ ...payload, submitSandbox: false, submitLive: false, tradingMode: TRADING_MODES.DRY_RUN }) }), env, ctx);
  }

  const signalId = await signalFingerprint(payload);
  const accountId = runtimeMode === TRADING_MODES.LIVE ? live.env.WEBULL_LIVE_ACCOUNT_ID : (payload.accountId || env.WEBULL_ACCOUNT_ID);
  const reservationResult = await coordinator(env).reserveOrderSubmission({
    signalId,
    accountId,
    symbol: payload.symbol,
    side: payload.side,
    runtimeMode,
    requestedCapitalMode: payload.capitalMode ?? payload.context?.capitalMode ?? 'AUTO',
    source: payload.source || 'MOERAND',
  });
  if (!reservationResult.accepted) {
    return secureJson({ ok: false, blocked: true, submitted: false, duplicate: true, duplicateProtection: reservationResult, error: 'Duplicate order blocked before broker submission.' }, 409);
  }

  const reservationId = reservationResult.reservation.id;
  try {
    const response = runtimeMode === TRADING_MODES.LIVE
      ? await handleWebullLiveOrder(request, live.env)
      : await entryWorker.fetch(request, env, ctx);
    let result = null;
    try { result = await response.clone().json(); } catch { result = null; }
    if (result?.submitted === true) {
      const brokerOrderIds = result.submission?.clientOrderIds || result.submission?.client_order_ids || null;
      const finalized = await coordinator(env).finalizeOrderReservation(reservationId, {
        tradeId: result.tradeId || null,
        capitalSource: result.capitalPolicy?.capitalSource || payload.capitalMode || 'AUTO',
        brokerOrderIds,
      });
      return secureJson({ ...result, duplicateProtection: { reserved: true, finalized } }, response.status, Object.fromEntries(response.headers));
    }
    await coordinator(env).releaseOrderReservation(reservationId, result?.error || result?.message || 'ORDER_NOT_SUBMITTED');
    return response;
  } catch (error) {
    await coordinator(env).releaseOrderReservation(reservationId, error instanceof Error ? error.message : 'ORDER_PIPELINE_FAILED');
    throw error;
  }
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (DASHBOARD_PATHS.has(path)) return dashboardHtmlResponse();
    if (TRADE_PATHS.has(path)) return Response.redirect(new URL('/#trades', request.url).toString(), 302);
    if (path === PATHS.mode) return handleMode(request, env);
    if (path === PATHS.readiness) return handleReadiness(request, env);
    if (path === PATHS.certification) return handleLiveCertification(request, env);
    if (path === PATHS.control) return handleControl(request, env);
    if (path === PATHS.audit) return handleAudit(request, env);
    if (path === PATHS.session) return secureJson({ ok: true, market: marketSessionStatus(new Date()) });
    if (path === PATHS.scanner) return handleScanner(request, env);
    if (path === PATHS.trades) return handleTrades(request, env);
    if (path === PATHS.lifecycle) return handleLifecycle(request, env);
    if (path === PATHS.reservations) return handleReservations(request, env);
    if (path === '/api/webull/bootstrap') return secureJson({ ok: false, blocked: true, error: 'Remote token bootstrap is disabled. Configure broker credentials only as Cloudflare secrets.' }, 423);
    if (path === PATHS.signal && request.method === 'POST') return executeSignalWithReservation(request, env, ctx);
    return entryWorker.fetch(request, env, ctx);
  },
  async scheduled(controller, env, ctx) {
    let mode; let control;
    try { [mode, control] = await Promise.all([coordinator(env).getTradingMode(), coordinator(env).getLiveControlState()]); }
    catch { mode = { effectiveMode: TRADING_MODES.DRY_RUN }; control = { sandboxAutomationEnabled: false, effectiveLiveAutomationArmed: false }; }
    const lifecycleTask = runSandboxLifecycle(env).then((result) => {
      console.log(JSON.stringify({ event: 'SANDBOX_ORDER_LIFECYCLE', ...result, createdAt: new Date().toISOString() }));
      return result;
    }).catch((error) => {
      console.error(JSON.stringify({ event: 'SANDBOX_ORDER_LIFECYCLE_FAILED', error: error instanceof Error ? error.message : 'Unknown lifecycle error', createdAt: new Date().toISOString() }));
      return null;
    });
    if (ctx?.waitUntil) ctx.waitUntil(lifecycleTask);
    if (mode.effectiveMode === TRADING_MODES.SANDBOX && control.sandboxAutomationEnabled) return entryWorker.scheduled(controller, env, ctx);
    if (mode.effectiveMode === TRADING_MODES.LIVE && control.effectiveLiveAutomationArmed) return entryWorker.scheduled(controller, applyRuntimeLiveControl(env, control), ctx);
    return entryWorker.scheduled(controller, { ...env, AUTO_SCANNER_ENABLED: 'false', WEBULL_AUTOMATION_ARMED: 'false', WEBULL_LIVE_AUTOMATION_ARMED: 'false' }, ctx);
  },
};
