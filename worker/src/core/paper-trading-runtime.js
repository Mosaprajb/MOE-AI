import { eventBus } from './event-bus.js';
import { initializeOpportunityExecution } from './execution-service.js';
import { PaperBrokerAdapter, BROKER_ORDER_STATUSES } from '../brokers/broker-adapter.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function crossedEntry(order, marketPrice) {
  if (order.side === 'SELL') return marketPrice >= number(order.limitPrice);
  return marketPrice <= number(order.limitPrice);
}

function reachedTakeProfit(position, marketPrice) {
  if (position.side === 'SELL') return marketPrice <= number(position.takeProfit);
  return marketPrice >= number(position.takeProfit);
}

function reachedStopLoss(position, marketPrice) {
  if (position.side === 'SELL') return marketPrice >= number(position.stopLoss);
  return marketPrice <= number(position.stopLoss);
}

export class PaperTradingRuntime {
  constructor({ storage, autoExecute = true, autoFill = true } = {}) {
    this.storage = storage;
    this.autoFill = autoFill !== false;
    this.broker = new PaperBrokerAdapter();
    this.execution = initializeOpportunityExecution({
      storage,
      broker: this.broker,
      mode: 'paper',
      autoExecute,
    });
    this.positions = new Map();
    this.unsubscribers = [];
  }

  async start() {
    await this.broker.connect();
    if (!this.unsubscribers.length) {
      this.unsubscribers.push(
        eventBus.on('execution:submitted', (order) => this.onSubmitted(order)),
        eventBus.on('market:price', (tick) => this.onPrice(tick)),
      );
    }
    await eventBus.emit('paper:runtime-ready', { mode: 'paper', timestamp: Date.now() });
    return this;
  }

  async onSubmitted(order) {
    if (!this.autoFill || !order?.brokerOrderId) return;
    const marketPrice = number(order.marketPrice, order.limitPrice);
    if (crossedEntry(order, marketPrice)) {
      await this.fillOrder(order.brokerOrderId, marketPrice);
    }
  }

  async fillOrder(orderId, fillPrice) {
    const filled = await this.broker.simulateFill(orderId, { fillPrice });
    if (filled.status !== BROKER_ORDER_STATUSES.FILLED) return filled;

    const position = {
      symbol: filled.symbol,
      side: filled.side,
      quantity: filled.quantity,
      entryPrice: number(filled.averageFillPrice, filled.limitPrice),
      stopLoss: number(filled.stopLoss),
      takeProfit: number(filled.takeProfit),
      brokerOrderId: filled.orderId,
      openedAt: Date.now(),
      status: 'open',
    };
    this.positions.set(position.symbol, position);
    await eventBus.emit('trade:opened', { ...position, mode: 'paper' });
    return filled;
  }

  async onPrice({ symbol, price, timestamp = Date.now() } = {}) {
    const normalizedSymbol = String(symbol || '').toUpperCase();
    const marketPrice = number(price);
    if (!normalizedSymbol || marketPrice <= 0) return null;

    const openOrders = await this.broker.getOrders({ symbol: normalizedSymbol, status: BROKER_ORDER_STATUSES.SUBMITTED });
    for (const order of openOrders) {
      if (order.expiresAt > 0 && order.expiresAt <= timestamp) {
        await this.broker.cancelOrder(order.orderId, { reason: 'OPPORTUNITY_EXPIRED' });
        await eventBus.emit('execution:expired', { ...order, timestamp });
      } else if (this.autoFill && crossedEntry(order, marketPrice)) {
        await this.fillOrder(order.orderId, marketPrice);
      }
    }

    const position = this.positions.get(normalizedSymbol);
    if (!position || position.status !== 'open') return position || null;

    const exitReason = reachedTakeProfit(position, marketPrice)
      ? 'TAKE_PROFIT'
      : reachedStopLoss(position, marketPrice)
        ? 'STOP_LOSS'
        : null;
    if (!exitReason) return position;

    const direction = position.side === 'SELL' ? -1 : 1;
    const pnl = (marketPrice - position.entryPrice) * position.quantity * direction;
    const closed = {
      ...position,
      status: 'closed',
      exitPrice: marketPrice,
      exitReason,
      pnl,
      closedAt: timestamp,
    };
    this.positions.delete(normalizedSymbol);
    await eventBus.emit('trade:closed', { ...closed, mode: 'paper' });
    return closed;
  }

  async getSnapshot() {
    return {
      mode: 'paper',
      orders: await this.broker.getOrders(),
      brokerPositions: await this.broker.getPositions(),
      managedPositions: [...this.positions.values()].map((position) => ({ ...position })),
    };
  }

  stop() {
    this.execution.stop();
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}

export async function initializePaperTradingRuntime(options = {}) {
  const runtime = new PaperTradingRuntime(options);
  await runtime.start();
  return runtime;
}
