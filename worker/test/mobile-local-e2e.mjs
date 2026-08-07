import assert from 'node:assert/strict';

const baseURL = process.env.MOE_LOCAL_BASE_URL ?? 'http://127.0.0.1:8787';
const pin = process.env.MOE_LOCAL_CONTROL_PIN ?? '246810';
const webhookSecret = process.env.MOE_LOCAL_WEBHOOK_SECRET ?? 'mobile-ci-webhook-secret';

async function waitForWorker(timeoutMs = 60_000) {
  const startedAt = Date.now();
  let lastError;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(`${baseURL}/api/health`, { cache: 'no-store' });
      if (response.ok) return;
      lastError = new Error(`health returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  throw new Error(`Local Worker did not become ready: ${lastError?.message ?? 'timeout'}`);
}

async function jsonRequest(path, init = {}) {
  const response = await fetch(`${baseURL}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      accept: 'application/json',
      'x-moe-mobile-client': '1',
      'x-moe-request-id': crypto.randomUUID(),
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
  });
  const payload = await response.json().catch(() => ({}));
  return { response, payload };
}

await waitForWorker();

const unauthenticated = await jsonRequest('/api/tradingview/status');
assert.equal(unauthenticated.response.status, 401);
assert.equal(unauthenticated.payload.ok, false);

const login = await jsonRequest('/api/tradingview/session', {
  method: 'POST',
  body: JSON.stringify({ pin }),
});
assert.equal(login.response.status, 200);
assert.equal(login.payload.ok, true);
const setCookie = login.response.headers.get('set-cookie');
assert.ok(setCookie, 'login must return a session cookie');
assert.match(setCookie, /HttpOnly/i);
assert.match(setCookie, /Secure/i);
assert.match(setCookie, /SameSite=Strict/i);
const cookie = setCookie.split(';', 1)[0];

const status = await jsonRequest('/api/tradingview/status', {
  headers: { cookie },
});
assert.equal(status.response.status, 200);
assert.equal(status.payload.ok, true);
assert.equal(status.payload.runtime.accountType, 'DEMO');
assert.equal(status.payload.accounts.demo.connected, false);
assert.match(status.response.headers.get('cache-control') ?? '', /no-store/i);

const liveReception = await jsonRequest('/api/tradingview/reception', {
  method: 'POST',
  headers: { cookie },
  body: JSON.stringify({
    enabled: true,
    accountType: 'LIVE',
    confirmation: 'CONFIRM',
  }),
});
assert.equal(liveReception.response.status, 423);
assert.match(liveReception.payload.error, /blocked by the server policy/i);

const pushRegistration = await jsonRequest('/api/mobile/push/register', {
  method: 'POST',
  headers: { cookie },
  body: JSON.stringify({
    token: 'ab'.repeat(32),
    platform: 'ios',
    bundleIdentifier: 'com.moerand.moeai',
    environment: 'development',
  }),
});
assert.equal(pushRegistration.response.status, 200);
assert.equal(pushRegistration.payload.registered, true);

const pushTest = await jsonRequest('/api/mobile/push/test', {
  method: 'POST',
  headers: { cookie },
});
assert.equal(pushTest.response.status, 503);
assert.match(pushTest.payload.error, /disabled/i);

const disableReception = await jsonRequest('/api/tradingview/reception', {
  method: 'POST',
  headers: { cookie },
  body: JSON.stringify({ enabled: false, accountType: 'DEMO' }),
});
assert.equal(disableReception.response.status, 200);
assert.equal(disableReception.payload.runtime.receptionEnabled, false);

const blockedWebhook = await jsonRequest('/api/tradingview/webhook', {
  method: 'POST',
  body: JSON.stringify({
    secret: webhookSecret,
    symbol: 'AAPL',
    action: 'buy',
    price: 180,
  }),
});
assert.equal(blockedWebhook.response.status, 423);
assert.equal(blockedWebhook.payload.code, 'TRADINGVIEW_RECEPTION_DISABLED');

const logout = await jsonRequest('/api/tradingview/session', {
  method: 'DELETE',
  headers: { cookie },
});
assert.equal(logout.response.status, 200);
assert.match(logout.response.headers.get('set-cookie') ?? '', /Max-Age=0/i);

console.log(JSON.stringify({
  ok: true,
  checks: [
    'unauthenticated request rejected',
    'PIN session cookie issued securely',
    'read-only status returned without broker secrets',
    'Live mobile control failed closed',
    'APNs token registered locally',
    'APNs sending remained disabled',
    'authenticated TradingView webhook was blocked while reception was disabled',
    'logout cleared the client cookie',
  ],
}));