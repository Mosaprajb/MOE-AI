import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './tradingview-only-entry.js';
import { TradingViewPositionCoordinator } from './tradingview-only-runtime-safety.js';
import {
  brokerAccountId,
  getBrokerPositions,
  placeSimpleSpotOrder,
} from './tradingview-only-broker.js';

export { AlertCoordinator, SimulationDriver, TradingViewPositionCoordinator };

const OLD_EXECUTION_PATHS = new Set([
  '/api/tradingview/webull-preview',
]);

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
