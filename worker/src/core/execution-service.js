import { eventBus } from './event-bus.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function orderKey(opportunity = {}) {
  return [
    String(opportunity.symbol || '').toUpperCase(),
    String(opportunity.direction || ''),
    number(opportunity.entryPrice),
    number(opportunity.stopLoss),
    number(opportunity.takeProfit),
    number(opportunity.expiresAt),
  ].join(':');
}

export function buildExecutionOrder(opportunity = {}, tradePlan = null) {
  const direction = String(opportunity.direction || '').toLowerCase() === 'short' ? 'SELL' : 'BUY';
  const quantity = Math.floor(number(tradePlan?.sizing?.quantity, opportunity.quantity));

  return {
    clientOrderId: orderKey(opportunity),
    symbol: String(opportunity.symbol || '').toUpperCase(),
    side: direction,
    orderType: 'LIMIT',
    quantity,
    limitPrice: number(opportunity.entryPrice),
    lowerZone: number(opportunity.lowerZone),
    upperZone: number(opportunity.upperZone),
    stopLoss: number(opportunity.stopLoss),
    takeProfit: number(opportunity.takeProfit),
    timeInForce: 'DAY',
    expiresAt: number(opportunity.expiresAt),
    metadata: {
      timeframe: opportunity.timeframe || null,
      confidence: number(opportunity.confidence),
      riskReward: number(opportunity.riskReward),
      liquidity: opportunity.liquidity || null,
      zoneAnchor: opportunity.zoneAnchor || null,
    },
  };
}

export class OpportunityExecutionService {
  constructor({ storage, broker, riskManager, mode = 'paper', autoExecute = false } = {}) {
    this.storage = storage;
    this.broker = broker;
    this.riskManager = riskManager;
    this.mode = String(mode || 'paper').toLowerCase();
    this.autoExecute = autoExecute === true;
    this.memory = new Map();
    this.unsubscribers = [];
  }

  async read(key) {
    if (this.storage?.get) return this.storage.get(key);
    return this.memory.get(key);
  }

  async write(key, value) {
    if (this.storage?.put) return this.storage.put(key, value);
    this.memory.set(key, value);
  }

  async cancelPrevious(symbol, replacementOrder) {
    const stateKey = `execution:${symbol}`;
    const previous = await this.read(stateKey);
    if (!previous?.brokerOrderId || previous.status === 'cancelled') return null;
    if (!this.broker?.cancelOrder) return null;

    const cancelled = await this.broker.cancelOrder(previous.brokerOrderId, {
      reason: 'BETTER_OPPORTUNITY',
      replacementClientOrderId: replacementOrder.clientOrderId,
    });
    await this.write(stateKey, { ...previous, status: 'cancelled', cancelledAt: Date.now() });
    await eventBus.emit('execution:cancelled', { symbol, previous, cancelled, timestamp: Date.now() });
    return cancelled;
  }

  async execute(opportunity, { replaced = false, tradePlan = null } = {}) {
    if (!opportunity?.accepted) return { executed: false, reason: 'OPPORTUNITY_NOT_ACCEPTED' };

    const order = buildExecutionOrder(opportunity, tradePlan);
    if (!order.symbol || order.quantity < 1 || order.limitPrice <= 0 || order.stopLoss <= 0 || order.takeProfit <= 0) {
      return { executed: false, reason: 'INVALID_EXECUTION_ORDER', order };
    }
    if (order.expiresAt > 0 && order.expiresAt <= Date.now()) {
      return { executed: false, reason: 'OPPORTUNITY_EXPIRED', order };
    }

    const stateKey = `execution:${order.symbol}`;
    const previous = await this.read(stateKey);
    if (previous?.clientOrderId === order.clientOrderId && previous.status !== 'cancelled') {
      return { executed: false, reason: 'DUPLICATE_EXECUTION', order, previous };
    }

    if (this.riskManager?.evaluateOrder) {
      const riskDecision = await this.riskManager.evaluateOrder(order);
      if (!riskDecision?.accepted) {
        const rejected = {
          ...order,
          mode: this.mode,
          status: 'rejected_by_risk',
          riskDecision,
          rejectedAt: Date.now(),
        };
        await this.write(stateKey, rejected);
        await eventBus.emit('execution:rejected-by-risk', rejected);
        return { executed: false, reason: riskDecision?.reason || 'RISK_REJECTED', order: rejected };
      }
    }

    if (replaced) await this.cancelPrevious(order.symbol, order);

    const intent = {
      ...order,
      mode: this.mode,
      status: 'pending',
      createdAt: Date.now(),
    };
    await eventBus.emit('execution:intent-created', intent);

    if (!this.autoExecute) {
      const pending = { ...intent, status: 'approval_required' };
      await this.write(stateKey, pending);
      await eventBus.emit('execution:approval-required', pending);
      return { executed: false, reason: 'APPROVAL_REQUIRED', order: pending };
    }

    if (!this.broker?.placeBracketOrder) {
      const pending = { ...intent, status: 'broker_not_configured' };
      await this.write(stateKey, pending);
      return { executed: false, reason: 'BROKER_NOT_CONFIGURED', order: pending };
    }

    const response = await this.broker.placeBracketOrder(order, { mode: this.mode });
    const submitted = {
      ...intent,
      status: 'submitted',
      brokerOrderId: response?.orderId || response?.id || null,
      brokerResponse: response || null,
      submittedAt: Date.now(),
    };
    await this.write(stateKey, submitted);
    await eventBus.emit('execution:submitted', submitted);
    return { executed: true, order: submitted };
  }

  start() {
    if (this.unsubscribers.length) return this;
    this.unsubscribers.push(
      eventBus.on('opportunity:created', (payload) => this.execute(payload, { replaced: false, tradePlan: payload.tradePlan })),
      eventBus.on('opportunity:replaced', (payload) => this.execute(payload, { replaced: true, tradePlan: payload.tradePlan })),
    );
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}

export function initializeOpportunityExecution(options = {}) {
  return new OpportunityExecutionService(options).start();
}
