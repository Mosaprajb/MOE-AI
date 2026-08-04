import mobileWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './tradingview-only-mobile-entry.js';
import { TradingViewPositionCoordinator } from './tradingview-only-durable-object.js';

export { AlertCoordinator, SimulationDriver, TradingViewPositionCoordinator };

const STANDALONE_LOGIN_PATH = '/mobile/login-v2';
const MOBILE_BOOT_PATH = '/mobile/boot-v3.js';
const MOBILE_CLIENT_PATH = '/mobile/client-v3.js';
const MOBILE_ASSET_VERSION = '20260804-3';
const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/m', '/m/', '/mobile', '/mobile/', '/alerts', '/alerts/']);

function escapeHtml(value) {
  return String(value || '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function standaloneLoginHtml(request) {
  const url = new URL(request.url);
  const error = url.searchParams.get('error') || url.searchParams.get('login_error') || '';
  let message = '';
  if (error === 'wrong') message = 'الرمز غير صحيح. أعد المحاولة.';
  else if (error === 'session') message = 'تعذر إنشاء جلسة آمنة. أعد المحاولة.';
  else if (error === 'request') message = 'تم رفض طلب الدخول. أعد تحميل الصفحة.';

  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
  <title>MOE-AI — تسجيل الدخول</title>
  <style>
    :root { color-scheme: dark; font-family: -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center; padding: 24px; background: #07111d; color: #eef6ff; }
    main { width: min(100%, 420px); padding: 28px 22px; border: 1px solid #1e3850; border-radius: 22px; background: #0b1928; box-shadow: 0 24px 70px rgba(0,0,0,.45); }
    h1 { margin: 0 0 8px; font-size: 25px; }
    p { margin: 0 0 22px; color: #9fb3c7; line-height: 1.6; }
    label { display: block; margin-bottom: 8px; font-weight: 700; }
    input { width: 100%; min-height: 54px; padding: 12px 15px; border: 1px solid #2b4d68; border-radius: 14px; background: #07131f; color: #fff; font-size: 20px; text-align: center; letter-spacing: 3px; }
    button { width: 100%; min-height: 54px; margin-top: 14px; border: 0; border-radius: 14px; background: #35a7ff; color: #03111d; font-size: 17px; font-weight: 800; }
    .error { margin: 16px 0 0; padding: 12px; border-radius: 12px; background: rgba(255,82,109,.12); color: #ff8194; }
    small { display: block; margin-top: 18px; color: #6f879d; text-align: center; }
  </style>
</head>
<body>
  <main>
    <h1>MOE-AI</h1>
    <p>صفحة دخول مباشرة وآمنة، لا تستخدم JavaScript ولا تنتظر رسالة Verifying.</p>
    <form method="post" action="/mobile/unlock" autocomplete="off">
      <label for="pin">الرمز السري</label>
      <input id="pin" name="pin" type="password" inputmode="numeric" autocomplete="current-password" required autofocus>
      <button type="submit">فتح لوحة التحكم</button>
    </form>
    ${message ? `<div class="error" role="alert">${escapeHtml(message)}</div>` : ''}
    <small>لا ترسل الرمز السري لأي شخص.</small>
  </main>
</body>
</html>`;
}

function standaloneLoginResponse(request) {
  const body = request.method === 'HEAD' ? null : standaloneLoginHtml(request);
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

function scriptResponse(body) {
  return new Response(body, {
    status: 200,
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      pragma: 'no-cache',
      expires: '0',
      'x-content-type-options': 'nosniff',
    },
  });
}

const MOBILE_BOOT_SCRIPT = `
(function () {
  'use strict';

  function byId(id) { return document.getElementById(id); }
  function setText(id, value) {
    var element = byId(id);
    if (element) element.textContent = value == null ? '' : String(value);
  }
  function money(value) {
    var number = Number(value);
    return isFinite(number) ? '$' + number.toFixed(2) : '—';
  }
  function duration(value) {
    var total = Math.max(0, Math.floor(Number(value) || 0));
    var hours = Math.floor(total / 3600);
    var minutes = Math.floor((total % 3600) / 60);
    var seconds = total % 60;
    function two(number) { return String(number).length < 2 ? '0' + number : String(number); }
    return two(hours) + ':' + two(minutes) + ':' + two(seconds);
  }
  function account(prefix, value) {
    value = value || {};
    setText(prefix + 'Balance', money(value.balance));
    setText(prefix + 'Power', money(value.buyingPower));
    setText(prefix + 'Open', value.openPositions || 0);
    setText(prefix + 'Pnl', money(value.totalPnl || 0));
    setText(prefix + 'Connection', value.connected === true ? 'Connected' : 'Disconnected');
    setText(prefix + 'ConnectionDetail', value.locked ? 'Locked' : (value.error || ''));
    var dot = byId(prefix + 'Dot');
    if (dot) dot.className = value.connected === true ? 'dot green' : 'dot';
  }
  function apply(data) {
    data = data || {};
    var runtime = data.runtime || {};
    var clock = data.marketClock || {};
    var accounts = data.accounts || {};
    setText('statusLabel', runtime.receptionEnabled === true ? 'Loaded · reception on' : 'Loaded · reception off');
    setText('receptionMetric', runtime.receptionEnabled === true ? 'ON' : 'OFF');
    setText('lastAlertMetric', runtime.lastValidAlertAt ? new Date(runtime.lastValidAlertAt).toLocaleString() : 'Never');
    setText('accountMetric', runtime.accountType || 'DEMO');
    setText('sessionMetric', (clock.label || 'Closed') + ' · ' + (clock.phase || 'CLOSED'));
    var next = Date.parse(String(clock.nextTransitionAt || ''));
    setText('sessionRemainingMetric', isFinite(next) ? duration(Math.ceil((next - Date.now()) / 1000)) : '—');
    var flatten = Date.parse(String(clock.autoFlattenAt || ''));
    setText('flattenMetric', isFinite(flatten) ? duration(Math.ceil((flatten - Date.now()) / 1000)) : '—');
    setText('entryMetric', clock.entryAllowed ? 'OPEN · ' + (clock.selectedSession || 'ALL') : 'BLOCKED · ' + (clock.entryBlockedReason || 'CLOSED'));
    account('demo', accounts.demo || {});
    account('live', accounts.live || {});
    var login = byId('login');
    if (login) login.hidden = true;
  }
  function showError(error) {
    setText('statusLabel', 'Interface error');
    var dot = byId('statusDot');
    if (dot) dot.className = 'dot';
    var toast = byId('toast');
    if (toast) {
      toast.textContent = String(error && error.message ? error.message : error || 'Unable to load the dashboard');
      toast.className = 'toast show';
    }
  }
  function loadStatus() {
    return fetch('/api/tradingview/status', {
      method: 'GET',
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'x-moe-mobile-client': '1' }
    }).then(function (response) {
      if (response.status === 401) {
        window.location.replace('/mobile/login-v2?error=session&v=' + Date.now());
        throw new Error('Authentication required');
      }
      return response.json().then(function (data) {
        if (!response.ok || data.ok === false) throw new Error(data.error || 'HTTP ' + response.status);
        return data;
      });
    }).then(apply).catch(showError);
  }
  function setView(name) {
    var views = document.querySelectorAll('.view');
    var buttons = document.querySelectorAll('[data-nav]');
    var index;
    for (index = 0; index < views.length; index += 1) {
      views[index].classList.toggle('active', views[index].getAttribute('data-view') === name);
    }
    for (index = 0; index < buttons.length; index += 1) {
      buttons[index].classList.toggle('active', buttons[index].getAttribute('data-nav') === name);
    }
    window.scrollTo(0, 0);
  }
  function bindFallback() {
    if (window.__MOE_FALLBACK_BOUND__) return;
    window.__MOE_FALLBACK_BOUND__ = true;
    var buttons = document.querySelectorAll('[data-nav]');
    var index;
    for (index = 0; index < buttons.length; index += 1) {
      buttons[index].addEventListener('click', function () { setView(this.getAttribute('data-nav')); });
    }
    var refresh = byId('refreshButton');
    if (refresh) refresh.addEventListener('click', function () { loadStatus(); });
  }

  window.addEventListener('error', function (event) {
    if (!window.__MOE_MAIN_CLIENT_READY__) showError(event.error || event.message || 'JavaScript error');
  });
  window.addEventListener('unhandledrejection', function (event) {
    if (!window.__MOE_MAIN_CLIENT_READY__) showError(event.reason || 'JavaScript promise error');
  });

  loadStatus();
  window.setTimeout(function () {
    if (!window.__MOE_MAIN_CLIENT_READY__) bindFallback();
  }, 900);
}());
`;

async function extractedMobileClient(request, env, ctx) {
  const sourceUrl = new URL('/mobile', request.url);
  sourceUrl.searchParams.set('client-source', MOBILE_ASSET_VERSION);
  const sourceRequest = new Request(sourceUrl, {
    method: 'GET',
    headers: request.headers,
  });
  const sourceResponse = await mobileWorker.fetch(sourceRequest, env, ctx);
  const sourceHtml = await sourceResponse.text();
  const scripts = [...sourceHtml.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1])
    .filter(Boolean);
  const body = `${scripts.join('\n')}\nwindow.__MOE_MAIN_CLIENT_READY__ = true;`;
  return scriptResponse(body);
}

async function patchedDashboard(request, env, ctx) {
  const response = await mobileWorker.fetch(request, env, ctx);
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('text/html')) return response;

  let body = await response.text();
  body = body.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, '');
  const scripts = `<script src="${MOBILE_BOOT_PATH}?v=${MOBILE_ASSET_VERSION}" defer></script><script src="${MOBILE_CLIENT_PATH}?v=${MOBILE_ASSET_VERSION}" defer></script>`;
  body = body.includes('</body>') ? body.replace('</body>', `${scripts}</body>`) : `${body}${scripts}`;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  headers.set('content-security-policy', "default-src 'self'; style-src 'unsafe-inline'; script-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
  headers.set('x-moe-mobile-assets', MOBILE_ASSET_VERSION);

  return new Response(request.method === 'HEAD' ? null : body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === STANDALONE_LOGIN_PATH && ['GET', 'HEAD'].includes(request.method)) {
      return standaloneLoginResponse(request);
    }
    if (url.pathname === MOBILE_BOOT_PATH && request.method === 'GET') {
      return scriptResponse(MOBILE_BOOT_SCRIPT);
    }
    if (url.pathname === MOBILE_CLIENT_PATH && request.method === 'GET') {
      return extractedMobileClient(request, env, ctx);
    }
    if (DASHBOARD_PATHS.has(url.pathname) && ['GET', 'HEAD'].includes(request.method)) {
      return patchedDashboard(request, env, ctx);
    }
    return mobileWorker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return mobileWorker.scheduled(controller, env, ctx);
  },
};
