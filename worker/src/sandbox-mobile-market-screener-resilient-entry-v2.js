import resilientWorker, {
  AlertCoordinator,
  SimulationDriver,
  TradingViewPositionCoordinator,
} from './sandbox-mobile-market-screener-resilient-entry.js';
import { tradingViewPnlControlPatch } from './tradingview-only-pnl-control-patch.js';

export { AlertCoordinator, SimulationDriver, TradingViewPositionCoordinator };

const PNL_SCRIPT_PATH = '/mobile/pnl-control-v2.js';
const PNL_ASSET_VERSION = '20260804-10';
const DASHBOARD_PATHS = new Set([
  '/',
  '/dashboard',
  '/dashboard/',
  '/m',
  '/m/',
  '/mobile',
  '/mobile/',
  '/alerts',
  '/alerts/',
]);

const INLINE_PNL_SCRIPT_PATTERN = /<script\s+id=["']moe-pnl-control-script-v1["'][^>]*>([\s\S]*?)<\/script>/i;
const PNL_PATCH_SOURCE = tradingViewPnlControlPatch();
const PNL_SCRIPT_MATCH = PNL_PATCH_SOURCE.match(INLINE_PNL_SCRIPT_PATTERN);

if (!PNL_SCRIPT_MATCH || !PNL_SCRIPT_MATCH[1]) {
  throw new Error('Unable to extract the mobile P&L client script');
}

const PNL_SCRIPT_BODY = `${PNL_SCRIPT_MATCH[1].trim()}\n//# sourceURL=moe-pnl-control-v2.js\n`;
const EXTERNAL_PNL_SCRIPT_TAG = `<script id="moe-pnl-control-script-v2" src="${PNL_SCRIPT_PATH}?v=${PNL_ASSET_VERSION}" defer></script>`;

function noCacheHeaders(contentType) {
  return new Headers({
    'content-type': contentType,
    'cache-control': 'no-store, no-cache, must-revalidate',
    pragma: 'no-cache',
    expires: '0',
    'x-content-type-options': 'nosniff',
  });
}

function javascriptAssetResponse(request) {
  return new Response(request.method === 'HEAD' ? null : PNL_SCRIPT_BODY, {
    status: 200,
    headers: noCacheHeaders('application/javascript; charset=utf-8'),
  });
}

function shouldExternalize(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) return false;
  if (!DASHBOARD_PATHS.has(new URL(request.url).pathname)) return false;
  return String(response.headers.get('content-type') || '').toLowerCase().includes('text/html');
}

async function externalizePnlClient(request, response) {
  if (!shouldExternalize(request, response)) return response;

  let source = await response.text();
  const hadInlineScript = INLINE_PNL_SCRIPT_PATTERN.test(source);
  INLINE_PNL_SCRIPT_PATTERN.lastIndex = 0;
  source = source.replace(INLINE_PNL_SCRIPT_PATTERN, '');

  source = source.replace(/<script\s+id=["']moe-pnl-control-script-v2["'][^>]*><\/script>/gi, '');
  source = source.replace(/<script\s+id=["']moe-pnl-control-script-v2["'][^>]*><\/script\s*>/gi, '');

  if (!source.includes('moe-pnl-control-script-v2')) {
    source = source.includes('</body>')
      ? source.replace('</body>', `${EXTERNAL_PNL_SCRIPT_TAG}\n</body>`)
      : `${source}\n${EXTERNAL_PNL_SCRIPT_TAG}`;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('pragma', 'no-cache');
  headers.set('expires', '0');
  headers.set('x-moe-pnl-client', `external-${PNL_ASSET_VERSION}`);
  headers.set('x-moe-pnl-inline-removed', hadInlineScript ? 'true' : 'not-found');

  return new Response(request.method === 'HEAD' ? null : source, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const worker = {
  ...resilientWorker,
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === PNL_SCRIPT_PATH && ['GET', 'HEAD'].includes(request.method)) {
      return javascriptAssetResponse(request);
    }

    const response = await resilientWorker.fetch(request, env, ctx);
    return externalizePnlClient(request, response);
  },
};

export default worker;
