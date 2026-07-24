import { buildTradePlan } from './trade-engine.js';
import { evaluatePortfolioRisk } from './portfolio-manager.js';
import { getWebullAccountSnapshot } from './webull-client.js';

const ALLOWED_SIDES = new Set(['BUY', 'SELL']);
const ALLOWED_ORDER_TYPES = new Set(['MARKET', 'LIMIT']);
const ALLOWED_SESSIONS = new Set(['CORE', 'ALL']);

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${field} must be a positive number`);
  return number;
}

function optionalPositive(value, field) {
  return value == null || value === '' ? null : finitePositive(value, field);
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function pickArray(value) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of ['data', 'items', 'positions', 'position_list', 'list']) {
    if (Array.isArray(value[key])) return value[key];
  }
  return [];
}

function normalizeWebullPortfolio(snapshot, fallback = {}) {
  const balance = snapshot?.balance || {};
  const balanceData = balance?.data && !Array.isArray(balance.data) ? balance.data : balance;
  const rawPositions = pickArray(snapshot?.positions);

  const accountEquity = firstFinite(
    balanceData?.net_liquidation,
    balanceData?.netLiquidation,
    balanceData?.total_asset,
    balanceData?.totalAsset,
    balanceData?.equity,
    fallback.accountEquity,
  );

  const openPositions = rawPositions.map((item) => ({
    symbol: String(item.symbol || item.ticker?.symbol || item.instrument?.symbol || '').trim().toUpperCase(),
    quantity: firstFinite(item.quantity, item.qty, item.position, item.holding_quantity) || 0,
    marketValue: firstFinite(item.market_value, item.marketValue, item.position_value),
    unrealizedPnl: firstFinite(item.unrealized_profit_loss, item.unrealizedPnl, item.unrealized_pl),
    sector: String(item.sector || '').trim().toUpperCase(),
    riskDollars: firstFinite(item.risk_dollars, item.riskDollars),
  })).filter((item) => item.symbol && item.quantity !== 0);

  return {
    ...fallback,
    accountEquity: accountEquity ?? fallback.accountEquity,
    openPositions,
    source: 'WEBULL_READ_ONLY',
    snapshotFetchedAt: snapshot?.fetchedAt,
  };
}

export function normalizeWebullSignal(input = {}) {
  const symbol = String(input.symbol || '').trim().toUpperCase();
  const side = String(input.side || '').trim().toUpperCase();
  const orderType = String(input.orderType || 'LIMIT').trim().toUpperCase();
  const session = String(input.session || 'CORE').trim().toUpperCase();

  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error('Invalid symbol');
  if (!ALLOWED_SIDES.has(side)) throw new Error('Only BUY and SELL are allowed in phase 1');
  if (!ALLOWED_ORDER_TYPES.has(orderType)) throw new Error('Only MARKET and LIMIT are allowed in phase 1');
  if (!ALLOWED_SESSIONS.has(session)) throw new Error('Unsupported trading session');

  const requestedQuantity = optionalPositive(input.quantity, 'quantity');
  const limitPrice = orderType === 'LIMIT' ? finitePositive(input.limitPrice, 'limitPrice') : null;
  const stopLoss = finitePositive(input.stopLoss, 'stopLoss');
  const takeProfit = finitePositive(input.takeProfit, 'takeProfit');
  const referencePrice = limitPrice || optionalPositive(input.marketPrice, 'marketPrice');

  if (!referencePrice) throw new Error('A reference price is required');
  if (side === 'BUY' && stopLoss >= referencePrice) throw new Error('BUY stopLoss must be below entry price');
  if (side === 'BUY' && takeProfit <= referencePrice) throw new Error('BUY takeProfit must be above entry price');
  if (side === 'SELL' && stopLoss <= referencePrice) throw new Error('SELL stopLoss must be above entry price');
  if (side === 'SELL' && takeProfit >= referencePrice) throw new Error('SELL takeProfit must be below entry price');

  return {
    symbol,
    side,
    orderType,
    session,
    requestedQuantity,
    limitPrice,
    stopLoss,
    takeProfit,
    source: String(input.source || 'MOERAND').slice(0, 32),
    signalId: String(input.signalId || crypto.randomUUID()).slice(0, 64),
  };
}

export function enforceRiskLimits(order, env = {}) {
  const maxQuantity = finitePositive(env.WEBULL_MAX_QUANTITY || 10, 'WEBULL_MAX_QUANTITY');
  const maxNotional = finitePositive(env.WEBULL_MAX_NOTIONAL || 1000, 'WEBULL_MAX_NOTIONAL');
  const referencePrice = order.limitPrice || Number(env.WEBULL_MARKET_PRICE_CAP || 0);

  if (order.quantity > maxQuantity) throw new Error('Order exceeds maximum quantity');
  if (order.orderType === 'MARKET' && referencePrice <= 0) {
    throw new Error('Market orders require WEBULL_MARKET_PRICE_CAP during sandbox testing');
  }
  if (referencePrice * order.quantity > maxNotional) throw new Error('Order exceeds maximum notional value');
  return order;
}

export async function handleWebullSandboxOrder(request, env = {}) {
  if (request.method !== 'POST') {
    return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
  }

  try {
    const suppliedSecret = request.headers.get('x-moe-webhook-secret') || '';
    if (!env.MOE_WEBHOOK_SECRET || suppliedSecret !== env.MOE_WEBHOOK_SECRET) {
      return Response.json({ ok: false, error: 'Unauthorized' }, { status: 401 });
    }

    const payload = await request.json();
    const signal = normalizeWebullSignal(payload);
    const accountId = String(payload.accountId || env.WEBULL_ACCOUNT_ID || '').trim();
    let accountSnapshot = null;
    let portfolioInput = {
      ...(payload.portfolio || {}),
      accountEquity: payload.portfolio?.accountEquity ?? payload.accountEquity ?? payload.context?.accountEquity,
      signalSector: payload.portfolio?.signalSector ?? payload.sector,
    };

    if (env.WEBULL_READ_ONLY_SYNC === 'true' && accountId) {
      accountSnapshot = await getWebullAccountSnapshot(accountId, env);
      portfolioInput = normalizeWebullPortfolio(accountSnapshot, portfolioInput);
    }

    const context = {
      ...(payload.context || {}),
      marketPrice: payload.marketPrice ?? payload.context?.marketPrice,
      accountEquity: portfolioInput.accountEquity,
      riskPercent: payload.riskPercent ?? payload.context?.riskPercent,
    };
    const plan = buildTradePlan(signal, context, env);
    const portfolio = evaluatePortfolioRisk({ signal, plan, portfolio: portfolioInput, env });

    if (!portfolio.accepted) {
      plan.evaluation.accepted = false;
      plan.evaluation.reasons.push(...portfolio.reasons.filter((reason) => !plan.evaluation.reasons.includes(reason)));
    }

    const quantity = signal.requestedQuantity == null
      ? plan.sizing.quantity
      : Math.min(Math.floor(signal.requestedQuantity), plan.sizing.quantity);

    const order = enforceRiskLimits({
      symbol: signal.symbol,
      side: signal.side,
      orderType: signal.orderType,
      session: signal.session,
      quantity,
      limitPrice: signal.limitPrice,
      stopLoss: signal.stopLoss,
      takeProfit: signal.takeProfit,
      source: signal.source,
      signalId: signal.signalId,
    }, env);

    if (quantity < 1) {
      plan.evaluation.accepted = false;
      if (!plan.evaluation.reasons.includes('Calculated position size is zero')) {
        plan.evaluation.reasons.push('Calculated position size is zero');
      }
    }

    if (env.WEBULL_LIVE_TRADING === 'true') {
      return Response.json(
        { ok: false, blocked: true, error: 'Live trading is intentionally disabled in phase 1' },
        { status: 423 },
      );
    }

    return Response.json({
      ok: plan.evaluation.accepted,
      accepted: plan.evaluation.accepted,
      mode: env.WEBULL_SANDBOX_ENABLED === 'true' ? 'SANDBOX_DRY_RUN' : 'DRY_RUN',
      previewRequired: true,
      submitted: false,
      order,
      plan,
      portfolio,
      accountSync: {
        enabled: env.WEBULL_READ_ONLY_SYNC === 'true',
        used: Boolean(accountSnapshot),
        accountId: accountSnapshot ? accountId : null,
        fetchedAt: accountSnapshot?.fetchedAt || null,
      },
      decisionPipeline: ['SIGNAL_VALIDATION', 'WEBULL_ACCOUNT_SYNC', 'TRADE_ENGINE', 'POSITION_SIZING', 'PORTFOLIO_MANAGER', 'ORDER_PREVIEW'],
      message: plan.evaluation.accepted
        ? 'Trade accepted by all decision layers for preview but not sent to Webull.'
        : 'Trade rejected by MOE decision pipeline.',
      createdAt: new Date().toISOString(),
    }, { status: plan.evaluation.accepted ? 200 : 422 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Invalid order' }, { status: 400 });
  }
}
