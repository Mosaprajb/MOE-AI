import routerWorker, { AlertCoordinator } from './router.js';

export { AlertCoordinator };

const AUTO_SUBMIT_PATHS = new Set([
  '/api/tradingview/signal',
  '/api/tradingview/webull-preview',
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

export default {
  async fetch(request, env, ctx) {
    const effectiveRequest = await withSandboxSubmission(request, env);
    return routerWorker.fetch(effectiveRequest, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    return routerWorker.scheduled(controller, env, ctx);
  },
};
