import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-account-balances-implementation.js';
import {
  MOBILE_SCANNER_MONITOR_PATH,
  handleMobileScannerMonitor,
} from './mobile-scanner-monitor.js';
import { enhanceMobileScannerVisibleUi } from './mobile-scanner-visible-ui.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const ACCOUNT_BALANCE_MARKER = 'moe-mobile-two-account-balances';
const VISIBLE_SCANNER_DOM_FIX_MARKER = 'moe-mobile-scanner-dom-insertion-fixed';

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

async function repairVisibleScannerDomInsertion(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;

  const html = await response.text();
  const repaired = html
    .replace(
      "stack?card.insertBefore(panel,stack):chips.insertAdjacentElement('afterend',panel);",
      "chips.insertAdjacentElement('afterend',panel);",
    )
    .replace(
      'body.insertBefore(holder.firstElementChild,body.firstChild);',
      "body.insertAdjacentElement('afterbegin',holder.firstElementChild);",
    )
    .replace(
      'body.insertBefore(tools,list);',
      "list.insertAdjacentElement('beforebegin',tools);",
    );

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-moe-mobile-scanner-dom-fix', 'enabled');

  return new Response(
    repaired.replace(
      '</body>',
      `<meta id="${VISIBLE_SCANNER_DOM_FIX_MARKER}" data-state="enabled">\n</body>`,
    ),
    {
      status: response.status,
      statusText: response.statusText,
      headers,
    },
  );
}

async function normalizeMonitorReadiness(response) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload || payload?.plan?.driftPassed !== false || !payload.readiness) return response;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(JSON.stringify({
    ...payload,
    readiness: {
      ...payload.readiness,
      percent: Math.min(82, Number(payload.readiness.percent) || 82),
      color: 'amber',
    },
  }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === MOBILE_SCANNER_MONITOR_PATH) {
      const response = await handleMobileScannerMonitor(request, env);
      return normalizeMonitorReadiness(response);
    }

    const response = await baseWorker.fetch(request, env, ctx);
    if (!MOBILE_PATHS.has(pathname)) return response;

    const repaired = await repairMobileAccountBalanceHtml(response, request);
    const enhanced = await enhanceMobileScannerVisibleUi(repaired, request);
    return repairVisibleScannerDomInsertion(enhanced, request);
  },
  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
