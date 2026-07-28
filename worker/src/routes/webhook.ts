// MOE-AI TradingView Webhook — receives signals, runs risk checks, stores decisions
import { Hono } from 'hono';
import type { Env, TVWebhookPayload, Decision } from '../lib/types';
import { getKillSwitch, getRiskConfig } from '../lib/risk';

const webhook = new Hono<{ Bindings: Env }>();

// POST /api/tradingview/webhook  — receives TradingView alerts
webhook.post('/webhook', async (c) => {
  const env = c.env;
  let payload: TVWebhookPayload;
  try { payload = await c.req.json<TVWebhookPayload>(); }
  catch { return c.json({ error: 'Invalid JSON body' }, 400); }

  // Verify webhook secret
  const secret = env.MOE_WEBHOOK_SECRET;
  if (secret && payload.secret !== secret)
    return c.json({ error: 'Invalid webhook secret' }, 401);

  if (!payload.symbol) return c.json({ error: 'Missing symbol' }, 400);

  const symbol = payload.symbol.toUpperCase().replace(/[^A-Z0-9.-]/, '');
  const mode   = 'SANDBOX'; // always sandbox for incoming webhooks unless live mode armed
  const signalId = `tv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  // ── Risk checks ─────────────────────────────────────────────────────────
  const killSwitch = await getKillSwitch(env);
  const reasons: string[] = [];
  let accepted = true;

  if (killSwitch) { reasons.push('Kill switch is engaged'); accepted = false; }

  const score  = payload.score  ?? 0;
  const cfg    = getRiskConfig(env);
  if (score < 60) { reasons.push(`Score ${score} below threshold (60)`); accepted = false; }

  // Check daily trade limit from DB
  let dailyTrades = 0;
  try {
    const today = new Date().toISOString().slice(0, 10);
    const row = await env.DB?.prepare(
      `SELECT COUNT(*) as cnt FROM decisions WHERE DATE(created_at) = ? AND accepted = 1 AND mode = ?`
    ).bind(today, mode).first<{ cnt: number }>();
    dailyTrades = row?.cnt ?? 0;
  } catch {}

  if (dailyTrades >= cfg.maxDailyTrades) {
    reasons.push(`Daily trade limit reached (${dailyTrades}/${cfg.maxDailyTrades})`);
    accepted = false;
  }

  // ── Build decision record ─────────────────────────────────────────────
  const decision: Decision = {
    signalId,
    symbol,
    side:         payload.action === 'buy' ? 'BUY' : payload.action === 'sell' ? 'SELL' : undefined,
    signal:       (payload.signal as Decision['signal']) ?? (payload.action === 'buy' ? 'BUY NOW' : payload.action === 'sell' ? 'SELL NOW' : 'HOLD'),
    score:        payload.score,
    entry:        payload.entry ?? payload.price,
    stop:         payload.stop,
    target:       payload.target,
    accepted,
    submitted:    false,
    rejectReason: accepted ? undefined : reasons.join('; '),
    reasons,
    mode,
    createdAt:    new Date().toISOString(),
  };

  // ── Persist to D1 ────────────────────────────────────────────────────
  try {
    await env.DB?.prepare(`
      INSERT INTO decisions (signal_id, symbol, side, signal, score, entry, stop, target,
        accepted, submitted, reject_reason, reasons, mode, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      signalId, symbol,
      decision.side ?? null, decision.signal ?? null,
      decision.score ?? null, decision.entry ?? null,
      decision.stop ?? null, decision.target ?? null,
      accepted ? 1 : 0, 0,
      decision.rejectReason ?? null,
      JSON.stringify(reasons),
      mode, decision.createdAt,
    ).run();
  } catch (err) {
    console.error('Failed to persist decision:', err);
  }

  // ── Log alert ────────────────────────────────────────────────────────
  try {
    await env.DB?.prepare(
      `INSERT INTO alerts (type, symbol, message, price, mode) VALUES (?, ?, ?, ?, ?)`
    ).bind(
      accepted ? 'BUY' : 'SYSTEM',
      symbol,
      accepted
        ? `🟢 إشارة مقبولة: ${symbol} ${decision.signal} @ ${decision.entry ?? payload.price ?? '—'}`
        : `🔴 إشارة مرفوضة: ${symbol} — ${decision.rejectReason}`,
      payload.price ?? payload.entry ?? null,
      mode,
    ).run();
  } catch {}

  return c.json({ signalId, accepted, decision });
});

// GET /api/tradingview/decisions — fetch recent decisions
webhook.get('/decisions', async (c) => {
  const env   = c.env;
  const limit = Math.min(Number(c.req.query('limit') ?? 50), 200);
  const mode  = c.req.query('mode');

  try {
    const query = mode
      ? `SELECT * FROM decisions WHERE mode = ? ORDER BY created_at DESC LIMIT ?`
      : `SELECT * FROM decisions ORDER BY created_at DESC LIMIT ?`;
    const dbResult = mode
      ? await env.DB?.prepare(query).bind(mode, limit).all<Record<string, unknown>>()
      : await env.DB?.prepare(query).bind(limit).all<Record<string, unknown>>();

    const decisions = (dbResult?.results ?? []).map((r: Record<string, unknown>) => ({
      signalId:     r.signal_id,
      symbol:       r.symbol,
      side:         r.side,
      signal:       r.signal,
      score:        r.score,
      entry:        r.entry,
      stop:         r.stop,
      target:       r.target,
      accepted:     !!r.accepted,
      submitted:    !!r.submitted,
      rejectReason: r.reject_reason,
      reasons:      r.reasons ? JSON.parse(r.reasons as string) : [],
      mode:         r.mode,
      createdAt:    r.created_at,
    }));

    return c.json({ decisions, total: decisions.length });
  } catch {
    // D1 not provisioned yet — return empty
    return c.json({ decisions: [], total: 0 });
  }
});

export { webhook };
