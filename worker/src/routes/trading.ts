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

// ── Position sizing settings ───────────────────────────────────────────────────
// Stored in the optional CONFIG KV namespace so the value set in the app is
// shared by TradingView webhooks and survives Worker restarts.
const SETTINGS_KEY = 'trading:settings';
type TradingSettings = {
  sizingSource: 'cash' | 'buying_power';
  maxCashPct: number;
  maxPositionUsd: number;
  stopLossEnabled: boolean;
  stopLossPct: number;
  blockIfPosition: boolean;
  sessionOpenOnly: boolean;
  sessionTz: string;
  sessionStart: string;
  sessionEnd: string;
};

const defaultSettings: TradingSettings = {
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

trading.get('/settings', async (c) => {
  let settings = defaultSettings;
  if (c.env.CONFIG) {
    try {
      const saved = await c.env.CONFIG.get(SETTINGS_KEY, 'json') as Partial<typeof defaultSettings> | null;
      if (saved) settings = { ...defaultSettings, ...saved };
    } catch { /* use defaults when KV is unavailable */ }
  }
  return c.json({ settings, persisted: !!c.env.CONFIG });
});

trading.post('/settings', async (c) => {
  const body = await c.req.json<Partial<typeof defaultSettings>>();
  const settings = {
    sizingSource: body.sizingSource === 'buying_power' ? ('buying_power' as const) : ('cash' as const),
    maxCashPct: Math.max(1, Math.min(100, Number(body.maxCashPct ?? defaultSettings.maxCashPct))),
    maxPositionUsd: Math.max(0, Number(body.maxPositionUsd ?? defaultSettings.maxPositionUsd)),
    stopLossEnabled: body.stopLossEnabled !== false,
    stopLossPct: Math.max(0.1, Math.min(50, Number(body.stopLossPct ?? defaultSettings.stopLossPct))),
    blockIfPosition: body.blockIfPosition !== false,
    sessionOpenOnly: body.sessionOpenOnly !== false,
    sessionTz: typeof body.sessionTz === 'string' ? body.sessionTz : defaultSettings.sessionTz,
    sessionStart: typeof body.sessionStart === 'string' ? body.sessionStart : defaultSettings.sessionStart,
    sessionEnd: typeof body.sessionEnd === 'string' ? body.sessionEnd : defaultSettings.sessionEnd,
  };
  if (!c.env.CONFIG) {
    return c.json({ error: 'CONFIG KV is not configured; settings cannot be saved from the app yet', settings, persisted: false }, 503);
  }
  await c.env.CONFIG.put(SETTINGS_KEY, JSON.stringify(settings));
  return c.json({ success: true, settings, persisted: true });
});

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

  // ── Enrich positions with SL/TP from D1 ──────────────────────────────────
  if (env.DB && pos.length > 0) {
    try {
      const syms = [...new Set(pos.map(p => p.symbol))];
      const ph   = syms.map(() => '?').join(',');
      const rows = await env.DB
        .prepare(`SELECT symbol, stop, target FROM decisions WHERE symbol IN (${ph}) AND accepted = 1 AND mode = ? GROUP BY symbol HAVING created_at = MAX(created_at)`)
        .bind(...syms, modeParam)
        .all<{ symbol: string; stop: number | null; target: number | null }>();
      const sltp = new Map(rows.results?.map(r => [r.symbol, r]) ?? []);
      for (const p of pos) {
        const d = sltp.get(p.symbol);
        if (d) {
          (p as unknown as Record<string,unknown>).stopLoss   = d.stop   ?? undefined;
          (p as unknown as Record<string,unknown>).takeProfit = d.target ?? undefined;
        }
      }
    } catch { /* D1 unavailable */ }
  }

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
  try {
    const positions = await client.getPositions();

    // ── Enrich with SL/TP from D1 decisions ──────────────────────────────
    // Webull API never returns stop-loss / take-profit; we stored them when
    // the webhook executed the order, so look up the latest accepted decision
    // per symbol and merge the values back.
    if (c.env.DB && positions.length > 0) {
      try {
        const symbols  = [...new Set(positions.map(p => p.symbol))];
        const placeholders = symbols.map(() => '?').join(',');
        const rows = await c.env.DB
          .prepare(
            `SELECT symbol, stop, target
               FROM decisions
              WHERE symbol IN (${placeholders})
                AND accepted = 1
                AND mode     = ?
              GROUP BY symbol
              HAVING created_at = MAX(created_at)`
          )
          .bind(...symbols, mode)
          .all<{ symbol: string; stop: number | null; target: number | null }>();

        const map = new Map<string, { stop: number | null; target: number | null }>();
        for (const r of rows.results ?? []) map.set(r.symbol, r);

        for (const pos of positions) {
          const d = map.get(pos.symbol);
          if (d) {
            (pos as unknown as Record<string, unknown>).stopLoss   = d.stop   ?? undefined;
            (pos as unknown as Record<string, unknown>).takeProfit = d.target ?? undefined;
          }
        }
      } catch { /* D1 not available — continue without SL/TP */ }
    }

    return c.json({ data: positions });
  } catch (e) { return c.json({ data: [], error: String(e) }, 502); }
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
