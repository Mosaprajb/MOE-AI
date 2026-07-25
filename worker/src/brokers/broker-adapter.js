function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nowId(prefix = 'order') {
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}`;
}

export const BROKER_ORDER_STATUSES = Object.freeze({
  PENDING: 'pending',
  SUBMITTED: 'submitted',
  PARTIALLY_FILLED: 'partially_filled',
  FILLED: 'filled',
  CANCELLED: 'cancelled',
  REJECTED: 'rejected',
  EXPIRED: 'expired',
});

export class BrokerAdapter {
  constructor({ mode = 'paper' } = {}) {
    this.mode = String(mode || 'paper').toLowerCase();
  }

  async connect() {
    throw new Error('BrokerAdapter.connect() must be implemented');
  }

  async placeBracketOrder() {
    throw new Error('BrokerAdapter.placeBracketOrder() must be implemented');
  }

  async cancelOrder() {
    throw new Error('BrokerAdapter.cancelOrder() must be implemented');
  }

  async replaceOrder(orderId, order, options = {}) {
    await this.cancelOrder(orderId, { reason: 'REPLACED', ...options });
    return this.placeBracketOrder(order, options);
  }

  async getOrder() {
    throw new Error('BrokerAdapter.getOrder() must be implemented');
  }

  async getOrders() {
    throw new Error('BrokerAdapter.getOrders() must be implemented');
  }

  async getPositions() {
    throw new Error('BrokerAdapter.getPositions() must be implemented');
  }
}

export class PaperBrokerAdapter extends BrokerAdapter {
  constructor(options = {}) {
    super({ ...options, mode: 'paper' });
    this.connected = false;
    this.orders = new Map();
    this.positions = new Map();
  }

  async connect() {
    this.connected = true;
    return { connected: true, mode: this.mode, broker: 'paper' };
  }

  validateOrder(order = {}) {
    const quantity = Math.floor(number(order.quantity));
    const limitPrice = number(order.limitPrice);
    const stopLoss = number(order.stopLoss);
    const takeProfit = number(order.takeProfit);
    if (!order.symbol || quantity < 1 || limitPrice <= 0 || stopLoss <= 0 || takeProfit <= 0) {
      throw new Error('Paper broker received an invalid bracket order');
    }
    return { quantity, limitPrice, stopLoss, takeProfit };
  }

  async placeBracketOrder(order = {}) {
    if (!this.connected) await this.connect();
    const values = this.validateOrder(order);
    const orderId = nowId('paper');
    const record = {
      ...order,
      ...values,
      orderId,
      broker: 'paper',
      mode: 'paper',
      status: BROKER_ORDER_STATUSES.SUBMITTED,
      filledQuantity: 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.orders.set(orderId, record);
    return { ...record };
  }

  async cancelOrder(orderId, metadata = {}) {
    const current = this.orders.get(orderId);
    if (!current) return { orderId, status: 'not_found' };
    if ([BROKER_ORDER_STATUSES.FILLED, BROKER_ORDER_STATUSES.CANCELLED].includes(current.status)) {
      return { ...current };
    }
    const cancelled = {
      ...current,
      status: BROKER_ORDER_STATUSES.CANCELLED,
      cancellation: metadata,
      cancelledAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.orders.set(orderId, cancelled);
    return { ...cancelled };
  }

  async getOrder(orderId) {
    const order = this.orders.get(orderId);
    return order ? { ...order } : null;
  }

  async getOrders({ symbol, status } = {}) {
    return [...this.orders.values()]
      .filter((order) => !symbol || order.symbol === String(symbol).toUpperCase())
      .filter((order) => !status || order.status === status)
      .map((order) => ({ ...order }));
  }

  async getPositions() {
    return [...this.positions.values()].map((position) => ({ ...position }));
  }

  async simulateFill(orderId, { quantity, fillPrice } = {}) {
    const current = this.orders.get(orderId);
    if (!current) throw new Error('Paper order not found');
    if ([BROKER_ORDER_STATUSES.CANCELLED, BROKER_ORDER_STATUSES.REJECTED, BROKER_ORDER_STATUSES.EXPIRED].includes(current.status)) {
      throw new Error(`Cannot fill order with status ${current.status}`);
    }

    const remaining = current.quantity - number(current.filledQuantity);
    const fillQuantity = Math.max(0, Math.min(remaining, Math.floor(number(quantity, remaining))));
    if (fillQuantity < 1) throw new Error('Fill quantity must be positive');

    const totalFilled = number(current.filledQuantity) + fillQuantity;
    const status = totalFilled >= current.quantity
      ? BROKER_ORDER_STATUSES.FILLED
      : BROKER_ORDER_STATUSES.PARTIALLY_FILLED;
    const updated = {
      ...current,
      status,
      filledQuantity: totalFilled,
      averageFillPrice: number(fillPrice, current.limitPrice),
      updatedAt: Date.now(),
      filledAt: status === BROKER_ORDER_STATUSES.FILLED ? Date.now() : current.filledAt,
    };
    this.orders.set(orderId, updated);

    const signedQuantity = current.side === 'SELL' ? -fillQuantity : fillQuantity;
    const existing = this.positions.get(current.symbol) || { symbol: current.symbol, quantity: 0, averagePrice: 0 };
    const newQuantity = number(existing.quantity) + signedQuantity;
    this.positions.set(current.symbol, {
      symbol: current.symbol,
      quantity: newQuantity,
      averagePrice: number(fillPrice, current.limitPrice),
      updatedAt: Date.now(),
    });
    return { ...updated };
  }
}
