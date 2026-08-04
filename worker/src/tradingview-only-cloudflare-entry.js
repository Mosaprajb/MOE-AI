import worker, {
  AlertCoordinator,
  SimulationDriver,
} from './tradingview-only-mobile-entry.js';
import { TradingViewPositionCoordinator } from './tradingview-only-durable-object.js';

export { AlertCoordinator, SimulationDriver, TradingViewPositionCoordinator };

const STANDALONE_LOGIN_PATH = '/mobile/login-v2';

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

export default {
  fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === STANDALONE_LOGIN_PATH && ['GET', 'HEAD'].includes(request.method)) {
      return standaloneLoginResponse(request);
    }
    return worker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
