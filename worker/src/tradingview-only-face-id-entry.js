import safariAuthWorker, {
  AlertCoordinator,
  SimulationDriver,
  TradingViewPositionCoordinator,
} from './tradingview-only-safari-auth-entry.js';
import {
  MOBILE_ASSET_VERSION,
  createChallenge,
  createDashboardSession,
  dashboardSessionCookie,
  passkeyRecordCookie,
  readPasskeyRecord,
  requestIsSameSite,
  verifyChallenge,
} from './tradingview-only-passkey-token.js';
import { createPasskeyRecord, verifyPasskeyAssertion } from './tradingview-only-passkey-verify.js';
import { loginPageHtml, setupPageHtml } from './tradingview-only-passkey-ui.js';

export { AlertCoordinator, SimulationDriver, TradingViewPositionCoordinator };

const LOGIN_PATH = '/mobile/login-v2';
const SETUP_PATH = '/mobile/face-id/setup';
const LOGIN_POST_PATHS = new Set(['/mobile/unlock', LOGIN_PATH]);
const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/m', '/m/', '/mobile', '/mobile/', '/alerts', '/alerts/']);

function responseHeaders(contentType, cookies = []) {
  const headers = new Headers({
    'content-type': contentType,
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
    expires: '0',
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'permissions-policy': 'publickey-credentials-get=(self), publickey-credentials-create=(self)',
  });
  for (const cookie of cookies) if (cookie) headers.append('set-cookie', cookie);
  return headers;
}

function page(body, method = 'GET', cookies = []) {
  const headers = responseHeaders('text/html; charset=utf-8', cookies);
  headers.set('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'");
  return new Response(method === 'HEAD' ? null : body, { status: 200, headers });
}

function json(payload, status = 200, cookies = []) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: responseHeaders('application/json; charset=utf-8', cookies),
  });
}

function redirect(request, path, status = 303) {
  const headers = responseHeaders('text/plain; charset=utf-8');
  headers.set('location', new URL(path, request.url).toString());
  return new Response(null, { status, headers });
}

function setCookies(headers) {
  if (typeof headers.getSetCookie === 'function') return headers.getSetCookie();
  const value = headers.get('set-cookie');
  return value ? [value] : [];
}

async function readJson(request) {
  if (!String(request.headers.get('content-type') || '').toLowerCase().includes('application/json')) return null;
  return request.json().catch(() => null);
}

function forwardedHeaders(request) {
  const headers = new Headers();
  for (const name of ['cookie', 'user-agent', 'cf-connecting-ip']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set('x-moe-mobile-client', '1');
  return headers;
}

async function dashboardSessionActive(request, env, ctx) {
  const statusUrl = new URL('/api/tradingview/status', request.url);
  const response = await safariAuthWorker.fetch(new Request(statusUrl, {
    method: 'GET',
    headers: forwardedHeaders(request),
  }), env, ctx);
  if (!response.ok) return false;
  const payload = await response.clone().json().catch(() => null);
  return Boolean(payload && payload.ok !== false);
}

function recordAudit(env, ctx, type) {
  try {
    const task = Promise.resolve(env.ALERT_COORDINATOR.getByName('global').recordTradingViewAudit({ type }))
      .catch((error) => console.warn(JSON.stringify({ event: 'FACE_ID_AUDIT_FAILED', type, error: String(error || '') })));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  } catch (error) {
    console.warn(JSON.stringify({ event: 'FACE_ID_AUDIT_SKIPPED', type, error: String(error || '') }));
  }
}

async function handleLoginPage(request, env, ctx) {
  if (await dashboardSessionActive(request, env, ctx)) {
    return redirect(request, `/mobile?resume=1&v=${MOBILE_ASSET_VERSION}`, 302);
  }
  const url = new URL(request.url);
  const record = await readPasskeyRecord(request, env);
  return page(loginPageHtml(Boolean(record), url.searchParams.get('error') || ''), request.method);
}

async function handlePinLogin(request, env, ctx) {
  const response = await safariAuthWorker.fetch(request, env, ctx);
  const cookies = setCookies(response.headers);
  const sessionCookies = cookies.filter((cookie) => cookie.startsWith('moe_tv_session='));
  if (!sessionCookies.length) return response;
  const record = await readPasskeyRecord(request, env);
  if (record) return response;
  const destination = `/mobile?unlocked=1&v=${MOBILE_ASSET_VERSION}`;
  return page(setupPageHtml(destination), 'GET', sessionCookies);
}

async function requireSession(request, env, ctx) {
  if (!requestIsSameSite(request)) return json({ ok: false, error: 'Invalid request origin' }, 403);
  if (!(await dashboardSessionActive(request, env, ctx))) return json({ ok: false, error: 'Authentication required' }, 401);
  return null;
}

async function registerOptions(request, env, ctx) {
  const denied = await requireSession(request, env, ctx);
  if (denied) return denied;
  const challenge = await createChallenge('register', request, env);
  const existing = await readPasskeyRecord(request, env);
  return json({
    ok: true,
    token: challenge.token,
    publicKey: {
      challenge: challenge.challenge,
      rp: { name: 'MOE-AI Trading Control', id: challenge.rpId },
      user: { id: crypto.randomUUID().replaceAll('-', ''), name: 'moe-control', displayName: 'MOE-AI Control' },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        residentKey: 'required',
        requireResidentKey: true,
        userVerification: 'required',
      },
      timeout: 60_000,
      attestation: 'none',
      excludeCredentials: existing ? [{ type: 'public-key', id: existing.credentialId, transports: existing.transports || [] }] : [],
    },
  });
}

async function registerComplete(request, env, ctx) {
  const denied = await requireSession(request, env, ctx);
  if (denied) return denied;
  const body = await readJson(request);
  const challenge = await verifyChallenge(body?.token, 'register', request, env);
  if (!challenge) return json({ ok: false, error: 'Face ID setup request expired' }, 400);
  try {
    const record = await createPasskeyRecord(body, challenge);
    recordAudit(env, ctx, 'TRADINGVIEW_FACE_ID_REGISTERED');
    return json({ ok: true, faceIdEnabled: true }, 200, [await passkeyRecordCookie(record, env)]);
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Face ID setup failed' }, 400);
  }
}

async function loginOptions(request, env) {
  if (!requestIsSameSite(request)) return json({ ok: false, error: 'Invalid request origin' }, 403);
  const record = await readPasskeyRecord(request, env);
  if (!record) return json({ ok: false, error: 'Face ID is not configured in this browser' }, 404);
  const challenge = await createChallenge('login', request, env);
  return json({
    ok: true,
    token: challenge.token,
    publicKey: {
      challenge: challenge.challenge,
      rpId: challenge.rpId,
      allowCredentials: [{ type: 'public-key', id: record.credentialId, transports: record.transports || [] }],
      userVerification: 'required',
      timeout: 60_000,
    },
  });
}

async function loginComplete(request, env, ctx) {
  if (!requestIsSameSite(request)) return json({ ok: false, error: 'Invalid request origin' }, 403);
  const record = await readPasskeyRecord(request, env);
  const body = await readJson(request);
  const challenge = await verifyChallenge(body?.token, 'login', request, env);
  if (!record || !challenge) return json({ ok: false, error: 'Face ID login request expired' }, 401);
  try {
    const updatedRecord = await verifyPasskeyAssertion(record, body, challenge);
    const session = await createDashboardSession(env);
    recordAudit(env, ctx, 'TRADINGVIEW_FACE_ID_LOGIN_SUCCEEDED');
    return json({ ok: true, faceId: true, expiresAt: new Date(session.payload.expiresAt).toISOString() }, 200, [
      dashboardSessionCookie(session),
      await passkeyRecordCookie(updatedRecord, env),
    ]);
  } catch (error) {
    recordAudit(env, ctx, 'TRADINGVIEW_FACE_ID_LOGIN_FAILED');
    return json({ ok: false, error: error instanceof Error ? error.message : 'Face ID verification failed' }, 401);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === LOGIN_PATH && ['GET', 'HEAD'].includes(request.method)) return handleLoginPage(request, env, ctx);
    if (LOGIN_POST_PATHS.has(path) && request.method === 'POST') return handlePinLogin(request, env, ctx);

    if (path === SETUP_PATH && request.method === 'GET') {
      if (!(await dashboardSessionActive(request, env, ctx))) return redirect(request, `${LOGIN_PATH}?error=session`, 302);
      return page(setupPageHtml(`/mobile?unlocked=1&v=${MOBILE_ASSET_VERSION}`));
    }
    if (path === '/api/mobile/passkey/register/options' && request.method === 'GET') return registerOptions(request, env, ctx);
    if (path === '/api/mobile/passkey/register/complete' && request.method === 'POST') return registerComplete(request, env, ctx);
    if (path === '/api/mobile/passkey/login/options' && request.method === 'GET') return loginOptions(request, env);
    if (path === '/api/mobile/passkey/login/complete' && request.method === 'POST') return loginComplete(request, env, ctx);

    if (DASHBOARD_PATHS.has(path) && ['GET', 'HEAD'].includes(request.method)) {
      if (!(await dashboardSessionActive(request, env, ctx))) return redirect(request, `${LOGIN_PATH}?v=${MOBILE_ASSET_VERSION}`, 302);
    }
    return safariAuthWorker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return safariAuthWorker.scheduled(controller, env, ctx);
  },
};
