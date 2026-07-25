const TRADE_KEY = 'trade-history:v1';
const MAX_TRADES = 2000;

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  const output = String(value ?? fallback).trim();
  return output || fallback;
}

function isoDate(value, fallback = new Date().toISOString()) {
  const date = value ? new Date(value) : new Date(fallback);
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
}

function tradeId(value = {}) {
  if (value.id) return text(value.id);
  const seed = `${value.signalId || ''}:${value.symbol || ''}:${value.entryTime || Date.now()}`;
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `trade_${(hash >>> 0).toString(16)}`;
}

export function normalizeTrade(input = {}, previous = null) {
  const entryPrice = finite(input.entryPrice ?? input.entry ?? previous?.entryPrice);
  const exitPrice = input.exitPrice == null ? previous?.exitPrice ?? null : finite(input.exitPrice);
  const quantity = Math.max(0, finite(input.quantity ?? input.qty ?? previous?.quantity));
  const direction = text(input.direction ?? input.side ?? previous?.direction, 'BUY').toUpperCase() === 'SELL' ? 'SELL' : 'BUY';
  const status = text(input.status ?? previous?.status, exitPrice == null ? 'OPEN' : 'CLOSED').toUpperCase();
  const multiplier = direction === 'SELL' ? -1 : 1;
  const realizedPnl = exitPrice == null ? null : Number(((exitPrice - entryPrice) * quantity * multiplier).toFixed(2));
  const riskPerShare = Math.abs(entryPrice - finite(input.stopLoss ?? previous?.stopLoss));
  const rewardPerShare = Math.abs(finite(input.takeProfit ?? previous?.takeProfit) - entryPrice);
  const risk = Number((riskPerShare * quantity).toFixed(2));
  const reward = Number((rewardPerShare * quantity).toFixed(2));
  const entryTime = isoDate(input.entryTime ?? previous?.entryTime);
  const exitTime = exitPrice == null ? null : isoDate(input.exitTime ?? previous?.exitTime);
  const holdingMinutes = exitTime ? Math.max(0, Math.round((new Date(exitTime) - new Date(entryTime)) / 60000)) : null;

  return {
    id: tradeId({ ...previous, ...input, entryTime }),
    signalId: text(input.signalId ?? previous?.signalId),
    symbol: text(input.symbol ?? previous?.symbol).toUpperCase(),
    direction,
    timeframe: text(input.timeframe ?? previous?.timeframe),
    marketRegime: text(input.marketRegime ?? previous?.marketRegime, 'UNKNOWN'),
    sector: text(input.sector ?? previous?.sector, 'OTHER'),
    entryPrice,
    stopLoss: finite(input.stopLoss ?? previous?.stopLoss),
    takeProfit: finite(input.takeProfit ?? previous?.takeProfit),
    quantity,
    entryTime,
    exitTime,
    exitPrice,
    exitReason: text(input.exitReason ?? previous?.exitReason),
    risk,
    reward,
    riskReward: risk > 0 ? Number((reward / risk).toFixed(2)) : 0,
    realizedPnl,
    realizedPnlPercent: exitPrice == null || !entryPrice ? null : Number((((exitPrice - entryPrice) / entryPrice) * 100 * multiplier).toFixed(2)),
    holdingMinutes,
    brainScore: finite(input.brainScore ?? previous?.brainScore),
    marketScore: finite(input.marketScore ?? previous?.marketScore),
    sectorScore: finite(input.sectorScore ?? previous?.sectorScore),
    decisionReasons: Array.isArray(input.decisionReasons) ? input.decisionReasons.map(String).slice(0, 20) : previous?.decisionReasons || [],
    status: status === 'CLOSED' || exitPrice != null ? 'CLOSED' : 'OPEN',
    createdAt: previous?.createdAt || isoDate(input.createdAt),
    updatedAt: new Date().toISOString()
  };
}

async function readTrades(storage) {
  const trades = await storage.get(TRADE_KEY);
  return Array.isArray(trades) ? trades : [];
}

async function writeTrades(storage, trades) {
  const ordered = [...trades]
    .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
    .slice(0, MAX_TRADES);
  await storage.put(TRADE_KEY, ordered);
  return ordered;
}

export async function upsertTrade(storage, input) {
  const trades = await readTrades(storage);
  const id = tradeId(input);
  const index = trades.findIndex((trade) => trade.id === id || (input.signalId && trade.signalId === input.signalId));
  const previous = index >= 0 ? trades[index] : null;
  const trade = normalizeTrade({ ...input, id: previous?.id || id }, previous);
  if (!trade.symbol) throw new Error('Trade symbol is required');
  if (!(trade.entryPrice > 0)) throw new Error('Trade entryPrice must be greater than zero');
  if (!(trade.quantity > 0)) throw new Error('Trade quantity must be greater than zero');
  if (index >= 0) trades[index] = trade;
  else trades.unshift(trade);
  await writeTrades(storage, trades);
  return trade;
}

export async function closeTrade(storage, id, input = {}) {
  const trades = await readTrades(storage);
  const index = trades.findIndex((trade) => trade.id === id);
  if (index < 0) throw new Error('Trade not found');
  const exitPrice = finite(input.exitPrice);
  if (!(exitPrice > 0)) throw new Error('exitPrice must be greater than zero');
  const trade = normalizeTrade({ ...input, id, exitPrice, status: 'CLOSED', exitTime: input.exitTime || new Date().toISOString() }, trades[index]);
  trades[index] = trade;
  await writeTrades(storage, trades);
  return trade;
}

export async function listTrades(storage, options = {}) {
  const limit = Math.min(500, Math.max(1, finite(options.limit, 100)));
  const status = text(options.status).toUpperCase();
  const symbol = text(options.symbol).toUpperCase();
  const trades = await readTrades(storage);
  return trades.filter((trade) => (!status || trade.status === status) && (!symbol || trade.symbol === symbol)).slice(0, limit);
}

export async function tradeAnalytics(storage) {
  const trades = await readTrades(storage);
  const closed = trades.filter((trade) => trade.status === 'CLOSED' && Number.isFinite(trade.realizedPnl));
  const wins = closed.filter((trade) => trade.realizedPnl > 0);
  const losses = closed.filter((trade) => trade.realizedPnl < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + trade.realizedPnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + trade.realizedPnl, 0));
  const netProfit = closed.reduce((sum, trade) => sum + trade.realizedPnl, 0);
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  const equityCurve = [...closed].reverse().map((trade) => {
    equity += trade.realizedPnl;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, peak - equity);
    return { at: trade.exitTime || trade.updatedAt, tradeId: trade.id, symbol: trade.symbol, pnl: trade.realizedPnl, equity: Number(equity.toFixed(2)) };
  });

  return {
    generatedAt: new Date().toISOString(),
    totalTrades: trades.length,
    openTrades: trades.filter((trade) => trade.status === 'OPEN').length,
    closedTrades: closed.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    winRate: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(2)) : 0,
    averageWin: wins.length ? Number((grossProfit / wins.length).toFixed(2)) : 0,
    averageLoss: losses.length ? Number((grossLoss / losses.length).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? null : 0,
    expectancy: closed.length ? Number((netProfit / closed.length).toFixed(2)) : 0,
    netProfit: Number(netProfit.toFixed(2)),
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    equityCurve
  };
}
