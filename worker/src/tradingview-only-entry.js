import baseWorker, {
  AlertCoordinator as BaseAlertCoordinator,
  SimulationDriver,
} from './sandbox-market-platform-entry.js';
import {
  getBrokerAccountSummary,
  liveBrokerReadiness,
} from './tradingview-only-broker.js';
import {
  normalizeTradingViewAlert,
  normalizeTradingViewSettings,
  tradingViewSignalId,
  TRADINGVIEW_DEFAULT_SETTINGS,
  TradingViewPositionCoordinator,
} from './tradingview-only-runtime.js';
import {
  scannerOnlyHtml,
  tradingViewDashboardHtml,
} from './tradingview-only-dashboard.js';

export { SimulationDriver, TradingViewPositionCoordinator };

const SETTINGS_KEY = 'tradingview-only:settings:v1';
const RUNTIME_KEY = 'tradingview-only:runtime:v1';
const AUDIT_KEY = 'tradingview-only:audit:v1';
const ARCHIVE_KEY = 'tradingview-only:archive:v1';
const ACTIVE_KEY = 'tradingview-only:active:v1';
const DEDUPE_INDEX_KEY = 'tradingview-only:dedupe-index:v1';
const DAILY_PNL_KEY = 'tradingview-only:daily-pnl:v1';
const SESSION_COOKIE = 'moe_tv_session';
const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/m', '/m/', '/mobile', '/mobile/', '/alerts', '/alerts/']);
const SCANNER_PATHS = new Set(['/scanner', '/scanner/']);
const WEBHOOK_PATHS = new Set(['/api/tradingview/signal', '/api/tradingview/webhook']);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function json(payload, status = 200, headers = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function html(content) {
  return new Response(content, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function positionCoordinator(env, symbol) {
  return env.TRADINGVIEW_POSITION.getByName(String(symbol || '').trim().toUpperCase());
}

function newYorkDateKey(value = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(value));
}

function defaultRuntime(settings = TRADINGVIEW_DEFAULT_SETTINGS) {
  return {
    receptionEnabled: false,
    killSwitchActive: false,
    accountType: settings.accountType || 'DEMO',
    liveActivated: false,
    liveActivatedAt: null,
    lastValidAlertAt: null,
    lastValidAlert: null,
    updatedAt: null,
  };
}

function constantTimeTextEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function sessionSecret(env = {}) {
  const value = String(env.MOE_MOBILE_SESSION_SECRET || env.MOE_WEBHOOK_SECRET || '').trim();
  if (value.length < 16) throw new Error('A secure mobile session secret is not configured');
  return value;
}

async function hmac(value, env) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(sessionSecret(env)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function cookieValue(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

async function createSession(env) {
  const issuedAt = Date.now();
  const ttlSeconds = Math.max(300, Math.min(86_400, finite(env.MOE_TRADINGVIEW_SESSION_TTL_SECONDS, 43_200)));
  const payload = {
    scope: 'MOE_TRADINGVIEW_DASHBOARD',
    issuedAt,
    expiresAt: issuedAt + ttlSeconds * 1000,
    nonce: crypto.randomUUID(),
  };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmac(body, env));
  return { token: `${body}.${signature}`, payload, ttlSeconds };
}

async function requireSession(request, env) {
  const [body, signature, ...extra] = cookieValue(request, SESSION_COOKIE).split('.');
  if (!body || !signature || extra.length) throw new Error('Authentication required');
  const expected = await hmac(body, env);
  if (!constantTimeTextEqual(base64UrlEncode(expected), signature)) throw new Error('Invalid dashboard session');
  let payload;
  try { payload = JSON.parse(decoder.decode(base64UrlDecode(body))); }
  catch { throw new Error('Invalid dashboard session'); }
  if (payload?.scope !== 'MOE_TRADINGVIEW_DASHBOARD' || finite(payload?.expiresAt, 0) <= Date.now()) {
    throw new Error('Dashboard session expired');
  }
  return payload;
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

async function requireUiAccess(request, env) {
  if (!sameOrigin(request)) throw new Error('Invalid request origin');
  return requireSession(request, env);
}

function publicRequestMetadata(request) {
  return {
    ip: request.headers.get('cf-connecting-ip') || null,
    userAgent: String(request.headers.get('user-agent') || '').slice(0, 180),
    country: request.cf?.country || null,
  };
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async tradingViewSettings() {
    const stored = await this.ctx.storage.get(SETTINGS_KEY);
    return stored && typeof stored === 'object'
      ? { ...TRADINGVIEW_DEFAULT_SETTINGS, ...stored, spotOnly: true, longOnly: true }
      : { ...TRADINGVIEW_DEFAULT_SETTINGS };
  }

  async updateTradingViewSettings(patch = {}) {
    const active = await this.tradingViewActivePositions();
    if (Object.keys(active).length > 0) throw new Error('Close all positions before changing TradingView execution settings');
    const settings = normalizeTradingViewSettings(patch);
    await this.ctx.storage.put(SETTINGS_KEY, settings);
    const runtime = await this.tradingViewRuntime();
    await this.ctx.storage.put(RUNTIME_KEY, {
      ...runtime,
      accountType: settings.accountType,
      receptionEnabled: false,
      updatedAt: new Date().toISOString(),
    });
    await this.recordTradingViewAudit({ type: 'TRADINGVIEW_SETTINGS_UPDATED', accountType: settings.accountType });
    return settings;
  }

  async tradingViewRuntime() {
    const settings = await this.tradingViewSettings();
    const stored = await this.ctx.storage.get(RUNTIME_KEY);
    return stored && typeof stored === 'object'
      ? { ...defaultRuntime(settings), ...stored }
      : defaultRuntime(settings);
  }

  async setTradingViewReception(payload = {}) {
    const settings = await this.tradingViewSettings();
    if (!settings.configured) throw new Error('Save all fixed-dollar settings before enabling alert reception');
    const current = await this.tradingViewRuntime();
    const receptionEnabled = payload.enabled === true;
    const accountType = String(payload.accountType || settings.accountType || current.accountType || 'DEMO').toUpperCase();
    if (!['DEMO', 'LIVE'].includes(accountType)) throw new Error('Account type must be DEMO or LIVE');
    if (receptionEnabled && current.killSwitchActive) throw new Error('Clear the emergency kill switch before enabling alerts');

    let liveActivated = current.liveActivated === true;
    let liveActivatedAt = current.liveActivatedAt || null;
    if (receptionEnabled && accountType === 'LIVE') {
      const readiness = liveBrokerReadiness(this.env);
      if (!readiness.ready) throw new Error('Live account remains locked or is not fully configured');
      if (!liveActivated) {
        if (String(payload.confirmation || '') !== 'CONFIRM') throw new Error('First Live activation requires typing CONFIRM');
        liveActivated = true;
        liveActivatedAt = new Date().toISOString();
        await this.recordTradingViewAudit({ type: 'TRADINGVIEW_LIVE_FIRST_ACTIVATION_CONFIRMED' });
      }
    }

    const runtime = {
      ...current,
      receptionEnabled,
      accountType,
      liveActivated,
      liveActivatedAt,
      updatedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(RUNTIME_KEY, runtime);
    await this.recordTradingViewAudit({
      type: receptionEnabled ? 'TRADINGVIEW_RECEPTION_ENABLED' : 'TRADINGVIEW_RECEPTION_DISABLED',
      accountType,
    });
    return runtime;
  }

  async recordValidTradingViewAlert(alert = {}) {
    const current = await this.tradingViewRuntime();
    const runtime = {
      ...current,
      lastValidAlertAt: new Date().toISOString(),
      lastValidAlert: {
        symbol: alert.symbol || null,
        signal: alert.signal || null,
        indicator: alert.indicator || null,
        signalId: alert.signalId || null,
        timestamp: alert.timestamp || null,
      },
      updatedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(RUNTIME_KEY, runtime);
    return runtime;
  }

  async recordTradingViewAudit(event = {}) {
    const current = await this.ctx.storage.get(AUDIT_KEY);
    const events = Array.isArray(current) ? current : [];
    const normalized = {
      id: crypto.randomUUID(),
      ...event,
      createdAt: event.createdAt || new Date().toISOString(),
    };
    const next = [normalized, ...events].slice(0, 1500);
    await this.ctx.storage.put(AUDIT_KEY, next);
    console.log(JSON.stringify({ event: normalized.type || 'TRADINGVIEW_AUDIT', ...normalized }));
    return normalized;
  }

  async tradingViewAudit(limit = 200) {
    const current = await this.ctx.storage.get(AUDIT_KEY);
    return (Array.isArray(current) ? current : []).slice(0, Math.max(1, Math.min(1000, Number(limit) || 200)));
  }

  async claimTradingViewSignal(signalId, alert = {}) {
    const key = `tradingview-only:dedupe:${signalId}`;
    const existing = await this.ctx.storage.get(key);
    if (existing) return { accepted: false, duplicate: true, existing };
    const record = {
      signalId,
      symbol: alert.symbol || null,
      signal: alert.signal || null,
      receivedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(key, record);
    const current = await this.ctx.storage.get(DEDUPE_INDEX_KEY);
    const index = Array.isArray(current) ? current.filter((item) => item?.signalId !== signalId) : [];
    index.unshift(record);
    const removed = index.splice(2000);
    await this.ctx.storage.put(DEDUPE_INDEX_KEY, index);
    for (const item of removed) {
      if (item?.signalId) await this.ctx.storage.delete(`tradingview-only:dedupe:${item.signalId}`);
    }
    return { accepted: true, duplicate: false, record };
  }

  async tradingViewActivePositions() {
    const stored = await this.ctx.storage.get(ACTIVE_KEY);
    return stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {};
  }

  async reserveTradingViewPosition(symbol) {
    const settings = await this.tradingViewSettings();
    const runtime = await this.tradingViewRuntime();
    if (!runtime.receptionEnabled) return { accepted: false, reason: 'ALERT_RECEPTION_DISABLED' };
    if (runtime.killSwitchActive) return { accepted: false, reason: 'KILL_SWITCH_ACTIVE' };
    const active = await this.tradingViewActivePositions();
    if (active[symbol]) return { accepted: false, reason: 'POSITION_ALREADY_OPEN', existing: active[symbol] };
    if (Object.keys(active).length >= settings.maxOpenPositions) return { accepted: false, reason: 'MAX_OPEN_POSITIONS_REACHED' };
    const daily = await this.ctx.storage.get(DAILY_PNL_KEY) || {};
    const today = newYorkDateKey();
    const realizedPnl = finite(daily[today], 0);
    if (realizedPnl <= -Math.abs(settings.maxDailyLossDollars)) {
      return { accepted: false, reason: 'DAILY_MAX_LOSS_REACHED', realizedPnl };
    }
    active[symbol] = {
      symbol,
      status: 'RESERVED',
      accountType: runtime.accountType,
      reservedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(ACTIVE_KEY, active);
    return { accepted: true, activeCount: Object.keys(active).length, reservation: active[symbol] };
  }

  async releaseTradingViewPosition(symbol, reason = 'RELEASED') {
    const active = await this.tradingViewActivePositions();
    delete active[symbol];
    await this.ctx.storage.put(ACTIVE_KEY, active);
    await this.recordTradingViewAudit({ type: 'TRADINGVIEW_POSITION_SLOT_RELEASED', symbol, reason });
    return { released: true, symbol, activeCount: Object.keys(active).length };
  }

  async finalizeTradingViewPosition(symbol, archiveRecord = {}) {
    const active = await this.tradingViewActivePositions();
    delete active[symbol];
    const archive = await this.ctx.storage.get(ARCHIVE_KEY);
    const records = Array.isArray(archive) ? archive : [];
    const nextArchive = [archiveRecord, ...records.filter((item) => item?.id !== archiveRecord?.id)].slice(0, 5000);
    const daily = await this.ctx.storage.get(DAILY_PNL_KEY) || {};
    const day = newYorkDateKey(archiveRecord.closedAt || Date.now());
    daily[day] = Number((finite(daily[day], 0) + finite(archiveRecord.profitLoss, 0)).toFixed(2));
    await this.ctx.storage.put({
      [ACTIVE_KEY]: active,
      [ARCHIVE_KEY]: nextArchive,
      [DAILY_PNL_KEY]: daily,
    });
    return { archived: true, symbol, activeCount: Object.keys(active).length, dailyPnl: daily[day] };
  }

  async tradingViewArchive(limit = 1000) {
    const archive = await this.ctx.storage.get(ARCHIVE_KEY);
    return (Array.isArray(archive) ? archive : []).slice(0, Math.max(1, Math.min(5000, Number(limit) || 1000)));
  }

  async activateTradingViewKillSwitch() {
    const runtime = await this.tradingViewRuntime();
    const active = await this.tradingViewActivePositions();
    const next = {
      ...runtime,
      receptionEnabled: false,
      killSwitchActive: true,
      killSwitchActivatedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(RUNTIME_KEY, next);
    await this.recordTradingViewAudit({ type: 'TRADINGVIEW_KILL_SWITCH_ACTIVATED', symbols: Object.keys(active) });
    return { runtime: next, symbols: Object.keys(active) };
  }

  async clearTradingViewKillSwitch(confirmation) {
    if (String(confirmation || '') !== 'CLEAR') throw new Error('Clearing the kill switch requires confirmation=CLEAR');
    const runtime = await this.tradingViewRuntime();
    const next = {
      ...runtime,
      receptionEnabled: false,
      killSwitchActive: false,
      killSwitchClearedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(RUNTIME_KEY, next);
    await this.recordTradingViewAudit({ type: 'TRADINGVIEW_KILL_SWITCH_CLEARED' });
    return next;
  }

  async tradingViewStateSnapshot() {
    const [settings, runtime, active, archive, audit, daily] = await Promise.all([
      this.tradingViewSettings(),
      this.tradingViewRuntime(),
      this.tradingViewActivePositions(),
      this.tradingViewArchive(1000),
      this.tradingViewAudit(200),
      this.ctx.storage.get(DAILY_PNL_KEY),
    ]);
    return {
      settings,
      runtime,
      active,
      archive,
      audit,
      dailyPnl: daily && typeof daily === 'object' ? daily : {},
    };
  }
}

async function parseJson(request) {
  try { return await request.json(); }
  catch { throw new Error('Valid JSON is required'); }
}

async function handleSession(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!sameOrigin(request)) return json({ ok: false, error: 'Invalid request origin' }, 403);
  const payload = await parseJson(request);
  const expected = String(env.MOE_SIMULATION_CONTROL_PIN || env.MOE_TRADINGVIEW_CONTROL_PIN || '').trim();
  if (!expected) return json({ ok: false, error: 'Control PIN is not configured' }, 503);
  if (!constantTimeTextEqual(payload.pin, expected)) {
    await coordinator(env).recordTradingViewAudit({ type: 'TRADINGVIEW_DASHBOARD_LOGIN_FAILED' });
    return json({ ok: false, error: 'Wrong control PIN' }, 401);
  }
  const session = await createSession(env);
  await coordinator(env).recordTradingViewAudit({ type: 'TRADINGVIEW_DASHBOARD_LOGIN_SUCCEEDED' });
  return json({ ok: true, expiresAt: new Date(session.payload.expiresAt).toISOString() }, 200, {
    'set-cookie': `${SESSION_COOKIE}=${session.token}; Path=/; Max-Age=${session.ttlSeconds}; HttpOnly; Secure; SameSite=Strict`,
  });
}

async function handleStatus(request, env) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  await requireUiAccess(request, env);
  const state = await coordinator(env).tradingViewStateSnapshot();
  const symbols = Object.keys(state.active);
  const [demo, live, positionResults] = await Promise.all([
    getBrokerAccountSummary('DEMO', env),
    getBrokerAccountSummary('LIVE', env),
    Promise.allSettled(symbols.map((symbol) => positionCoordinator(env, symbol).snapshot())),
  ]);
  const positions = positionResults
    .map((result, index) => result.status === 'fulfilled' ? result.value : ({ symbol: symbols[index], status: 'UNAVAILABLE', error: String(result.reason || '') }))
    .filter(Boolean);
  const lastAlertAge = state.runtime.lastValidAlertAt ? Date.now() - Date.parse(state.runtime.lastValidAlertAt) : Infinity;
  return json({
    ok: true,
    mode: 'TRADINGVIEW_ONLY',
    executionSource: 'TRADINGVIEW_WEBHOOK',
    scannerExecutionEnabled: false,
    strategiesVisible: false,
    spotOnly: true,
    longOnly: true,
    percentageSettingsAllowed: false,
    settings: state.settings,
    runtime: state.runtime,
    accounts: { demo, live },
    positions,
    archive: state.archive,
    audit: state.audit,
    dailyPnl: state.dailyPnl,
    tradingViewConnected: state.runtime.receptionEnabled === true && lastAlertAge <= 30 * 60_000,
    generatedAt: new Date().toISOString(),
  });
}

async function handleSettings(request, env) {
  await requireUiAccess(request, env);
  if (request.method === 'GET') return json({ ok: true, settings: await coordinator(env).tradingViewSettings() });
  if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed' }, 405);
  return json({ ok: true, settings: await coordinator(env).updateTradingViewSettings(await parseJson(request)) });
}

async function handleReception(request, env) {
  await requireUiAccess(request, env);
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  return json({ ok: true, runtime: await coordinator(env).setTradingViewReception(await parseJson(request)) });
}

async function handleKillSwitch(request, env) {
  await requireUiAccess(request, env);
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  const payload = await parseJson(request);
  if (String(payload.action || '').toUpperCase() === 'CLEAR') {
    return json({ ok: true, runtime: await coordinator(env).clearTradingViewKillSwitch(payload.confirmation) });
  }
  const activated = await coordinator(env).activateTradingViewKillSwitch();
  const results = await Promise.allSettled(
    activated.symbols.map((symbol) => positionCoordinator(env, symbol).emergencyClose('KILL_SWITCH')),
  );
  const exits = results.map((result, index) => ({
    symbol: activated.symbols[index],
    ok: result.status === 'fulfilled',
    result: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? String(result.reason || 'Exit failed') : null,
  }));
  return json({ ok: true, partialFailure: exits.some((item) => !item.ok), runtime: activated.runtime, exits });
}

async function handleArchive(request, env, csv = false) {
  await requireUiAccess(request, env);
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const archive = await coordinator(env).tradingViewArchive(5000);
  if (!csv) return json({ ok: true, count: archive.length, archive });
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const headers = ['date','ticker','entry_price','exit_price','exit_reason','profit_loss','quantity','duration_seconds','account_type','indicator','signal_id'];
  const rows = archive.map((item) => [
    item.closedAt,
    item.symbol,
    item.entryPrice,
    item.exitPrice,
    item.exitReason,
    item.profitLoss,
    item.quantity,
    item.durationSeconds,
    item.accountType,
    item.indicator,
    item.signalId,
  ].map(quote).join(','));
  return new Response([headers.join(','), ...rows].join('\n'), {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="moe-tradingview-archive-${newYorkDateKey()}.csv"`,
      'cache-control': 'no-store',
    },
  });
}

async function handleAudit(request, env) {
  await requireUiAccess(request, env);
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  const audit = await coordinator(env).tradingViewAudit(1000);
  return json({ ok: true, count: audit.length, audit });
}

async function handleWebhook(request, env) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  let payload;
  try { payload = await request.json(); }
  catch {
    await coordinator(env).recordTradingViewAudit({ type: 'TRADINGVIEW_SUSPICIOUS_INVALID_JSON', ...publicRequestMetadata(request) });
    return json({ ok: false, error: 'Invalid JSON payload' }, 400);
  }
  const supplied = request.headers.get('x-moe-webhook-secret')
    || String(payload.token || payload.secret || payload.webhookSecret || payload.webhook_secret || '');
  if (!env.MOE_WEBHOOK_SECRET || !constantTimeTextEqual(supplied, env.MOE_WEBHOOK_SECRET)) {
    await coordinator(env).recordTradingViewAudit({
      type: 'TRADINGVIEW_SUSPICIOUS_UNAUTHORIZED_ALERT',
      claimedSymbol: String(payload.ticker || payload.symbol || '').slice(0, 12),
      ...publicRequestMetadata(request),
    });
    return json({ ok: false, error: 'Unauthorized TradingView alert' }, 401);
  }

  let alert;
  try { alert = normalizeTradingViewAlert(payload); }
  catch (error) {
    await coordinator(env).recordTradingViewAudit({
      type: 'TRADINGVIEW_ALERT_REJECTED_SCHEMA',
      error: error instanceof Error ? error.message : 'Invalid alert',
      ...publicRequestMetadata(request),
    });
    return json({ ok: false, error: error instanceof Error ? error.message : 'Invalid alert' }, 400);
  }
  alert.signalId = await tradingViewSignalId(alert);

  const claim = await coordinator(env).claimTradingViewSignal(alert.signalId, alert);
  if (!claim.accepted) {
    await coordinator(env).recordTradingViewAudit({
      type: 'TRADINGVIEW_DUPLICATE_ALERT_IGNORED',
      symbol: alert.symbol,
      signal: alert.signal,
      signalId: alert.signalId,
    });
    return json({ ok: true, accepted: true, executed: false, duplicate: true, signalId: alert.signalId });
  }

  const runtime = await coordinator(env).recordValidTradingViewAlert(alert);
  const settings = await coordinator(env).tradingViewSettings();
  await coordinator(env).recordTradingViewAudit({
    type: 'TRADINGVIEW_ALERT_RECEIVED',
    symbol: alert.symbol,
    signal: alert.signal,
    signalId: alert.signalId,
    indicator: alert.indicator,
    alertPrice: alert.price,
  });

  if (!settings.configured || !runtime.receptionEnabled || runtime.killSwitchActive) {
    const reason = !settings.configured
      ? 'SETTINGS_NOT_CONFIGURED'
      : runtime.killSwitchActive
        ? 'KILL_SWITCH_ACTIVE'
        : 'ALERT_RECEPTION_DISABLED';
    await coordinator(env).recordTradingViewAudit({ type: 'TRADINGVIEW_ALERT_LOGGED_NOT_EXECUTED', symbol: alert.symbol, signalId: alert.signalId, reason });
    return json({ ok: true, accepted: true, executed: false, ignored: true, reason, signalId: alert.signalId }, 202);
  }

  let reservation = null;
  if (alert.signal === 'BUY') {
    reservation = await coordinator(env).reserveTradingViewPosition(alert.symbol);
    if (!reservation.accepted) {
      await coordinator(env).recordTradingViewAudit({
        type: 'TRADINGVIEW_BUY_BLOCKED',
        symbol: alert.symbol,
        signalId: alert.signalId,
        reason: reservation.reason,
      });
      return json({ ok: true, accepted: true, executed: false, ignored: true, reason: reservation.reason, signalId: alert.signalId });
    }
  }

  try {
    const result = await positionCoordinator(env, alert.symbol).processAlert(alert, settings, runtime);
    if (alert.signal === 'BUY' && result?.ignored === true) {
      await coordinator(env).releaseTradingViewPosition(alert.symbol, result.reason || 'BUY_IGNORED');
    }
    return json({
      ok: true,
      accepted: true,
      executed: result?.ignored !== true,
      queuedByTicker: true,
      signalId: alert.signalId,
      symbol: alert.symbol,
      signal: alert.signal,
      result,
    });
  } catch (error) {
    if (alert.signal === 'BUY') await coordinator(env).releaseTradingViewPosition(alert.symbol, 'PROCESSING_FAILED');
    const message = error instanceof Error ? error.message : 'TradingView alert processing failed';
    await coordinator(env).recordTradingViewAudit({
      type: 'TRADINGVIEW_ALERT_PROCESSING_FAILED',
      symbol: alert.symbol,
      signalId: alert.signalId,
      error: message,
    });
    return json({ ok: false, accepted: true, executed: false, signalId: alert.signalId, error: message }, 502);
  }
}

async function route(request, env, ctx) {
  const path = new URL(request.url).pathname;
  if (DASHBOARD_PATHS.has(path) && ['GET', 'HEAD'].includes(request.method)) return html(tradingViewDashboardHtml());
  if (SCANNER_PATHS.has(path) && ['GET', 'HEAD'].includes(request.method)) return html(scannerOnlyHtml());
  if (path === '/api/tradingview/session') return handleSession(request, env);
  if (path === '/api/tradingview/status') return handleStatus(request, env);
  if (path === '/api/tradingview/settings') return handleSettings(request, env);
  if (path === '/api/tradingview/reception') return handleReception(request, env);
  if (path === '/api/tradingview/kill-switch') return handleKillSwitch(request, env);
  if (path === '/api/tradingview/archive') return handleArchive(request, env, false);
  if (path === '/api/tradingview/archive.csv') return handleArchive(request, env, true);
  if (path === '/api/tradingview/audit') return handleAudit(request, env);
  if (WEBHOOK_PATHS.has(path)) return handleWebhook(request, env);
  return baseWorker.fetch(request, env, ctx);
}

export default {
  async fetch(request, env, ctx) {
    try {
      return await route(request, env, ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TradingView-only request failed';
      const status = /Authentication|required|session/i.test(message) ? 401
        : /origin/i.test(message) ? 403
          : /not configured|locked|close all positions|kill switch/i.test(message) ? 423
            : 400;
      return json({ ok: false, error: message }, status, status === 401 ? {
        'set-cookie': `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
      } : {});
    }
  },

  async scheduled() {
    console.log(JSON.stringify({
      event: 'TRADINGVIEW_ONLY_SCHEDULE_SKIPPED',
      scannerExecutionEnabled: false,
      reason: 'TRADINGVIEW_WEBHOOKS_ARE_THE_ONLY_EXECUTION_SOURCE',
      createdAt: new Date().toISOString(),
    }));
    return { ok: true, skipped: 'TRADINGVIEW_ONLY_NO_SCANNER' };
  },
};
