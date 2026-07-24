import { buildTradePlan } from './trade-engine.js';

const ALLOWED_SIDES = new Set(['BUY', 'SELL']);
const ALLOWED_ORDER_TYPES = new Set(['MARKET', 'LIMIT']);
const ALLOWED_SESSIONS = new Set(['CORE', 'ALL']);

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return number;
}

function optionalPositive(value, field) {
  return value == null || value === '' ? null : finitePositive(value, field);
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
    const context = {
      ...(payload.context || {}),
      marketPrice: payload.marketPrice ?? payload.context?.marketPrice,
      accountEquity: payload.accountEquity ?? payload.context?.accountEquity,
      riskPercent: payload.riskPercent ?? payload.context?.riskPercent,
    };
    const plan = buildTradePlan(signal, context, env);

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

    const liveEnabled = env.WEBULL_LIVE_TRADING === 'true';
    const sandboxEnabled = env.WEBULL_SANDBOX_ENABLED === 'true';

    if (liveEnabled) {
      return Response.json(
        { ok: false, blocked: true, error: 'Live trading is intentionally disabled in phase 1' },
        { status: 423 },
      );
    }

    return Response.json({
      ok: plan.evaluation.accepted,
      accepted: plan.evaluation.accepted,
      mode: sandboxEnabled ? 'SANDBOX_DRY_RUN' : 'DRY_RUN',
      previewRequired: true,
      submitted: false,
      order,
      plan,
      message: plan.evaluation.accepted
        ? 'Trade accepted for preview but not sent to Webull.'
        : 'Trade rejected by MOE risk and confidence rules.',
      createdAt: new Date().toISOString(),
    }, { status: plan.evaluation.accepted ? 200 : 422 });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Invalid order' }, { status: 400 });
  }
}
