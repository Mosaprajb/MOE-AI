import { marketSessionStatus } from '../market-session.js';

const MODE_PATH = '/api/trading/mode';
const CONFIG_PATH = '/api/config';
const SESSION_PATH = '/api/market/session';
const SESSION_POLICY_PATH = '/api/trading/session-policy';
const SCAN_MODE_PATH = '/api/scanner/source-mode';
const TRADES_PATH = '/api/trades';
const TRADES_CLOSE_PATH = '/api/trades/close';
const ANALYTICS_PATH = '/api/trades/analytics';
const ACTIVE_POSITION_PATH = '/api/trading-intelligence/active-position';
const PORTFOLIO_RISK_PATH = '/api/trading-intelligence/portfolio-risk';

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-mobile-api': '1.0.0',
    },
  });
}

async function payload(request) {
  try { return await request.json(); }
  catch { throw new Error('Invalid JSON payload.'); }
}

function errorStatus(error, fallback = 422) {
  const message = error instanceof Error ? error.message : String(error || 'Request failed.');
  if (/unauthorized|invalid mobile session/i.test(message)) return 401;
  if (/locked|live controls|kill switch|trading mode .* is locked|blocked/i.test(message)) return 423;
  if (/method not allowed/i.test(message)) return 405;
  return fallback;
}

function configPatch(input = {}) {
  const aliases = {
    cashAllocationPercent: input.cashAllocationPercent ?? input.cashPct,
    marginAllocationPercent: input.marginAllocationPercent ?? input.marginPct,
    takeProfitR: input.takeProfitR,
    riskPerTradePercent: input.riskPerTradePercent ?? input.stopLossPct,
    maxDailyTrades: input.maxDailyTrades ?? input.maxTrades,
    maxDailyLossPercent: input.maxDailyLossPercent ?? input.dailyLossPct,
  };
  return Object.fromEntries(Object.entries(aliases).filter(([, value]) => value != null));
}

function sessionSnapshot(date = new Date()) {
  const market = marketSessionStatus(date);
  const key = String(market.currentSession?.key || 'CLOSED').toUpperCase();
  const current = key === 'PRE_MARKET' ? 'PREMARKET' : key;
  return {
    current,
    isOpen: market.open === true,
    endsAt: market.open ? market.transitionAt : market.nextOpenAt,
  };
}

async function modeSnapshot(stub) {
  const [runtime, control, tradingMode] = await Promise.all([
    stub.mobileDashboardRuntime(),
    stub.getLiveControlState(),
    stub.getTradingMode(),
  ]);
  const armed = control.effectiveLiveAutomationArmed === true
    || control.sandboxAutomationEnabled === true;
  return { runtime: { ...runtime, armed }, control, tradingMode, armed };
}

async function updateMode(request, env, stub) {
  const body = await payload(request);
  const current = await stub.mobileDashboardRuntime();

  if (body.armed === false) {
    const control = await stub.forceSafeDisarmFromMobile('MOBILE_DASHBOARD');
    const runtime = await stub.updateMobileDashboardRuntime({
      ...body,
      mode: body.mode ?? current.mode,
      armed: false,
      settings: body.settings == null ? current.settings : configPatch(body.settings),
    }, 'MOBILE_DASHBOARD');
    return json({ ok: true, ...runtime, runtime, control, armed: false, storage: 'DURABLE_OBJECT' });
  }

  const settings = body.settings == null
    ? current.settings
    : await stub.updateMobileDashboardConfig(configPatch(body.settings));

  let scanMode = null;
  if (Array.isArray(body.symbols)) {
    scanMode = await stub.updateScanSourceMode({ mode: 'CURATED_UNIVERSE', symbols: body.symbols }, 'MOBILE_DASHBOARD');
  }

  let policy = null;
  if (Array.isArray(body.sessions)) {
    policy = await stub.updateTradingSessionPolicyFromMobile(body.sessions, 'MOBILE_DASHBOARD');
  }

  const requestedMode = String(body.mode ?? current.mode ?? 'SANDBOX').trim().toUpperCase();
  if (!['SANDBOX', 'LIVE'].includes(requestedMode)) throw new Error('mode must be SANDBOX or LIVE.');

  let control = await stub.getLiveControlState();
  let tradingMode;
  if (requestedMode === 'LIVE') {
    if (!control.effectiveLiveUnlocked || control.killSwitch !== false) {
      throw new Error('Live controls must be unlocked by the existing PIN gate and the kill switch must be cleared first.');
    }
    if (body.armed === true && !control.effectiveLiveAutomationArmed) {
      throw new Error('Live automation must be armed through the existing Live control gate first.');
    }
    tradingMode = await stub.updateTradingMode({
      mode: 'LIVE',
      confirmation: 'ENABLE_LIVE_TRADING',
      actor: 'MOBILE_DASHBOARD',
    });
  } else {
    tradingMode = await stub.updateTradingMode({ mode: 'SANDBOX', actor: 'MOBILE_DASHBOARD' });
    if (body.armed === true) control = await stub.setSandboxAutomationFromMobile(true, 'MOBILE_DASHBOARD');
  }

  const runtime = await stub.updateMobileDashboardRuntime({
    mode: requestedMode,
    armed: body.armed === true,
    strategy: body.strategy ?? current.strategy,
    symbols: body.symbols ?? current.symbols,
    sessions: body.sessions ?? current.sessions,
    settings,
  }, 'MOBILE_DASHBOARD');

  return json({
    ok: true,
    ...runtime,
    runtime,
    control,
    tradingMode,
    scanMode: scanMode?.scanMode || scanMode,
    policy,
    storage: 'DURABLE_OBJECT',
  });
}

async function closeAllTrades(request, stub) {
  const body = await payload(request);
  if (body.all !== true) throw new Error('all:true is required.');
  const reason = String(body.reason || 'MANUAL_STOP').trim().toUpperCase();
  const [trades, control] = await Promise.all([
    stub.listTrades({ status: 'OPEN', limit: 500 }),
    stub.forceSafeDisarmFromMobile('MOBILE_DASHBOARD'),
  ]);
  if (trades.length) {
    return json({
      ok: false,
      blocked: true,
      all: true,
      reason,
      openPositions: trades.length,
      engineDisarmed: true,
      control,
      error: 'Manual broker flattening is unavailable on this route; trading was safely disarmed and existing protective exits remain authoritative.',
    }, 501);
  }
  return json({ ok: true, all: true, reason, closed: 0, engineDisarmed: true, control });
}

export async function handleAuthenticatedMobileApi(request, env, stub, { baseFetch = null } = {}) {
  const path = new URL(request.url).pathname;
  try {
    if (path === CONFIG_PATH) {
      if (request.method === 'GET') return json({ ok: true, config: await stub.mobileDashboardConfig(), storage: 'DURABLE_OBJECT' });
      if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const config = await stub.updateMobileDashboardConfig(configPatch(await payload(request)));
      return json({ ok: true, config, storage: 'DURABLE_OBJECT' });
    }

    if (path === MODE_PATH) {
      if (request.method === 'GET') return json({ ok: true, ...(await modeSnapshot(stub)), storage: 'DURABLE_OBJECT' });
      if (request.method !== 'PUT') return null;
      return updateMode(request, env, stub);
    }

    if (path === SESSION_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const session = sessionSnapshot();
      return json({ ok: true, session, current: session.current, isOpen: session.isOpen, endsAt: session.endsAt });
    }

    if (path === SESSION_POLICY_PATH) {
      if (request.method === 'GET') {
        const policy = await stub.getTradingSessionPolicy();
        return json({ ok: true, policy, sessions: policy.sessions, storage: 'DURABLE_OBJECT' });
      }
      if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const body = await payload(request);
      const policy = await stub.updateTradingSessionPolicyFromMobile(body.sessions, 'MOBILE_DASHBOARD');
      return json({ ok: true, policy, sessions: policy.sessions, storage: 'DURABLE_OBJECT' });
    }

    if (path === SCAN_MODE_PATH) {
      if (request.method === 'GET') {
        const scanMode = await stub.scanSourceMode();
        return json({ ok: true, scanMode, mode: scanMode.mode, symbols: scanMode.activeSymbols, storage: 'DURABLE_OBJECT' });
      }
      if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const result = await stub.updateScanSourceMode(await payload(request), 'MOBILE_DASHBOARD');
      return json({ ok: true, ...result, mode: result.scanMode?.mode, symbols: result.scanMode?.activeSymbols, storage: 'DURABLE_OBJECT' });
    }

    if (path === TRADES_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const trades = await stub.listTrades({ limit: 500 });
      return json({ ok: true, trades, items: trades, storage: 'DURABLE_OBJECT' });
    }

    if (path === ANALYTICS_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const analytics = await stub.tradeAnalytics();
      return json({ ok: true, analytics, byStrategy: analytics.byStrategy || [], storage: 'DURABLE_OBJECT' });
    }

    if (path === ACTIVE_POSITION_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const position = await stub.activePositionIntelligence();
      const positions = position?.available ? [position] : [];
      return json({ ok: true, activePosition: position, position: positions[0] || null, positions, storage: 'DURABLE_OBJECT' });
    }

    if (path === PORTFOLIO_RISK_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const portfolioRisk = await stub.portfolioRiskIntelligence();
      const cashBalance = portfolioRisk?.capital?.cashBalance ?? null;
      const marginBalance = portfolioRisk?.capital?.marginExcess ?? portfolioRisk?.capital?.dayBuyingPower ?? null;
      return json({
        ok: true,
        portfolioRisk,
        portfolio: { ...portfolioRisk, cashBalance, marginBalance },
        cashBalance,
        marginBalance,
        storage: 'DURABLE_OBJECT',
      });
    }

    if (path === TRADES_CLOSE_PATH) {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed.' }, 405);
      return closeAllTrades(request, stub);
    }

    if (path === '/api/health' && typeof baseFetch === 'function') {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
      const baseResponse = await baseFetch(request);
      let health = {};
      try { health = await baseResponse.clone().json(); } catch { health = {}; }
      const mode = await modeSnapshot(stub);
      return json({
        ...health,
        ok: health.ok !== false,
        broker: health.broker || { connected: false, status: 'UNKNOWN' },
        armed: mode.armed,
        runtime: mode.runtime,
      }, baseResponse.ok ? 200 : baseResponse.status);
    }
  } catch (error) {
    return json({
      ok: false,
      blocked: errorStatus(error) === 423,
      error: error instanceof Error ? error.message : 'Mobile API request failed.',
    }, errorStatus(error));
  }
  return null;
}

export { configPatch, sessionSnapshot };
