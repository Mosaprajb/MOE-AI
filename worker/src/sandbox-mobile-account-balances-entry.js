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
const ACTIVITY_PATH = '/api/scanner/live-activity';
const ACCOUNT_BALANCE_MARKER = 'moe-mobile-two-account-balances';
const VISIBLE_SCANNER_DOM_FIX_MARKER = 'moe-mobile-scanner-dom-insertion-fixed';

function coordinator(env = {}) {
  return env.ALERT_COORDINATOR?.getByName?.('global') || null;
}

async function mobileRuntime(env = {}) {
  try {
    const stub = coordinator(env);
    return stub ? await stub.mobileDashboardRuntime() : null;
  } catch {
    return null;
  }
}

function rewrittenJson(response, payload, extraHeaders = {}) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  for (const [key, value] of Object.entries(extraHeaders)) headers.set(key, value);
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

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

async function normalizeMonitorReadiness(response, env = {}) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload) return response;

  const runtime = await mobileRuntime(env);
  const armed = runtime?.armed === true;
  if (!armed) {
    return rewrittenJson(response, {
      ...payload,
      plan: null,
      readiness: {
        percent: 0,
        stage: 'Scanner stopped — press Start trading',
        color: 'red',
        estimateOnly: true,
      },
      scanner: {
        ...(payload.scanner && typeof payload.scanner === 'object' ? payload.scanner : {}),
        armed: false,
      },
      scannerArmed: false,
    }, {
      'x-moe-mobile-scanner-gate': 'stopped',
    });
  }

  const readiness = payload.readiness && typeof payload.readiness === 'object'
    ? { ...payload.readiness }
    : {};
  if (payload?.plan?.driftPassed === false) {
    readiness.percent = Math.min(82, Number(readiness.percent) || 82);
    readiness.color = 'amber';
  }

  return rewrittenJson(response, {
    ...payload,
    readiness,
    scanner: {
      ...(payload.scanner && typeof payload.scanner === 'object' ? payload.scanner : {}),
      armed: true,
    },
    scannerArmed: true,
  }, {
    'x-moe-mobile-scanner-gate': 'armed',
  });
}

async function normalizeActivityWhenStopped(response, env = {}) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload) return response;
  const runtime = await mobileRuntime(env);
  if (runtime?.armed === true) {
    return rewrittenJson(response, {
      ...payload,
      scannerArmed: true,
    }, {
      'x-moe-mobile-activity-gate': 'armed',
    });
  }

  const waiting = {
    id: 'mobile_scanner_waiting_visible',
    type: 'SCANNER_WAITING',
    status: 'STOPPED',
    reason: 'Press Start trading to begin scheduled scanner cycles.',
    createdAt: new Date().toISOString(),
  };
  return rewrittenJson(response, {
    ...payload,
    events: [waiting],
    activity: [waiting],
    items: [waiting],
    scannerArmed: false,
  }, {
    'x-moe-mobile-activity-gate': 'stopped',
  });
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === MOBILE_SCANNER_MONITOR_PATH) {
      const response = await handleMobileScannerMonitor(request, env);
      return normalizeMonitorReadiness(response, env);
    }
    if (pathname === ACTIVITY_PATH) {
      const response = await baseWorker.fetch(request, env, ctx);
      return normalizeActivityWhenStopped(response, env);
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
