import { Hono } from 'hono';
import type { AccountData, Order, Position, TradingMode } from '../lib/types';
import type { MobileEnv } from '../lib/mobile-env';
import { WebullClient } from '../lib/webull';
import { fetchLivePrices } from '../lib/market-data';
import { ensureWatchlistTable, loadWatchlist } from '../lib/watchlist';
import {
  getKillSwitch,
  getTradingMode,
  setKillSwitch,
} from '../lib/risk';
import { getTradingSettings } from './trading-settings';
import {
  buildMobileSessionCookie,
  clearMobileSessionCookie,
  createMobileSessionToken,
  mobileRequestFingerprint,
  readValidMobileSession,
  verifyMobileControlPin,
} from '../lib/mobile-session';
import {
  broadcastMobilePush,
  getAPNsConfigurationStatus,
  mobilePushRegistrationStatus,
  registerMobilePushDevice,
  unregisterMobilePushDevice,
} from '../lib/apns';
import {
  ensureMobileAuditSchema,
  getMobileReceptionState,
  mobileAccountTypeForMode,
  setMobileReceptionState,
  writeMobileAudit,
} from '../lib/mobile-control';

const mobileApi = new Hono<{ Bindings: MobileEnv }>();
const mobileTradingView = new Hono<{ Bindings: MobileEnv }>();

const LOGIN_WINDOW_SECONDS = 15 * 60;
const LOGIN_MAX_FAILURES = 5;
const LOGIN_LOCK_SECONDS = 15 * 60;

function noStoreHeaders(response: Response): Response {
  response.headers.set('cache-control', 'no-store');
  response.headers.set('pragma', 'no-cache');
  response.headers.set('x-content-type-options', 'nosniff');
  return response;
}

mobileApi.use('*', async (c, next) => {
  const session = await readValidMobileSession(c.req.raw, c.env);
  if (!session) return c.json({ ok: false, error: 'Authentication required' }, 401);
  await next();
  noStoreHeaders(c.res);
  return undefined;
});

mobileTradingView.use('*', async (c, next) => {
  if (!c.req.path.endsWith('/session')) {
    const session = await readValidMobileSession(c.req.raw, c.env);
    if (!session) return c.json({ ok: false, error: 'Authentication required' }, 401);
  }
  await next();
  noStoreHeaders(c.res);
  return undefined;
});

async function checkLoginAllowed(
  env: MobileEnv,
  request: Request,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ allowed: boolean; retryAfter?: number; fingerprint: string }> {
  await ensureMobileAuditSchema(env);
  if (!env.DB) throw new Error('D1 DB is required for mobile login rate limiting');
  const fingerprint = await mobileRequestFingerprint(request, env);
  const row = await env.DB.prepare(`
    SELECT failures, window_started_at, locked_until
      FROM mobile_login_attempts
     WHERE fingerprint = ?
  `).bind(fingerprint).first<{
    failures: number;
    window_started_at: number;
    locked_until: number | null;
  }>();

  if (row?.locked_until && row.locked_until > nowSeconds) {
    return { allowed: false, retryAfter: row.locked_until - nowSeconds, fingerprint };
  }

  if (row && nowSeconds - row.window_started_at >= LOGIN_WINDOW_SECONDS) {
    await env.DB.prepare('DELETE FROM mobile_login_attempts WHERE fingerprint = ?')
      .bind(fingerprint).run();
  }
  return { allowed: true, fingerprint };
}

async function recordLoginFailure(
  env: MobileEnv,
  fingerprint: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<void> {
  if (!env.DB) return;
  const row = await env.DB.prepare(`
    SELECT failures, window_started_at
      FROM mobile_login_attempts
     WHERE fingerprint = ?
  `).bind(fingerprint).first<{ failures: number; window_started_at: number }>();
  const freshWindow = !row || nowSeconds - row.window_started_at >= LOGIN_WINDOW_SECONDS;
  const failures = freshWindow ? 1 : Number(row.failures ?? 0) + 1;
  const windowStartedAt = freshWindow ? nowSeconds : row.window_started_at;
  const lockedUntil = failures >= LOGIN_MAX_FAILURES ? nowSeconds + LOGIN_LOCK_SECONDS : null;

  await env.DB.prepare(`
    INSERT INTO mobile_login_attempts (
      fingerprint, failures, window_started_at, locked_until, updated_at
    ) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(fingerprint) DO UPDATE SET
      failures = excluded.failures,
      window_started_at = excluded.window_started_at,
      locked_until = excluded.locked_until,
      updated_at = excluded.updated_at
  `).bind(fingerprint, failures, windowStartedAt, lockedUntil, nowSeconds).run();
}

async function clearLoginFailures(env: MobileEnv, fingerprint: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare('DELETE FROM mobile_login_attempts WHERE fingerprint = ?')
    .bind(fingerprint).run();
}

mobileTradingView.post('/session', async c => {
  if (!c.env.MOE_MOBILE_CONTROL_PIN || !c.env.MOE_MOBILE_SESSION_SECRET) {
    return c.json({ ok: false, error: 'Mobile authentication is not configured' }, 503);
  }

  let payload: { pin?: string };
  try {
    payload = await c.req.json<{ pin?: string }>();
  } catch {
    return c.json({ ok: false, error: 'Valid JSON is required' }, 400);
  }

  const rateLimit = await checkLoginAllowed(c.env, c.req.raw);
  if (!rateLimit.allowed) {
    return c.json(
      { ok: false, error: 'Too many login attempts. Try again later.' },
      429,
      { 'retry-after': String(rateLimit.retryAfter ?? LOGIN_LOCK_SECONDS) },
    );
  }

  const pin = String(payload.pin ?? '');
  if (!(await verifyMobileControlPin(pin, c.env))) {
    await recordLoginFailure(c.env, rateLimit.fingerprint);
    await writeMobileAudit(c.env, {
      type: 'MOBILE_LOGIN_FAILED',
      requestId: c.req.header('x-moe-request-id'),
    });
    return c.json({ ok: false, error: 'Wrong control PIN' }, 401);
  }

  await clearLoginFailures(c.env, rateLimit.fingerprint);
  const session = await createMobileSessionToken(c.env);
  await writeMobileAudit(c.env, {
    type: 'MOBILE_LOGIN_SUCCEEDED',
    requestId: c.req.header('x-moe-request-id'),
  });
  return c.json(
    { ok: true, expiresAt: new Date(session.payload.exp * 1000).toISOString() },
    200,
    { 'set-cookie': buildMobileSessionCookie(session.token, session.ttlSeconds) },
  );
});

mobileTradingView.delete('/session', async c => c.json(
  { ok: true },
  200,
  { 'set-cookie': clearMobileSessionCookie() },
));

interface BrokerSnapshot {
  account: Record<string, unknown>;
  positions: Position[];
  orders: Order[];
}

function disconnectedAccount(mode: TradingMode): Record<string, unknown> {
  return {
    accountType: mobileAccountTypeForMode(mode),
    connected: false,
    locked: mode === 'LIVE',
    positions: [],
    fetchedAt: new Date().toISOString(),
  };
}

function mapBrokerAccount(
  mode: TradingMode,
  account: AccountData,
  positions: Position[],
): Record<string, unknown> {
  const totalPnl = Number(account.realizedPnl ?? 0) + Number(account.unrealizedPnl ?? 0);
  const dayPnlPercent = account.accountValue
    ? (Number(account.dayPnl ?? 0) / account.accountValue) * 100
    : 0;
  return {
    accountType: mobileAccountTypeForMode(mode),
    connected: true,
    locked: false,
    balance: account.accountValue,
    cash: account.cash,
    buyingPower: account.buyingPower,
    openPositions: positions.length,
    totalPnl,
    dayPnl: account.dayPnl,
    realizedPnl: account.realizedPnl,
    unrealizedPnl: account.unrealizedPnl,
    dayPnlPercent,
    pnlSource: 'WEBULL_OPENAPI',
    pnlReliable: true,
    fetchedAt: account.updatedAt,
    positions: positions.map(position => ({
      symbol: position.symbol,
      quantity: position.quantity,
      averagePrice: position.averagePrice,
      currentPrice: position.currentPrice,
      marketValue: position.marketValue,
      unrealizedPnl: position.unrealizedPnl,
    })),
  };
}

async function loadBrokerSnapshot(env: MobileEnv, mode: TradingMode): Promise<BrokerSnapshot> {
  const client = WebullClient.fromEnv(env, mode);
  if (!client) return { account: disconnectedAccount(mode), positions: [], orders: [] };

  const [account, positions, orders] = await Promise.allSettled([
    client.getAccount(),
    client.getPositions(),
    client.getOrders(),
  ]);
  const safePositions = positions.status === 'fulfilled' ? positions.value : [];
  return {
    account: account.status === 'fulfilled'
      ? mapBrokerAccount(mode, account.value, safePositions)
      : disconnectedAccount(mode),
    positions: safePositions,
    orders: orders.status === 'fulfilled' ? orders.value : [],
  };
}

function mapMobilePositions(
  mode: TradingMode,
  positions: Position[],
  orders: Order[],
): Array<Record<string, unknown>> {
  return positions.map(position => {
    const symbolOrders = orders.filter(order => order.symbol === position.symbol);
    const entry = symbolOrders.find(order => order.side === 'BUY');
    const stop = symbolOrders.find(order => order.type === 'STOP' || order.type === 'STOP_LIMIT');
    return {
      symbol: position.symbol,
      status: 'OPEN',
      positionOpen: true,
      accountType: mobileAccountTypeForMode(mode),
      quantity: position.quantity,
      entryPrice: position.averagePrice,
      plannedEntryPrice: position.averagePrice,
      lastPrice: position.currentPrice,
      takeProfitPrice: position.takeProfit,
      currentStopPrice: position.stopLoss,
      initialStopPrice: position.stopLoss,
      updatedAt: new Date().toISOString(),
      indicator: 'WEBULL_OPENAPI',
      orderIds: {
        entry: entry?.id,
        stopLoss: stop?.id,
        currentStop: stop?.id,
      },
    };
  });
}

async function loadArchive(env: MobileEnv): Promise<Array<Record<string, unknown>>> {
  if (!env.DB) return [];
  try {
    const rows = await env.DB.prepare(`
      SELECT id, symbol, entry_price, exit_price, reason, pnl, quantity,
             mode, signal, closed_at, opened_at
        FROM trades
       WHERE status = 'CLOSED'
       ORDER BY closed_at DESC
       LIMIT 500
    `).all<Record<string, unknown>>();
    return (rows.results ?? []).map(row => ({
      id: row.id,
      symbol: row.symbol,
      entryPrice: row.entry_price,
      exitPrice: row.exit_price,
      exitReason: row.reason,
      profitLoss: row.pnl,
      quantity: row.quantity,
      accountType: row.mode === 'LIVE' ? 'LIVE' : 'DEMO',
      indicator: row.signal,
      closedAt: row.closed_at,
    }));
  } catch {
    return [];
  }
}

async function loadMobileAudit(env: MobileEnv): Promise<Array<Record<string, unknown>>> {
  if (!env.DB) return [];
  await ensureMobileAuditSchema(env);
  const rows = await env.DB.prepare(`
    SELECT id, type, symbol, account_type, reason, error, created_at
      FROM mobile_audit
     ORDER BY created_at DESC
     LIMIT 200
  `).all<Record<string, unknown>>();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    type: row.type,
    symbol: row.symbol,
    accountType: row.account_type,
    reason: row.reason,
    error: row.error,
    createdAt: row.created_at,
  }));
}

async function loadDailyPnl(env: MobileEnv): Promise<Record<string, number>> {
  if (!env.DB) return {};
  try {
    const rows = await env.DB.prepare(`
      SELECT substr(closed_at, 1, 10) AS day, SUM(COALESCE(pnl, 0)) AS value
        FROM trades
       WHERE status = 'CLOSED' AND closed_at IS NOT NULL
       GROUP BY substr(closed_at, 1, 10)
       ORDER BY day DESC
       LIMIT 120
    `).all<{ day: string; value: number }>();
    return Object.fromEntries((rows.results ?? []).map(row => [row.day, Number(row.value ?? 0)]));
  } catch {
    return {};
  }
}

async function latestTradingViewAlert(env: MobileEnv): Promise<string | null> {
  if (!env.DB) return null;
  try {
    const row = await env.DB.prepare(
      'SELECT created_at FROM decisions ORDER BY created_at DESC LIMIT 1',
    ).first<{ created_at: string }>();
    return row?.created_at ?? null;
  } catch {
    return null;
  }
}

function marketClock(env: MobileEnv): Record<string, unknown> {
  const timezone = env.SESSION_TZ || 'America/Chicago';
  const start = env.SESSION_START || '08:30';
  const end = env.SESSION_END || '15:00';
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  const weekday = part('weekday');
  const hour = Number(part('hour') === '24' ? '0' : part('hour'));
  const minute = Number(part('minute'));
  const current = hour * 60 + minute;
  const [startHour, startMinute] = start.split(':').map(Number);
  const [endHour, endMinute] = end.split(':').map(Number);
  const entryAllowed = !['Sat', 'Sun'].includes(weekday)
    && current >= startHour * 60 + startMinute
    && current < endHour * 60 + endMinute;
  return {
    label: `${weekday} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ${timezone}`,
    phase: entryAllowed ? 'REGULAR' : 'CLOSED',
    entryAllowed,
    entryBlockedReason: entryAllowed ? null : 'OUTSIDE_CONFIGURED_SESSION',
    selectedSession: `${start}-${end}`,
  };
}

async function buildMobileStatus(env: MobileEnv): Promise<Record<string, unknown>> {
  const mode = await getTradingMode(env) as TradingMode;
  const [sandbox, live, reception, killSwitch, archive, audit, dailyPnl, lastAlert, settings] = await Promise.all([
    loadBrokerSnapshot(env, 'SANDBOX'),
    loadBrokerSnapshot(env, 'LIVE'),
    getMobileReceptionState(env),
    getKillSwitch(env),
    loadArchive(env),
    loadMobileAudit(env),
    loadDailyPnl(env),
    latestTradingViewAlert(env),
    getTradingSettings(env),
  ]);
  const selected = mode === 'LIVE' ? live : sandbox;
  const lastAlertAge = lastAlert ? Date.now() - Date.parse(lastAlert) : Number.POSITIVE_INFINITY;
  return {
    ok: true,
    mode: 'TRADINGVIEW_BRIDGE',
    executionSource: 'TRADINGVIEW_WEBHOOK',
    tradingViewConnected: reception.enabled && lastAlertAge <= 30 * 60_000,
    generatedAt: new Date().toISOString(),
    runtime: {
      receptionEnabled: reception.enabled,
      killSwitchActive: killSwitch,
      accountType: mobileAccountTypeForMode(mode),
      liveActivated: mode === 'LIVE',
      lastValidAlertAt: lastAlert,
      updatedAt: reception.updatedAt,
    },
    accounts: {
      demo: sandbox.account,
      live: live.account,
    },
    positions: mapMobilePositions(mode, selected.positions, selected.orders),
    archive,
    audit,
    dailyPnl,
    marketClock: marketClock(env),
    settings: {
      configured: true,
      accountType: mobileAccountTypeForMode(mode),
      tradingMode: mode,
      positionSizeDollars: settings.maxPositionUsd,
      maxOpenPositions: Number(env.MAX_OPEN_POSITIONS ?? 4),
      session: `${settings.sessionStart}-${settings.sessionEnd}`,
      autoFlattenTimezone: settings.sessionTz,
    },
  };
}

mobileTradingView.get('/status', async c => c.json(await buildMobileStatus(c.env)));

mobileTradingView.post('/refresh', async c => {
  await buildMobileStatus(c.env);
  await writeMobileAudit(c.env, {
    type: 'MOBILE_BROKER_REFRESHED',
    requestId: c.req.header('x-moe-request-id'),
  });
  return c.json({ ok: true, message: 'Broker state refreshed' });
});

mobileTradingView.post('/repair', async c => {
  const mode = await getTradingMode(c.env) as TradingMode;
  const snapshot = await loadBrokerSnapshot(c.env, mode);
  const unprotected = snapshot.positions.filter(position => position.stopLoss == null).length;
  await writeMobileAudit(c.env, {
    type: 'MOBILE_PROTECTION_AUDIT_COMPLETED',
    accountType: mobileAccountTypeForMode(mode),
    reason: `UNPROTECTED_POSITIONS_${unprotected}`,
    requestId: c.req.header('x-moe-request-id'),
  });
  return c.json({
    ok: true,
    message: 'Protection audit completed; no order was modified automatically',
  });
});

mobileTradingView.post('/position/close', async c => {
  let payload: { symbol?: string; confirmation?: string };
  try {
    payload = await c.req.json<{ symbol?: string; confirmation?: string }>();
  } catch {
    return c.json({ ok: false, error: 'Valid JSON is required' }, 400);
  }
  if (payload.confirmation !== 'CLOSE') {
    return c.json({ ok: false, error: 'confirmation=CLOSE is required' }, 400);
  }
  const symbol = String(payload.symbol ?? '').toUpperCase().replace(/[^A-Z0-9.-]/gu, '');
  if (!symbol) return c.json({ ok: false, error: 'A valid symbol is required' }, 400);

  const mode = await getTradingMode(c.env) as TradingMode;
  if (mode === 'LIVE' && c.env.MOE_MOBILE_LIVE_CONTROL_ENABLED !== 'true') {
    return c.json({ ok: false, error: 'Live mobile control is disabled' }, 423);
  }
  const client = WebullClient.fromEnv(c.env, mode);
  if (!client) return c.json({ ok: false, error: `${mode} Webull credentials are not configured` }, 503);

  const positions = await client.getPositions();
  const position = positions.find(item => item.symbol === symbol && item.side === 'LONG' && item.quantity > 0);
  if (!position) return c.json({ ok: false, error: 'No open long position was found' }, 404);

  const requestId = c.req.header('x-moe-request-id') ?? crypto.randomUUID();
  const result = await client.placeOrder({
    symbol,
    side: 'SELL',
    type: 'MARKET',
    qty: position.quantity,
    price: position.currentPrice || position.averagePrice,
    idempotencyKey: `mobile-close-${requestId}`,
  });

  await writeMobileAudit(c.env, {
    type: 'MOBILE_POSITION_CLOSE_SUBMITTED',
    symbol,
    accountType: mobileAccountTypeForMode(mode),
    reason: result.orderId,
    requestId,
  });

  const apns = getAPNsConfigurationStatus(c.env);
  if (apns.enabled && apns.configured && c.env.DB) {
    c.executionCtx.waitUntil(broadcastMobilePush(c.env, {
      type: 'POSITION_CLOSE_SUBMITTED',
      title: 'MOE-AI',
      body: `Close order submitted for ${symbol}`,
      symbol,
      accountType: mobileAccountTypeForMode(mode),
      price: position.currentPrice,
      collapseId: `close-${symbol}`,
    }));
  }

  return c.json({ ok: true, message: 'Close order submitted' });
});

mobileTradingView.post('/reception', async c => {
  let payload: { enabled?: boolean; accountType?: string; confirmation?: string };
  try {
    payload = await c.req.json<{ enabled?: boolean; accountType?: string; confirmation?: string }>();
  } catch {
    return c.json({ ok: false, error: 'Valid JSON is required' }, 400);
  }
  const accountType = payload.accountType?.toUpperCase() === 'LIVE' ? 'LIVE' : 'DEMO';
  if (accountType === 'LIVE' && payload.enabled === true) {
    if (c.env.MOE_MOBILE_LIVE_CONTROL_ENABLED !== 'true') {
      return c.json({ ok: false, error: 'Live mobile control is disabled' }, 423);
    }
    if (payload.confirmation !== 'CONFIRM') {
      return c.json({ ok: false, error: 'confirmation=CONFIRM is required for Live' }, 400);
    }
  }
  const state = await setMobileReceptionState(c.env, payload.enabled === true, accountType);
  await writeMobileAudit(c.env, {
    type: state.enabled ? 'MOBILE_RECEPTION_ENABLED' : 'MOBILE_RECEPTION_DISABLED',
    accountType,
    requestId: c.req.header('x-moe-request-id'),
  });
  return c.json({
    ok: true,
    runtime: {
      receptionEnabled: state.enabled,
      accountType: state.accountType,
      updatedAt: state.updatedAt,
      killSwitchActive: await getKillSwitch(c.env),
    },
  });
});

mobileTradingView.post('/kill-switch', async c => {
  let payload: { action?: string; confirmation?: string };
  try {
    payload = await c.req.json<{ action?: string; confirmation?: string }>();
  } catch {
    return c.json({ ok: false, error: 'Valid JSON is required' }, 400);
  }
  const action = String(payload.action ?? 'ACTIVATE').toUpperCase();
  if (action === 'CLEAR') {
    if (payload.confirmation !== 'CLEAR') {
      return c.json({ ok: false, error: 'confirmation=CLEAR is required' }, 400);
    }
    await setKillSwitch(c.env, false);
    await writeMobileAudit(c.env, {
      type: 'MOBILE_KILL_SWITCH_CLEARED',
      requestId: c.req.header('x-moe-request-id'),
    });
  } else {
    await setKillSwitch(c.env, true);
    const mode = await getTradingMode(c.env) as TradingMode;
    await setMobileReceptionState(c.env, false, mobileAccountTypeForMode(mode));
    await writeMobileAudit(c.env, {
      type: 'MOBILE_KILL_SWITCH_ACTIVATED',
      accountType: mobileAccountTypeForMode(mode),
      requestId: c.req.header('x-moe-request-id'),
    });
  }
  const mode = await getTradingMode(c.env) as TradingMode;
  const reception = await getMobileReceptionState(c.env);
  return c.json({
    ok: true,
    runtime: {
      receptionEnabled: reception.enabled,
      killSwitchActive: await getKillSwitch(c.env),
      accountType: mobileAccountTypeForMode(mode),
      updatedAt: new Date().toISOString(),
    },
  });
});

mobileApi.get('/market-screener', async c => {
  const mode = await getTradingMode(c.env) as TradingMode;
  await ensureWatchlistTable(c.env);
  const symbols = await loadWatchlist(c.env, mode);
  const quotes = await fetchLivePrices(symbols);
  const search = (c.req.query('search') ?? '').trim().toUpperCase();
  const sort = (c.req.query('sort') ?? 'VOLUME').toUpperCase();
  let rows = quotes.map(quote => ({
    symbol: quote.symbol,
    name: quote.symbol,
    price: quote.price,
    change: quote.changeAmt,
    changePercent: quote.changePct,
    volume: quote.volume,
    session: 'US',
    available: quote.price > 0,
  }));
  if (search) rows = rows.filter(row => row.symbol.includes(search));
  rows.sort((left, right) => {
    if (sort === 'CHANGE') return right.changePercent - left.changePercent;
    if (sort === 'PRICE_DESC') return right.price - left.price;
    return right.volume - left.volume;
  });
  return c.json({ ok: true, rows: rows.slice(0, 100), updatedAt: new Date().toISOString() });
});

mobileApi.post('/push/register', async c => {
  let payload: { token?: string; platform?: string; bundleIdentifier?: string; environment?: string };
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Valid JSON is required' }, 400);
  }
  try {
    const result = await registerMobilePushDevice(c.env, {
      token: String(payload.token ?? ''),
      platform: String(payload.platform ?? ''),
      bundleIdentifier: String(payload.bundleIdentifier ?? ''),
      environment: String(payload.environment ?? ''),
    });
    await writeMobileAudit(c.env, {
      type: 'MOBILE_PUSH_REGISTERED',
      reason: result.tokenSuffix,
      requestId: c.req.header('x-moe-request-id'),
    });
    return c.json({ ok: true, registered: result.registered });
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : 'Registration failed' }, 400);
  }
});

mobileApi.delete('/push/register', async c => {
  let payload: { token?: string };
  try {
    payload = await c.req.json();
  } catch {
    return c.json({ ok: false, error: 'Valid JSON is required' }, 400);
  }
  try {
    const result = await unregisterMobilePushDevice(c.env, String(payload.token ?? ''));
    return c.json({ ok: true, message: result.unregistered ? 'Device unregistered' : 'Device was not registered' });
  } catch (error) {
    return c.json({ ok: false, error: error instanceof Error ? error.message : 'Unregister failed' }, 400);
  }
});

mobileApi.get('/push/status', async c => c.json({
  ok: true,
  ...(await mobilePushRegistrationStatus(c.env)),
}));

mobileApi.post('/push/test', async c => {
  const configuration = getAPNsConfigurationStatus(c.env);
  if (!configuration.enabled || !configuration.configured) {
    return c.json({
      ok: false,
      error: configuration.enabled
        ? `APNs is not configured: ${configuration.missing.join(', ')}`
        : 'APNs sending is disabled',
    }, 503);
  }
  const result = await broadcastMobilePush(c.env, {
    type: 'TEST',
    title: 'MOE-AI',
    body: 'Native iPhone notifications are connected.',
    collapseId: 'moe-test',
  });
  return c.json(result, result.ok ? 200 : 502);
});

export { mobileApi, mobileTradingView, buildMobileStatus };
