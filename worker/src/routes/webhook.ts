// MOE-AI TradingView Webhook — receives alerts and executes on armed Webull accounts.
import { Hono } from 'hono';
import type { Decision, Env, TradingMode, TVWebhookPayload } from '../lib/types';
import { getKillSwitch } from '../lib/risk';
import { getLiveExecutionPolicy } from '../lib/live-control';
import { getMobileReceptionState } from '../lib/mobile-control';
import { WebullClient } from '../lib/webull';
import {
  startTradeProtection,
  stopTradeProtection,
} from '../lib/trade-protection-coordinator';
import {
  currentTradingWindow,
  getTradingSettings,
  isCurrentTradingWindowAllowed,
  isTradingSettingsConfigured,
  protectionPreview,
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
  protectionStarted?: boolean;
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
    return account.nightTradingBuyingPower > 0
      ? account.nightTradingBuyingPower
      : account.overnightBuyingPower > 0
        ? account.overnightBuyingPower
        : account.buyingPower;
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
    stopPrice?: number;
    targetPrice?: number;
  },
): Promise<ExecutionResult> {
  const { symbol, side, orderPrice, stopPrice, targetPrice } = normalized;
  const signalId = `${normalized.baseSignalId}-${mode.toLowerCase()}`.slice(0, 190);
  const settings = await getTradingSettings(env, mode);

  if (!isTradingSettingsConfigured(settings)) {
    return reject(env, {
      mode, signalId, symbol, side,
      error: 'Trading controls are not configured for this account.',
    }, orderPrice, stopPrice, targetPrice);
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
      }, orderPrice, stopPrice, targetPrice);
    }
  }

  const market = currentTradingWindow();
  if (!market.webullSession || !isCurrentTradingWindowAllowed(settings, market)) {
    return reject(env, {
      mode, signalId, symbol, side,
      error: `Current trading window is not enabled for ${mode}: ${market.label}.`,
    }, orderPrice, stopPrice, targetPrice);
  }
  if (market.webullSession !== 'CORE') {
    return reject(env, {
      mode, signalId, symbol, side,
      error: 'Broker-managed Stop Loss, Take Profit, and trailing protection currently require CORE regular trading hours.',
    }, orderPrice, stopPrice, targetPrice);
  }

  const client = WebullClient.fromEnv(env, mode);
  if (!client) {
    return reject(env, {
      mode, signalId, symbol, side,
      error: `${mode} Webull credentials are not configured.`,
    }, orderPrice, stopPrice, targetPrice);
  }

  // MOE-AI is long-only: every SELL signal closes the existing long position.
  const isClose = side === 'SELL' || payload.action === 'close' || payload.closePosition === true;
  let qty = 0;
  let executionPrice = Number(orderPrice ?? 0);
  let estimatedTotal: number | undefined;
  let estimatedTransactionFee: number | undefined;
  let maxQty: number | undefined;
  let protectionPausedForClose = false;

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
        }, orderPrice, stopPrice, targetPrice);
      }
      qty = Math.floor(position.quantity);
      if (!(executionPrice > 0)) executionPrice = Number(position.currentPrice ?? position.averagePrice);
    } else {
      if (!(executionPrice > 0)) {
        return reject(env, {
          mode, signalId, symbol, side,
          error: 'TradingView BUY alerts must include a valid price.',
        }, orderPrice, stopPrice, targetPrice);
      }

      if (settings.blockIfPosition) {
        const positions = await client.getPositions();
        if (positions.some(item => item.symbol === symbol && item.quantity > 0)) {
          return reject(env, {
            mode, signalId, symbol, side,
            error: `A position in ${symbol} is already open; duplicate BUY was blocked.`,
          }, orderPrice, stopPrice, targetPrice);
        }
      }

      const account = await client.getAccount();
      const buyingPower = availableBuyingPower(account);
      maxQty = maximumQuantity(settings, executionPrice, buyingPower);
      qty = maxQty;
      if (qty < 1) {
        return reject(env, {
          mode, signalId, symbol, side,
          maximumQuantityToBuy: maxQty,
          error: 'Configured share quantity, trade cap, or buying power does not allow one share.',
        }, orderPrice, stopPrice, targetPrice);
      }
    }

    if (!(executionPrice > 0)) {
      return reject(env, {
        mode, signalId, symbol, side, qty,
        error: 'A valid price is required to preview and submit this order.',
      }, orderPrice, stopPrice, targetPrice);
    }

    const preview = await client.previewOrder({
      symbol,
      side,
      type: 'MARKET',
      qty,
      price: executionPrice,
      idempotencyKey: `${signalId}-preview`,
      tradingSession: 'CORE',
      timeInForce: settings.timeInForce,
    });
    estimatedTotal = preview.estimatedCost;
    estimatedTransactionFee = preview.estimatedTransactionFee;

    if (isClose) {
      // Cancel existing TP/SL/trailing orders only after preview succeeds, so
      // the time without broker protection is limited to the close submission.
      await stopTradeProtection(env, mode, symbol);
      protectionPausedForClose = true;
    }

    const result = await client.placeOrder({
      symbol,
      side,
      type: 'MARKET',
      qty,
      price: executionPrice,
      idempotencyKey: signalId,
      tradingSession: 'CORE',
      timeInForce: settings.timeInForce,
    });

    let orderStatus = result.status;
    let configuredStop: number | undefined;
    let configuredTarget: number | undefined;
    let protectionStarted = false;

    if (!isClose && side === 'BUY') {
      const configured = protectionPreview(settings, executionPrice);
      configuredStop = configured.stopLossPrice;
      configuredTarget = configured.takeProfitPrice;
      const protection = await startTradeProtection(env, {
        mode,
        symbol,
        signalId,
        quantity: qty,
        settings,
      });
      protectionStarted = protection.ok;
      if (!protection.ok) {
        const message = `Entry submitted but trade protection coordinator failed to arm: ${JSON.stringify(protection.body)}`;
        await persistDecision(env, {
          signalId,
          symbol,
          side,
          signal: 'BUY NOW',
          entry: executionPrice,
          stop: configuredStop,
          target: configuredTarget,
          accepted: true,
          submitted: true,
          rejectReason: message,
          reasons: [message],
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
          orderStatus,
          protectionStarted: false,
          estimatedTotal,
          estimatedTransactionFee,
          maximumQuantityToBuy: maxQty,
          error: message,
        };
      }
      orderStatus = `${orderStatus}; PROTECTION_ARMED`;
    }

    await persistDecision(env, {
      signalId,
      symbol,
      side,
      signal: side === 'BUY' ? 'BUY NOW' : 'SELL NOW',
      entry: executionPrice,
      stop: configuredStop ?? stopPrice,
      target: configuredTarget ?? targetPrice,
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
      orderStatus,
      protectionStarted: isClose ? undefined : protectionStarted,
      estimatedTotal,
      estimatedTransactionFee,
      maximumQuantityToBuy: maxQty,
    };
  } catch (error) {
    if (protectionPausedForClose && qty > 0) {
      try {
        await startTradeProtection(env, {
          mode,
          symbol,
          signalId: `${signalId}-restore`.slice(0, 190),
          quantity: qty,
          settings,
        });
      } catch {
        // The primary close failure remains the user-visible error. The Durable
        // Object keeps its own diagnostics if restoring protection also fails.
      }
    }
    return reject(env, {
      mode, signalId, symbol, side, qty: qty || undefined,
      estimatedTotal,
      estimatedTransactionFee,
      maximumQuantityToBuy: maxQty,
      error: String(error),
    }, executionPrice || orderPrice, stopPrice, targetPrice);
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
  const stopPrice = payload.stop ?? payload.stopLoss;
  const targetPrice = payload.target ?? payload.takeProfit;

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
    stopPrice,
    targetPrice,
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
    // Compatibility fields for the existing mobile notification middleware.
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
