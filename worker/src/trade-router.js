import routerWorker, { AlertCoordinator as BaseAlertCoordinator } from './router.js';
import { getWebullPositions } from './webull-client.js';
import { closeTrade, listTrades, reconcileTradesWithPositions, tradeAnalytics, upsertTrade } from './trade-history.js';

const TRADINGVIEW_SIGNAL_PATH = '/api/tradingview/signal';

export class AlertCoordinator extends BaseAlertCoordinator {
  async listTrades(options = {}) {
    return listTrades(this.ctx.storage, options);
  }

  async upsertTrade(payload) {
    return upsertTrade(this.ctx.storage, payload);
  }

  async closeTrade(id, payload = {}) {
    return closeTrade(this.ctx.storage, id, payload);
  }

  async reconcileTrades(positions = [], options = {}) {
    return reconcileTradesWithPositions(this.ctx.storage, positions, options);
  }

  async tradeAnalytics() {
    return tradeAnalytics(this.ctx.storage);
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function secureJson(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === env.APP_ORIGIN || origin === 'http://localhost:3000') return origin;
  return null;
}

function cors(origin) {
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type,x-moe-webhook-secret',
    vary: 'Origin',
  } : {};
}

function authorizedWrite(request, env) {
  const supplied = request.headers.get('x-moe-webhook-secret') || '';
  return Boolean(env.MOE_WEBHOOK_SECRET) && supplied === env.MOE_WEBHOOK_SECRET;
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('Invalid JSON payload');
  }
}

async function signalFingerprint(payload) {
  const explicit = String(payload.signalId || payload.signal_id || '').trim();
  if (explicit) return explicit.slice(0, 64);
  const raw = [
    payload.symbol,
    payload.side,
    payload.timeframe || payload.interval,
    payload.barTime || payload.time || payload.timestamp,
    payload.limitPrice || payload.marketPrice,
    payload.stopLoss,
    payload.takeProfit,
  ].map((value) => String(value ?? '')).join('|');
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('').slice(0, 64);
}

function automaticTrade(payload, result, signalId) {
  const order = result?.order || {};
  const evaluation = result?.plan?.evaluation || {};
  const brain = result?.brain || result?.plan?.brain || {};
  return {
    signalId,
    symbol: String(order.symbol || payload.symbol || '').trim().toUpperCase(),
    direction: String(order.side || payload.side || 'BUY').trim().toUpperCase(),
    timeframe: String(payload.timeframe || payload.interval || ''),
    entryPrice: order.limitPrice ?? order.marketPrice ?? payload.limitPrice ?? payload.marketPrice,
    stopLoss: order.stopLoss ?? payload.stopLoss,
    takeProfit: order.takeProfit ?? payload.takeProfit,
    quantity: order.quantity ?? payload.quantity ?? payload.qty,
    entryTime: result?.createdAt || payload.barTime || payload.time || payload.timestamp || new Date().toISOString(),
    marketRegime: brain.marketRegime ?? payload.marketRegime ?? 'UNKNOWN',
    sector: brain.sector ?? payload.sector ?? 'OTHER',
    brainScore: evaluation.score ?? brain.brainScore ?? payload.score,
    marketScore: brain.marketScore ?? payload.marketScore,
    sectorScore: brain.sectorScore ?? payload.sectorScore,
    decisionReasons: evaluation.reasons || result?.accountSafety?.reasons || [],
    status: 'OPEN',
  };
}

function extractPositions(payload) {
  if (Array.isArray(payload)) return payload;
  const candidates = [
    payload?.positions,
    payload?.position_list,
    payload?.data,
    payload?.data?.positions,
    payload?.data?.position_list,
    payload?.result?.positions,
  ];
  return candidates.find(Array.isArray) || [];
}

function missingChecks(env, override) {
  const raw = override ?? env.WEBULL_RECONCILE_MISSING_CHECKS ?? 2;
  const parsed = Number(raw);
  return Math.max(1, Math.min(10, Number.isFinite(parsed) ? parsed : 2));
}

async function runWebullReconciliation(env, options = {}) {
  if (String(env.WEBULL_RECONCILIATION_ENABLED || 'true').toLowerCase() === 'false') {
    return { skipped: true, reason: 'WEBULL_RECONCILIATION_DISABLED' };
  }

  const accountId = String(options.accountId || env.WEBULL_ACCOUNT_ID || '').trim();
  if (!accountId) return { skipped: true, reason: 'WEBULL_ACCOUNT_ID_MISSING' };

  const response = await getWebullPositions(accountId, env);
  const positions = extractPositions(response);
  const result = await coordinator(env).reconcileTrades(positions, {
    requiredMissingChecks: missingChecks(env, options.requiredMissingChecks),
  });

  return {
    ...result,
    skipped: false,
    accountId,
    brokerPositions: positions.length,
  };
}

async function forwardAndRecordSignal(request, env, ctx) {
  const requestCopy = request.clone();
  let payload = null;
  try {
    payload = await requestCopy.json();
  } catch {
    return routerWorker.fetch(request, env, ctx);
  }

  const response = await routerWorker.fetch(request, env, ctx);
  let result = null;
  try {
    result = await response.clone().json();
  } catch {
    return response;
  }

  if (result?.submitted === true) {
    try {
      const signalId = await signalFingerprint(payload);
      const trade = await coordinator(env).upsertTrade(automaticTrade(payload, result, signalId));
      const enriched = { ...result, tradeHistoryRecorded: true, tradeId: trade.id };
      return secureJson(enriched, response.status, Object.fromEntries(response.headers));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'TRADE_HISTORY_AUTO_RECORD_FAILED',
        error: error instanceof Error ? error.message : 'Unknown trade history error',
        symbol: payload?.symbol || null,
        createdAt: new Date().toISOString(),
      }));
      const enriched = {
        ...result,
        tradeHistoryRecorded: false,
        tradeHistoryError: error instanceof Error ? error.message : 'Trade history recording failed',
      };
      return secureJson(enriched, response.status, Object.fromEntries(response.headers));
    }
  }

  return response;
}

async function handleTrades(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!origin) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);

  const stub = coordinator(env);
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const trades = await stub.listTrades({
      limit: url.searchParams.get('limit') || 100,
      status: url.searchParams.get('status') || '',
      symbol: url.searchParams.get('symbol') || '',
    });
    return secureJson({ ok: true, count: trades.length, trades, storage: 'DURABLE_OBJECT' }, 200, headers);
  }

  if (request.method === 'POST') {
    if (!authorizedWrite(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);
    const trade = await stub.upsertTrade(await parseJson(request));
    return secureJson({ ok: true, trade, storage: 'DURABLE_OBJECT' }, 200, headers);
  }

  return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
}

async function handleTradeClose(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!origin) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  if (!authorizedWrite(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);

  const payload = await parseJson(request);
  const id = String(payload.id || payload.tradeId || '').trim();
  if (!id) return secureJson({ ok: false, error: 'Trade id is required' }, 400, headers);
  const trade = await coordinator(env).closeTrade(id, payload);
  return secureJson({ ok: true, trade, storage: 'DURABLE_OBJECT' }, 200, headers);
}

async function handleTradeAnalytics(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!origin) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);

  const analytics = await coordinator(env).tradeAnalytics();
  return secureJson({ ok: true, analytics, storage: 'DURABLE_OBJECT' }, 200, headers);
}

async function handleTradeReconcile(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (!origin) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
  if (!authorizedWrite(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);

  const payload = await parseJson(request);
  const reconciliation = await runWebullReconciliation(env, payload);
  return secureJson({ ok: true, reconciliation, storage: 'DURABLE_OBJECT' }, 200, headers);
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    try {
      if (path === '/api/trades') return await handleTrades(request, env);
      if (path === '/api/trades/close') return await handleTradeClose(request, env);
      if (path === '/api/trades/analytics') return await handleTradeAnalytics(request, env);
      if (path === '/api/trades/reconcile') return await handleTradeReconcile(request, env);
      if (path === TRADINGVIEW_SIGNAL_PATH && request.method === 'POST') return await forwardAndRecordSignal(request, env, ctx);
      return routerWorker.fetch(request, env, ctx);
    } catch (error) {
      return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Trade history request failed' }, 400);
    }
  },

  async scheduled(controller, env, ctx) {
    const baseTask = Promise.resolve(routerWorker.scheduled(controller, env, ctx));
    const reconciliationTask = runWebullReconciliation(env)
      .then((result) => {
        console.log(JSON.stringify({
          event: 'WEBULL_TRADE_RECONCILIATION',
          ...result,
          createdAt: new Date().toISOString(),
        }));
        return result;
      })
      .catch((error) => {
        console.error(JSON.stringify({
          event: 'WEBULL_TRADE_RECONCILIATION_FAILED',
          error: error instanceof Error ? error.message : 'Unknown reconciliation error',
          createdAt: new Date().toISOString(),
        }));
        return null;
      });

    if (ctx?.waitUntil) ctx.waitUntil(reconciliationTask);
    return baseTask;
  },
};