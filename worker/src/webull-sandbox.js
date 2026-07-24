import { buildTradePlan } from './trade-engine.js';
import { evaluatePortfolioRisk } from './portfolio-manager.js';
import { getWebullAccountSnapshot, placeWebullSandboxOrder } from './webull-client.js';

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
    balanceData?.total_net_liquidation_value,
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

function evaluateAccountSafety(snapshot, signal, referencePrice, quantity, env = {}) {
  if (!snapshot) return { accepted: true, reasons: [], metrics: {} };

  const balance = snapshot.balance || {};
  const currencyAsset = Array.isArray(balance.account_currency_assets)
    ? balance.account_currency_assets.find((item) => String(item.currency || '').toUpperCase() === 'USD') || balance.account_currency_assets[0]
    : null;

  const dayBuyingPower = firstFinite(currencyAsset?.day_buying_power, balance.day_buying_power);
  const overnightBuyingPower = firstFinite(currencyAsset?.overnight_buying_power, balance.overnight_buying_power);
  const cashBalance = firstFinite(currencyAsset?.cash_balance, balance.total_cash_balance, balance.cash_balance);
  const netLiquidation = firstFinite(currencyAsset?.net_liquidation_value, balance.total_net_liquidation_value, balance.net_liquidation_value);
  const maintenanceMargin = firstFinite(balance.maintenance_margin);
  const marginCalls = Array.isArray(balance.open_margin_calls) ? balance.open_margin_calls : [];
  const estimatedNotional = Number.isFinite(referencePrice) && Number.isFinite(quantity) ? referencePrice * quantity : null;
  const reasons = [];

  const requirePositiveOvernight = env.WEBULL_REQUIRE_POSITIVE_OVERNIGHT_BP !== 'false';
  const blockNegativeCash = env.WEBULL_BLOCK_NEGATIVE_CASH === 'true';
  const minEquity = Number(env.WEBULL_MIN_NET_LIQUIDATION || 2000);
  const maintenanceBuffer = Number(env.WEBULL_MIN_MAINTENANCE_BUFFER || 1.15);

  if (marginCalls.length > 0) reasons.push('Account has an open margin call');
  if (Number.isFinite(netLiquidation) && netLiquidation < minEquity) reasons.push('Net liquidation is below the configured minimum');
  if (Number.isFinite(netLiquidation) && Number.isFinite(maintenanceMargin) && maintenanceMargin > 0 && netLiquidation < maintenanceMargin * maintenanceBuffer) {
    reasons.push('Maintenance margin safety buffer is too low');
  }

  if (signal.side === 'BUY') {
    if (requirePositiveOvernight && Number.isFinite(overnightBuyingPower) && overnightBuyingPower <= 0) {
      reasons.push('Overnight buying power is not positive');
    }
    if (blockNegativeCash && Number.isFinite(cashBalance) && cashBalance < 0) reasons.push('Cash balance is negative');
    if (Number.isFinite(dayBuyingPower) && Number.isFinite(estimatedNotional) && estimatedNotional > dayBuyingPower) {
      reasons.push('Estimated order value exceeds day buying power');
    }
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    metrics: {
      dayBuyingPower,
      overnightBuyingPower,
      cashBalance,
      netLiquidation,
      maintenanceMargin,
      estimatedNotional,
      marginCallCount: marginCalls.length,
    },
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
  if (order.orderType === 'MARKET' && referencePrice <= 0) throw new Error('Market orders require WEBULL_MARKET_PRICE_CAP during sandbox testing');
  if (referencePrice * order.quantity > maxNotional) throw new Error('Order exceeds maximum notional value');
  return order;
}

export async function handleWebullSandboxOrder(request, env = {}) {
  if (request.method !== 'POST') return Response.json({ ok: false, error: 'Method not allowed' }, { status: 405 });
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
      if (!plan.evaluation.reasons.includes('Calculated position size is zero')) plan.evaluation.reasons.push('Calculated position size is zero');
    }

    const referencePrice = signal.limitPrice || Number((payload.marketPrice ?? payload.context?.marketPrice ?? env.WEBULL_MARKET_PRICE_CAP) || 0);
    const accountSafety = evaluateAccountSafety(accountSnapshot, signal, referencePrice, quantity, env);
    if (!accountSafety.accepted) {
      plan.evaluation.accepted = false;
      plan.evaluation.reasons.push(...accountSafety.reasons.filter((reason) => !plan.evaluation.reasons.includes(reason)));
    }

    if (env.WEBULL_LIVE_TRADING === 'true' || env.WEBULL_ENVIRONMENT === 'production') {
      return Response.json({ ok: false, blocked: true, error: 'Production trading is intentionally disabled' }, { status: 423 });
    }

    const submissionRequested = payload.submitSandbox === true;
    const submissionEnabled = env.WEBULL_SANDBOX_ENABLED === 'true' && env.WEBULL_SANDBOX_ORDER_SUBMISSION === 'true';
    let submission = null;
    if (submissionRequested) {
      if (!submissionEnabled) throw new Error('Sandbox submission requested but server submission is disabled');
      if (!accountId) throw new Error('WEBULL_ACCOUNT_ID or payload.accountId is required');
      if (!plan.evaluation.accepted) {
        return Response.json({
          ok: false,
          accepted: false,
          submitted: false,
          blocked: true,
          order,
          plan,
          portfolio,
          accountSafety,
          message: 'Sandbox order was not submitted because the trade failed MOE safety rules.',
        }, { status: 422 });
      }
      submission = await placeWebullSandboxOrder(accountId, order, env);
    }

    const submitted = Boolean(submission);
    return Response.json({
      ok: plan.evaluation.accepted,
      accepted: plan.evaluation.accepted,
      mode: submitted ? 'SANDBOX_SUBMITTED' : (env.WEBULL_SANDBOX_ENABLED === 'true' ? 'SANDBOX_DRY_RUN' : 'DRY_RUN'),
      previewRequired: !submitted,
      submitted,
      order,
      plan,
      portfolio,
      accountSafety,
      submission,
      accountSync: {
        enabled: env.WEBULL_READ_ONLY_SYNC === 'true',
        used: Boolean(accountSnapshot),
        accountId: accountSnapshot ? accountId : null,
        fetchedAt: accountSnapshot?.fetchedAt || null,
      },
      decisionPipeline: ['SIGNAL_VALIDATION', 'WEBULL_ACCOUNT_SYNC', 'TRADE_ENGINE', 'POSITION_SIZING', 'PORTFOLIO_MANAGER', 'MARGIN_ACCOUNT_SAFETY', submitted ? 'SANDBOX_SUBMISSION' : 'ORDER_PREVIEW'],
      message: submitted
        ? 'Trade passed all decision layers and was submitted to Webull Sandbox.'
        : plan.evaluation.accepted
          ? 'Trade accepted by all decision layers for preview but not submitted.'
          : 'Trade rejected by MOE decision pipeline.',
      createdAt: new Date().toISOString(),
    }, { status: plan.evaluation.accepted ? 200 : 422 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Invalid order' }, { status: 400 });
  }
}
