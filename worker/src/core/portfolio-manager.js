import { eventBus } from './event-bus.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, precision = 2) {
  const factor = 10 ** precision;
  return Math.round(number(value) * factor) / factor;
}

export class PortfolioManager {
  constructor({
    startingBalance = 100000,
    maxRiskPerTradePct = 1,
    maxDailyLossPct = 3,
    maxOpenPositions = 3,
  } = {}) {
    this.startingBalance = Math.max(0, number(startingBalance, 100000));
    this.balance = this.startingBalance;
    this.equity = this.startingBalance;
    this.maxRiskPerTradePct = Math.max(0, number(maxRiskPerTradePct, 1));
    this.maxDailyLossPct = Math.max(0, number(maxDailyLossPct, 3));
    this.maxOpenPositions = Math.max(1, Math.floor(number(maxOpenPositions, 3)));
    this.openPositions = new Map();
    this.closedTrades = [];
    this.realizedPnl = 0;
    this.unrealizedPnl = 0;
    this.peakEquity = this.startingBalance;
    this.maxDrawdown = 0;
    this.dailyRealizedPnl = 0;
    this.dayKey = this.currentDayKey();
    this.unsubscribers = [];
  }

  currentDayKey(timestamp = Date.now()) {
    return new Date(timestamp).toISOString().slice(0, 10);
  }

  resetDailyIfNeeded(timestamp = Date.now()) {
    const key = this.currentDayKey(timestamp);
    if (key !== this.dayKey) {
      this.dayKey = key;
      this.dailyRealizedPnl = 0;
    }
  }

  orderRisk(order = {}) {
    return Math.abs(number(order.limitPrice) - number(order.stopLoss)) * Math.max(0, number(order.quantity));
  }

  async evaluateOrder(order = {}) {
    this.resetDailyIfNeeded();
    const riskAmount = this.orderRisk(order);
    const riskPct = this.equity > 0 ? (riskAmount / this.equity) * 100 : 100;
    const dailyLossLimit = this.startingBalance * (this.maxDailyLossPct / 100);

    let reason = null;
    if (this.openPositions.size >= this.maxOpenPositions && !this.openPositions.has(order.symbol)) {
      reason = 'MAX_OPEN_POSITIONS';
    } else if (riskPct > this.maxRiskPerTradePct) {
      reason = 'MAX_RISK_PER_TRADE';
    } else if (this.dailyRealizedPnl <= -dailyLossLimit) {
      reason = 'MAX_DAILY_LOSS';
    }

    const decision = {
      accepted: !reason,
      reason,
      symbol: order.symbol,
      riskAmount: round(riskAmount),
      riskPct: round(riskPct, 4),
      openPositions: this.openPositions.size,
      equity: round(this.equity),
      timestamp: Date.now(),
    };

    if (reason) {
      await eventBus.emit('risk:limit-reached', decision);
      await eventBus.emit('trade:rejected-by-risk', { ...decision, order });
    } else {
      await eventBus.emit('trade:accepted-by-risk', { ...decision, order });
    }
    return decision;
  }

  async onTradeOpened(position = {}) {
    if (!position.symbol) return;
    this.openPositions.set(position.symbol, { ...position });
    await this.publish();
  }

  async onMarketPrice({ symbol, price } = {}) {
    const key = String(symbol || '').toUpperCase();
    const position = this.openPositions.get(key);
    const marketPrice = number(price);
    if (!position || marketPrice <= 0) return;

    position.marketPrice = marketPrice;
    const direction = position.side === 'SELL' ? -1 : 1;
    position.unrealizedPnl = (marketPrice - number(position.entryPrice)) * number(position.quantity) * direction;
    this.openPositions.set(key, position);
    this.recalculateEquity();
    await this.publish();
  }

  async onTradeClosed(trade = {}) {
    this.resetDailyIfNeeded(trade.closedAt);
    if (trade.symbol) this.openPositions.delete(trade.symbol);
    const pnl = number(trade.pnl);
    this.realizedPnl += pnl;
    this.dailyRealizedPnl += pnl;
    this.balance += pnl;
    this.closedTrades.push({ ...trade, pnl });
    this.recalculateEquity();
    await this.publish();
  }

  recalculateEquity() {
    this.unrealizedPnl = [...this.openPositions.values()]
      .reduce((total, position) => total + number(position.unrealizedPnl), 0);
    this.equity = this.balance + this.unrealizedPnl;
    this.peakEquity = Math.max(this.peakEquity, this.equity);
    const drawdown = this.peakEquity > 0 ? ((this.peakEquity - this.equity) / this.peakEquity) * 100 : 0;
    this.maxDrawdown = Math.max(this.maxDrawdown, drawdown);
  }

  getSnapshot() {
    const wins = this.closedTrades.filter((trade) => number(trade.pnl) > 0);
    const losses = this.closedTrades.filter((trade) => number(trade.pnl) < 0);
    const grossProfit = wins.reduce((sum, trade) => sum + number(trade.pnl), 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + number(trade.pnl), 0));
    const totalTrades = this.closedTrades.length;

    return {
      startingBalance: round(this.startingBalance),
      balance: round(this.balance),
      equity: round(this.equity),
      realizedPnl: round(this.realizedPnl),
      unrealizedPnl: round(this.unrealizedPnl),
      dailyRealizedPnl: round(this.dailyRealizedPnl),
      openPositions: [...this.openPositions.values()].map((position) => ({ ...position })),
      totalTrades,
      wins: wins.length,
      losses: losses.length,
      winRate: totalTrades ? round((wins.length / totalTrades) * 100) : 0,
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss, 4) : grossProfit > 0 ? null : 0,
      maxDrawdownPct: round(this.maxDrawdown, 4),
      limits: {
        maxRiskPerTradePct: this.maxRiskPerTradePct,
        maxDailyLossPct: this.maxDailyLossPct,
        maxOpenPositions: this.maxOpenPositions,
      },
    };
  }

  async publish() {
    await eventBus.emit('portfolio:updated', this.getSnapshot());
  }

  start() {
    if (this.unsubscribers.length) return this;
    this.unsubscribers.push(
      eventBus.on('trade:opened', (position) => this.onTradeOpened(position)),
      eventBus.on('trade:closed', (trade) => this.onTradeClosed(trade)),
      eventBus.on('market:price', (tick) => this.onMarketPrice(tick)),
    );
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}

export function initializePortfolioManager(options = {}) {
  return new PortfolioManager(options).start();
}
