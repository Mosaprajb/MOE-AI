import tradingWorker, { AlertCoordinator } from './trading-dashboard-entry.js';
import { placeWebullSandboxOrder } from './webull-client.js';
import { placeWebullLiveOrder, previewWebullLiveOrder } from './webull-live-client.js';

const UNLOCK_PATH = '/api/trading/live/unlock';
const LOCK_PATH = '/api/trading/live/lock';
const STATUS_PATH = '/api/trading/live/status';
const EXECUTE_PATH = '/api/trading/orders/execute';
const BUILD_ID = 'trading-mode-control-v2-20260727';
const encoder = new TextEncoder();

function enabled(value) { return String(value || '').trim().toLowerCase() === 'true'; }
function json(payload, status = 200) {
  return Response.json(payload, { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store, no-cache, must-revalidate', 'x-content-type-options': 'nosniff', 'x-moe-trading-control': BUILD_ID } });
}
function base64Url(bytes) { let binary = ''; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
function decodeBase64Url(value) { const normalized = value.replace(/-/g, '+').replace(/_/g, '/'); const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4); const binary = atob(padded); return Uint8Array.from(binary, (character) => character.charCodeAt(0)); }
async function sha256(value) { return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value))); }
function constantTimeEqual(left, right) { if (left.length !== right.length) return false; let difference = 0; for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index]; return difference === 0; }
async function hmac(secret, value) { const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value))); }

async function createLiveSession(env) {
  const secret = String(env.MOE_LIVE_SESSION_SECRET || '').trim();
  if (!secret) throw new Error('MOE_LIVE_SESSION_SECRET is not configured');
  const ttlMinutes = Math.max(1, Math.min(60, Number(env.MOE_LIVE_SESSION_TTL_MINUTES || 15)));
  const payload = { scope: 'MOE_LIVE_TRADING', issuedAt: Date.now(), expiresAt: Date.now() + ttlMinutes * 60000, nonce: crypto.randomUUID() };
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  return { token: `${body}.${base64Url(await hmac(secret, body))}`, expiresAt: new Date(payload.expiresAt).toISOString(), ttlMinutes };
}

async function verifyLiveSession(request, env) {
  const token = String(request.headers.get('x-moe-live-session') || '').trim();
  const secret = String(env.MOE_LIVE_SESSION_SECRET || '').trim();
  if (!token || !secret) return { ok: false, code: 'LIVE_SESSION_REQUIRED' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, code: 'LIVE_SESSION_INVALID' };
  try {
    const expected = await hmac(secret, parts[0]);
    if (!constantTimeEqual(expected, decodeBase64Url(parts[1]))) return { ok: false, code: 'LIVE_SESSION_INVALID' };
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    if (payload.scope !== 'MOE_LIVE_TRADING') return { ok: false, code: 'LIVE_SESSION_INVALID' };
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) return { ok: false, code: 'LIVE_SESSION_EXPIRED' };
    return { ok: true, payload };
  } catch { return { ok: false, code: 'LIVE_SESSION_INVALID' }; }
}

function liveEnvironment(env) {
  return { ...env, WEBULL_ENVIRONMENT: 'production', WEBULL_API_BASE_URL: String(env.WEBULL_LIVE_API_BASE_URL || 'https://api.webull.com').trim(), WEBULL_APP_KEY: env.WEBULL_LIVE_APP_KEY || env.WEBULL_APP_KEY, WEBULL_APP_SECRET: env.WEBULL_LIVE_APP_SECRET || env.WEBULL_APP_SECRET, WEBULL_ACCESS_TOKEN: env.WEBULL_LIVE_ACCESS_TOKEN || env.WEBULL_ACCESS_TOKEN, MOE_LIVE_MAX_ORDER_NOTIONAL: env.WEBULL_LIVE_MAX_NOTIONAL || env.MOE_LIVE_MAX_ORDER_NOTIONAL };
}

function sandboxEnvironment(env) {
  return { ...env, WEBULL_ENVIRONMENT: 'sandbox', WEBULL_API_BASE_URL: String(env.WEBULL_SANDBOX_API_BASE_URL || 'https://api.sandbox.webull.com').trim() };
}

function liveBlockers(env) {
  const blockers = [];
  if (!enabled(env.MOE_LIVE_PIN_CONTROL_ENABLED)) blockers.push('PIN control is disabled');
  if (!enabled(env.WEBULL_LIVE_TRADING)) blockers.push('live trading is disabled');
  if (!enabled(env.WEBULL_LIVE_ORDER_SUBMISSION)) blockers.push('live order submission is disabled');
  if (!enabled(env.WEBULL_LIVE_AUTOMATION_ARMED)) blockers.push('live automation is not armed');
  if (enabled(env.WEBULL_LIVE_KILL_SWITCH)) blockers.push('live kill switch is active');
  if (!String(env.WEBULL_LIVE_ACCOUNT_ID || '').trim()) blockers.push('live account is not configured');
  return blockers;
}

function sandboxBlockers(env) {
  const blockers = [];
  if (!enabled(env.WEBULL_SANDBOX_ENABLED)) blockers.push('sandbox trading is disabled');
  if (!enabled(env.WEBULL_SANDBOX_ORDER_SUBMISSION)) blockers.push('sandbox submission is disabled');
  if (!enabled(env.WEBULL_AUTOMATION_ARMED)) blockers.push('sandbox automation is not armed');
  if (!enabled(env.WEBULL_PROTECTED_ORDERS)) blockers.push('sandbox protected orders are disabled');
  if (!String(env.WEBULL_ACCOUNT_ID || '').trim()) blockers.push('sandbox account is not configured');
  return blockers;
}

async function parseBody(request) { try { return await request.json(); } catch { throw new Error('A valid JSON request body is required'); } }

async function unlock(request, env) {
  const configuredPin = String(env.MOE_LIVE_TRADING_PIN || '').trim();
  if (!configuredPin) return json({ ok: false, code: 'LIVE_PIN_NOT_CONFIGURED' }, 503);
  const body = await parseBody(request);
  const suppliedPin = String(body.pin || '').trim();
  const [expectedDigest, suppliedDigest] = await Promise.all([sha256(configuredPin), sha256(suppliedPin)]);
  if (!suppliedPin || !constantTimeEqual(expectedDigest, suppliedDigest)) return json({ ok: false, code: 'LIVE_PIN_INVALID', error: 'Invalid live trading PIN' }, 403);
  const blockers = liveBlockers(env);
  if (blockers.length) return json({ ok: false, code: 'LIVE_MODE_BLOCKED', blockers }, 423);
  const session = await createLiveSession(env);
  console.log(JSON.stringify({ event: 'LIVE_MODE_UNLOCKED', expiresAt: session.expiresAt, createdAt: new Date().toISOString() }));
  return json({ ok: true, build: BUILD_ID, mode: 'LIVE', sessionToken: session.token, expiresAt: session.expiresAt, ttlMinutes: session.ttlMinutes });
}

async function status(request, env) {
  const verification = await verifyLiveSession(request, env);
  const blockers = liveBlockers(env);
  return json({ ok: true, build: BUILD_ID, mode: verification.ok && blockers.length === 0 ? 'LIVE' : 'SANDBOX', liveSessionActive: verification.ok, liveExecutionReady: verification.ok && blockers.length === 0, sandboxExecutionReady: sandboxBlockers(env).length === 0, blockers, expiresAt: verification.ok ? new Date(verification.payload.expiresAt).toISOString() : null });
}

async function execute(request, env) {
  const body = await parseBody(request);
  const mode = String(body.mode || 'sandbox').trim().toLowerCase();
  const order = body.order || {};
  if (mode === 'sandbox') {
    const blockers = sandboxBlockers(env);
    if (blockers.length) return json({ ok: false, code: 'SANDBOX_EXECUTION_BLOCKED', blockers }, 423);
    if (body.confirm !== true) return json({ ok: true, mode: 'SANDBOX', executionAttempted: false, confirmationRequired: true, order, liveFundsUsed: false });
    const result = await placeWebullSandboxOrder(String(env.WEBULL_ACCOUNT_ID || '').trim(), order, sandboxEnvironment(env));
    console.log(JSON.stringify({ event: 'SANDBOX_ORDER_SUBMITTED', symbol: order.symbol, signalId: order.signalId, createdAt: new Date().toISOString() }));
    return json({ ok: true, mode: 'SANDBOX', executionAttempted: true, liveFundsUsed: false, protectedOrder: true, result }, 201);
  }
  if (mode !== 'live') return json({ ok: false, error: 'mode must be sandbox or live' }, 400);
  const verification = await verifyLiveSession(request, env);
  if (!verification.ok) return json({ ok: false, code: verification.code, error: 'A valid live trading session is required' }, 401);
  const blockers = liveBlockers(env);
  if (blockers.length) return json({ ok: false, code: 'LIVE_EXECUTION_BLOCKED', blockers }, 423);
  const accountId = String(env.WEBULL_LIVE_ACCOUNT_ID || '').trim();
  const liveEnv = liveEnvironment(env);
  const preview = await previewWebullLiveOrder(accountId, order, liveEnv);
  if (body.confirm !== true) return json({ ok: true, mode: 'LIVE', executionAttempted: false, confirmationRequired: true, preview });
  const result = await placeWebullLiveOrder(accountId, order, liveEnv);
  console.log(JSON.stringify({ event: 'LIVE_ORDER_SUBMITTED', symbol: order.symbol, signalId: order.signalId, createdAt: new Date().toISOString() }));
  return json({ ok: true, mode: 'LIVE', executionAttempted: true, protectedOrder: true, result }, 201);
}

export { AlertCoordinator };
export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (![UNLOCK_PATH, LOCK_PATH, STATUS_PATH, EXECUTE_PATH].includes(pathname)) return tradingWorker.fetch(request, env, ctx);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
    try {
      if (pathname === UNLOCK_PATH && request.method === 'POST') return unlock(request, env);
      if (pathname === STATUS_PATH && request.method === 'GET') return status(request, env);
      if (pathname === LOCK_PATH && request.method === 'POST') return json({ ok: true, mode: 'SANDBOX', liveSessionActive: false, clientMustDiscardSessionToken: true });
      if (pathname === EXECUTE_PATH && request.method === 'POST') return execute(request, env);
      return json({ ok: false, error: 'Method not allowed' }, 405);
    } catch (error) {
      console.error(JSON.stringify({ event: 'TRADING_MODE_CONTROL_FAILED', path: pathname, error: error instanceof Error ? error.message : 'Unknown error', createdAt: new Date().toISOString() }));
      return json({ ok: false, build: BUILD_ID, error: error instanceof Error ? error.message : 'Trading mode control failed' }, 500);
    }
  },
  scheduled(controller, env, ctx) { return tradingWorker.scheduled(controller, env, ctx); },
};
