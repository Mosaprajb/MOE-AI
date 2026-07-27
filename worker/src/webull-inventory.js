const ACTIVE_ORDER_STATUSES = new Set([
  'NEW',
  'PENDING',
  'PENDING_NEW',
  'SUBMITTED',
  'WORKING',
  'OPEN',
  'PARTIALLY_FILLED',
  'PARTIAL_FILLED',
  'TRIGGER_PENDING',
]);

function firstFinite(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function normalizeSide(value) {
  const side = String(value || '').trim().toUpperCase();
  if (['SELL', 'SELL_SHORT', 'SHORT'].includes(side)) return 'SELL';
  if (['BUY', 'BUY_TO_COVER', 'COVER'].includes(side)) return 'BUY';
  return side;
}

function normalizeStatus(value) {
  return String(value || '').trim().toUpperCase().replaceAll(' ', '_');
}

function pickArray(value, keys = []) {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== 'object') return [];
  for (const key of keys) {
    if (Array.isArray(value[key])) return value[key];
  }
  if (Array.isArray(value.data)) return value.data;
  if (value.data && typeof value.data === 'object') {
    for (const key of keys) {
      if (Array.isArray(value.data[key])) return value.data[key];
    }
  }
  return [];
}

function normalizePosition(item = {}) {
  const symbol = normalizeSymbol(
    item.symbol || item.ticker?.symbol || item.instrument?.symbol || item.security?.symbol,
  );
  const quantity = firstFinite(
    item.quantity,
    item.qty,
    item.position,
    item.holding_quantity,
    item.position_quantity,
  ) || 0;
  const averagePrice = firstFinite(
    item.average_price,
    item.averagePrice,
    item.avg_price,
    item.cost_price,
    item.costPrice,
  );
  const marketPrice = firstFinite(
    item.market_price,
    item.marketPrice,
    item.last_price,
    item.lastPrice,
  );
  const marketValue = firstFinite(item.market_value, item.marketValue, item.position_value);
  const unrealizedPnl = firstFinite(
    item.unrealized_profit_loss,
    item.unrealizedPnl,
    item.unrealized_pl,
  );
  return {
    symbol,
    quantity,
    direction: quantity < 0 ? 'SHORT' : 'LONG',
    averagePrice,
    marketPrice,
    marketValue,
    unrealizedPnl,
    sector: String(item.sector || '').trim().toUpperCase() || null,
    raw: item,
  };
}

function normalizeOrder(item = {}) {
  const symbol = normalizeSymbol(
    item.symbol || item.ticker?.symbol || item.instrument?.symbol || item.security?.symbol,
  );
  const status = normalizeStatus(item.status || item.order_status || item.orderStatus);
  const quantity = firstFinite(item.quantity, item.qty, item.total_quantity, item.order_quantity) || 0;
  const filledQuantity = firstFinite(
    item.filled_quantity,
    item.filledQuantity,
    item.cumulative_quantity,
    item.cum_qty,
  ) || 0;
  return {
    orderId: String(item.order_id || item.orderId || item.client_order_id || item.clientOrderId || '').trim() || null,
    comboOrderId: String(item.combo_order_id || item.comboOrderId || item.client_combo_order_id || '').trim() || null,
    symbol,
    side: normalizeSide(item.side || item.action || item.order_side),
    status,
    active: ACTIVE_ORDER_STATUSES.has(status),
    orderType: String(item.order_type || item.orderType || '').trim().toUpperCase() || null,
    quantity,
    filledQuantity,
    remainingQuantity: Math.max(0, quantity - filledQuantity),
    limitPrice: firstFinite(item.limit_price, item.limitPrice, item.price),
    stopPrice: firstFinite(item.stop_price, item.stopPrice, item.trigger_price),
    createdAt: item.created_at || item.createdAt || item.create_time || null,
    raw: item,
  };
}

export function buildWebullInventory(snapshot = {}) {
  const rawPositions = pickArray(snapshot.positions, ['positions', 'position_list', 'list', 'items']);
  const rawOrders = pickArray(snapshot.openOrders, ['orders', 'order_list', 'list', 'items']);
  const positions = rawPositions.map(normalizePosition).filter((item) => item.symbol && item.quantity !== 0);
  const orders = rawOrders.map(normalizeOrder).filter((item) => item.symbol);
  const openOrders = orders.filter((item) => item.active);

  const positionsBySymbol = Object.fromEntries(positions.map((position) => [position.symbol, position]));
  const openOrdersBySymbol = {};
  for (const order of openOrders) {
    if (!openOrdersBySymbol[order.symbol]) openOrdersBySymbol[order.symbol] = [];
    openOrdersBySymbol[order.symbol].push(order);
  }

  const symbols = [...new Set([
    ...positions.map((position) => position.symbol),
    ...openOrders.map((order) => order.symbol),
  ])].sort();

  return {
    accountId: snapshot.accountId || null,
    fetchedAt: snapshot.fetchedAt || new Date().toISOString(),
    readOnly: true,
    positionCount: positions.length,
    openOrderCount: openOrders.length,
    symbols,
    positions,
    openOrders,
    positionsBySymbol,
    openOrdersBySymbol,
  };
}

export function evaluateWebullInventoryConflict({ signal = {}, inventory = {}, env = {} } = {}) {
  const symbol = normalizeSymbol(signal.symbol);
  const side = normalizeSide(signal.side);
  if (!symbol) throw new Error('signal.symbol is required');
  if (!['BUY', 'SELL'].includes(side)) throw new Error('signal.side must be BUY or SELL');

  const position = inventory.positionsBySymbol?.[symbol] || null;
  const openOrders = inventory.openOrdersBySymbol?.[symbol] || [];
  const reasons = [];
  const warnings = [];
  const blockDuplicateOrders = env.WEBULL_BLOCK_DUPLICATE_ORDERS !== 'false';
  const blockExistingPosition = env.WEBULL_BLOCK_EXISTING_POSITION !== 'false';
  const allowExitAgainstPosition = env.WEBULL_ALLOW_POSITION_EXIT !== 'false';

  const sameSideOrders = openOrders.filter((order) => order.side === side);
  const oppositeSideOrders = openOrders.filter((order) => order.side && order.side !== side);

  if (blockDuplicateOrders && sameSideOrders.length > 0) {
    reasons.push(`Active ${side} order already exists for ${symbol}`);
  }
  if (oppositeSideOrders.length > 0) {
    reasons.push(`Opposing active order already exists for ${symbol}`);
  }

  if (position && blockExistingPosition) {
    const positionSide = position.quantity > 0 ? 'BUY' : 'SELL';
    const isExit = allowExitAgainstPosition && positionSide !== side;
    if (!isExit) reasons.push(`Existing ${position.direction} position already exists for ${symbol}`);
    else warnings.push(`Signal is treated as an exit against the existing ${position.direction} position`);
  }

  return {
    accepted: reasons.length === 0,
    symbol,
    side,
    reasons,
    warnings,
    metrics: {
      hasPosition: Boolean(position),
      positionQuantity: position?.quantity || 0,
      activeOrderCount: openOrders.length,
      sameSideOrderCount: sameSideOrders.length,
      oppositeSideOrderCount: oppositeSideOrders.length,
    },
    position,
    openOrders,
    readOnly: true,
  };
}

export function reconcileWebullInventory(previous = {}, current = {}) {
  const previousPositions = previous.positionsBySymbol || {};
  const currentPositions = current.positionsBySymbol || {};
  const openedPositions = [];
  const closedPositions = [];
  const changedPositions = [];

  for (const [symbol, position] of Object.entries(currentPositions)) {
    const prior = previousPositions[symbol];
    if (!prior) openedPositions.push(position);
    else if (prior.quantity !== position.quantity || prior.averagePrice !== position.averagePrice) {
      changedPositions.push({ symbol, previous: prior, current: position });
    }
  }
  for (const [symbol, position] of Object.entries(previousPositions)) {
    if (!currentPositions[symbol]) closedPositions.push(position);
  }

  const key = (order) => order.orderId || `${order.symbol}:${order.side}:${order.orderType}:${order.quantity}`;
  const previousOrders = new Map((previous.openOrders || []).map((order) => [key(order), order]));
  const currentOrders = new Map((current.openOrders || []).map((order) => [key(order), order]));
  const openedOrders = [];
  const removedOrders = [];

  for (const [orderKey, order] of currentOrders) if (!previousOrders.has(orderKey)) openedOrders.push(order);
  for (const [orderKey, order] of previousOrders) if (!currentOrders.has(orderKey)) removedOrders.push(order);

  return {
    changed: openedPositions.length > 0
      || closedPositions.length > 0
      || changedPositions.length > 0
      || openedOrders.length > 0
      || removedOrders.length > 0,
    openedPositions,
    closedPositions,
    changedPositions,
    openedOrders,
    removedOrders,
    reconciledAt: new Date().toISOString(),
    readOnly: true,
  };
}
