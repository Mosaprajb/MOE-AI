import { eventBus } from './event-bus.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeTrade(trade = {}) {
  const pnl = number(trade.pnl, number(trade.realizedPnl));
  const entryPrice = number(trade.entryPrice);
  const exitPrice = number(trade.exitPrice);
  const quantity = Math.max(0, number(trade.quantity));
  const risk = Math.abs(number(trade.riskAmount, number(trade.initialRisk)));

  return {
    ...clone(trade),
    symbol: String(trade.symbol || 'UNKNOWN').toUpperCase(),
    timeframe: String(trade.timeframe || trade.metadata?.timeframe || 'unknown'),
    session: String(trade.session || trade.metadata?.session || 'unknown'),
    direction: String(trade.direction || trade.side || 'unknown').toLowerCase(),
    pnl,
    entryPrice,
    exitPrice,
    quantity,
    risk,
    rMultiple: risk > 0 ? pnl / risk : number(trade.rMultiple),
    closedAt: number(trade.closedAt, Date.now()),
  };
}

function summarizeTrades(trades = []) {
  const normalized = trades.map(normalizeTrade);
  const winners = normalized.filter((trade) => trade.pnl > 0);
  const losers = normalized.filter((trade) => trade.pnl < 0);
  const breakeven = normalized.filter((trade) => trade.pnl === 0);
  const grossProfit = winners.reduce((sum, trade) => sum + trade.pnl, 0);
  const grossLoss = Math.abs(losers.reduce((sum, trade) => sum + trade.pnl, 0));
  const netProfit = normalized.reduce((sum, trade) => sum + trade.pnl, 0);
  const averageWin = winners.length ? grossProfit / winners.length : 0;
  const averageLoss = losers.length ? grossLoss / losers.length : 0;
  const winRate = normalized.length ? winners.length / normalized.length : 0;
  const lossRate = normalized.length ? losers.length / normalized.length : 0;
  const expectancy = normalized.length ? netProfit / normalized.length : 0;
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;
  const rValues = normalized.map((trade) => trade.rMultiple).filter(Number.isFinite);

  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve = normalized
    .slice()
    .sort((a, b) => a.closedAt - b.closedAt)
    .map((trade, index) => {
      equity += trade.pnl;
      peak = Math.max(peak, equity);
      const drawdown = peak - equity;
      maxDrawdown = Math.max(maxDrawdown, drawdown);
      return {
        index: index + 1,
        timestamp: trade.closedAt,
        symbol: trade.symbol,
        pnl: trade.pnl,
        equity,
        drawdown,
      };
    });

  return {
    totalTrades: normalized.length,
    winners: winners.length,
    losers: losers.length,
    breakeven: breakeven.length,
    winRate,
    lossRate,
    grossProfit,
    grossLoss,
    netProfit,
    averageWin,
    averageLoss,
    payoffRatio: averageLoss > 0 ? averageWin / averageLoss : averageWin > 0 ? Infinity : 0,
    expectancy,
    profitFactor,
    averageR: rValues.length ? rValues.reduce((sum, value) => sum + value, 0) / rValues.length : 0,
    maxDrawdown,
    equityCurve,
  };
}

function groupBy(trades, selector) {
  const groups = new Map();
  for (const trade of trades) {
    const key = selector(trade) || 'unknown';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(trade);
  }
  return Object.fromEntries(
    [...groups.entries()].map(([key, items]) => [key, summarizeTrades(items)]),
  );
}

export class PerformanceAnalyticsEngine {
  constructor({ maxTrades = 5000 } = {}) {
    this.maxTrades = Math.max(1, Math.floor(number(maxTrades, 5000)));
    this.trades = [];
    this.unsubscribers = [];
  }

  recordTrade(trade = {}) {
    const normalized = normalizeTrade(trade);
    this.trades.push(normalized);
    if (this.trades.length > this.maxTrades) {
      this.trades.splice(0, this.trades.length - this.maxTrades);
    }
    return clone(normalized);
  }

  recordTrades(trades = []) {
    return trades.map((trade) => this.recordTrade(trade));
  }

  clear() {
    this.trades = [];
  }

  getReport({ symbol = null, timeframe = null, session = null, from = null, to = null } = {}) {
    const selected = this.trades.filter((trade) => {
      if (symbol && trade.symbol !== String(symbol).toUpperCase()) return false;
      if (timeframe && trade.timeframe !== String(timeframe)) return false;
      if (session && trade.session !== String(session)) return false;
      if (from != null && trade.closedAt < number(from)) return false;
      if (to != null && trade.closedAt > number(to)) return false;
      return true;
    });

    return {
      generatedAt: Date.now(),
      filters: { symbol, timeframe, session, from, to },
      summary: summarizeTrades(selected),
      bySymbol: groupBy(selected, (trade) => trade.symbol),
      byTimeframe: groupBy(selected, (trade) => trade.timeframe),
      bySession: groupBy(selected, (trade) => trade.session),
      trades: selected.map(clone),
    };
  }

  async publishReport(filters = {}) {
    const report = this.getReport(filters);
    await eventBus.emit('analytics:updated', clone(report));
    return report;
  }

  start() {
    if (this.unsubscribers.length) return this;
    this.unsubscribers.push(
      eventBus.on('trade:closed', async (trade) => {
        this.recordTrade(trade);
        await this.publishReport();
      }),
      eventBus.on('backtest:completed', async (result) => {
        const trades = Array.isArray(result?.trades) ? result.trades : [];
        if (trades.length) this.recordTrades(trades);
        await this.publishReport();
      }),
    );
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}

export function initializePerformanceAnalytics(options = {}) {
  return new PerformanceAnalyticsEngine(options).start();
}

export { summarizeTrades };
