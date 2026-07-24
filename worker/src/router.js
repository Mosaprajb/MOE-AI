import alertsWorker, { AlertCoordinator } from './index.js';
import { handleWebullSandboxOrder } from './webull-sandbox.js';
import { createWebullAccessToken, getWebullAccounts, getWebullAccountSnapshot } from './webull-client.js';

export { AlertCoordinator };

const WEBULL_WEBHOOK_PATH = '/api/tradingview/webull-preview';

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

function findAccessToken(payload) {
  return String(
    payload?.access_token ||
    payload?.accessToken ||
    payload?.data?.access_token ||
    payload?.data?.accessToken ||
    ''
  ).trim();
}

function findAccounts(payload) {
  if (Array.isArray(payload)) return payload;
  for (const value of [payload?.data, payload?.accounts, payload?.account_list, payload?.data?.accounts, payload?.data?.account_list]) {
    if (Array.isArray(value)) return value;
  }
  return [];
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
    if (!accessToken) throw new Error('Webull did not return an access token');

    const temporaryEnv = { ...env, WEBULL_ACCESS_TOKEN: accessToken };
    const accountsResponse = await getWebullAccounts(temporaryEnv);
    const accounts = findAccounts(accountsResponse);

    return secureJson({
      ok: true,
      environment: env.WEBULL_ENVIRONMENT || 'sandbox',
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
