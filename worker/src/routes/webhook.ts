// MOE-AI TradingView Webhook — receives alerts and executes on Webull
import { Hono } from 'hono';
import type { Env, TVWebhookPayload, Decision } from '../lib/types';
import { getKillSwitch, getTradingMode } from '../lib/risk';
import { WebullClient } from '../lib/webull';

const webhook = new Hono<{ Bindings: Env }>();
const SETTINGS_KEY = 'trading:settings';
const defaultTradingSettings = {
  sizingSource: 'cash',
  maxCashPct: 25,
  maxPositionUsd: 0,
  stopLossEnabled: true,
  stopLossPct: 2,
  blockIfPosition: true,
  sessionOpenOnly: true,
  sessionTz: 'America/Chicago',
  sessionStart: '08:30',
  sessionEnd: '15:00',
};

async function getTradingSettings(env: Env) {
  if (!env.CONFIG) return defaultTradingSettings;
  try {
    const saved = await env.CONFIG.get(SETTINGS_KEY, 'json') as Partial<typeof defaultTradingSettings> | null;
    return { ...defaultTradingSettings, ...(saved ?? {}) };
  } catch {
    return defaultTradingSettings;
  }
}

// ── Regular-session gate ──────────────────────────────────────────────────────
// Opening trades is only allowed inside the configured session window
// (default 08:30–15:00 America/Chicago, Mon–Fri). Closing is always allowed.
function isWithinSession(env: Env): { ok: boolean; now: string; window: string } {
  const tz    = env.SESSION_TZ || 'America/Chicago';
  const start = env.SESSION_START || '08:30';
  const end   = env.SESSION_END   || '15:00';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false, weekday: 'short', hour: '2-digit', minute: '2-digit',
  }).formatToParts(new Date());
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const weekday = get('weekday');
  const hh = Number(get('hour') === '24' ? '0' : get('hour'));
  const mm = Number(get('minute'));
  const nowMin = hh * 60 + mm;
  const [sH, sM] = start.split(':').map(Number);
  const [eH, eM] = end.split(':').map(Number);
  const isWeekday = !['Sat', 'Sun'].includes(weekday);
  const ok = isWeekday && nowMin >= sH * 60 + sM && nowMin < eH * 60 + eM;
  const pad = (n: number) => String(n).padStart(2, '0');
  return { ok, now: `${weekday} ${pad(hh)}:${pad(mm)} (${tz})`, window: `${start}–${end} ${tz}, Mon–Fri` };
}

// ── POST /api/tradingview/webhook ─────────────────────────────────────────────
// Called by TradingView when an alert fires. Validates the secret, checks the
// kill switch, determines SANDBOX vs LIVE mode, then places the order on Webull.
//
// Expected JSON body:
// {
//   "secret":   "your-MOE_WEBHOOK_SECRET",
//   "symbol":   "{{ticker}}",
//   "action":   "buy" | "sell" | "close",
//   "qty":      10,              // optional — integer shares
//   "price":    {{close}},       // optional — for LIMIT orders
//   "entry":    {{close}},       // optional — alias for price
//   "stop":     {{low}},         // optional — stop loss price
//   "target":   0,               // optional — take profit price
//   "type":     "MARKET"         // optional — MARKET | LIMIT (default MARKET)
// }

webhook.post('/webhook', async (c) => {
  const env = c.env;
  const settings = await getTradingSettings(env);
  let payload: TVWebhookPayload;
  try {
    payload = await c.req.json<TVWebhookPayload>();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // ── Validate secret ──────────────────────────────────────────────────────
  const secret = env.MOE_WEBHOOK_SECRET;
  if (secret && payload.secret !== secret) {
    return c.json({ error: 'Unauthorized — invalid secret' }, 401);
  }

  if (!payload.symbol) return c.json({ error: 'Missing field: symbol' }, 400);

  // Accept both the dashboard format (action/price/stop/target) and the
  // MOERAND TradingView indicator format (side/orderType/limitPrice/stopLoss/takeProfit).
  const action = payload.action
    ?? (payload.side === 'BUY' ? 'buy' : payload.side === 'SELL' ? 'sell' : undefined);
  if (!action || !['buy', 'sell', 'close'].includes(action))
    return c.json({ error: 'Invalid signal — expected action or side BUY/SELL' }, 400);

  const symbol   = payload.symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const signalId = payload.signalId
    ? `tv-${payload.signalId.slice(0, 180)}`
    : `tv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orderPrice = payload.price ?? payload.entry ?? payload.limitPrice;
  const stopPrice  = payload.stop ?? payload.stopLoss;
  const targetPrice = payload.target ?? payload.takeProfit;

  // ── Kill switch ──────────────────────────────────────────────────────────
  const killSwitch = await getKillSwitch(env);
  if (killSwitch) {
    console.log(`[Webhook] ${symbol} rejected — kill switch engaged`);
    return c.json({
      signalId, accepted: false,
      reason: 'Kill switch is engaged — no orders will execute until it is disarmed',
    });
  }

  // ── Determine trading mode ───────────────────────────────────────────────
  const mode   = await getTradingMode(env);
  const client = WebullClient.fromEnv(env, mode);

  if (!client) {
    console.warn(`[Webhook] ${symbol} — ${mode} Webull credentials not configured`);
    return c.json({
      signalId, accepted: false,
      reason: `${mode} Webull credentials are not set in Cloudflare Secrets`,
    });
  }

  // ── Build order ──────────────────────────────────────────────────────────
  const side = (action === 'buy' ? 'BUY' : 'SELL') as 'BUY' | 'SELL';
  const type = ((payload.type ?? payload.orderType ?? 'MARKET') as string).toUpperCase() as 'MARKET' | 'LIMIT';

  // ── Smart position sizing ─────────────────────────────────────────────────
  // Close semantics: action "close", or SELL with closePosition:true → sell the
  // actual held quantity. Never opens a short; rejects if no position exists.
  // Otherwise: explicit qty is honoured, else qty = floor(buyingPower × RISK_PCT% ÷ price).
  const isClose = action === 'close' || (side === 'SELL' && payload.closePosition === true);
  let qty: number;
  if (isClose) {
    try {
      const positions = await client.getPositions();
      const pos = positions.find(p => p.symbol === symbol && p.side === 'LONG' && p.quantity > 0);
      if (!pos) {
        console.log(`[Webhook] ${symbol} close rejected — no open long position`);
        return c.json({ signalId, accepted: false, reason: `No open long position in ${symbol} to close` });
      }
      qty = Math.floor(pos.quantity);
      console.log(`[Webhook] close qty from position: ${qty} ${symbol}`);
    } catch (err) {
      console.error(`[Webhook] ${symbol} close rejected — failed to fetch positions:`, err);
      return c.json({ signalId, accepted: false, reason: 'Failed to fetch positions to close — order not placed' });
    }
  } else {
    // ── Opening a new trade ─────────────────────────────────────────────────
    // 1. Session gate — new trades only inside the regular-session window.
    if (settings.sessionOpenOnly) {
      const session = isWithinSession({
        ...env,
        SESSION_TZ: settings.sessionTz,
        SESSION_START: settings.sessionStart,
        SESSION_END: settings.sessionEnd,
      });
      if (!session.ok) {
        console.log(`[Webhook] ${symbol} open rejected — outside session (now ${session.now}, window ${session.window})`);
        return c.json({
          signalId, accepted: false,
          reason: `Outside trading session — new trades allowed only ${session.window} (now: ${session.now}). Open positions still close on SELL signals.`,
        });
      }
    }

    // 2. One position per symbol — reject BUY if the symbol is already held.
    if (side === 'BUY' && settings.blockIfPosition) {
      try {
        const positions = await client.getPositions();
        const existing = positions.find(p => p.symbol === symbol && p.quantity > 0);
        if (existing) {
          console.log(`[Webhook] ${symbol} BUY rejected — position already open (${existing.quantity} shares)`);
          return c.json({
            signalId, accepted: false,
            reason: `Position already open in ${symbol} (${existing.quantity} shares) — BUY skipped`,
          });
        }
      } catch (err) {
        console.warn(`[Webhook] ${symbol} — position check failed, continuing:`, err);
      }
    }

    // 3. Sizing — from CASH balance by default (no margin / no intraday BP).
    if (payload.qty != null) {
      qty = Math.max(1, Math.round(Number(payload.qty)));
      console.log(`[Webhook] qty from alert: ${qty}`);
    } else {
      const price = Number(orderPrice ?? 0);
      if (!(price > 0)) {
        return c.json({
          signalId, accepted: false,
          reason: 'No price in alert — add "price": {{close}} to your TradingView alert so position size can be calculated',
        });
      }
      try {
        const acct = await client.getAccount();
        const useBuyingPower = settings.sizingSource === 'buying_power';
        const base = useBuyingPower
          ? (acct.buyingPower > 0 ? acct.buyingPower : acct.cash)
          : acct.cash;
        const allocPct = settings.maxCashPct / 100;
        let budget = base * allocPct;
        const capUsd = settings.maxPositionUsd;
        if (capUsd > 0) budget = Math.min(budget, capUsd);
        qty = Math.floor(budget / price);
        console.log(`[Webhook] cash sizing: floor(min($${base.toFixed(2)} × ${(allocPct*100).toFixed(0)}%${capUsd > 0 ? `, $${capUsd}` : ''}) ÷ $${price}) = ${qty} (${useBuyingPower ? 'buying power' : 'cash'})`);
        if (qty < 1) {
          return c.json({
            signalId, accepted: false,
            reason: `Insufficient ${useBuyingPower ? 'buying power' : 'cash'} — budget $${budget.toFixed(2)} < 1 share at $${price}`,
          });
        }
      } catch (err) {
        console.error(`[Webhook] ${symbol} open rejected — balance fetch failed:`, err);
        return c.json({ signalId, accepted: false, reason: 'Failed to fetch account balance — order not placed' });
      }
    }
  }

  // Apply the application-level protective stop to every new BUY. It is
  // calculated from the alert's entry price, so the user-controlled loss
  // limit is consistent across TradingView alerts.
  let protectiveStop = stopPrice;
  if (!isClose && side === 'BUY' && settings.stopLossEnabled) {
    const entryForStop = Number(orderPrice ?? 0);
    if (!(entryForStop > 0)) {
      return c.json({
        signalId, accepted: false,
        reason: 'No price in alert — a price is required to calculate the configured stop loss',
      });
    }
    protectiveStop = entryForStop * (1 - settings.stopLossPct / 100);
  }

  // ── Place order on Webull ────────────────────────────────────────────────
  let orderId   = '';
  let orderStatus = '';
  let execError = '';

  try {
    const result = await client.placeOrder({
      symbol, side, type, qty,
       price: orderPrice,
       // The protective stop is submitted as a separate SELL STOP_LOSS order
       // below, never mixed into the MARKET entry request.
       stop:  undefined,
      idempotencyKey: signalId,
    });
    orderId     = result.orderId;
    orderStatus = result.status;
    console.log(`[Webhook] ✓ ${side} ${qty} ${symbol} @ ${mode} — order ${orderId} (${orderStatus})`);

    if (!isClose && side === 'BUY' && protectiveStop != null) {
      try {
        const stopResult = await client.placeProtectiveStop({
          symbol,
          qty,
          stop: protectiveStop,
          idempotencyKey: `${signalId}-SL`,
        });
        console.log(`[Webhook] ✓ protective stop ${qty} ${symbol} @ ${protectiveStop.toFixed(4)} — order ${stopResult.orderId} (${stopResult.status})`);
        orderStatus = `${orderStatus}; STOP_LOSS ${stopResult.status}`;
      } catch (stopErr) {
        // The BUY already executed. Report the protection failure explicitly so
        // the operator can close or protect the position manually.
        execError = `Entry filled but protective stop failed: ${String(stopErr)}`;
        console.error(`[Webhook] ✗ Protective stop failed for ${symbol}:`, stopErr);
      }
    }
  } catch (err) {
    execError = String(err);
    console.error(`[Webhook] ✗ Order failed for ${symbol}:`, err);
  }

  const accepted = !execError;

  // ── Build decision record ────────────────────────────────────────────────
  const decision: Decision = {
    signalId, symbol, side,
    signal:       side === 'BUY' ? 'BUY NOW' : 'SELL NOW',
    entry:        orderPrice,
    stop:         protectiveStop,
    target:       targetPrice,
    accepted,
    submitted:    accepted,
    rejectReason: execError || undefined,
    reasons:      execError ? [execError] : [],
    mode,
    createdAt:    new Date().toISOString(),
  };

  // ── Persist to D1 (optional) ─────────────────────────────────────────────
  try {
    await env.DB?.prepare(`
      INSERT INTO decisions
        (signal_id, symbol, side, signal, entry, stop, target, accepted, submitted, reject_reason, mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      signalId, symbol, side, decision.signal ?? null,
      decision.entry ?? null, decision.stop ?? null, decision.target ?? null,
      accepted ? 1 : 0, accepted ? 1 : 0,
      decision.rejectReason ?? null, mode, decision.createdAt,
    ).run();
  } catch { /* D1 not provisioned — continue without persistence */ }

  return c.json({
    signalId,
    accepted,
    mode,
    symbol,
    side,
    qty,
    orderId:     orderId     || undefined,
    orderStatus: orderStatus || undefined,
    error:       execError   || undefined,
  });
});

// ── GET /api/tradingview/decisions ────────────────────────────────────────────
// Returns recent alert decisions stored in D1 (empty if D1 not provisioned).
webhook.get('/decisions', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const mode  = c.req.query('mode');
  try {
    const query = mode
      ? `SELECT * FROM decisions WHERE mode = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?`;
    const dbResult = mode
      ? await c.env.DB?.prepare(query).bind(mode, limit).all<Record<string, unknown>>()
      : await c.env.DB?.prepare(query).bind(limit).all<Record<string, unknown>>();

    const decisions = (dbResult?.results ?? []).map(r => ({
      signalId:     r.signal_id,
      symbol:       r.symbol,
      side:         r.side,
      signal:       r.signal,
      entry:        r.entry,
      stop:         r.stop,
      target:       r.target,
      accepted:     !!r.accepted,
      submitted:    !!r.submitted,
      rejectReason: r.reject_reason,
      mode:         r.mode,
      createdAt:    r.created_at,
    }));
    return c.json({ decisions, total: decisions.length });
  } catch {
    return c.json({ decisions: [], total: 0 });
  }
});

export { webhook };
