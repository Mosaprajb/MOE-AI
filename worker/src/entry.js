import routerWorker, { AlertCoordinator } from './router.js';
import { runAutoScanner } from './auto-scanner.js';
import { buildDashboardSnapshot, htmlResponse } from './moe-dashboard.js';

export { AlertCoordinator };

const AUTO_SUBMIT_PATHS = new Set([
  '/api/tradingview/signal',
  '/api/tradingview/webull-preview',
]);

const DASHBOARD_PAGE_PATHS = new Set([
  '/moe-ai',
  '/moe-ai/',
  '/dashboard',
  '/dashboard/',
]);

async function withSandboxSubmission(request, env) {
  if (
    request.method !== 'POST'
    || !AUTO_SUBMIT_PATHS.has(new URL(request.url).pathname)
    || env.WEBULL_ENVIRONMENT !== 'sandbox'
    || env.WEBULL_SANDBOX_ENABLED !== 'true'
    || env.WEBULL_SANDBOX_ORDER_SUBMISSION !== 'true'
    || env.WEBULL_AUTO_SUBMIT_SANDBOX !== 'true'
  ) {
    return request;
  }

  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return request;

  let payload;
  try {
    payload = await request.clone().json();
  } catch {
    return request;
  }

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');

  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify({ ...payload, submitSandbox: true }),
  });
}

async function dashboardData(request, env, ctx) {
  if (request.method !== 'GET') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  const incomingUrl = new URL(request.url);
  const decisionsUrl = new URL('/api/tradingview/decisions', incomingUrl.origin);
  decisionsUrl.searchParams.set('limit', '100');
  const headers = new Headers();
  headers.set('origin', env.APP_ORIGIN || 'http://localhost:3000');

  const internalRequest = new Request(decisionsUrl.toString(), {
    method: 'GET',
    headers,
  });

  const response = await routerWorker.fetch(internalRequest, env, ctx);
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Dashboard storage lookup failed' }));
    return Response.json({ ok: false, ...error }, {
      status: response.status,
      headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
    });
  }

  const payload = await response.json();
  const snapshot = buildDashboardSnapshot(payload.decisions || []);
  return Response.json({
    ok: true,
    ...snapshot,
    storage: payload.storage || 'DURABLE_OBJECT',
    brainVersion: '2.0.0',
    environment: env.WEBULL_ENVIRONMENT || 'sandbox',
    liveTrading: env.WEBULL_LIVE_TRADING === 'true',
  }, {
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (DASHBOARD_PAGE_PATHS.has(url.pathname)) return htmlResponse();
    if (url.pathname === '/api/moe-ai/dashboard') return dashboardData(request, env, ctx);

    const effectiveRequest = await withSandboxSubmission(request, env);
    return routerWorker.fetch(effectiveRequest, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    ctx.waitUntil(Promise.allSettled([
      routerWorker.scheduled(controller, env, ctx),
      runAutoScanner(env, controller.scheduledTime),
    ]));
  },
};
