const ALLOWED_SIDES = new Set(["BUY", "SELL"]);
const ALLOWED_ORDER_TYPES = new Set(["MARKET", "LIMIT"]);
const ALLOWED_SESSIONS = new Set(["CORE", "ALL"]);

function finitePositive(value, field) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new Error(`${field} must be a positive number`);
  }
  return number;
}

export function normalizeWebullSignal(input = {}) {
  const symbol = String(input.symbol || "").trim().toUpperCase();
  const side = String(input.side || "").trim().toUpperCase();
  const orderType = String(input.orderType || "LIMIT").trim().toUpperCase();
  const session = String(input.session || "CORE").trim().toUpperCase();

  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) throw new Error("Invalid symbol");
  if (!ALLOWED_SIDES.has(side)) throw new Error("Only BUY and SELL are allowed in phase 1");
  if (!ALLOWED_ORDER_TYPES.has(orderType)) throw new Error("Only MARKET and LIMIT are allowed in phase 1");
  if (!ALLOWED_SESSIONS.has(session)) throw new Error("Unsupported trading session");

  const quantity = finitePositive(input.quantity, "quantity");
  const limitPrice = orderType === "LIMIT" ? finitePositive(input.limitPrice, "limitPrice") : null;
  const stopLoss = input.stopLoss == null ? null : finitePositive(input.stopLoss, "stopLoss");
  const takeProfit = input.takeProfit == null ? null : finitePositive(input.takeProfit, "takeProfit");

  if (side === "BUY" && stopLoss != null && limitPrice != null && stopLoss >= limitPrice) {
    throw new Error("BUY stopLoss must be below limitPrice");
  }
  if (side === "BUY" && takeProfit != null && limitPrice != null && takeProfit <= limitPrice) {
    throw new Error("BUY takeProfit must be above limitPrice");
  }

  return {
    symbol,
    side,
    orderType,
    session,
    quantity,
    limitPrice,
    stopLoss,
    takeProfit,
    source: String(input.source || "MOERAND").slice(0, 32),
    signalId: String(input.signalId || crypto.randomUUID()).slice(0, 64),
  };
}

export function enforceRiskLimits(order, env = {}) {
  const maxQuantity = finitePositive(env.WEBULL_MAX_QUANTITY || 10, "WEBULL_MAX_QUANTITY");
  const maxNotional = finitePositive(env.WEBULL_MAX_NOTIONAL || 1000, "WEBULL_MAX_NOTIONAL");

  if (order.quantity > maxQuantity) throw new Error("Order exceeds maximum quantity");

  const referencePrice = order.limitPrice || Number(env.WEBULL_MARKET_PRICE_CAP || 0);
  if (order.orderType === "MARKET" && referencePrice <= 0) {
    throw new Error("Market orders require WEBULL_MARKET_PRICE_CAP during sandbox testing");
  }
  if (referencePrice * order.quantity > maxNotional) {
    throw new Error("Order exceeds maximum notional value");
  }

  return order;
}

export async function handleWebullSandboxOrder(request, env = {}) {
  if (request.method !== "POST") {
    return Response.json({ ok: false, error: "Method not allowed" }, { status: 405 });
  }

  try {
    const suppliedSecret = request.headers.get("x-moe-webhook-secret") || "";
    if (!env.MOE_WEBHOOK_SECRET || suppliedSecret !== env.MOE_WEBHOOK_SECRET) {
      return Response.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }

    const order = enforceRiskLimits(normalizeWebullSignal(await request.json()), env);
    const liveEnabled = env.WEBULL_LIVE_TRADING === "true";
    const sandboxEnabled = env.WEBULL_SANDBOX_ENABLED === "true";

    if (liveEnabled) {
      return Response.json(
        { ok: false, blocked: true, error: "Live trading is intentionally disabled in phase 1" },
        { status: 423 },
      );
    }

    return Response.json({
      ok: true,
      mode: sandboxEnabled ? "SANDBOX_DRY_RUN" : "DRY_RUN",
      previewRequired: true,
      submitted: false,
      order,
      message: "Order validated but not sent to Webull.",
      createdAt: new Date().toISOString(),
    });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : "Invalid order" }, { status: 400 });
  }
}
