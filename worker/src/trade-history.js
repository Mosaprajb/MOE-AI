const TRADE_KEY = 'trade-history:v1';
const LIFECYCLE_REPORT_KEY = 'order-lifecycle-report:v1';
const MAX_TRADES = 2000;

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function nullableFinite(value, fallback = null) {
  if (value == null || value === '') return fallback;
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

function safeObject(value, fallback = null) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fallback;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function safeArray(value, fallback = []) {
  if (!Array.isArray(value)) return fallback;
  return value.map(String).slice(0, 50);
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
  const holdingSeconds = exitTime ? Math.max(0, Math.floor((new Date(exitTime) - new Date(entryTime)) / 1000)) : null;
  const holdingMinutes = holdingSeconds == null ? null : Math.round(holdingSeconds / 60);
  const currentPrice = nullableFinite(input.currentPrice ?? input.lastPrice, previous?.currentPrice ?? null);
  const unrealizedPnl = currentPrice == null ? previous?.unrealizedPnl ?? null : Number(((currentPrice - entryPrice) * quantity * multiplier).toFixed(2));
  const replay = safeObject(input.decisionReplay ?? input.decision ?? previous?.decisionReplay, previous?.decisionReplay ?? null);
  const brokerOrderIds = safeObject(input.brokerOrderIds ?? input.clientOrderIds ?? previous?.brokerOrderIds, previous?.brokerOrderIds ?? null);
  const lifecycleAnomalies = safeArray(input.lifecycleAnomalies, previous?.lifecycleAnomalies || []);
  const capitalPolicy = safeObject(input.capitalPolicy ?? previous?.capitalPolicy, previous?.capitalPolicy ?? null);
  const marginDirective = safeObject(input.marginDirective ?? previous?.marginDirective, previous?.marginDirective ?? null);

  return {
    id: tradeId({ ...previous, ...input, entryTime }),
    signalId: text(input.signalId ?? previous?.signalId),
    symbol: text(input.symbol ?? previous?.symbol).toUpperCase(),
    direction,
    timeframe: text(input.timeframe ?? previous?.timeframe),
    source: text(input.source ?? input.strategy ?? previous?.source ?? previous?.strategy, 'UNKNOWN').toUpperCase(),
    marketRegime: text(input.marketRegime ?? replay?.marketRegime ?? previous?.marketRegime, 'UNKNOWN'),
    sector: text(input.sector ?? previous?.sector, 'OTHER'),
    entryPrice,
    stopLoss: finite(input.stopLoss ?? previous?.stopLoss),
    takeProfit: finite(input.takeProfit ?? previous?.takeProfit),
    trailingStop: nullableFinite(input.trailingStop ?? input.trailingStopPrice, previous?.trailingStop ?? null),
    quantity,
    filledQuantity: Math.max(0, finite(input.filledQuantity ?? previous?.filledQuantity)),
    averageFillPrice: nullableFinite(input.averageFillPrice, previous?.averageFillPrice ?? null),
    entryTime,
    exitTime,
    exitPrice,
    exitReason: text(input.exitReason ?? previous?.exitReason),
    currentPrice,
    unrealizedPnl,
    capitalSource: text(input.capitalSource ?? capitalPolicy?.capitalSource ?? previous?.capitalSource, 'UNKNOWN').toUpperCase(),
    holdPolicy: text(input.holdPolicy ?? capitalPolicy?.holdPolicy ?? previous?.holdPolicy, 'UNSPECIFIED').toUpperCase(),
    accountRoute: text(input.accountRoute ?? capitalPolicy?.accountRoute ?? previous?.accountRoute, 'UNSPECIFIED').toUpperCase(),
    capitalPolicyMode: text(input.capitalPolicyMode ?? previous?.capitalPolicyMode, 'UNKNOWN').toUpperCase(),
    capitalPolicy,
    capitalPolicyReasons: safeArray(input.capitalPolicyReasons ?? capitalPolicy?.reasons, previous?.capitalPolicyReasons || []),
    capitalPolicyWarnings: safeArray(input.capitalPolicyWarnings ?? capitalPolicy?.warnings, previous?.capitalPolicyWarnings || []),
    marginDirective,
    brokerOrderIds,
    brokerPositionSeen: input.brokerPositionSeen ?? previous?.brokerPositionSeen ?? false,
    brokerSyncStatus: text(input.brokerSyncStatus ?? previous?.brokerSyncStatus, 'PENDING'),
    lastBrokerSyncAt: input.lastBrokerSyncAt ? isoDate(input.lastBrokerSyncAt) : previous?.lastBrokerSyncAt ?? null,
    missingPositionChecks: Math.max(0, finite(input.missingPositionChecks ?? previous?.missingPositionChecks)),
    lifecycleStatus: text(input.lifecycleStatus ?? previous?.lifecycleStatus, 'SUBMITTED').toUpperCase(),
    protectionStatus: text(input.protectionStatus ?? previous?.protectionStatus, 'WAITING_FOR_ENTRY').toUpperCase(),
    lifecycleCheckedAt: input.lifecycleCheckedAt ? isoDate(input.lifecycleCheckedAt) : previous?.lifecycleCheckedAt ?? null,
    lifecycleAnomalies,
    attentionRequired: input.attentionRequired ?? previous?.attentionRequired ?? lifecycleAnomalies.length > 0,
    brokerEntryStatus: text(input.brokerEntryStatus ?? previous?.brokerEntryStatus, 'UNKNOWN').toUpperCase(),
    brokerTakeProfitStatus: text(input.brokerTakeProfitStatus ?? previous?.brokerTakeProfitStatus, 'UNKNOWN').toUpperCase(),
    brokerStopLossStatus: text(input.brokerStopLossStatus ?? previous?.brokerStopLossStatus, 'UNKNOWN').toUpperCase(),
    risk,
    reward,
    riskReward: risk > 0 ? Number((reward / risk).toFixed(2)) : 0,
    realizedPnl,
    realizedPnlPercent: exitPrice == null || !entryPrice ? null : Number((((exitPrice - entryPrice) / entryPrice) * 100 * multiplier).toFixed(2)),
    holdingSeconds,
    holdingMinutes,
    realizedR: exitPrice == null || !(risk > 0) ? null : Number((realizedPnl / risk).toFixed(4)),
    initialRiskPerShare: Number(riskPerShare.toFixed(8)),
    brainScore: finite(input.brainScore ?? previous?.brainScore),
    marketScore: finite(input.marketScore ?? previous?.marketScore),
    sectorScore: finite(input.sectorScore ?? previous?.sectorScore),
    decisionConfidence: nullableFinite(input.decisionConfidence ?? replay?.confidence, previous?.decisionConfidence ?? null),
    decisionGrade: text(input.decisionGrade ?? replay?.grade ?? previous?.decisionGrade),
    decisionStatus: text(input.decisionStatus ?? replay?.status ?? previous?.decisionStatus),
    decisionEngineVersion: text(input.decisionEngineVersion ?? replay?.version ?? previous?.decisionEngineVersion),
    decisionReasons: Array.isArray(input.decisionReasons) ? input.decisionReasons.map(String).slice(0, 30) : previous?.decisionReasons || [],
    decisionReplay: replay,
    status: status === 'CLOSED' || exitPrice != null ? 'CLOSED' : 'OPEN',
    createdAt: previous?.createdAt || isoDate(input.createdAt),
    updatedAt: new Date().toISOString(),
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

export async function getTradeDecision(storage, id) {
  const trades = await readTrades(storage);
  const trade = trades.find((item) => item.id === id || item.signalId === id);
  if (!trade) throw new Error('Trade not found');
  return {
    tradeId: trade.id,
    signalId: trade.signalId,
    symbol: trade.symbol,
    direction: trade.direction,
    timeframe: trade.timeframe,
    entryTime: trade.entryTime,
    confidence: trade.decisionConfidence,
    grade: trade.decisionGrade,
    status: trade.decisionStatus,
    engineVersion: trade.decisionEngineVersion,
    reasons: trade.decisionReasons,
    replay: trade.decisionReplay,
    capital: {
      source: trade.capitalSource,
      holdPolicy: trade.holdPolicy,
      accountRoute: trade.accountRoute,
      policyMode: trade.capitalPolicyMode,
      policy: trade.capitalPolicy,
      marginDirective: trade.marginDirective,
    },
    lifecycle: {
      status: trade.lifecycleStatus,
      protectionStatus: trade.protectionStatus,
      checkedAt: trade.lifecycleCheckedAt,
      anomalies: trade.lifecycleAnomalies,
      attentionRequired: trade.attentionRequired,
    },
    outcome: {
      tradeStatus: trade.status,
      exitReason: trade.exitReason,
      realizedPnl: trade.realizedPnl,
      realizedPnlPercent: trade.realizedPnlPercent,
      holdingMinutes: trade.holdingMinutes,
    },
  };
}

export async function applyLifecycleReport(storage, report = {}) {
  const trades = await readTrades(storage);
  const lifecycles = Array.isArray(report.lifecycles) ? report.lifecycles : [];
  const now = report.generatedAt || new Date().toISOString();
  let updated = 0;
  let closed = 0;
  let attentionRequired = 0;

  for (const lifecycle of lifecycles) {
    const index = trades.findIndex((trade) => trade.id === lifecycle.tradeId || (lifecycle.signalId && trade.signalId === lifecycle.signalId));
    if (index < 0) continue;
    const previous = trades[index];
    const shouldClose = previous.status === 'OPEN' && Boolean(lifecycle.exitReason);
    const exitPrice = nullableFinite(lifecycle.currentPrice ?? lifecycle.averageFillPrice, previous.currentPrice ?? previous.entryPrice);
    const patch = {
      id: previous.id,
      brokerOrderIds: lifecycle.orderIds,
      currentPrice: lifecycle.currentPrice ?? previous.currentPrice,
      filledQuantity: lifecycle.filledQuantity,
      averageFillPrice: lifecycle.averageFillPrice,
      capitalSource: lifecycle.capitalSource ?? previous.capitalSource,
      holdPolicy: lifecycle.holdPolicy ?? previous.holdPolicy,
      marginDirective: lifecycle.marginDirective,
      brokerPositionSeen: Boolean(lifecycle.position) || previous.brokerPositionSeen,
      brokerSyncStatus: lifecycle.lifecycleStatus,
      lastBrokerSyncAt: lifecycle.checkedAt || now,
      lifecycleStatus: lifecycle.lifecycleStatus,
      protectionStatus: lifecycle.protectionStatus,
      lifecycleCheckedAt: lifecycle.checkedAt || now,
      lifecycleAnomalies: lifecycle.anomalies || [],
      attentionRequired: lifecycle.attentionRequired === true,
      brokerEntryStatus: lifecycle.orders?.entry?.status || 'UNKNOWN',
      brokerTakeProfitStatus: lifecycle.orders?.takeProfit?.status || 'UNKNOWN',
      brokerStopLossStatus: lifecycle.orders?.stopLoss?.status || 'UNKNOWN',
      ...(shouldClose && exitPrice > 0 ? {
        status: 'CLOSED',
        exitReason: lifecycle.exitReason,
        exitPrice,
        exitTime: lifecycle.checkedAt || now,
      } : {}),
    };
    trades[index] = normalizeTrade(patch, previous);
    updated += 1;
    if (shouldClose && exitPrice > 0) closed += 1;
    if (lifecycle.attentionRequired) attentionRequired += 1;
  }

  if (updated > 0) await writeTrades(storage, trades);
  const persistedReport = {
    ...safeObject(report, {}),
    persistedAt: new Date().toISOString(),
    persistence: { updated, closed, attentionRequired },
  };
  await storage.put(LIFECYCLE_REPORT_KEY, persistedReport);
  return persistedReport;
}

export async function getLatestLifecycleReport(storage) {
  const report = await storage.get(LIFECYCLE_REPORT_KEY);
  return report && typeof report === 'object' ? report : {
    version: 1,
    mode: 'SANDBOX_READ_ONLY',
    generatedAt: null,
    readOnly: true,
    noOrdersSubmitted: true,
    noOrdersModified: true,
    metrics: { tradesChecked: 0, attentionRequired: 0, protectedPositions: 0, unprotectedPositions: 0, marginExitWindow: 0, marginHardExitRequired: 0 },
    lifecycles: [],
    errors: [],
    persistence: { updated: 0, closed: 0, attentionRequired: 0 },
  };
}

export async function reconcileTradesWithPositions(storage, positions = [], options = {}) {
  const now = new Date().toISOString();
  const requiredMissingChecks = Math.max(1, finite(options.requiredMissingChecks, 2));
  const normalizedPositions = (Array.isArray(positions) ? positions : []).map((item) => ({
    symbol: text(item.symbol ?? item.ticker?.symbol ?? item.instrument?.symbol).toUpperCase(),
    quantity: finite(item.quantity ?? item.qty ?? item.position ?? item.holding_quantity),
    averagePrice: nullableFinite(item.averagePrice ?? item.average_price ?? item.cost_price ?? item.avg_price),
    lastPrice: nullableFinite(item.lastPrice ?? item.last_price ?? item.market_price ?? item.current_price),
  })).filter((item) => item.symbol && item.quantity !== 0);

  const positionBySymbol = new Map(normalizedPositions.map((position) => [position.symbol, position]));
  const trades = await readTrades(storage);
  let updated = 0;
  let closed = 0;

  for (let index = 0; index < trades.length; index += 1) {
    const trade = trades[index];
    if (trade.status !== 'OPEN') continue;
    const position = positionBySymbol.get(trade.symbol);

    if (position) {
      trades[index] = normalizeTrade({ id: trade.id, currentPrice: position.lastPrice ?? position.averagePrice ?? trade.currentPrice, brokerPositionSeen: true, brokerSyncStatus: 'OPEN_CONFIRMED', lastBrokerSyncAt: now, missingPositionChecks: 0 }, trade);
      updated += 1;
      continue;
    }

    if (!trade.brokerPositionSeen) {
      trades[index] = normalizeTrade({ id: trade.id, brokerSyncStatus: 'AWAITING_POSITION', lastBrokerSyncAt: now }, trade);
      updated += 1;
      continue;
    }

    const missingPositionChecks = finite(trade.missingPositionChecks) + 1;
    if (missingPositionChecks < requiredMissingChecks) {
      trades[index] = normalizeTrade({ id: trade.id, brokerSyncStatus: 'POSITION_MISSING', lastBrokerSyncAt: now, missingPositionChecks }, trade);
      updated += 1;
      continue;
    }

    const exitPrice = nullableFinite(trade.currentPrice, trade.entryPrice);
    trades[index] = normalizeTrade({ id: trade.id, exitPrice, exitTime: now, exitReason: 'WEBULL_POSITION_CLOSED', status: 'CLOSED', brokerSyncStatus: 'CLOSED_CONFIRMED', lastBrokerSyncAt: now, missingPositionChecks }, trade);
    updated += 1;
    closed += 1;
  }

  if (updated > 0) await writeTrades(storage, trades);
  return { checkedAt: now, openTradesChecked: trades.filter((trade) => trade.status === 'OPEN').length, updated, closed };
}

export async function listTrades(storage, options = {}) {
  const limit = Math.min(500, Math.max(1, finite(options.limit, 100)));
  const status = text(options.status).toUpperCase();
  const symbol = text(options.symbol).toUpperCase();
  const capitalSource = text(options.capitalSource).toUpperCase();
  const trades = await readTrades(storage);
  return trades.filter((trade) => (!status || trade.status === status) && (!symbol || trade.symbol === symbol) && (!capitalSource || trade.capitalSource === capitalSource)).slice(0, limit);
}

function realizedRForTrade(trade = {}) {
  const explicit = nullableFinite(trade.realizedR, null);
  if (explicit != null) return explicit;
  const risk = nullableFinite(trade.risk, null);
  const pnl = nullableFinite(trade.realizedPnl, null);
  if (risk != null && risk > 0 && pnl != null) return pnl / risk;
  const entry = nullableFinite(trade.entryPrice, null);
  const exit = nullableFinite(trade.exitPrice, null);
  const stop = nullableFinite(trade.stopLoss ?? trade.initialStopPrice, null);
  if (entry == null || exit == null || stop == null || entry === stop) return null;
  const directionValue = text(trade.direction, 'BUY').toUpperCase();
  const direction = ['SELL', 'SHORT', 'BEARISH'].includes(directionValue) ? -1 : 1;
  return ((exit - entry) * direction) / Math.abs(entry - stop);
}

function strategySource(trade = {}) {
  return text(
    trade.source
      ?? trade.strategy
      ?? trade.decisionReplay?.source
      ?? trade.decisionReplay?.strategy
      ?? trade.decisionReplay?.signal?.source,
    'UNKNOWN',
  ).toUpperCase();
}

export function strategyAnalyticsFromTrades(trades = []) {
  const completed = [...(Array.isArray(trades) ? trades : [])]
    .filter((trade) => text(trade?.status).toUpperCase() === 'CLOSED')
    .map((trade) => ({ trade, realizedR: realizedRForTrade(trade) }))
    .filter((item) => Number.isFinite(item.realizedR))
    .sort((left, right) => Date.parse(left.trade.exitTime || left.trade.updatedAt || 0) - Date.parse(right.trade.exitTime || right.trade.updatedAt || 0));
  const groups = new Map();
  for (const item of completed) {
    const source = strategySource(item.trade);
    const group = groups.get(source) || [];
    group.push(item.realizedR);
    groups.set(source, group);
  }
  return [...groups.entries()].map(([source, values]) => {
    let cumulative = 0;
    let peak = 0;
    let maxDrawdownR = 0;
    for (const value of values) {
      cumulative += value;
      peak = Math.max(peak, cumulative);
      maxDrawdownR = Math.max(maxDrawdownR, peak - cumulative);
    }
    const totalR = values.reduce((sum, value) => sum + value, 0);
    return {
      source,
      trades: values.length,
      wins: values.filter((value) => value > 0).length,
      expectancy: Number((totalR / values.length).toFixed(4)),
      maxDrawdownR: Number(maxDrawdownR.toFixed(4)),
      history: values.slice(-12).map((value) => Number(value.toFixed(4))),
      totalR: Number(totalR.toFixed(4)),
    };
  }).sort((left, right) => right.expectancy - left.expectancy || right.trades - left.trades || left.source.localeCompare(right.source));
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
  const decisions = trades.filter((trade) => Number.isFinite(trade.decisionConfidence));
  const averageDecisionConfidence = decisions.length ? decisions.reduce((sum, trade) => sum + trade.decisionConfidence, 0) / decisions.length : 0;
  const byStrategy = strategyAnalyticsFromTrades(trades);

  return {
    generatedAt: new Date().toISOString(),
    totalTrades: trades.length,
    openTrades: trades.filter((trade) => trade.status === 'OPEN').length,
    closedTrades: closed.length,
    winningTrades: wins.length,
    losingTrades: losses.length,
    openCashTrades: trades.filter((trade) => trade.status === 'OPEN' && trade.capitalSource === 'CASH').length,
    openMarginIntradayTrades: trades.filter((trade) => trade.status === 'OPEN' && trade.capitalSource === 'MARGIN_INTRADAY').length,
    marginExitActionsRequired: trades.filter((trade) => trade.status === 'OPEN' && ['BEGIN_EXIT', 'FORCE_EXIT', 'EMERGENCY_FLATTEN'].includes(trade.marginDirective?.action)).length,
    lifecycleAttentionRequired: trades.filter((trade) => trade.status === 'OPEN' && trade.attentionRequired).length,
    protectedOpenTrades: trades.filter((trade) => trade.status === 'OPEN' && trade.protectionStatus === 'PROTECTED').length,
    winRate: closed.length ? Number(((wins.length / closed.length) * 100).toFixed(2)) : 0,
    averageWin: wins.length ? Number((grossProfit / wins.length).toFixed(2)) : 0,
    averageLoss: losses.length ? Number((grossLoss / losses.length).toFixed(2)) : 0,
    profitFactor: grossLoss > 0 ? Number((grossProfit / grossLoss).toFixed(2)) : grossProfit > 0 ? null : 0,
    expectancy: closed.length ? Number((netProfit / closed.length).toFixed(2)) : 0,
    netProfit: Number(netProfit.toFixed(2)),
    maxDrawdown: Number(maxDrawdown.toFixed(2)),
    decisionsRecorded: decisions.length,
    averageDecisionConfidence: Number(averageDecisionConfidence.toFixed(2)),
    equityCurve,
    byStrategy,
  };
}
