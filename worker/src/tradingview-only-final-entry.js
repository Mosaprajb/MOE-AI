import baseWorker, {
  AlertCoordinator as BaseAlertCoordinator,
  SimulationDriver,
} from './tradingview-only-entry.js';
import { TradingViewPositionCoordinator } from './tradingview-only-runtime-final.js';
import {
  brokerAccountId,
  fetchAlpacaSpotQuote,
  getBrokerPositions,
  placeSimpleSpotOrder,
} from './tradingview-only-broker.js';
import {
  migrateTradingViewSettingsV2,
  normalizeTradingViewSettingsV2,
  TRADINGVIEW_SETTINGS_VERSION,
} from './tradingview-only-settings-v2.js';
import { marketPhaseAt, tradingViewMarketClock } from './tradingview-only-market-clock.js';
import {
  scannerOnlyHtml,
  tradingViewDashboardHtml,
} from './tradingview-only-dashboard-final.js';
import { handleQueuedTradingViewWebhook } from './tradingview-only-webhook-queue.js';

const SETTINGS_KEY = 'tradingview-only:settings:v1';
const RUNTIME_KEY = 'tradingview-only:runtime:v1';
const DEDUPE_INDEX_KEY = 'tradingview-only:dedupe-index:v1';
const AUTO_FLATTEN_STATE_KEY = 'tradingview-only:auto-flatten:v2';
const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/m', '/m/', '/mobile', '/mobile/', '/alerts', '/alerts/']);
const SCANNER_PATHS = new Set(['/scanner', '/scanner/']);
const WEBHOOK_PATHS = new Set(['/api/tradingview/signal', '/api/tradingview/webhook']);
const OLD_EXECUTION_PATHS = new Set([
  '/api/tradingview/webull-preview',
]);

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async tradingViewSettings() {
    const stored = await this.ctx.storage.get(SETTINGS_KEY);
    return migrateTradingViewSettingsV2(stored);
  }

  async updateTradingViewSettings(patch = {}) {
    const active = await this.tradingViewActivePositions();
    if (Object.keys(active).length > 0) {
      throw new Error('Close all positions before changing TradingView execution settings');
    }
    const settings = normalizeTradingViewSettingsV2(patch);
    await this.ctx.storage.put(SETTINGS_KEY, settings);
    const runtime = await this.tradingViewRuntime();
    await this.ctx.storage.put(RUNTIME_KEY, {
      ...runtime,
      accountType: settings.accountType,
      receptionEnabled: false,
      updatedAt: new Date().toISOString(),
    });
    await this.recordTradingViewAudit({
      type: 'TRADINGVIEW_SETTINGS_V2_UPDATED',
      settingsVersion: TRADINGVIEW_SETTINGS_VERSION,
      accountType: settings.accountType,
      tradingMode: settings.tradingMode,
      session: settings.session,
      autoFlattenTimeLocal: settings.autoFlattenTimeLocal,
      autoFlattenTimezone: settings.autoFlattenTimezone,
      wholeTradeTargets: true,
      noOvernightHolding: true,
    });
    await this.scheduleNextTradingViewAutoFlatten(settings);
    return settings;
  }

  async setTradingViewReception(payload = {}) {
    const runtime = await super.setTradingViewReception(payload);
    await this.scheduleNextTradingViewAutoFlatten(await this.tradingViewSettings());
    return runtime;
  }

  async scheduleNextTradingViewAutoFlatten(settings = null, from = Date.now(), retryWhenDue = true) {
    const currentSettings = settings || await this.tradingViewSettings();
    const clock = tradingViewMarketClock(from, currentSettings);
    const nextAt = clock.autoFlattenDue && retryWhenDue
      ? from + 5_000
      : Date.parse(clock.autoFlattenAt || '');
    if (Number.isFinite(nextAt)) await this.ctx.storage.setAlarm(nextAt);
    return { scheduled: Number.isFinite(nextAt), nextAt: Number.isFinite(nextAt) ? new Date(nextAt).toISOString() : null, clock };
  }

  async alarm() {
    const result = await runAutoFlatten({ scheduledTime: Date.now() }, this.env, this);
    const completed = result?.result?.completed === true;
    const skipped = Boolean(result?.skipped);
    if (!completed && !skipped) {
      await this.ctx.storage.setAlarm(Date.now() + 60_000);
    } else {
      await this.scheduleNextTradingViewAutoFlatten(
        await this.tradingViewSettings(),
        Date.now() + 60_000,
        false,
      );
    }
    return result;
  }

  async reserveTradingViewPosition(symbol) {
    const settings = await this.tradingViewSettings();
    const clock = tradingViewMarketClock(Date.now(), settings);
    if (!clock.entryAllowed) {
      return {
        accepted: false,
        reason: clock.entryBlockedReason,
        marketClock: clock,
      };
    }
    return super.reserveTradingViewPosition(symbol);
  }

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

  async prepareTradingViewAutoFlatten(now = Date.now()) {
    const [settings, runtime, active] = await Promise.all([
      this.tradingViewSettings(),
      this.tradingViewRuntime(),
      this.tradingViewActivePositions(),
    ]);
    const clock = tradingViewMarketClock(now, settings);
    const previous = await this.ctx.storage.get(AUTO_FLATTEN_STATE_KEY);
    const previousAt = Date.parse(previous?.checkedAt || previous?.updatedAt || '');
    if (!clock.autoFlattenDue) {
      return {
        due: false,
        reason: 'AUTO_FLATTEN_WINDOW_NOT_REACHED',
        settings,
        runtime,
        clock,
        symbols: Object.keys(active),
      };
    }
    if (previous?.completed === true && Number.isFinite(previousAt) && now - previousAt < 5 * 60_000) {
      return {
        due: false,
        reason: 'RECENTLY_VERIFIED_FLAT',
        settings,
        runtime,
        clock,
        symbols: Object.keys(active),
      };
    }
    return {
      due: true,
      reason: 'NO_OVERNIGHT_AUTO_FLATTEN',
      settings,
      runtime,
      clock,
      accountType: String(runtime.accountType || settings.accountType || 'DEMO').toUpperCase(),
      symbols: Object.keys(active),
    };
  }

  async claimAutoFlattenInventoryOrder(symbol, accountType, dayKey, now = Date.now()) {
    const key = `tradingview-only:auto-flatten-order:${dayKey}:${accountType}:${symbol}`;
    const existing = await this.ctx.storage.get(key);
    const submittedAt = Date.parse(existing?.submittedAt || '');
    if (existing && Number.isFinite(submittedAt) && now - submittedAt < 5 * 60_000) {
      return { accepted: false, reason: 'RECENT_EXIT_ORDER_EXISTS', existing };
    }
    const record = { symbol, accountType, dayKey, submittedAt: new Date(now).toISOString() };
    await this.ctx.storage.put(key, record);
    return { accepted: true, record };
  }

  async releaseAutoFlattenInventoryOrder(symbol, accountType, dayKey) {
    const key = `tradingview-only:auto-flatten-order:${dayKey}:${accountType}:${symbol}`;
    await this.ctx.storage.delete(key);
    return { released: true, symbol, accountType, dayKey };
  }

  async recordTradingViewAutoFlatten(result = {}) {
    const record = {
      ...result,
      checkedAt: new Date().toISOString(),
    };
    await this.ctx.storage.put(AUTO_FLATTEN_STATE_KEY, record);
    await this.recordTradingViewAudit({
      type: record.completed ? 'TRADINGVIEW_AUTO_FLATTEN_VERIFIED_FLAT' : 'TRADINGVIEW_AUTO_FLATTEN_PROGRESS',
      accountType: record.accountType,
      trackedCount: record.trackedCount,
      brokerPositionCount: record.brokerPositionCount,
      submittedCount: record.submittedCount,
      failureCount: record.failureCount,
      phase: record.phase,
    });
    return record;
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

function positionCoordinator(env, symbol) {
  return env.TRADINGVIEW_POSITION.getByName(String(symbol || '').trim().toUpperCase());
}

function sellLimit(referencePrice) {
  const value = Number(referencePrice);
  if (!(value > 0)) return null;
  return Math.max(0.01, Math.floor(value * 0.995 * 100) / 100);
}

async function inventoryExitInstruction(symbol, env) {
  const phase = marketPhaseAt(Date.now());
  if (phase === 'REGULAR') return { phase, orderType: 'MARKET', session: 'CORE', limitPrice: null };
  const quote = await fetchAlpacaSpotQuote(symbol, env);
  return {
    phase,
    orderType: 'LIMIT',
    session: phase === 'OVERNIGHT' ? 'NIGHT' : 'ALL',
    limitPrice: sellLimit(quote.bid || quote.price),
  };
}

async function closeBrokerInventory(accountType, excludedSymbols, env, reason, dayKey, global = coordinator(env)) {
  const accountId = brokerAccountId(accountType, env);
  const brokerPositions = rows(await getBrokerPositions(accountType, env));
  const exits = [];
  for (const position of brokerPositions) {
    const symbol = positionSymbol(position);
    const quantity = positionQuantity(position);
    if (!symbol || quantity <= 0 || excludedSymbols.has(symbol)) continue;
    const claim = await global.claimAutoFlattenInventoryOrder(symbol, accountType, dayKey, Date.now());
    if (!claim.accepted) {
      exits.push({ symbol, quantity, ok: true, skipped: true, reason: claim.reason });
      continue;
    }
    try {
      const instruction = await inventoryExitInstruction(symbol, env);
      const exit = await placeSimpleSpotOrder({
        accountType,
        accountId,
        symbol,
        side: 'SELL',
        quantity,
        orderType: instruction.orderType,
        limitPrice: instruction.limitPrice,
        signalId: `${reason.toLowerCase()}:${symbol}:${Date.now()}`,
        session: instruction.session,
      }, env);
      exits.push({
        symbol,
        quantity,
        ok: true,
        clientOrderId: exit.clientOrderId,
        instruction,
      });
      await global.recordTradingViewAudit({
        type: `${reason}_UNTRACKED_POSITION_EXIT_SUBMITTED`,
        symbol,
        quantity,
        accountType,
        clientOrderId: exit.clientOrderId,
        phase: instruction.phase,
        orderType: instruction.orderType,
        session: instruction.session,
        limitPrice: instruction.limitPrice,
      });
    } catch (error) {
      await global.releaseAutoFlattenInventoryOrder(symbol, accountType, dayKey);
      const message = error instanceof Error ? error.message : 'Emergency broker exit failed';
      exits.push({ symbol, quantity, ok: false, error: message });
      await global.recordTradingViewAudit({
        type: `${reason}_UNTRACKED_POSITION_EXIT_FAILED`,
        symbol,
        quantity,
        accountType,
        error: message,
      });
    }
  }
  return { brokerPositionCount: brokerPositions.length, exits };
}

async function augmentStatusResponse(response) {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object') return response;
  const settings = payload.settings || {};
  const marketClock = tradingViewMarketClock(Date.now(), settings);
  return Response.json({
    ...payload,
    settingsSchema: 'WHOLE_TRADE_V2',
    wholeTradeTargets: true,
    wholeSharesOnly: true,
    equitiesOnly: true,
    spotOnly: settings.marginLongEnabled !== true,
    cashOnly: settings.cashOnly !== false,
    marginLongEnabled: settings.marginLongEnabled === true,
    noOvernightHolding: true,
    marginLongOptional: true,
    percentageSettingsAllowed: 'MAX_BUYING_POWER_ONLY',
    marketClock,
    generatedAt: new Date().toISOString(),
  }, {
    status: response.status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function closeUntrackedBrokerPositions(response, env) {
  const payload = await response.clone().json().catch(() => ({}));
  const accountType = String(payload?.runtime?.accountType || 'DEMO').toUpperCase();
  const successfulTracked = new Set((Array.isArray(payload?.exits) ? payload.exits : [])
    .filter((item) => item?.ok === true && item?.result?.skipped !== true)
    .map((item) => String(item.symbol || '').toUpperCase()));
  const inventory = await closeBrokerInventory(accountType, successfulTracked, env, 'KILL_SWITCH', 'manual');
  return Response.json({
    ...payload,
    ok: true,
    closesAllBrokerPositions: true,
    additionalExits: inventory.exits,
    partialFailure: payload.partialFailure === true || inventory.exits.some((item) => !item.ok),
  }, {
    status: 200,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function runAutoFlatten(controller, env, global = coordinator(env)) {
  const now = finite(controller?.scheduledTime, Date.now());
  const plan = await global.prepareTradingViewAutoFlatten(now);
  if (!plan.due) {
    console.log(JSON.stringify({
      event: 'TRADINGVIEW_AUTO_FLATTEN_SKIPPED',
      reason: plan.reason,
      phase: plan.clock?.phase,
      createdAt: new Date(now).toISOString(),
    }));
    return { ok: true, skipped: plan.reason, marketClock: plan.clock };
  }

  const trackedResults = await Promise.allSettled(
    plan.symbols.map((symbol) => positionCoordinator(env, symbol).emergencyClose('AUTO_FLATTEN')),
  );
  const tracked = trackedResults.map((result, index) => ({
    symbol: plan.symbols[index],
    ok: result.status === 'fulfilled',
    result: result.status === 'fulfilled' ? result.value : null,
    error: result.status === 'rejected' ? String(result.reason || 'Auto-flatten failed') : null,
  }));
  const excluded = new Set(tracked
    .filter((item) => item.ok && item.result?.skipped !== true)
    .map((item) => item.symbol));
  const inventory = await closeBrokerInventory(
    plan.accountType,
    excluded,
    env,
    'AUTO_FLATTEN',
    plan.clock.localDateKey,
    global,
  );
  const failureCount = tracked.filter((item) => !item.ok).length + inventory.exits.filter((item) => !item.ok).length;
  const submittedCount = tracked.filter((item) => item.ok && item.result?.skipped !== true).length
    + inventory.exits.filter((item) => item.ok && item.skipped !== true).length;
  const completed = plan.symbols.length === 0 && inventory.brokerPositionCount === 0;
  const result = await global.recordTradingViewAutoFlatten({
    completed,
    accountType: plan.accountType,
    phase: plan.clock.phase,
    localDateKey: plan.clock.localDateKey,
    trackedCount: plan.symbols.length,
    brokerPositionCount: inventory.brokerPositionCount,
    submittedCount,
    failureCount,
    tracked,
    inventoryExits: inventory.exits,
  });
  console.log(JSON.stringify({
    event: 'TRADINGVIEW_AUTO_FLATTEN_RESULT',
    ...result,
  }));
  return { ok: failureCount === 0, plan, result };
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
    if (path === '/api/tradingview/status' && request.method === 'GET') {
      return augmentStatusResponse(await baseWorker.fetch(request, env, ctx));
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

  scheduled(controller, env) {
    return runAutoFlatten(controller, env);
  },
};
