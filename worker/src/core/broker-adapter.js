import { eventBus } from './event-bus.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSide(value) {
  const side = String(value || '').toUpperCase();
  return side === 'SELL' || side === 'SHORT' ? 'SELL' : 'BUY';
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

export class BrokerAdapter {
  constructor({ name = 'generic', mode = 'paper' } = {}) {
    this.name = String(name || 'generic');
    this.mode = String(mode || 'paper').toLowerCase();
    this.connected = false;
  }

  async connect() {
    this.connected = true;
    await eventBus.emit('broker:connected', this.getStatus());
    return this.getStatus();
  }

  async disconnect() {
    this.connected = false;
    await eventBus.emit('broker:disconnected', this.getStatus());
    return this.getStatus();
  }

  getStatus() {
    return {
      name: this.name,
      mode: this.mode,
      connected: this.connected,
      timestamp: Date.now(),
    };
  }

  async placeBracketOrder() {
    throw new Error(`${this.name} does not implement placeBracketOrder`);
  }

  async cancelOrder() {
    throw new Error(`${this.name} does not implement cancelOrder`);
  }

  async getOrder() {
    throw new Error(`${this.name} does not implement getOrder`);
  }

  async listOpenOrders() {
    throw new Error(`${this.name} does not implement listOpenOrders`);
  }
}

export class PaperBrokerAdapter extends BrokerAdapter {
  constructor(options = {}) {
    super({ ...options, name: options.name || 'paper-broker', mode: 'paper' });
    this.orders = new Map();
    this.sequence = 0;
  }

  validateBracketOrder(order = {}) {
    const side = normalizeSide(order.side);
    const quantity = Math.floor(number(order.quantity));
    const limitPrice = number(order.limitPrice);
    const stopLoss = number(order.stopLoss);
    const takeProfit = number(order.takeProfit);
    const validLevels = side === 'SELL'
      ? stopLoss > limitPrice && takeProfit < limitPrice
      : stopLoss < limitPrice && takeProfit > limitPrice;

    if (!order.symbol) return { valid: false, reason: 'SYMBOL_REQUIRED' };
    if (quantity < 1) return { valid: false, reason: 'INVALID_QUANTITY' };
    if (limitPrice <= 0) return { valid: false, reason: 'INVALID_LIMIT_PRICE' };
    if (!validLevels) return { valid: false, reason: 'INVALID_BRACKET_LEVELS' };
    return { valid: true };
  }

  async placeBracketOrder(order = {}, context = {}) {
    if (!this.connected) await this.connect();
    const validation = this.validateBracketOrder(order);
    if (!validation.valid) {
      const error = new Error(validation.reason);
      error.code = validation.reason;
      throw error;
    }

    const orderId = `paper-${Date.now()}-${this.sequence += 1}`;
    const stored = {
      ...clone(order),
      orderId,
      broker: this.name,
      mode: context.mode || this.mode,
      side: normalizeSide(order.side),
      status: 'OPEN',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    this.orders.set(orderId, stored);
    await eventBus.emit('broker:order-opened', clone(stored));
    return clone(stored);
  }

  async cancelOrder(orderId, metadata = {}) {
    const order = this.orders.get(orderId);
    if (!order) return { cancelled: false, reason: 'ORDER_NOT_FOUND', orderId };
    if (order.status !== 'OPEN') return { cancelled: false, reason: 'ORDER_NOT_OPEN', order: clone(order) };

    order.status = 'CANCELLED';
    order.cancelMetadata = clone(metadata);
    order.cancelledAt = Date.now();
    order.updatedAt = order.cancelledAt;
    this.orders.set(orderId, order);
    await eventBus.emit('broker:order-cancelled', clone(order));
    return { cancelled: true, order: clone(order) };
  }

  async getOrder(orderId) {
    return clone(this.orders.get(orderId) || null);
  }

  async listOpenOrders() {
    return [...this.orders.values()]
      .filter((order) => order.status === 'OPEN')
      .map(clone);
  }

  async fillOrder(orderId, { fillPrice = null, filledAt = Date.now() } = {}) {
    const order = this.orders.get(orderId);
    if (!order) return { filled: false, reason: 'ORDER_NOT_FOUND', orderId };
    if (order.status !== 'OPEN') return { filled: false, reason: 'ORDER_NOT_OPEN', order: clone(order) };

    order.status = 'FILLED';
    order.fillPrice = number(fillPrice, order.limitPrice);
    order.filledAt = filledAt;
    order.updatedAt = filledAt;
    this.orders.set(orderId, order);
    await eventBus.emit('broker:order-filled', clone(order));
    return { filled: true, order: clone(order) };
  }
}

export function createBrokerAdapter(options = {}) {
  const type = String(options.type || options.mode || 'paper').toLowerCase();
  if (type === 'paper') return new PaperBrokerAdapter(options);
  return new BrokerAdapter(options);
}
