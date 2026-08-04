import cloudflareWorker, {
  AlertCoordinator,
  SimulationDriver,
  TradingViewPositionCoordinator,
} from './tradingview-only-cloudflare-entry.js';

export { AlertCoordinator, SimulationDriver, TradingViewPositionCoordinator };

const SESSION_COOKIE = 'moe_tv_session';
const LOGIN_PATHS = new Set(['/mobile/unlock', '/mobile/login-v2']);
const MOBILE_ASSET_VERSION = '20260804-5';
const encoder = new TextEncoder();

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function constantTimeTextEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] || 0) ^ (b[index] || 0);
  }
  return difference === 0;
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
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
  const ttlSeconds = Math.max(
    300,
    Math.min(86_400, finite(env.MOE_TRADINGVIEW_SESSION_TTL_SECONDS, 43_200)),
  );
  const payload = {
    scope: 'MOE_TRADINGVIEW_DASHBOARD',
    issuedAt,
    expiresAt: issuedAt + ttlSeconds * 1000,
    nonce: crypto.randomUUID(),
  };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmac(body, env));
  return {
    token: `${body}.${signature}`,
    payload,
    ttlSeconds,
  };
}

function expectedControlPin(env = {}) {
  return String(env.MOE_SIMULATION_CONTROL_PIN || env.MOE_TRADINGVIEW_CONTROL_PIN || '').trim();
}

function requestIsSameSite(request) {
  const requestUrl = new URL(request.url);
  const origin = String(request.headers.get('origin') || '').trim();
  if (origin && origin !== 'null' && origin !== requestUrl.origin) return false;

  const referer = String(request.headers.get('referer') || '').trim();
  if (referer) {
    try {
      if (new URL(referer).origin !== requestUrl.origin) return false;
    } catch {
      return false;
    }
  }

  const fetchSite = String(request.headers.get('sec-fetch-site') || '').toLowerCase();
  return !fetchSite || ['same-origin', 'same-site', 'none'].includes(fetchSite);
}

async function readLoginPin(request) {
  const contentType = String(request.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('application/json')) {
    const payload = await request.json().catch(() => null);
    return payload && typeof payload === 'object' ? String(payload.pin || '') : '';
  }
  const form = await request.formData().catch(() => null);
  return form ? String(form.get('pin') || '') : '';
}

function sessionCookie(session) {
  return `${SESSION_COOKIE}=${session.token}; Path=/; Max-Age=${session.ttlSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

function noCacheRedirect(request, path, status = 303) {
  return new Response(null, {
    status,
    headers: {
      location: new URL(path, request.url).toString(),
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
      'x-content-type-options': 'nosniff',
    },
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function transitionHtml(destination) {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <meta http-equiv="refresh" content="1;url=${escapeHtml(destination)}">
  <title>MOE-AI — تم تسجيل الدخول</title>
  <style>
    :root{color-scheme:dark;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    *{box-sizing:border-box}
    body{margin:0;min-height:100vh;display:grid;place-items:center;padding:24px;background:#07111d;color:#eef6ff}
    main{width:min(100%,420px);padding:30px 22px;text-align:center;border:1px solid #1e3850;border-radius:22px;background:#0b1928}
    h1{margin:0 0 12px;font-size:25px}
    p{color:#9fb3c7;line-height:1.7}
    a{min-height:54px;display:grid;place-items:center;margin-top:18px;border-radius:14px;background:#35a7ff;color:#03111d;font-weight:800;text-decoration:none}
  </style>
</head>
<body>
  <main>
    <h1>تم تثبيت الجلسة بنجاح</h1>
    <p>جاري فتح لوحة التحكم مباشرة. لن يعاد إرسال الرمز أثناء هذا الانتقال.</p>
    <a href="${escapeHtml(destination)}">فتح لوحة التحكم الآن</a>
  </main>
</body>
</html>`;
}

function transitionResponse(session) {
  const destination = `/mobile?unlocked=1&v=${MOBILE_ASSET_VERSION}`;
  return new Response(transitionHtml(destination), {
    status: 200,
    headers: {
      'set-cookie': sessionCookie(session),
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
      refresh: `1; url=${destination}`,
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'x-moe-session-handoff': MOBILE_ASSET_VERSION,
    },
  });
}

function recordLoginAudit(env, ctx, type) {
  let task;
  try {
    const coordinator = env.ALERT_COORDINATOR.getByName('global');
    task = Promise.resolve(coordinator.recordTradingViewAudit({ type }));
  } catch (error) {
    console.warn(JSON.stringify({
      event: 'TRADINGVIEW_LOGIN_AUDIT_SKIPPED',
      type,
      error: String(error || ''),
    }));
    return;
  }
  task = task.catch((error) => {
    console.warn(JSON.stringify({
      event: 'TRADINGVIEW_LOGIN_AUDIT_FAILED',
      type,
      error: String(error || ''),
    }));
  });
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
}

async function handleSafariLogin(request, env, ctx) {
  if (request.method !== 'POST' || !requestIsSameSite(request)) {
    return noCacheRedirect(request, `/mobile/login-v2?error=request&v=${MOBILE_ASSET_VERSION}`);
  }

  const expected = expectedControlPin(env);
  if (!expected) {
    return noCacheRedirect(request, `/mobile/login-v2?error=session&v=${MOBILE_ASSET_VERSION}`);
  }

  const pin = (await readLoginPin(request)).trim();
  if (!constantTimeTextEqual(pin, expected)) {
    recordLoginAudit(env, ctx, 'TRADINGVIEW_DASHBOARD_LOGIN_FAILED');
    return noCacheRedirect(request, `/mobile/login-v2?error=wrong&v=${MOBILE_ASSET_VERSION}`);
  }

  try {
    const session = await createSession(env);
    recordLoginAudit(env, ctx, 'TRADINGVIEW_DASHBOARD_LOGIN_SUCCEEDED');
    return transitionResponse(session);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'TRADINGVIEW_SAFARI_LOGIN_SESSION_FAILED',
      error: String(error || ''),
    }));
    return noCacheRedirect(request, `/mobile/login-v2?error=session&v=${MOBILE_ASSET_VERSION}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (LOGIN_PATHS.has(path) && request.method === 'POST') {
      return handleSafariLogin(request, env, ctx);
    }
    return cloudflareWorker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return cloudflareWorker.scheduled(controller, env, ctx);
  },
};
