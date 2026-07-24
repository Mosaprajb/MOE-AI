import alertsWorker, { AlertCoordinator } from './index.js';
import { handleWebullSandboxOrder } from './webull-sandbox.js';
import { createWebullAccessToken, getWebullAccounts, getWebullAccountSnapshot } from './webull-client.js';

export { AlertCoordinator };

const WEBULL_WEBHOOK_PATH = '/api/tradingview/webull-preview';
const TRADINGVIEW_SIGNAL_PATH = '/api/tradingview/signal';

function authorized(request, env) {
  const supplied = request.headers.get('x-moe-webhook-secret') || '';
  return Boolean(env.MOE_WEBHOOK_SECRET) && supplied === env.MOE_WEBHOOK_SECRET;
}

function secureJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function findAccessToken(payload, depth = 0) {
  if (depth > 6 || payload == null) return '';
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const token = findAccessToken(item, depth + 1);
      if (token) return token;
    }
    return '';
  }
  if (typeof payload !== 'object') return '';
  for (const key of ['access_token', 'accessToken', 'token']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  for (const value of Object.values(payload)) {
    const token = findAccessToken(value, depth + 1);
    if (token) return token;
  }
  return '';
}

function findTokenStatus(payload, depth = 0) {
  if (depth > 6 || payload == null) return '';
  if (Array.isArray(payload)) {
    for (const item of payload) {
      const status = findTokenStatus(item, depth + 1);
      if (status) return status;
    }
    return '';
  }
  if (typeof payload !== 'object') return '';
  for (const key of ['status', 'token_status', 'tokenStatus']) {
    const value = payload[key];
    if (typeof value === 'string' && value.trim()) return value.trim().toUpperCase();
  }
  for (const value of Object.values(payload)) {
    const status = findTokenStatus(value, depth + 1);
    if (status) return status;
  }
  return '';
}

function describePayload(payload) {
  if (payload == null) return { type: String(payload), keys: [] };
  if (Array.isArray(payload)) return { type: 'array', length: payload.length };
  if (typeof payload !== 'object') return { type: typeof payload };
  return { type: 'object', keys: Object.keys(payload).slice(0, 20) };
}

function findAccounts(payload) {
  if (Array.isArray(payload)) return payload;
  for (const value of [payload?.data, payload?.accounts, payload?.account_list, payload?.data?.accounts, payload?.data?.account_list]) {
    if (Array.isArray(value)) return value;
  }
  return [];
}

async function signalFingerprint(payload) {
  const explicit = String(payload.signalId || payload.signal_id || '').trim();
  if (explicit) return explicit.slice(0, 64);
  const raw = [
    payload.symbol,
    payload.side,
    payload.timeframe || payload.interval,
    payload.barTime || payload.time || payload.timestamp,
    payload.limitPrice || payload.marketPrice,
    payload.stopLoss,
    payload.takeProfit,
  ].map((value) => String(value ?? '')).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 64);
}

async function handleTradingViewSignal(request, env) {
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400);
  }

  const suppliedSecret = request.headers.get('x-moe-webhook-secret')
    || String(payload.secret || payload.webhookSecret || payload.webhook_secret || '');
  if (!env.MOE_WEBHOOK_SECRET || suppliedSecret !== env.MOE_WEBHOOK_SECRET) {
    return secureJson({ ok: false, error: 'Unauthorized' }, 401);
  }

  const signalId = await signalFingerprint(payload);
  const cache = caches.default;
  const dedupeKey = new Request(`https://moerand.internal/tradingview-signal/${encodeURIComponent(signalId)}`, { method: 'GET' });
  if (await cache.match(dedupeKey)) {
    return secureJson({ ok: false, accepted: false, duplicate: true, signalId, error: 'Duplicate signal ignored' }, 409);
  }

  const ttlSeconds = Math.max(60, Math.min(86400, Number(env.TRADINGVIEW_DEDUPE_TTL_SECONDS || 900)));
  await cache.put(dedupeKey, new Response('pending', {
    headers: { 'cache-control': `public, max-age=${ttlSeconds}` },
  }));

  const sanitized = { ...payload, signalId };
  delete sanitized.secret;
  delete sanitized.webhookSecret;
  delete sanitized.webhook_secret;

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  headers.set('x-moe-webhook-secret', suppliedSecret);

  const forwarded = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(sanitized),
  });

  const response = await handleWebullSandboxOrder(forwarded, env);
  let result = null;
  try {
    result = await response.clone().json();
  } catch {
    result = { error: 'Non-JSON response' };
  }

  if (response.status >= 400 && response.status < 500 && response.status !== 422) {
    await cache.delete(dedupeKey);
  } else {
    await cache.put(dedupeKey, new Response(JSON.stringify({ status: response.status, accepted: result?.accepted, createdAt: new Date().toISOString() }), {
      headers: { 'content-type': 'application/json', 'cache-control': `public, max-age=${ttlSeconds}` },
    }));
  }

  console.log(JSON.stringify({
    event: 'TRADINGVIEW_SIGNAL_RESULT',
    signalId,
    symbol: sanitized.symbol,
    side: sanitized.side,
    status: response.status,
    accepted: result?.accepted ?? false,
    submitted: result?.submitted ?? false,
    reasons: result?.plan?.evaluation?.reasons || result?.accountSafety?.reasons || [],
    createdAt: new Date().toISOString(),
  }));

  return response;
}

async function handleWebullBootstrap(request, env) {
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
  if (!authorized(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401);
  if (env.WEBULL_ENVIRONMENT === 'production' || env.WEBULL_LIVE_TRADING === 'true') {
    return secureJson({ ok: false, blocked: true, error: 'Production trading is intentionally disabled' }, 423);
  }

  try {
    const tokenResponse = await createWebullAccessToken(env);
    const accessToken = findAccessToken(tokenResponse);
    const tokenStatus = findTokenStatus(tokenResponse) || 'UNKNOWN';

    if (!accessToken) {
      return secureJson({
        ok: false,
        error: 'Webull did not return an access token',
        diagnostic: describePayload(tokenResponse),
      }, 400);
    }

    if (tokenStatus !== 'NORMAL') {
      return secureJson({
        ok: true,
        pendingVerification: tokenStatus === 'PENDING',
        environment: env.WEBULL_ENVIRONMENT || 'sandbox',
        tokenStatus,
        accessToken,
        nextStep: 'Verify this token in the Webull app, then save it as the WEBULL_ACCESS_TOKEN Cloudflare secret. Do not run bootstrap again because that creates a new token.',
      });
    }

    const temporaryEnv = { ...env, WEBULL_ACCESS_TOKEN: accessToken };
    const accountsResponse = await getWebullAccounts(temporaryEnv);
    const accounts = findAccounts(accountsResponse);

    return secureJson({
      ok: true,
      environment: env.WEBULL_ENVIRONMENT || 'sandbox',
      tokenStatus,
      accessToken,
      accounts,
      nextSecrets: {
        WEBULL_ACCESS_TOKEN: accessToken,
        WEBULL_ACCOUNT_ID: accounts[0]?.account_id || accounts[0]?.accountId || accounts[0]?.id || null,
      },
      warning: 'Store these values as Cloudflare Secrets. Do not commit or share them.',
    });
  } catch (error) {
    return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Webull bootstrap failed' }, 400);
  }
}

async function handleWebullAccounts(request, env) {
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
  if (!authorized(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401);
  try {
    return secureJson({ ok: true, accounts: await getWebullAccounts(env) });
  } catch (error) {
    return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Account lookup failed' }, 400);
  }
}

async function handleWebullSnapshot(request, env) {
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
  if (!authorized(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401);
  const url = new URL(request.url);
  const accountId = String(url.searchParams.get('accountId') || env.WEBULL_ACCOUNT_ID || '').trim();
  if (!accountId) return secureJson({ ok: false, error: 'WEBULL_ACCOUNT_ID is required' }, 400);
  try {
    return secureJson({ ok: true, snapshot: await getWebullAccountSnapshot(accountId, env) });
  } catch (error) {
    return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Snapshot failed' }, 400);
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === TRADINGVIEW_SIGNAL_PATH) return handleTradingViewSignal(request, env);
    if (url.pathname === WEBULL_WEBHOOK_PATH) return handleWebullSandboxOrder(request, env);
    if (url.pathname === '/api/webull/bootstrap') return handleWebullBootstrap(request, env);
    if (url.pathname === '/api/webull/accounts') return handleWebullAccounts(request, env);
    if (url.pathname === '/api/webull/snapshot') return handleWebullSnapshot(request, env);

    return alertsWorker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return alertsWorker.scheduled(controller, env, ctx);
  }
};