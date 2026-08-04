import baseWorker, {
  AlertCoordinator as BaseAlertCoordinator,
  SimulationDriver,
} from './tradingview-only-entry.js';
import { TradingViewPositionCoordinator } from './tradingview-only-runtime-final.js';
import {
  brokerAccountId,
  getBrokerPositions,
  placeSimpleSpotOrder,
} from './tradingview-only-broker.js';
import {
  scannerOnlyHtml,
  tradingViewDashboardHtml,
} from './tradingview-only-dashboard-final.js';
import { handleQueuedTradingViewWebhook } from './tradingview-only-webhook-queue.js';

const DEDUPE_INDEX_KEY = 'tradingview-only:dedupe-index:v1';
const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/m', '/m/', '/mobile', '/mobile/', '/alerts', '/alerts/']);
const SCANNER_PATHS = new Set(['/scanner', '/scanner/']);
const WEBHOOK_PATHS = new Set(['/api/tradingview/signal', '/api/tradingview/webhook']);
const OLD_EXECUTION_PATHS = new Set([
  '/api/tradingview/webull-preview',
]);

export class AlertCoordinator extends BaseAlertCoordinator {
  async claimTradingViewSignal(signalId, alert = {}) {
    const key = `tradingview-only:dedupe:${signalId}`;
    const existing = await this.ctx.storage.get(key);
    if (existing) return { accepted: false, duplicate: true, existing };
    const record = {
      signalId,
      symbol: alert.symbol || null,
      signal: alert.signal || null,
      receivedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(key, record);
    const current = await this.ctx.storage.get(DEDUPE_INDEX_KEY);
    const index = Array.isArray(current) ? current.filter((item) => item?.signalId !== signalId) : [];
    index.unshift(record);
    await this.ctx.storage.put(DEDUPE_INDEX_KEY, index.slice(0, 2000));
    return { accepted: true, duplicate: false, record, permanent: true };
  }
}

export { SimulationDriver, TradingViewPositionCoordinator };

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

function rows(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'items', 'positions', 'position_list', 'list']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function positionSymbol(position = {}) {
  return String(position.symbol || position.ticker?.symbol || position.instrument?.symbol || '').trim().toUpperCase();
}

function positionQuantity(position = {}) {
  const value = Number(position.quantity ?? position.qty ?? position.position ?? position.holding_quantity ?? 0);
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

async function closeUntrackedBrokerPositions(response, env) {
  const payload = await response.clone().json().catch(() => ({}));
  const accountType = String(payload?.runtime?.accountType || 'DEMO').toUpperCase();
  const successfulTracked = new Set((Array.isArray(payload?.exits) ? payload.exits : [])
    .filter((item) => item?.ok === true)
    .map((item) => String(item.symbol || '').toUpperCase()));
  const accountId = brokerAccountId(accountType, env);
  const brokerPositions = rows(await getBrokerPositions(accountType, env));
  const additionalExits = [];

  for (const position of brokerPositions) {
    const symbol = positionSymbol(position);
    const quantity = positionQuantity(position);
    if (!symbol || quantity <= 0 || successfulTracked.has(symbol)) continue;
    try {
      const exit = await placeSimpleSpotOrder({
        accountType,
        accountId,
        symbol,
        side: 'SELL',
        quantity,
        orderType: 'MARKET',
        signalId: `kill-all:${symbol}:${Date.now()}`,
        session: 'ALL',
      }, env);
      additionalExits.push({ symbol, quantity, ok: true, clientOrderId: exit.clientOrderId });
      await coordinator(env).recordTradingViewAudit({
        type: 'KILL_SWITCH_UNTRACKED_POSITION_EXIT_SUBMITTED',
        symbol,
        quantity,
        accountType,
        clientOrderId: exit.clientOrderId,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Emergency broker exit failed';
      additionalExits.push({ symbol, quantity, ok: false, error: message });
      await coordinator(env).recordTradingViewAudit({
        type: 'KILL_SWITCH_UNTRACKED_POSITION_EXIT_FAILED',
        symbol,
        quantity,
        accountType,
        error: message,
      });
    }
  }

  return Response.json({
    ...payload,
    ok: true,
    closesAllBrokerPositions: true,
    additionalExits,
    partialFailure: payload.partialFailure === true || additionalExits.some((item) => !item.ok),
  }, {
    status: 200,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (DASHBOARD_PATHS.has(path) && ['GET', 'HEAD'].includes(request.method)) {
      return html(tradingViewDashboardHtml(), request.method);
    }
    if (SCANNER_PATHS.has(path) && ['GET', 'HEAD'].includes(request.method)) {
      return html(scannerOnlyHtml(), request.method);
    }
    if (WEBHOOK_PATHS.has(path)) {
      return handleQueuedTradingViewWebhook(request, env, ctx);
    }
    if (OLD_EXECUTION_PATHS.has(path)) {
      return Response.json({
        ok: false,
        blocked: true,
        error: 'This legacy internal execution path is disabled. TradingView-only webhook execution is active.',
      }, { status: 410, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
    }

    if (path === '/api/tradingview/kill-switch' && request.method === 'POST') {
      const copy = request.clone();
      const action = String((await copy.json().catch(() => ({})))?.action || '').toUpperCase();
      const response = await baseWorker.fetch(request, env, ctx);
      if (!response.ok || action === 'CLEAR') return response;
      try {
        return await closeUntrackedBrokerPositions(response, env);
      } catch (error) {
        await coordinator(env).recordTradingViewAudit({
          type: 'KILL_SWITCH_BROKER_INVENTORY_SYNC_FAILED',
          error: error instanceof Error ? error.message : 'Broker inventory sync failed',
        });
        return response;
      }
    }

    return baseWorker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
