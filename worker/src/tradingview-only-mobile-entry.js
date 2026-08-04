import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './tradingview-only-final-entry.js';
import { tradingViewMobileDashboardHtml } from './tradingview-only-dashboard-mobile.js';

export { AlertCoordinator, SimulationDriver };

const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/m', '/m/', '/mobile', '/mobile/', '/alerts', '/alerts/']);
const SESSION_COOKIE = 'moe_tv_session';
const encoder = new TextEncoder();

const SAFARI_LOGIN_PATCH = `
<script id="moe-safari-login-patch">
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }

  function setMessage(text, isError) {
    var message = byId('loginMessage');
    if (!message) return;
    message.textContent = text || '';
    message.style.color = isError ? '#ff647c' : '#8fa7be';
    message.style.marginTop = '10px';
  }

  function setBusy(button, busy) {
    if (!button) return;
    button.disabled = busy;
    button.style.opacity = busy ? '0.72' : '1';
    button.textContent = busy ? 'Verifying PIN…' : 'Unlock dashboard';
  }

  function parsePayload(response) {
    return response.text().then(function (text) {
      var payload = {};
      try { payload = text ? JSON.parse(text) : {}; } catch (_) {}
      return { response: response, payload: payload };
    });
  }

  function requestSession(value) {
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeoutId = window.setTimeout(function () {
      if (controller) controller.abort();
    }, 10000);
    var options = {
      method: 'POST',
      cache: 'no-store',
      credentials: 'include',
      headers: {
        'content-type': 'application/json',
        'x-moe-mobile-client': '1'
      },
      body: JSON.stringify({ pin: value })
    };
    if (controller) options.signal = controller.signal;

    return fetch('/api/tradingview/session', options)
      .then(function (response) {
        window.clearTimeout(timeoutId);
        return parsePayload(response);
      })
      .catch(function (error) {
        window.clearTimeout(timeoutId);
        if (error && error.name === 'AbortError') {
          throw new Error('Login timed out. Reload the page and try again.');
        }
        throw error;
      });
  }

  function submitLogin(button) {
    if (window.__moeLoginSubmitting) return;
    var pin = byId('pin');
    var value = pin ? String(pin.value || '').trim() : '';
    if (!value) {
      setMessage('Enter the control PIN first.', true);
      if (pin) pin.focus();
      return;
    }

    window.__moeLoginSubmitting = true;
    setBusy(button, true);
    setMessage('Verifying secure session…', false);

    requestSession(value)
      .then(function (result) {
        if (!result.response.ok || result.payload.ok === false) {
          throw new Error(result.payload.error || ('Login failed · HTTP ' + result.response.status));
        }
        if (pin) pin.value = '';
        setMessage('PIN accepted. Opening dashboard…', false);
        setBusy(button, true);
        window.setTimeout(function () {
          window.location.href = '/mobile?session=' + Date.now();
        }, 50);
      })
      .catch(function (error) {
        window.__moeLoginSubmitting = false;
        setBusy(button, false);
        setMessage(error && error.message ? error.message : 'Unable to open the dashboard.', true);
      });
  }

  function captureLoginClick(event) {
    var button = byId('loginButton');
    if (!button) return;
    var target = event.target;
    if (target !== button && !button.contains(target)) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    submitLogin(button);
  }

  function captureLoginEnter(event) {
    if (event.key !== 'Enter' || event.target !== byId('pin')) return;
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
    submitLogin(byId('loginButton'));
  }

  document.addEventListener('click', captureLoginClick, true);
  document.addEventListener('keydown', captureLoginEnter, true);
})();
</script>`;

function html(content, method = 'GET') {
  const patched = content.includes('</body>')
    ? content.replace('</body>', () => `${SAFARI_LOGIN_PATCH}\n</body>`)
    : `${content}\n${SAFARI_LOGIN_PATCH}`;
  return new Response(method === 'HEAD' ? null : patched, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'pragma': 'no-cache',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
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

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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

function sessionSecret(env = {}) {
  const value = String(env.MOE_MOBILE_SESSION_SECRET || env.MOE_WEBHOOK_SECRET || '').trim();
  if (value.length < 16) throw new Error('A secure mobile session secret is not configured');
  return value;
}

async function hmac(value, env) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(sessionSecret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
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

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function globalCoordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function recordLoginAudit(env, ctx, type) {
  let task;
  try {
    task = Promise.resolve(globalCoordinator(env).recordTradingViewAudit({ type }));
  } catch (error) {
    console.warn(JSON.stringify({ event: 'TRADINGVIEW_LOGIN_AUDIT_SKIPPED', type, error: String(error || '') }));
    return;
  }
  task = task.catch((error) => {
    console.warn(JSON.stringify({ event: 'TRADINGVIEW_LOGIN_AUDIT_FAILED', type, error: String(error || '') }));
  });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
}

function positionCoordinator(env, symbol) {
  return env.TRADINGVIEW_POSITION.getByName(String(symbol || '').trim().toUpperCase());
}

function requestHeaders(request) {
  const headers = new Headers();
  for (const key of ['cookie', 'origin', 'user-agent', 'cf-connecting-ip', 'x-moe-mobile-client']) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  headers.set('x-moe-mobile-client', '1');
  return headers;
}

async function authenticatedStatus(request, env, ctx) {
  const url = new URL('/api/tradingview/status', request.url);
  const response = await baseWorker.fetch(new Request(url, {
    method: 'GET',
    headers: requestHeaders(request),
  }), env, ctx);
  const payload = await response.clone().json().catch(() => ({}));
  return { response, payload };
}

async function readPayload(request) {
  if (request.method === 'GET') return Object.fromEntries(new URL(request.url).searchParams.entries());
  return request.json().catch(() => ({}));
}

function activeSymbols(status, requestedSymbol = '') {
  const requested = String(requestedSymbol || '').trim().toUpperCase();
  const symbols = (Array.isArray(status?.positions) ? status.positions : [])
    .filter((position) => position?.symbol && position.positionOpen !== false)
    .map((position) => String(position.symbol).toUpperCase());
  if (requested) return symbols.includes(requested) ? [requested] : [];
  return [...new Set(symbols)];
}

async function refreshedStatus(request, env, ctx) {
  const next = await authenticatedStatus(request, env, ctx);
  return next.payload;
}

async function handleRefresh(request, env, ctx, repair = false) {
  if (!['GET', 'POST'].includes(request.method)) return json({ ok: false, error: 'Method not allowed' }, 405);
  const auth = await authenticatedStatus(request, env, ctx);
  if (!auth.response.ok) return auth.response;
  const payload = await readPayload(request);
  const symbols = activeSymbols(auth.payload, payload.symbol);
  const results = await Promise.allSettled(symbols.map((symbol) => repair
    ? positionCoordinator(env, symbol).repairProtection('MANUAL_REPAIR')
    : positionCoordinator(env, symbol).monitor('MANUAL_REFRESH')));
  const normalized = results.map((result, index) => ({
    symbol: symbols[index],
    ok: result.status === 'fulfilled',
    result: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? String(result.reason || 'Refresh failed') : null,
  }));
  return json({
    ok: normalized.every((item) => item.ok),
    action: repair ? 'REPAIR_PROTECTION' : 'REFRESH_POSITIONS',
    results: normalized,
    status: await refreshedStatus(request, env, ctx),
  }, normalized.some((item) => !item.ok) ? 207 : 200);
}

async function handleClosePosition(request, env, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  const auth = await authenticatedStatus(request, env, ctx);
  if (!auth.response.ok) return auth.response;
  const payload = await readPayload(request);
  const symbol = String(payload.symbol || '').trim().toUpperCase();
  if (!symbol || payload.confirmation !== 'CLOSE') {
    return json({ ok: false, error: 'symbol and confirmation=CLOSE are required' }, 400);
  }
  const symbols = activeSymbols(auth.payload, symbol);
  if (!symbols.length) return json({ ok: false, error: 'The requested tracked position is not open' }, 404);
  const result = await positionCoordinator(env, symbol).emergencyClose('MANUAL_CLOSE');
  return json({
    ok: true,
    symbol,
    result,
    status: await refreshedStatus(request, env, ctx),
  });
}

async function handleSessionCompatibility(request, env, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (!sameOrigin(request)) return json({ ok: false, error: 'Invalid request origin' }, 403);

  const payload = await request.json().catch(() => null);
  if (!payload || typeof payload !== 'object') return json({ ok: false, error: 'Valid JSON is required' }, 400);

  const expected = String(env.MOE_SIMULATION_CONTROL_PIN || env.MOE_TRADINGVIEW_CONTROL_PIN || '').trim();
  if (!expected) return json({ ok: false, error: 'Control PIN is not configured' }, 503);
  if (!constantTimeTextEqual(payload.pin, expected)) {
    recordLoginAudit(env, ctx, 'TRADINGVIEW_DASHBOARD_LOGIN_FAILED');
    return json({ ok: false, error: 'Wrong control PIN' }, 401);
  }

  let session;
  try {
    session = await createSession(env);
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to create dashboard session',
    }, 503);
  }

  recordLoginAudit(env, ctx, 'TRADINGVIEW_DASHBOARD_LOGIN_SUCCEEDED');
  return json({
    ok: true,
    expiresAt: new Date(session.payload.expiresAt).toISOString(),
  }, 200, {
    'set-cookie': `${SESSION_COOKIE}=${session.token}; Path=/; Max-Age=${session.ttlSeconds}; HttpOnly; Secure; SameSite=Lax`,
  });
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (DASHBOARD_PATHS.has(path) && ['GET', 'HEAD'].includes(request.method)) {
      return html(tradingViewMobileDashboardHtml(), request.method);
    }
    if (path === '/api/tradingview/session') return handleSessionCompatibility(request, env, ctx);
    if (path === '/api/tradingview/refresh') return handleRefresh(request, env, ctx, false);
    if (path === '/api/tradingview/repair') return handleRefresh(request, env, ctx, true);
    if (path === '/api/tradingview/position/close') return handleClosePosition(request, env, ctx);
    return baseWorker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
