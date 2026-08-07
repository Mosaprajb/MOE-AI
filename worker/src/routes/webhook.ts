// MOE-AI TradingView Webhook — receives alerts and executes on armed Webull accounts.
import { Hono } from 'hono';
import type { Decision, Env, TradingMode, TVWebhookPayload } from '../lib/types';
import { getKillSwitch } from '../lib/risk';
import { getLiveExecutionPolicy } from '../lib/live-control';
import { getMobileReceptionState } from '../lib/mobile-control';
import { WebullClient } from '../lib/webull';
import { placeProtectiveBracket } from '../lib/webull-protection';
import {
  prepareTrailingManagedClose,
  startTrailingManagement,
  trailingCoordinatorConfigured,
} from '../lib/trailing-stop-coordinator';
import {
  currentTradingWindow,
  getTradingSettings,
  isCurrentTradingWindowAllowed,
  isTradingSettingsConfigured,
  type TradingSettings,
} from './trading-settings';

const webhook = new Hono<{ Bindings: Env }>();

type ExecutionResult = {
  mode: TradingMode;
  accepted: boolean;
  symbol: string;
  side: 'BUY' | 'SELL';
  qty?: number;
  signalId: string;
  orderId?: string;
  orderStatus?: string;
  estimatedTotal?: number;
  estimatedTransactionFee?: number;
  maximumQuantityToBuy?: number;
  error?: string;
};

function availableBuyingPower(
  account: Awaited<ReturnType<WebullClient['getAccount']>>,
): number {
  const market = currentTradingWindow();
  if (market.window === 'NIGHT') {
    return Math.max(0, Math.min(
      Number(account.cash ?? 0),
      Number(account.nightTradingBuyingPower ?? 0),
    ));
  }
  if (market.window === 'EXTENDED') {
    return account.overnightBuyingPower > 0
      ? account.overnightBuyingPower
      : account.buyingPower;
  }
  return account.dayBuyingPower > 0 ? account.dayBuyingPower : account.buyingPower;
}

function maximumQuantity(
  settings: TradingSettings,
  price: number,
  buyingPower: number,
): number {
  if (!(price > 0)) return 0;
  return Math.max(0, Math.min(
    Math.floor(settings.shareQuantity),
    Math.floor(settings.maxTradeAmountUsd / price),
    Math.floor(buyingPower / price),
  ));
}

function roundPrice(value: number): number {
  return Number(value.toFixed(value >= 1 ? 2 : 4));
}

async function persistDecision(
  env: Env,
  decision: Decision,
): Promise<void> {
  try {
    await env.DB?.prepare(`
      INSERT INTO decisions
        (signal_id, symbol, side, signal, entry, stop, target, accepted, submitted, reject_reason, mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      decision.signalId,
      decision.symbol,
      decision.side ?? null,
      decision.signal ?? null,
      decision.entry ?? null,
      decision.stop ?? null,
      decision.target ?? null,
      decision.accepted ? 1 : 0,
      decision.submitted ? 1 : 0,
      decision.rejectReason ?? null,
      decision.mode ?? null,
      decision.createdAt,
    ).run();
  } catch {
    // D1 persistence is diagnostic only and must never create a duplicate order.
  }
}

async function reject(
  env: Env,
  result: Omit<ExecutionResult, 'accepted'> & { error: string },
  orderPrice?: number,
  stop?: number,
  target?: number,
): Promise<ExecutionResult> {
  const rejected: ExecutionResult = { ...result, accepted: false };
  await persistDecision(env, {
    signalId: result.signalId,
    symbol: result.symbol,
    side: result.side,
    signal: result.side === 'BUY' ? 'BUY NOW' : 'SELL NOW',
    entry: orderPrice,
    stop,
    target,
    accepted: false,
    submitted: false,
    rejectReason: result.error,
    reasons: [result.error],
    mode: result.mode,
    createdAt: new Date().toISOString(),
  });
  return rejected;
}

async function executeForMode(
  env: Env,
  mode: TradingMode,
  payload: TVWebhookPayload,
  normalized: {
    baseSignalId: string;
    symbol: string;
    side: 'BUY' | 'SELL';
    orderPrice?: number;
  },
): Promise<ExecutionResult> {
  const { symbol, side, orderPrice } = normalized;
  const signalId = `${normalized.baseSignalId}-${mode.toLowerCase()}`.slice(0, 190);
  const settings = await getTradingSettings(env, mode);

  if (!isTradingSettingsConfigured(settings)) {
    return reject(env, {
      mode, signalId, symbol, side,
      error: 'Trading controls, stop loss, take profit, or trailing settings are incomplete.',
    }, orderPrice);
  }

  if (mode === 'LIVE') {
    const policy = await getLiveExecutionPolicy(env);
    if (!policy.webhookExecutionAllowed) {
      const reason = [...policy.blockers, ...policy.webhookBlockers]
        .map(blocker => blocker.message)
        .join(' ');
      return reject(env, {
        mode, signalId, symbol, side,
        error: reason || 'Live TradingView execution is blocked by server policy.',
      }, orderPrice);
    }
  }

  const market = currentTradingWindow();
  if (!market.webullSession || !isCurrentTradingWindowAllowed(settings, market)) {
    return reject(env, {
      mode, signalId, symbol, side,
      error: `Current trading window is not enabled for ${mode}: ${market.label}.`,
    }, orderPrice);
  }

  const client = WebullClient.fromEnv(env, mode);
  if (!client) {
    return reject(env, {
      mode, signalId, symbol, side,
      error: `${mode} Webull credentials are not configured.`,
    }, orderPrice);
  }

  const isClose = side === 'SELL' || payload.action === 'close' || payload.closePosition === true;
  let qty = 0;
  let estimatedTotal: number | undefined;
  let estimatedTransactionFee: number | undefined;
  let maxQty: number | undefined;
  let positionPrice = Number(orderPrice ?? 0);
  let closeProtectionRemoved = false;

  try {
    if (isClose) {
      const positions = await client.getPositions();
      const position = positions.find(item => (
        item.symbol === symbol
        && item.side === 'LONG'
        && item.quantity > 0
      ));
      if (!position) {
        return reject(env, {
          mode, signalId, symbol, side,
          error: `No open long position in ${symbol} to close.`,
        }, orderPrice);
      }
      qty = Math.floor(position.quantity);
      positionPrice = Number(orderPrice ?? position.currentPrice ?? position.averagePrice ?? 0);
    } else {
      const price = Number(orderPrice ?? 0);
      if (!(price > 0)) {
        return reject(env, {
          mode, signalId, symbol, side,
          error: 'TradingView BUY alerts must include a valid price.',
        }, orderPrice);
      }
      if (!trailingCoordinatorConfigured(env)) {
        return reject(env, {
          mode, signalId, symbol, side,
          error: 'Protective-order coordinator is not configured; BUY is blocked.',
        }, orderPrice);
      }

      if (settings.blockIfPosition) {
        const positions = await client.getPositions();
        if (positions.some(item => item.symbol === symbol && item.quantity > 0)) {
          return reject(env, {
            mode, signalId, symbol, side,
            error: `A position in ${symbol} is already open; duplicate BUY was blocked.`,
          }, orderPrice);
        }
      }

      const account = await client.getAccount();
      const buyingPower = availableBuyingPower(account);
      maxQty = maximumQuantity(settings, price, buyingPower);
      qty = maxQty;
      if (qty < 1) {
        return reject(env, {
          mode, signalId, symbol, side,
          maximumQuantityToBuy: maxQty,
          error: 'Configured share quantity, trade cap, or buying power does not allow one share.',
        }, orderPrice);
      }
    }

    const previewPrice = Number(isClose ? positionPrice : orderPrice ?? 0);
    if (!(previewPrice > 0)) {
      return reject(env, {
        mode, signalId, symbol, side, qty,
        error: 'A valid price is required to preview and submit this order.',
      }, orderPrice);
    }

    const preview = await client.previewOrder({
      symbol,
      side,
      type: market.webullSession === 'CORE' ? 'MARKET' : 'LIMIT',
      qty,
      price: previewPrice,
      idempotencyKey: `${signalId}-preview`,
      tradingSession: market.webullSession,
      timeInForce: settings.timeInForce,
    });
    estimatedTotal = preview.estimatedCost;
    estimatedTransactionFee = preview.estimatedTransactionFee;

    if (isClose) {
      await prepareTrailingManagedClose(env, mode, symbol);
      closeProtectionRemoved = true;
      const result = await client.placeOrder({
        symbol,
        side: 'SELL',
        type: market.webullSession === 'CORE' ? 'MARKET' : 'LIMIT',
        qty,
        price: previewPrice,
        idempotencyKey: signalId,
        tradingSession: market.webullSession,
        timeInForce: settings.timeInForce,
      });
      await persistDecision(env, {
        signalId,
        symbol,
        side,
        signal: 'SELL NOW',
        entry: previewPrice,
        accepted: true,
        submitted: true,
        mode,
        createdAt: new Date().toISOString(),
      });
      return {
        mode,
        accepted: true,
        signalId,
        symbol,
        side,
        qty,
        orderId: result.orderId,
        orderStatus: result.status,
        estimatedTotal,
        estimatedTransactionFee,
      };
    }

    const protectiveStop = roundPrice(previewPrice * (1 - settings.stopLossPct / 100));
    const protectiveTarget = roundPrice(previewPrice * (1 + settings.takeProfitPct / 100));
    const bracket = await placeProtectiveBracket(client, {
      symbol,
      qty,
      requestedEntryPrice: previewPrice,
      takeProfitPrice: protectiveTarget,
      stopLossPrice: protectiveStop,
      idempotencyKey: signalId,
      tradingSession: market.webullSession,
      timeInForce: settings.timeInForce,
    });

    let coordinatorError: string | undefined;
    try {
      await startTrailingManagement(env, {
        mode,
        symbol,
        qty,
        requestedEntryPrice: previewPrice,
        entryClientOrderId: bracket.entryClientOrderId,
        takeProfitClientOrderId: bracket.takeProfitClientOrderId,
        stopLossClientOrderId: bracket.stopLossClientOrderId,
        comboClientOrderId: bracket.comboClientOrderId,
        settings: {
          stopLossPct: settings.stopLossPct,
          takeProfitPct: settings.takeProfitPct,
          trailingEnabled: settings.trailingEnabled,
          trailActivationUsd: settings.trailActivationUsd,
          trailInitialStopOffsetUsd: settings.trailInitialStopOffsetUsd,
          trailTriggerStepUsd: settings.trailTriggerStepUsd,
          trailStopMoveUsd: settings.trailStopMoveUsd,
        },
        timeInForce: settings.timeInForce,
        tradingSession: market.webullSession,
        entryPrice: undefined,
        takeProfitPrice: protectiveTarget,
        initialStopPrice: protectiveStop,
        currentStopPrice: protectiveStop,
        activationPrice: undefined,
        nextTriggerPrice: undefined,
        lastPrice: undefined,
        protectionAdjusted: false,
        takeProfitCancelled: false,
        lastError: undefined,
      });
    } catch (error) {
      coordinatorError = `Static TP/SL bracket is active, but stepped trailing did not start: ${String(error)}`;
    }

    await persistDecision(env, {
      signalId,
      symbol,
      side,
      signal: 'BUY NOW',
      entry: previewPrice,
      stop: protectiveStop,
      target: protectiveTarget,
      accepted: true,
      submitted: true,
      rejectReason: coordinatorError,
      reasons: coordinatorError ? [coordinatorError] : undefined,
      mode,
      createdAt: new Date().toISOString(),
    });

    return {
      mode,
      accepted: true,
      signalId,
      symbol,
      side,
      qty,
      orderId: bracket.orderId,
      orderStatus: bracket.status,
      estimatedTotal,
      estimatedTransactionFee,
      maximumQuantityToBuy: maxQty,
      error: coordinatorError,
    };
  } catch (error) {
    let message = String(error);
    if (isClose && closeProtectionRemoved && positionPrice > 0 && qty > 0) {
      try {
        const emergencyStop = roundPrice(positionPrice * (1 - settings.stopLossPct / 100));
        await client.placeProtectiveStop({
          symbol,
          qty,
          stop: emergencyStop,
          idempotencyKey: `${signalId}-RECOVERY-SL`,
          timeInForce: settings.timeInForce,
        });
        message = `${message}; close failed, emergency stop protection was restored.`;
      } catch (restoreError) {
        message = `${message}; CRITICAL: close failed and emergency stop restoration also failed: ${String(restoreError)}`;
      }
    }
    return reject(env, {
      mode, signalId, symbol, side, qty: qty || undefined,
      estimatedTotal,
      estimatedTransactionFee,
      maximumQuantityToBuy: maxQty,
      error: message,
    }, orderPrice);
  }
}

webhook.post('/webhook', async c => {
  const env = c.env;
  let payload: TVWebhookPayload;
  try {
    payload = await c.req.json<TVWebhookPayload>();
  } catch {
    return c.json({ ok: false, error: 'Invalid JSON body' }, 400);
  }

  const secret = String(env.MOE_WEBHOOK_SECRET ?? '').trim();
  if (!secret) {
    return c.json({ ok: false, error: 'MOE_WEBHOOK_SECRET is not configured' }, 503);
  }
  if (String(payload.secret ?? '') !== secret) {
    return c.json({ ok: false, error: 'Unauthorized — invalid secret' }, 401);
  }
  if (!payload.symbol) return c.json({ ok: false, error: 'Missing field: symbol' }, 400);

  const action = payload.action
    ?? (payload.side === 'BUY' ? 'buy' : payload.side === 'SELL' ? 'sell' : undefined);
  if (!action || !['buy', 'sell', 'close'].includes(action)) {
    return c.json({ ok: false, error: 'Invalid signal — expected BUY or SELL' }, 400);
  }

  const symbol = payload.symbol.toUpperCase().replace(/[^A-Z0-9.-]/gu, '');
  if (!symbol) return c.json({ ok: false, error: 'Invalid symbol' }, 400);
  const side = action === 'buy' ? 'BUY' : 'SELL';
  const baseSignalId = payload.signalId
    ? `tv-${payload.signalId.slice(0, 150)}`
    : `tv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orderPrice = payload.price ?? payload.entry ?? payload.limitPrice;

  if (await getKillSwitch(env)) {
    return c.json({
      ok: false,
      accepted: false,
      symbol,
      side,
      code: 'KILL_SWITCH_ACTIVE',
      error: 'Kill Switch is engaged — no TradingView order can execute.',
    }, 423);
  }

  const [paperReception, liveReception] = await Promise.all([
    getMobileReceptionState(env, 'SANDBOX'),
    getMobileReceptionState(env, 'LIVE'),
  ]);
  const armedModes: TradingMode[] = [];
  if (paperReception.enabled) armedModes.push('SANDBOX');
  if (liveReception.enabled) armedModes.push('LIVE');

  if (armedModes.length === 0) {
    return c.json({
      ok: false,
      accepted: false,
      symbol,
      side,
      code: 'TRADINGVIEW_RECEPTION_DISABLED',
      error: 'TradingView reception is disabled for both Paper and Live accounts.',
    }, 423);
  }

  const executions = await Promise.all(armedModes.map(mode => executeForMode(env, mode, payload, {
    baseSignalId,
    symbol,
    side,
    orderPrice,
  })));
  const accepted = executions.some(result => result.accepted);
  const primary = executions[0];

  return c.json({
    ok: true,
    accepted,
    symbol,
    side,
    armedModes,
    executions,
    mode: executions.length === 1 ? primary?.mode : 'MULTI',
    qty: executions.length === 1 ? primary?.qty : undefined,
    orderId: executions.length === 1 ? primary?.orderId : undefined,
    orderStatus: executions.length === 1 ? primary?.orderStatus : undefined,
    error: accepted ? undefined : executions.map(result => result.error).filter(Boolean).join(' | '),
  });
});

webhook.get('/decisions', async c => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const mode = c.req.query('mode');
  try {
    const query = mode
      ? 'SELECT * FROM decisions WHERE mode = ? ORDER BY created_at DESC LIMIT ?'
      : 'SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?';
    const dbResult = mode
      ? await c.env.DB?.prepare(query).bind(mode, limit).all<Record<string, unknown>>()
      : await c.env.DB?.prepare(query).bind(limit).all<Record<string, unknown>>();

    const decisions = (dbResult?.results ?? []).map(row => ({
      signalId: row.signal_id,
      symbol: row.symbol,
      side: row.side,
      signal: row.signal,
      entry: row.entry,
      stop: row.stop,
      target: row.target,
      accepted: !!row.accepted,
      submitted: !!row.submitted,
      rejectReason: row.reject_reason,
      mode: row.mode,
      createdAt: row.created_at,
    }));
    return c.json({ decisions, total: decisions.length });
  } catch {
    return c.json({ decisions: [], total: 0 });
  }
});

export { webhook };
