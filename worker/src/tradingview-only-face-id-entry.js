import safariAuthWorker, {
  AlertCoordinator,
  SimulationDriver,
  TradingViewPositionCoordinator,
} from './tradingview-only-safari-auth-entry.js';
import {
  MOBILE_ASSET_VERSION,
  SESSION_COOKIE,
  cookieValue,
  createChallenge,
  createDashboardSession,
  dashboardSessionCookie,
  passkeyRecordCookie,
  readPasskeyRecord,
  readSignedToken,
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
const LEGACY_LOGIN_PATTERN = /<div class="login" id="login">[\s\S]*?<div class="app">/;
const AUTHENTICATED_LOGIN_COMPATIBILITY = `<div class="login" id="login" hidden aria-hidden="true" style="display:none!important;visibility:hidden!important;pointer-events:none!important">
  <input id="pin" type="hidden" value="" aria-hidden="true">
  <button id="loginButton" type="button" hidden aria-hidden="true" tabindex="-1" style="display:none!important"></button>
  <div id="loginMessage" hidden aria-hidden="true"></div>
</div>`;

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

function redirect(request, path, status = 303, cookies = []) {
  const headers = responseHeaders('text/plain; charset=utf-8', cookies);
  headers.set('location', new URL(path, request.url).toString());
  headers.set('x-moe-auth-handoff', 'direct-redirect-v3');
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

async function dashboardSessionActive(request, env) {
  const token = cookieValue(request, SESSION_COOKIE);
  if (!token) return false;
  const payload = await readSignedToken(token, env);
  return Boolean(
    payload
    && payload.scope === 'MOE_TRADINGVIEW_DASHBOARD'
    && Number(payload.expiresAt) > Date.now(),
  );
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

async function authenticatedDashboardResponse(request, env, ctx) {
  const response = await safariAuthWorker.fetch(request, env, ctx);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (request.method !== 'GET' || !contentType.includes('text/html')) return response;

  let source = await response.text();
  const compatibilityShell = `${AUTHENTICATED_LOGIN_COMPATIBILITY}<div class="app">`;
  if (LEGACY_LOGIN_PATTERN.test(source)) {
    source = source.replace(LEGACY_LOGIN_PATTERN, compatibilityShell);
  }

  const authenticatedStyle = '<style id="moe-authenticated-dashboard-v1">#login[aria-hidden="true"]{display:none!important;visibility:hidden!important;pointer-events:none!important}</style>';
  if (!source.includes('moe-authenticated-dashboard-v1')) {
    source = source.includes('</head>')
      ? source.replace('</head>', `${authenticatedStyle}</head>`)
      : `${authenticatedStyle}${source}`;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  headers.set('x-moe-authenticated-dashboard', 'face-id-v3');
  return new Response(source, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function handleLoginPage(request, env) {
  if (await dashboardSessionActive(request, env)) {
    return redirect(request, `/mobile?resume=1&v=${MOBILE_ASSET_VERSION}`, 302);
  }
  const url = new URL(request.url);
  const record = await readPasskeyRecord(request, env);
  return page(loginPageHtml(Boolean(record), url.searchParams.get('error') || ''), request.method);
}

async function handlePinLogin(request, env, ctx) {
  const response = await safariAuthWorker.fetch(request, env, ctx);
  const cookies = setCookies(response.headers);
  const sessionCookies = cookies.filter((cookie) => cookie.startsWith(`${SESSION_COOKIE}=`));
  if (!sessionCookies.length) return response;

  const record = await readPasskeyRecord(request, env);
  const destination = `/mobile?unlocked=1&v=${MOBILE_ASSET_VERSION}`;
  if (record) return redirect(request, destination, 303, sessionCookies);
  return page(setupPageHtml(destination), 'GET', sessionCookies);
}

async function requireSession(request, env) {
  if (!requestIsSameSite(request)) return json({ ok: false, error: 'Invalid request origin' }, 403);
  if (!(await dashboardSessionActive(request, env))) return json({ ok: false, error: 'Authentication required' }, 401);
  return null;
}

async function registerOptions(request, env) {
  const denied = await requireSession(request, env);
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
  const denied = await requireSession(request, env);
  if (denied) return denied;
  const body = await readJson(request);
  const challenge = await verifyChallenge(body?.token, 'register', request, env);
  if (!challenge) return json({ ok: false, error: 'Face ID setup request expired' }, 400);
  try {
    const record = await createPasskeyRecord(body, challenge);
    const session = await createDashboardSession(env);
    recordAudit(env, ctx, 'TRADINGVIEW_FACE_ID_REGISTERED');
    return json({
      ok: true,
      faceIdEnabled: true,
      sessionRefreshed: true,
      expiresAt: new Date(session.payload.expiresAt).toISOString(),
    }, 200, [
      dashboardSessionCookie(session),
      await passkeyRecordCookie(record, env),
    ]);
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

    if (path === LOGIN_PATH && ['GET', 'HEAD'].includes(request.method)) return handleLoginPage(request, env);
    if (LOGIN_POST_PATHS.has(path) && request.method === 'POST') return handlePinLogin(request, env, ctx);

    if (path === SETUP_PATH && request.method === 'GET') {
      if (!(await dashboardSessionActive(request, env))) return redirect(request, `${LOGIN_PATH}?error=session`, 302);
      return page(setupPageHtml(`/mobile?unlocked=1&v=${MOBILE_ASSET_VERSION}`));
    }
    if (path === '/api/mobile/passkey/register/options' && request.method === 'GET') return registerOptions(request, env);
    if (path === '/api/mobile/passkey/register/complete' && request.method === 'POST') return registerComplete(request, env, ctx);
    if (path === '/api/mobile/passkey/login/options' && request.method === 'GET') return loginOptions(request, env);
    if (path === '/api/mobile/passkey/login/complete' && request.method === 'POST') return loginComplete(request, env, ctx);

    if (DASHBOARD_PATHS.has(path) && ['GET', 'HEAD'].includes(request.method)) {
      if (!(await dashboardSessionActive(request, env))) return redirect(request, `${LOGIN_PATH}?v=${MOBILE_ASSET_VERSION}`, 302);
      return authenticatedDashboardResponse(request, env, ctx);
    }
    return safariAuthWorker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return safariAuthWorker.scheduled(controller, env, ctx);
  },
};
