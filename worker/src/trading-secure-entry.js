import tradingWorker, { AlertCoordinator } from './trading-dashboard-entry.js';
import { authenticateTradingRequest, tradingAuthStatus } from './trading-request-auth.js';

const TRADING_PREFIX = '/api/trading/';
const PUBLIC_PATHS = new Set(['/api/trading/connection']);
const BUILD_ID = 'trading-secure-webull-cloudflare-v6-20260727';

function originFor(request, env) {
  const origin = request.headers.get('origin');
  const configured = String(env.APP_ORIGIN || '').replace(/\/$/, '');
  if (!origin) return configured || '*';
  if (origin === configured || origin === 'http://localhost:3000') return origin;
  return null;
}

function secureHeaders(origin) {
  return {
    'access-control-allow-origin': origin || '*',
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'authorization, content-type, x-moe-trading-token',
    'access-control-max-age': '86400',
    'cache-control': 'no-store, no-cache, must-revalidate',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'referrer-policy': 'no-referrer',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    vary: 'Origin',
  };
}

function secureJson(payload, status, origin) {
  return Response.json(payload, { status, headers: secureHeaders(origin) });
}

function isProtectedTradingPath(pathname) {
  return pathname.startsWith(TRADING_PREFIX) && !PUBLIC_PATHS.has(pathname);
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = originFor(request, env);

    if (url.pathname.startsWith(TRADING_PREFIX)) {
      if (!origin) {
        return secureJson({ ok: false, build: BUILD_ID, error: 'Origin not allowed' }, 403, '*');
      }

      if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: secureHeaders(origin) });
      }

      if (isProtectedTradingPath(url.pathname)) {
        const authentication = await authenticateTradingRequest(request, env);
        if (!authentication.ok) {
          console.warn(JSON.stringify({
            event: 'TRADING_API_AUTH_REJECTED',
            path: url.pathname,
            code: authentication.code,
            createdAt: new Date().toISOString(),
          }));
          return secureJson({
            ok: false,
            build: BUILD_ID,
            code: authentication.code,
            error: authentication.error,
          }, authentication.status, origin);
        }

        console.log(JSON.stringify({
          event: 'TRADING_API_AUTH_ACCEPTED',
          path: url.pathname,
          tokenGeneration: authentication.tokenGeneration,
          createdAt: new Date().toISOString(),
        }));
      }

      if (url.pathname === '/api/trading/connection') {
        const response = await tradingWorker.fetch(request, env, ctx);
        const payload = await response.json();
        return secureJson({
          ...payload,
          secureGateway: {
            enabled: true,
            build: BUILD_ID,
            protectedRoutes: true,
            authentication: tradingAuthStatus(env),
          },
        }, response.status, origin);
      }
    }

    const response = await tradingWorker.fetch(request, env, ctx);
    if (!url.pathname.startsWith(TRADING_PREFIX)) return response;

    const responseHeaders = new Headers(response.headers);
    for (const [key, value] of Object.entries(secureHeaders(origin))) responseHeaders.set(key, value);
    responseHeaders.set('x-moe-trading-gateway', BUILD_ID);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders,
    });
  },

  scheduled(controller, env, ctx) {
    return tradingWorker.scheduled(controller, env, ctx);
  },
};
