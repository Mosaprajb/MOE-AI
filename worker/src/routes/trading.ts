// MOE-AI Trading Routes — account, positions, orders, mode, kill-switch
import { Hono } from 'hono';
import type { TradingMode } from '../lib/types';
import type { LiveControlEnv } from '../lib/live-policy';
import { WebullClient } from '../lib/webull';
import {
  authorizeLiveControl,
  authorizeLiveExecution,
  getLiveExecutionPolicy,
} from '../lib/live-control';
import {
  computeRiskState, checkLiveSafetyGates,
  getKillSwitch, setKillSwitch,
  setTradingMode,
} from '../lib/risk';
import { getTradingSettings, type TradingSettings } from './trading-settings';

const trading = new Hono<{ Bindings: LiveControlEnv }>();

function liveBlockedResponse(authorization: Awaited<ReturnType<typeof authorizeLiveExecution>>) {
  return {
    ok: false,
    code: authorization.code ?? 'LIVE_EXECUTION_BLOCKED',
    error: authorization.error ?? 'Live execution is blocked.',
    blockers: authorization.policy.blockers,
    policy: authorization.policy,
  };
}

const SETTINGS_KEY = 'trading:settings';
trading.get('/settings', async c => {
  const settings = await getTradingSettings(c.env);
  return c.json({ settings, persisted: !!c.env.CONFIG });
});

trading.post('/settings', async c => {
  const body = await c.req.json<Partial<TradingSettings>>();
  const current = await getTradingSettings(c.env);
  const settings = {
    sizingSource: body.sizingSource === 'buying_power'
      ? ('buying_power' as const)
      : body.sizingSource === 'cash'
        ? ('cash' as const)
        : ('cash_plus_margin' as const),
    maxCashPct: Math.max(1, Math.min(100, Number(body.maxCashPct ?? current.maxCashPct))),
    marginPct: Math.max(0, Math.min(100, Number(body.marginPct ?? current.marginPct))),
    maxPositionUsd: Math.max(0, Number(body.maxPositionUsd ?? current.maxPositionUsd)),
    stopLossEnabled: body.stopLossEnabled !== false,
    stopLossPct: Math.max(0.1, Math.min(50, Number(body.stopLossPct ?? current.stopLossPct))),
    blockIfPosition: body.blockIfPosition !== false,
    sessionOpenOnly: body.sessionOpenOnly !== false,
    sessionTz: typeof body.sessionTz === 'string' ? body.sessionTz : current.sessionTz,
    sessionStart: typeof body.sessionStart === 'string' ? body.sessionStart : current.sessionStart,
    sessionEnd: typeof body.sessionEnd === 'string' ? body.sessionEnd : current.sessionEnd,
  };
  if (!c.env.CONFIG) {
    return c.json({
      error: 'CONFIG KV is not configured; settings cannot be saved from the app yet',
      settings,
      persisted: false,
    }, 503);
  }
  await c.env.CONFIG.put(SETTINGS_KEY, JSON.stringify(settings));
  return c.json({ success: true, settings, persisted: true });
});

// Dashboard reads are allowed in Live observation-only mode. Execution state is
// always derived from the server policy and never from the requested URL alone.
trading.get('/:mode/dashboard', async c => {
  const env = c.env;
  const modeParam = (c.req.param('mode').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  const client = WebullClient.fromEnv(env, modeParam);
  const [ks, livePolicy] = await Promise.all([
    getKillSwitch(env),
    modeParam === 'LIVE' ? getLiveExecutionPolicy(env) : Promise.resolve(null),
  ]);

  if (!client) {
    const readiness = modeParam === 'LIVE'
      ? {
          ...(await checkLiveSafetyGates(env, false, 0)),
          ready: false,
          policy: livePolicy,
          blockers: livePolicy?.blockers ?? [],
        }
      : {
          ready: false,
          missingSecrets: [
            'WEBULL_SANDBOX_APP_KEY',
            'WEBULL_SANDBOX_ACCESS_TOKEN',
            'WEBULL_SANDBOX_ACCOUNT_ID',
          ],
          gates: {},
        };

    return c.json({
      account: {},
      positions: [],
      orders: [],
      safety: {
        webullConnected: false,
        webullMode: 'DISCONNECTED',
        killSwitch: ks,
        mode: modeParam,
        executionAllowed: false,
        observationOnly: true,
      },
      readiness,
      livePolicy,
      updatedAt: new Date().toISOString(),
    });
  }

  const [account, positions, orders] = await Promise.allSettled([
    client.getAccount(),
    client.getPositions(),
    client.getOrders(),
  ]);

  const acct = account.status === 'fulfilled' ? account.value : {};
  const pos = positions.status === 'fulfilled' ? positions.value : [];
  const ord = orders.status === 'fulfilled' ? orders.value : [];

  if (env.DB && pos.length > 0) {
    try {
      const syms = [...new Set(pos.map(position => position.symbol))];
      const placeholders = syms.map(() => '?').join(',');
      const rows = await env.DB
        .prepare(`SELECT symbol, stop, target FROM decisions WHERE symbol IN (${placeholders}) AND accepted = 1 AND mode = ? GROUP BY symbol HAVING created_at = MAX(created_at)`)
        .bind(...syms, modeParam)
        .all<{ symbol: string; stop: number | null; target: number | null }>();
      const stops = new Map(rows.results?.map(row => [row.symbol, row]) ?? []);
      for (const position of pos) {
        const decision = stops.get(position.symbol);
        if (decision) {
          (position as unknown as Record<string, unknown>).stopLoss = decision.stop ?? undefined;
          (position as unknown as Record<string, unknown>).takeProfit = decision.target ?? undefined;
        }
      }
    } catch {
      // D1 is optional for observation reads.
    }
  }

  const accountValue = (acct as { accountValue?: number }).accountValue ?? 0;
  const risk = await computeRiskState(env, modeParam, pos, accountValue);
  const executionAllowed = modeParam === 'LIVE'
    ? Boolean(livePolicy?.executionAllowed) && !risk.locked
    : !ks && !risk.locked;

  const payload: Record<string, unknown> = {
    account: acct,
    positions: pos,
    orders: ord,
    risk,
    safety: {
      webullConnected: true,
      webullMode: modeParam,
      killSwitch: ks,
      mode: modeParam,
      executionAllowed,
      observationOnly: !executionAllowed,
    },
    updatedAt: new Date().toISOString(),
  };

  if (modeParam === 'LIVE') {
    const readiness = await checkLiveSafetyGates(env, pos.length > 0, accountValue);
    payload.readiness = {
      ...readiness,
      ready: readiness.ready && Boolean(livePolicy?.executionAllowed),
      policy: livePolicy,
      blockers: livePolicy?.blockers ?? [],
    };
    payload.livePolicy = livePolicy;
  }

  return c.json(payload);
});

trading.get('/:mode/account', async c => {
  const mode = (c.req.param('mode').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  const client = WebullClient.fromEnv(c.env, mode);
  if (!client) return c.json({ error: `${mode} credentials not configured` }, 503);
  try {
    return c.json(await client.getAccount());
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

trading.get('/:mode/positions', async c => {
  const mode = (c.req.param('mode').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  const client = WebullClient.fromEnv(c.env, mode);
  if (!client) return c.json({ data: [], error: `${mode} credentials not configured` }, 503);
  try {
    const positions = await client.getPositions();
    if (c.env.DB && positions.length > 0) {
      try {
        const symbols = [...new Set(positions.map(position => position.symbol))];
        const placeholders = symbols.map(() => '?').join(',');
        const rows = await c.env.DB.prepare(
          `SELECT symbol, stop, target
             FROM decisions
            WHERE symbol IN (${placeholders})
              AND accepted = 1
              AND mode = ?
            GROUP BY symbol
            HAVING created_at = MAX(created_at)`,
        ).bind(...symbols, mode).all<{
          symbol: string;
          stop: number | null;
          target: number | null;
        }>();
        const decisions = new Map<string, { stop: number | null; target: number | null }>();
        for (const row of rows.results ?? []) decisions.set(row.symbol, row);
        for (const position of positions) {
          const decision = decisions.get(position.symbol);
          if (decision) {
            (position as unknown as Record<string, unknown>).stopLoss = decision.stop ?? undefined;
            (position as unknown as Record<string, unknown>).takeProfit = decision.target ?? undefined;
          }
        }
      } catch {
        // Continue without D1 enrichment.
      }
    }
    return c.json({ data: positions });
  } catch (error) {
    return c.json({ data: [], error: String(error) }, 502);
  }
});

trading.get('/:mode/orders', async c => {
  const mode = (c.req.param('mode').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  const client = WebullClient.fromEnv(c.env, mode);
  if (!client) return c.json({ data: [], error: `${mode} credentials not configured` }, 503);
  try {
    return c.json({ data: await client.getOrders() });
  } catch (error) {
    return c.json({ data: [], error: String(error) }, 502);
  }
});

trading.post('/orders', async c => {
  const env = c.env;
  const body = await c.req.json<{
    symbol: string;
    side: 'BUY' | 'SELL';
    type: string;
    quantity: number;
    price?: number;
    stopPrice?: number;
    mode: string;
    idempotencyKey: string;
  }>();
  const mode = (body.mode?.toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;

  if (mode === 'LIVE') {
    const authorization = await authorizeLiveExecution(c.req.raw, env);
    if (!authorization.ok) {
      return c.json(liveBlockedResponse(authorization), authorization.status as 401 | 423);
    }
  }

  const killSwitch = await getKillSwitch(env);
  if (killSwitch) return c.json({ error: 'Kill switch is engaged' }, 403);

  try {
    const existing = await env.DB?.prepare('SELECT id FROM orders WHERE idempotency_key = ?')
      .bind(body.idempotencyKey)
      .first<{ id: string }>();
    if (existing) return c.json({ orderId: existing.id, status: 'ALREADY_SUBMITTED' });
  } catch {
    // D1 idempotency is best effort when the database is unavailable.
  }

  const client = WebullClient.fromEnv(env, mode);
  if (!client) return c.json({ error: `${mode} credentials not configured` }, 503);

  try {
    const result = await client.placeOrder({
      symbol: body.symbol,
      side: body.side,
      type: body.type as 'MARKET' | 'LIMIT',
      qty: body.quantity,
      price: body.price,
      stop: body.stopPrice,
      idempotencyKey: body.idempotencyKey,
    });
    await env.DB?.prepare(
      `INSERT OR IGNORE INTO orders
         (webull_id, symbol, side, type, quantity, price, stop_price, status, mode, idempotency_key)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).bind(
      result.orderId,
      body.symbol,
      body.side,
      body.type,
      body.quantity,
      body.price ?? null,
      body.stopPrice ?? null,
      result.status,
      mode,
      body.idempotencyKey,
    ).run();
    return c.json(result);
  } catch (error) {
    return c.json({ error: String(error) }, 502);
  }
});

trading.get('/trades', async c => {
  const limit = Math.min(Number(c.req.query('limit') ?? 100), 500);
  const mode = c.req.query('mode');
  try {
    const query = mode
      ? 'SELECT * FROM trades WHERE mode = ? ORDER BY opened_at DESC LIMIT ?'
      : 'SELECT * FROM trades ORDER BY opened_at DESC LIMIT ?';
    const dbResult = mode
      ? await c.env.DB?.prepare(query).bind(mode, limit).all<Record<string, unknown>>()
      : await c.env.DB?.prepare(query).bind(limit).all<Record<string, unknown>>();
    const trades = (dbResult?.results ?? []).map(row => ({
      id: row.id,
      symbol: row.symbol,
      side: row.side,
      quantity: row.quantity,
      entryPrice: row.entry_price,
      exitPrice: row.exit_price,
      pnl: row.pnl,
      pnlPct: row.pnl_pct,
      stopLoss: row.stop_loss,
      takeProfit: row.take_profit,
      signal: row.signal,
      status: row.status,
      mode: row.mode,
      openedAt: row.opened_at,
      closedAt: row.closed_at,
    }));
    return c.json({ trades, total: trades.length });
  } catch {
    return c.json({ trades: [], total: 0 });
  }
});

trading.get('/live/readiness', async c => {
  const env = c.env;
  const live = WebullClient.fromEnv(env, 'LIVE');
  let accountValue = 0;
  let hasPositions = false;
  if (live) {
    try {
      const [account, positions] = await Promise.allSettled([
        live.getAccount(),
        live.getPositions(),
      ]);
      if (account.status === 'fulfilled') accountValue = account.value.accountValue;
      if (positions.status === 'fulfilled') hasPositions = positions.value.length > 0;
    } catch {
      // Readiness remains false when broker observation fails.
    }
  }
  const [legacyReadiness, policy] = await Promise.all([
    checkLiveSafetyGates(env, hasPositions, accountValue),
    getLiveExecutionPolicy(env),
  ]);
  return c.json({
    ...legacyReadiness,
    ready: legacyReadiness.ready && policy.executionAllowed,
    policy,
    blockers: policy.blockers,
  });
});

trading.get('/mode', async c => {
  const policy = await getLiveExecutionPolicy(c.env);
  return c.json({
    mode: policy.currentMode,
    storedMode: policy.storedMode,
    killSwitch: policy.runtimeKillSwitch,
    liveExecutionAllowed: policy.executionAllowed,
    blockers: policy.blockers,
  });
});

trading.post('/mode', async c => {
  const body = await c.req.json<{ mode: string }>();
  const requestedMode = (body.mode?.toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX') as TradingMode;
  if (requestedMode === 'LIVE') {
    const authorization = await authorizeLiveExecution(c.req.raw, c.env);
    if (!authorization.ok) {
      return c.json(liveBlockedResponse(authorization), authorization.status as 401 | 423);
    }
  }
  await setTradingMode(c.env, requestedMode);
  const policy = await getLiveExecutionPolicy(c.env);
  return c.json({
    success: true,
    mode: policy.currentMode,
    storedMode: policy.storedMode,
    liveExecutionAllowed: policy.executionAllowed,
    blockers: policy.blockers,
  });
});

trading.get('/kill-switch', async c => {
  const enabled = await getKillSwitch(c.env);
  return c.json({ killSwitch: enabled });
});

trading.post('/kill-switch', async c => {
  const body = await c.req.json<{ enabled: boolean }>();
  const enabled = Boolean(body.enabled);
  if (!enabled) {
    const policy = await getLiveExecutionPolicy(c.env);
    if (policy.executionAllowedByConfig) {
      const authorization = await authorizeLiveControl(c.req.raw, c.env);
      if (!authorization.ok) {
        return c.json(liveBlockedResponse(authorization), authorization.status as 401 | 423);
      }
    }
  }
  await setKillSwitch(c.env, enabled);
  if (enabled) await setTradingMode(c.env, 'SANDBOX');
  return c.json({
    success: true,
    killSwitch: enabled,
    mode: enabled ? 'SANDBOX' : undefined,
  });
});

export { trading };
