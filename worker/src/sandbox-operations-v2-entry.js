import baseWorker, { AlertCoordinator } from './sandbox-operations-entry.js';
import { probeAlpacaHourlyRegime } from './alpaca-market-regime.js';

const PUBLIC_VIEW = 'public';
const READINESS_PATH = '/api/readiness';

function isPublicReadiness(request) {
  const url = new URL(request.url);
  return url.pathname === READINESS_PATH && url.searchParams.get('view') === PUBLIC_VIEW;
}

async function patchPublicReadiness(response, env) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object') return response;

  const alpaca = await probeAlpacaHourlyRegime(env);
  const patched = {
    ...payload,
    connections: {
      ...(payload.connections || {}),
      alpaca,
    },
    marketRegime: {
      regime: alpaca.regime,
      indexes: alpaca.indexes,
      checkedAt: alpaca.checkedAt,
    },
  };

  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-moe-sandbox-operations', '1.1.0');
  return new Response(JSON.stringify(patched), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    if (!isPublicReadiness(request)) return response;
    return patchPublicReadiness(response, env);
  },

  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};

export { AlertCoordinator };
