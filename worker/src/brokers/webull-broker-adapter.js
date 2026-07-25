import { BrokerAdapter } from './broker-adapter.js';

function requireTransportMethod(transport, method) {
  if (typeof transport?.[method] !== 'function') {
    throw new Error(`Webull transport must implement ${method}()`);
  }
}

export class WebullBrokerAdapter extends BrokerAdapter {
  constructor({ transport, mode = 'paper', accountId = null } = {}) {
    super({ mode });
    this.transport = transport;
    this.accountId = accountId;
    this.connected = false;
  }

  async connect() {
    requireTransportMethod(this.transport, 'connect');
    const session = await this.transport.connect({ mode: this.mode, accountId: this.accountId });
    this.connected = session?.connected !== false;
    return { broker: 'webull', mode: this.mode, accountId: this.accountId, ...session };
  }

  async ensureConnected() {
    if (!this.connected) await this.connect();
  }

  async placeBracketOrder(order, options = {}) {
    await this.ensureConnected();
    requireTransportMethod(this.transport, 'placeBracketOrder');
    return this.transport.placeBracketOrder(order, {
      mode: this.mode,
      accountId: this.accountId,
      ...options,
    });
  }

  async cancelOrder(orderId, options = {}) {
    await this.ensureConnected();
    requireTransportMethod(this.transport, 'cancelOrder');
    return this.transport.cancelOrder(orderId, {
      mode: this.mode,
      accountId: this.accountId,
      ...options,
    });
  }

  async replaceOrder(orderId, order, options = {}) {
    await this.ensureConnected();
    if (typeof this.transport?.replaceOrder === 'function') {
      return this.transport.replaceOrder(orderId, order, {
        mode: this.mode,
        accountId: this.accountId,
        ...options,
      });
    }
    return super.replaceOrder(orderId, order, options);
  }

  async getOrder(orderId) {
    await this.ensureConnected();
    requireTransportMethod(this.transport, 'getOrder');
    return this.transport.getOrder(orderId, { mode: this.mode, accountId: this.accountId });
  }

  async getOrders(filters = {}) {
    await this.ensureConnected();
    requireTransportMethod(this.transport, 'getOrders');
    return this.transport.getOrders({ ...filters, mode: this.mode, accountId: this.accountId });
  }

  async getPositions() {
    await this.ensureConnected();
    requireTransportMethod(this.transport, 'getPositions');
    return this.transport.getPositions({ mode: this.mode, accountId: this.accountId });
  }
}

export function createWebullBrokerAdapter(options = {}) {
  return new WebullBrokerAdapter(options);
}
