import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './tradingview-only-final-entry.js';
import { tradingViewMobileDashboardHtml } from './tradingview-only-dashboard-mobile.js';

export { AlertCoordinator, SimulationDriver };

const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/m', '/m/', '/mobile', '/mobile/', '/alerts', '/alerts/']);

function html(content, method = 'GET') {
  return new Response(method === 'HEAD' ? null : content, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      'referrer-policy': 'same-origin',
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    },
  });
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
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

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (DASHBOARD_PATHS.has(path) && ['GET', 'HEAD'].includes(request.method)) {
      return html(tradingViewMobileDashboardHtml(), request.method);
    }
    if (path === '/api/tradingview/refresh') return handleRefresh(request, env, ctx, false);
    if (path === '/api/tradingview/repair') return handleRefresh(request, env, ctx, true);
    if (path === '/api/tradingview/position/close') return handleClosePosition(request, env, ctx);
    return baseWorker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
