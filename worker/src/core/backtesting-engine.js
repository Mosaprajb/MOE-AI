import { eventBus } from './event-bus.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, precision = 4) {
  const factor = 10 ** precision;
  return Math.round(number(value) * factor) / factor;
}

function normalizeSide(value) {
  const side = String(value || '').toUpperCase();
  return side === 'SELL' || side === 'SHORT' ? 'SELL' : 'BUY';
}

function validCandle(candle = {}) {
  return number(candle.high) > 0
    && number(candle.low) > 0
    && number(candle.close) > 0
    && number(candle.high) >= number(candle.low);
}

function calculateExit(position, candle) {
  const high = number(candle.high);
  const low = number(candle.low);
  const isShort = position.side === 'SELL';
  const stopHit = isShort ? high >= position.stopLoss : low <= position.stopLoss;
  const targetHit = isShort ? low <= position.takeProfit : high >= position.takeProfit;

  // Conservative assumption when both levels are touched inside the same candle.
  if (stopHit) return { price: position.stopLoss, reason: 'STOP_LOSS' };
  if (targetHit) return { price: position.takeProfit, reason: 'TAKE_PROFIT' };
  return null;
}

export class BacktestingEngine {
  constructor({ startingBalance = 100000, commissionPerOrder = 0, slippagePct = 0 } = {}) {
    this.startingBalance = Math.max(0, number(startingBalance, 100000));
    this.commissionPerOrder = Math.max(0, number(commissionPerOrder));
    this.slippagePct = Math.max(0, number(slippagePct));
  }

  entryPrice(signal, candle) {
    const base = number(signal.entryPrice, candle.close);
    const direction = normalizeSide(signal.side || signal.direction) === 'SELL' ? -1 : 1;
    return base * (1 + ((this.slippagePct / 100) * direction));
  }

  exitPrice(price, side) {
    const direction = side === 'SELL' ? 1 : -1;
    return number(price) * (1 + ((this.slippagePct / 100) * direction));
  }

  async run({ candles = [], strategy, symbol = 'UNKNOWN', timeframe = null } = {}) {
    if (typeof strategy !== 'function') throw new Error('BacktestingEngine requires a strategy function');
    const data = candles.filter(validCandle);
    if (!data.length) throw new Error('BacktestingEngine requires valid candle data');

    let balance = this.startingBalance;
    let peakEquity = balance;
    let maxDrawdownPct = 0;
    let position = null;
    const trades = [];
    const equityCurve = [];

    for (let index = 0; index < data.length; index += 1) {
      const candle = data[index];

      if (position) {
        const exit = calculateExit(position, candle);
        if (exit) {
          const fillPrice = this.exitPrice(exit.price, position.side);
          const direction = position.side === 'SELL' ? -1 : 1;
          const grossPnl = (fillPrice - position.entryPrice) * position.quantity * direction;
          const pnl = grossPnl - (this.commissionPerOrder * 2);
          balance += pnl;
          const riskAmount = Math.abs(position.entryPrice - position.stopLoss) * position.quantity;
          const trade = {
            ...position,
            exitPrice: fillPrice,
            exitReason: exit.reason,
            exitedAt: candle.timestamp ?? index,
            grossPnl: round(grossPnl),
            pnl: round(pnl),
            rMultiple: riskAmount > 0 ? round(pnl / riskAmount) : 0,
            barsHeld: index - position.entryIndex,
          };
          trades.push(trade);
          await eventBus.emit('backtest:trade-closed', trade);
          position = null;
        }
      }

      if (!position) {
        const signal = await strategy({ candle, index, candles: data, trades: [...trades], balance });
        if (signal?.accepted !== false && signal && (signal.side || signal.direction)) {
          const side = normalizeSide(signal.side || signal.direction);
          const quantity = Math.max(0, Math.floor(number(signal.quantity, 1)));
          const entryPrice = this.entryPrice(signal, candle);
          const stopLoss = number(signal.stopLoss);
          const takeProfit = number(signal.takeProfit);
          const validLevels = side === 'SELL'
            ? stopLoss > entryPrice && takeProfit < entryPrice
            : stopLoss < entryPrice && takeProfit > entryPrice;

          if (quantity > 0 && validLevels) {
            position = {
              symbol: String(signal.symbol || symbol).toUpperCase(),
              timeframe: signal.timeframe || timeframe,
              side,
              quantity,
              entryPrice,
              stopLoss,
              takeProfit,
              enteredAt: candle.timestamp ?? index,
              entryIndex: index,
              confidence: number(signal.confidence),
            };
            await eventBus.emit('backtest:trade-opened', { ...position });
          }
        }
      }

      let unrealizedPnl = 0;
      if (position) {
        const direction = position.side === 'SELL' ? -1 : 1;
        unrealizedPnl = (number(candle.close) - position.entryPrice) * position.quantity * direction;
      }
      const equity = balance + unrealizedPnl;
      peakEquity = Math.max(peakEquity, equity);
      const drawdownPct = peakEquity > 0 ? ((peakEquity - equity) / peakEquity) * 100 : 0;
      maxDrawdownPct = Math.max(maxDrawdownPct, drawdownPct);
      equityCurve.push({ timestamp: candle.timestamp ?? index, balance: round(balance, 2), equity: round(equity, 2) });
    }

    if (position) {
      const candle = data[data.length - 1];
      const fillPrice = this.exitPrice(candle.close, position.side);
      const direction = position.side === 'SELL' ? -1 : 1;
      const grossPnl = (fillPrice - position.entryPrice) * position.quantity * direction;
      const pnl = grossPnl - (this.commissionPerOrder * 2);
      balance += pnl;
      const riskAmount = Math.abs(position.entryPrice - position.stopLoss) * position.quantity;
      trades.push({
        ...position,
        exitPrice: fillPrice,
        exitReason: 'END_OF_DATA',
        exitedAt: candle.timestamp ?? data.length - 1,
        grossPnl: round(grossPnl),
        pnl: round(pnl),
        rMultiple: riskAmount > 0 ? round(pnl / riskAmount) : 0,
        barsHeld: data.length - 1 - position.entryIndex,
      });
    }

    const wins = trades.filter((trade) => trade.pnl > 0);
    const losses = trades.filter((trade) => trade.pnl < 0);
    const grossProfit = wins.reduce((sum, trade) => sum + trade.pnl, 0);
    const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.pnl, 0));
    const totalR = trades.reduce((sum, trade) => sum + number(trade.rMultiple), 0);
    const netProfit = balance - this.startingBalance;
    const report = {
      symbol,
      timeframe,
      startingBalance: round(this.startingBalance, 2),
      endingBalance: round(balance, 2),
      netProfit: round(netProfit, 2),
      netReturnPct: this.startingBalance > 0 ? round((netProfit / this.startingBalance) * 100) : 0,
      totalTrades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate: trades.length ? round((wins.length / trades.length) * 100) : 0,
      profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
      expectancy: trades.length ? round(netProfit / trades.length, 2) : 0,
      averageR: trades.length ? round(totalR / trades.length) : 0,
      maxDrawdownPct: round(maxDrawdownPct),
      averageBarsHeld: trades.length ? round(trades.reduce((sum, trade) => sum + trade.barsHeld, 0) / trades.length, 2) : 0,
      trades,
      equityCurve,
    };

    await eventBus.emit('backtest:completed', report);
    return report;
  }
}

export function createBacktestingEngine(options = {}) {
  return new BacktestingEngine(options);
}
