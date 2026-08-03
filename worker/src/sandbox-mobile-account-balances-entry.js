import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-account-balances-implementation.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const ACCOUNT_BALANCE_MARKER = 'moe-mobile-two-account-balances';

async function repairMobileAccountBalanceHtml(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;

  const html = await response.text();
  const repaired = html.replace(
    /id=\\?"moe-mobile-two-account-balances\\?"/g,
    `id="${ACCOUNT_BALANCE_MARKER}"`,
  );

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-moe-mobile-account-balance-html', 'repaired');

  return new Response(repaired, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    const pathname = new URL(request.url).pathname;
    return MOBILE_PATHS.has(pathname)
      ? repairMobileAccountBalanceHtml(response, request)
      : response;
  },
  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
