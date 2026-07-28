// MOE-AI Trading Routes — account, positions, orders, mode, kill-switch
import { Hono } from 'hono';
import type { Env, TradingMode } from '../lib/types';
import { WebullClient } from '../lib/webull';
import {
  computeRiskState, checkLiveSafetyGates,
  getKillSwitch, setKillSwitch,
  getTradingMode, setTradingMode,
} from '../lib/risk';

const trading = new Hono<{ Bindings: Env }>();

// ── Dashboard (composite: account + positions + orders) ───────────────────────
trading.get('/:mode/dashboard', async (c) => {
  const env  = c.env;
  const modeParam = (c.req.param('mode').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  const client    = WebullClient.fromEnv(env, modeParam);
  const ks        = await getKillSwitch(env);

  if (!client) {
    const readiness = modeParam === 'LIVE'
      ? await checkLiveSafetyGates(env, false, 0)
      : { ready: false, missingSecrets: ['WEBULL_SANDBOX_APP_KEY', 'WEBULL_SANDBOX_ACCESS_TOKEN', 'WEBULL_SANDBOX_ACCOUNT_ID'], gates: {} };

    return c.json({
      account:   {},
      positions: [],
      orders:    [],
      safety: {
        webullConnected: false,
        webullMode:      'DISCONNECTED',
        killSwitch:      ks,
        mode:            modeParam,
        executionAllowed: false,
      },
      readiness,
      updatedAt: new Date().toISOString(),
    });
  }

  const [account, positions, orders] = await Promise.allSettled([
    client.getAccount(),
    client.getPositions(),
    client.getOrders(),
  ]);

  const acct = account.status   === 'fulfilled' ? account.value   : {};
  const pos  = positions.status === 'fulfilled' ? positions.value : [];
  const ord  = orders.status    === 'fulfilled' ? orders.value    : [];
  const risk = await computeRiskState(env, modeParam, pos, (acct as { accountValue?: number }).accountValue ?? 0);
  const executionAllowed = !ks && !risk.locked;

  const payload: Record<string, unknown> = {
    account: acct,
    positions: pos,
    orders: ord,
    risk,
    safety: {
      webullConnected:  true,
      webullMode:       modeParam,
      killSwitch:       ks,
      mode:             modeParam,
      executionAllowed,
      observationOnly:  !executionAllowed,
    },
    updatedAt: new Date().toISOString(),
  };

  if (modeParam === 'LIVE') {
    const readiness = await checkLiveSafetyGates(env, pos.length > 0, (acct as { accountValue?: number }).accountValue ?? 0);
    payload.readiness = readiness;
  }

  return c.json(payload);
});

// ── Individual account / positions / orders ───────────────────────────────────
trading.get('/:mode/account', async (c) => {
  const mode   = (c.req.param('mode').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  const client = WebullClient.fromEnv(c.env, mode);
  if (!client) return c.json({ error: `${mode} credentials not configured` }, 503);
  try   { return c.json(await client.getAccount()); }
  catch (e) { return c.json({ error: String(e) }, 502); }
});

trading.get('/:mode/positions', async (c) => {
  const mode   = (c.req.param('mode').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  const client = WebullClient.fromEnv(c.env, mode);
  if (!client) return c.json({ data: [], error: `${mode} credentials not configured` }, 503);
  try   { return c.json({ data: await client.getPositions() }); }
  catch (e) { return c.json({ data: [], error: String(e) }, 502); }
});

trading.get('/:mode/orders', async (c) => {
  const mode   = (c.req.param('mode').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  const client = WebullClient.fromEnv(c.env, mode);
  if (!client) return c.json({ data: [], error: `${mode} credentials not configured` }, 503);
  try   { return c.json({ data: await client.getOrders() }); }
  catch (e) { return c.json({ data: [], error: String(e) }, 502); }
});

// ── Place order ────────────────────────────────────────────────────────────────
trading.post('/orders', async (c) => {
  const env  = c.env;
  const body = await c.req.json<{
    symbol: string; side: 'BUY'|'SELL'; type: string; quantity: number;
    price?: number; stopPrice?: number; mode: string; idempotencyKey: string;
  }>();

  const mode = (body.mode?.toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  const ks   = await getKillSwitch(env);
  if (ks)    return c.json({ error: 'Kill switch is engaged' }, 403);

  // Idempotency check
  try {
    const existing = await env.DB?.prepare('SELECT id FROM orders WHERE idempotency_key = ?')
      .bind(body.idempotencyKey).first<{ id: string }>();
    if (existing) return c.json({ orderId: existing.id, status: 'ALREADY_SUBMITTED' });
  } catch {}

  const client = WebullClient.fromEnv(env, mode);
  if (!client) return c.json({ error: `${mode} credentials not configured` }, 503);

  try {
    const result = await client.placeOrder({
      symbol: body.symbol, side: body.side,
      type:   body.type as 'MARKET'|'LIMIT', qty: body.quantity,
      price:  body.price, stop: body.stopPrice,
      idempotencyKey: body.idempotencyKey,
    });

    await env.DB?.prepare(
      `INSERT OR IGNORE INTO orders
         (webull_id, symbol, side, type, quantity, price, stop_price, status, mode, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(result.orderId, body.symbol, body.side, body.type, body.quantity,
      body.price ?? null, body.stopPrice ?? null, result.status, mode, body.idempotencyKey,
    ).run();

    return c.json(result);
  } catch (e) { return c.json({ error: String(e) }, 502); }
});

// ── Trades history ─────────────────────────────────────────────────────────────
trading.get('/trades', async (c) => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const mode  = c.req.query('mode');
  try {
    const query = mode
      ? `SELECT * FROM trades WHERE mode = ? ORDER BY opened_at DESC LIMIT ?`
      : `SELECT * FROM trades ORDER BY opened_at DESC LIMIT ?`;
    const dbResult = mode
      ? await c.env.DB?.prepare(query).bind(mode, limit).all<Record<string, unknown>>()
      : await c.env.DB?.prepare(query).bind(limit).all<Record<string, unknown>>();

    const trades = (dbResult?.results ?? []).map(r => ({
      id:         r.id,
      symbol:     r.symbol,
      side:       r.side,
      quantity:   r.quantity,
      entryPrice: r.entry_price,
      exitPrice:  r.exit_price,
      pnl:        r.pnl,
      pnlPct:     r.pnl_pct,
      stopLoss:   r.stop_loss,
      takeProfit: r.take_profit,
      signal:     r.signal,
      status:     r.status,
      mode:       r.mode,
      openedAt:   r.opened_at,
      closedAt:   r.closed_at,
    }));
    return c.json({ trades, total: trades.length });
  } catch {
    return c.json({ trades: [], total: 0 });
  }
});

// ── Live readiness ─────────────────────────────────────────────────────────────
trading.get('/live/readiness', async (c) => {
  const env  = c.env;
  const live = WebullClient.fromEnv(env, 'LIVE');
  let accountValue = 0;
  let hasPositions = false;
  if (live) {
    try {
      const [acct, pos] = await Promise.allSettled([live.getAccount(), live.getPositions()]);
      if (acct.status === 'fulfilled') accountValue = acct.value.accountValue;
      if (pos.status  === 'fulfilled') hasPositions = pos.value.length > 0;
    } catch {}
  }
  return c.json(await checkLiveSafetyGates(env, hasPositions, accountValue));
});

// ── Trading mode (SANDBOX / LIVE) ──────────────────────────────────────────────
trading.get('/mode', async (c) => {
  const mode = await getTradingMode(c.env);
  const ks   = await getKillSwitch(c.env);
  return c.json({ mode, killSwitch: ks });
});

trading.post('/mode', async (c) => {
  const body = await c.req.json<{ mode: string }>();
  const mode = (body.mode?.toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  await setTradingMode(c.env, mode);
  return c.json({ success: true, mode });
});

// ── Kill switch ────────────────────────────────────────────────────────────────
trading.get('/kill-switch', async (c) => {
  const enabled = await getKillSwitch(c.env);
  return c.json({ killSwitch: enabled });
});

trading.post('/kill-switch', async (c) => {
  const body = await c.req.json<{ enabled: boolean }>();
  await setKillSwitch(c.env, !!body.enabled);
  return c.json({ success: true, killSwitch: !!body.enabled });
});

export { trading };
