import {
  normalizeTradingViewAlert,
  tradingViewSignalId,
} from './tradingview-only-runtime.js';

const encoder = new TextEncoder();

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

function constantTimeTextEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function positionCoordinator(env, symbol) {
  return env.TRADINGVIEW_POSITION.getByName(String(symbol || '').trim().toUpperCase());
}

function requestMetadata(request) {
  return {
    ip: request.headers.get('cf-connecting-ip') || null,
    country: request.cf?.country || null,
    userAgent: String(request.headers.get('user-agent') || '').slice(0, 180),
  };
}

async function processQueuedAlert(alert, settings, runtime, env) {
  try {
    const result = await positionCoordinator(env, alert.symbol).processAlert(alert, settings, runtime);
    if (alert.signal === 'BUY' && result?.ignored === true) {
      await coordinator(env).releaseTradingViewPosition(alert.symbol, result.reason || 'BUY_IGNORED');
    }
    await coordinator(env).recordTradingViewAudit({
      type: 'TRADINGVIEW_ALERT_QUEUE_COMPLETED',
      symbol: alert.symbol,
      signal: alert.signal,
      signalId: alert.signalId,
      executed: result?.ignored !== true,
      ignored: result?.ignored === true,
      reason: result?.reason || null,
    });
  } catch (error) {
    if (alert.signal === 'BUY') {
      await coordinator(env).releaseTradingViewPosition(alert.symbol, 'PROCESSING_FAILED');
    }
    await coordinator(env).recordTradingViewAudit({
      type: 'TRADINGVIEW_ALERT_PROCESSING_FAILED',
      symbol: alert.symbol,
      signal: alert.signal,
      signalId: alert.signalId,
      error: error instanceof Error ? error.message : 'Queued TradingView execution failed',
    });
  }
}

export async function handleQueuedTradingViewWebhook(request, env, ctx) {
  if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);

  let payload;
  try { payload = await request.json(); }
  catch {
    await coordinator(env).recordTradingViewAudit({
      type: 'TRADINGVIEW_SUSPICIOUS_INVALID_JSON',
      ...requestMetadata(request),
    });
    return json({ ok: false, error: 'Invalid JSON payload' }, 400);
  }

  const supplied = request.headers.get('x-moe-webhook-secret')
    || String(payload.token || payload.secret || payload.webhookSecret || payload.webhook_secret || '');
  if (!env.MOE_WEBHOOK_SECRET || !constantTimeTextEqual(supplied, env.MOE_WEBHOOK_SECRET)) {
    await coordinator(env).recordTradingViewAudit({
      type: 'TRADINGVIEW_SUSPICIOUS_UNAUTHORIZED_ALERT',
      claimedSymbol: String(payload.ticker || payload.symbol || '').slice(0, 12),
      ...requestMetadata(request),
    });
    return json({ ok: false, error: 'Unauthorized TradingView alert' }, 401);
  }

  let alert;
  try { alert = normalizeTradingViewAlert(payload); }
  catch (error) {
    await coordinator(env).recordTradingViewAudit({
      type: 'TRADINGVIEW_ALERT_REJECTED_SCHEMA',
      error: error instanceof Error ? error.message : 'Invalid TradingView alert',
      ...requestMetadata(request),
    });
    return json({ ok: false, error: error instanceof Error ? error.message : 'Invalid TradingView alert' }, 400);
  }
  alert.signalId = await tradingViewSignalId(alert);

  const global = coordinator(env);
  const claim = await global.claimTradingViewSignal(alert.signalId, alert);
  if (!claim.accepted) {
    await global.recordTradingViewAudit({
      type: 'TRADINGVIEW_DUPLICATE_ALERT_IGNORED',
      symbol: alert.symbol,
      signal: alert.signal,
      signalId: alert.signalId,
    });
    return json({
      ok: true,
      accepted: true,
      queued: false,
      executed: false,
      duplicate: true,
      signalId: alert.signalId,
    });
  }

  const runtime = await global.recordValidTradingViewAlert(alert);
  const settings = await global.tradingViewSettings();
  await global.recordTradingViewAudit({
    type: 'TRADINGVIEW_ALERT_RECEIVED',
    symbol: alert.symbol,
    signal: alert.signal,
    signalId: alert.signalId,
    indicator: alert.indicator,
    alertPrice: alert.price,
    processing: 'DURABLE_OBJECT_TICKER_QUEUE',
  });

  if (!settings.configured || !runtime.receptionEnabled || runtime.killSwitchActive) {
    const reason = !settings.configured
      ? 'SETTINGS_NOT_CONFIGURED'
      : runtime.killSwitchActive
        ? 'KILL_SWITCH_ACTIVE'
        : 'ALERT_RECEPTION_DISABLED';
    await global.recordTradingViewAudit({
      type: 'TRADINGVIEW_ALERT_LOGGED_NOT_EXECUTED',
      symbol: alert.symbol,
      signalId: alert.signalId,
      reason,
    });
    return json({
      ok: true,
      accepted: true,
      queued: false,
      executed: false,
      ignored: true,
      reason,
      signalId: alert.signalId,
    }, 202);
  }

  if (alert.signal === 'BUY') {
    const reservation = await global.reserveTradingViewPosition(alert.symbol);
    if (!reservation.accepted) {
      await global.recordTradingViewAudit({
        type: 'TRADINGVIEW_BUY_BLOCKED',
        symbol: alert.symbol,
        signalId: alert.signalId,
        reason: reservation.reason,
      });
      return json({
        ok: true,
        accepted: true,
        queued: false,
        executed: false,
        ignored: true,
        reason: reservation.reason,
        signalId: alert.signalId,
      });
    }
  }

  const task = processQueuedAlert(alert, settings, runtime, env);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  else await task;

  return json({
    ok: true,
    accepted: true,
    queued: true,
    executed: false,
    processing: 'DURABLE_OBJECT_TICKER_QUEUE',
    symbol: alert.symbol,
    signal: alert.signal,
    signalId: alert.signalId,
    message: 'TradingView alert accepted for isolated ticker processing.',
  }, 202);
}
