// MOE-AI TradingView Webhook — receives alerts and executes on Webull
import { Hono } from 'hono';
import type { Env, TVWebhookPayload, Decision } from '../lib/types';
import { getKillSwitch, getTradingMode } from '../lib/risk';
import { WebullClient } from '../lib/webull';

const webhook = new Hono<{ Bindings: Env }>();

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
  if (!payload.action || !['buy', 'sell', 'close'].includes(payload.action))
    return c.json({ error: 'Invalid action — must be: buy | sell | close' }, 400);

  const symbol   = payload.symbol.toUpperCase().replace(/[^A-Z0-9.-]/g, '');
  const signalId = `tv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

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
  const side = (payload.action === 'buy' ? 'BUY' : 'SELL') as 'BUY' | 'SELL';
  const qty  = Math.max(1, Math.round(Number(payload.qty ?? 1)));
  const type = ((payload.type ?? 'MARKET') as string).toUpperCase() as 'MARKET' | 'LIMIT';

  // ── Place order on Webull ────────────────────────────────────────────────
  let orderId   = '';
  let orderStatus = '';
  let execError = '';

  try {
    const result = await client.placeOrder({
      symbol, side, type, qty,
      price: payload.price ?? payload.entry,
      stop:  payload.stop,
      idempotencyKey: signalId,
    });
    orderId     = result.orderId;
    orderStatus = result.status;
    console.log(`[Webhook] ✓ ${side} ${qty} ${symbol} @ ${mode} — order ${orderId} (${orderStatus})`);
  } catch (err) {
    execError = String(err);
    console.error(`[Webhook] ✗ Order failed for ${symbol}:`, err);
  }

  const accepted = !execError;

  // ── Build decision record ────────────────────────────────────────────────
  const decision: Decision = {
    signalId, symbol, side,
    signal:       side === 'BUY' ? 'BUY NOW' : 'SELL NOW',
    entry:        payload.entry ?? payload.price,
    stop:         payload.stop,
    target:       payload.target,
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
