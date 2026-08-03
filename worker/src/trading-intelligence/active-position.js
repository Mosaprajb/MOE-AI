const TERMINAL_TRADE_STATES = new Set([
  'CLOSED', 'CANCELLED', 'CANCELED', 'REJECTED', 'ERROR', 'EXPIRED', 'FAILED',
  'CLOSED_TAKE_PROFIT', 'CLOSED_STOP_LOSS',
]);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function finite(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positive(...values) {
  for (const value of values) {
    const parsed = finite(value);
    if (parsed != null && parsed > 0) return parsed;
  }
  return null;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeDirection(...values) {
  for (const value of values) {
    const normalized = String(value || '').trim().toUpperCase();
    if (['LONG', 'BUY', 'BULLISH'].includes(normalized)) return 'LONG';
    if (['SHORT', 'SELL', 'BEARISH'].includes(normalized)) return 'SHORT';
  }
  return 'UNKNOWN';
}

function status(value) {
  return String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
}

function lifecycleForTrade(trade, report) {
  const lifecycles = Array.isArray(report?.lifecycles) ? report.lifecycles : [];
  const tradeId = String(trade?.id || '');
  const signalId = String(trade?.signalId || '');
  const symbol = String(trade?.symbol || '').toUpperCase();
  return lifecycles.find((item) => tradeId && String(item.tradeId || '') === tradeId)
    || lifecycles.find((item) => signalId && String(item.signalId || '') === signalId)
    || lifecycles.find((item) => symbol && String(item.symbol || '').toUpperCase() === symbol)
    || null;
}

function activeTrade(trades, report) {
  const values = Array.isArray(trades) ? trades : [];
  for (const trade of values) {
    const lifecycle = lifecycleForTrade(trade, report);
    const tradeStatus = status(trade?.status);
    const lifecycleStatus = status(lifecycle?.lifecycleStatus);
    const hasPosition = Math.abs(finite(lifecycle?.position?.quantity, 0)) > 0;
    if (hasPosition) return { trade, lifecycle };
    if (!TERMINAL_TRADE_STATES.has(tradeStatus) && !TERMINAL_TRADE_STATES.has(lifecycleStatus)) return { trade, lifecycle };
  }
  return null;
}

function orderState(order) {
  if (!order) return 'MISSING';
  return status(order.status) || (order.working ? 'WORKING' : 'UNKNOWN');
}

function timeline(trade, lifecycle, positionState) {
  const entry = lifecycle?.orders?.entry || null;
  const takeProfit = lifecycle?.orders?.takeProfit || null;
  const stopLoss = lifecycle?.orders?.stopLoss || null;
  const entryStatus = orderState(entry);
  const protection = status(lifecycle?.protectionStatus) || 'UNKNOWN';
  const closed = ['TARGET_REACHED', 'STOPPED', 'CLOSED'].includes(positionState);
  return [
    freeze({ id: 'SUBMITTED', label: 'Order Submitted', state: trade ? 'PASSED' : 'PENDING' }),
    freeze({
      id: 'ENTRY',
      label: 'Entry',
      state: ['FILLED', 'PARTIALLY_FILLED'].includes(entryStatus) || lifecycle?.position ? 'PASSED'
        : ['REJECTED', 'CANCELLED', 'EXPIRED'].includes(entryStatus) ? 'FAILED' : 'ACTIVE',
      detail: entryStatus,
    }),
    freeze({
      id: 'PROTECTION',
      label: 'SL / TP Protection',
      state: protection === 'PROTECTED' ? 'PASSED' : protection === 'UNPROTECTED' ? 'FAILED' : protection === 'PARTIALLY_PROTECTED' ? 'ACTIVE' : 'PENDING',
      detail: protection,
    }),
    freeze({
      id: 'EXIT',
      label: 'Position Exit',
      state: closed ? 'PASSED' : 'PENDING',
      detail: `${orderState(takeProfit)} / ${orderState(stopLoss)}`,
    }),
  ];
}

function priceMetrics({ direction, entry, current, stop, target }) {
  const valid = [entry, current, stop, target].every((value) => value != null && value > 0)
    && direction !== 'UNKNOWN';
  if (!valid) {
    return freeze({
      valid: false,
      rangeProgressPercent: null,
      entryMarkerPercent: null,
      progressToTargetPercent: null,
      rawProgressToTargetPercent: null,
      distanceToStopPercent: null,
      distanceToStopR: null,
      initialRiskPerShare: null,
      targetRewardPerShare: null,
      rewardRisk: null,
      targetReached: false,
      stopReached: false,
      missing: [
        entry == null ? 'ENTRY_PRICE_MISSING' : null,
        current == null ? 'CURRENT_PRICE_MISSING' : null,
        stop == null ? 'STOP_PRICE_MISSING' : null,
        target == null ? 'TARGET_PRICE_MISSING' : null,
        direction === 'UNKNOWN' ? 'DIRECTION_MISSING' : null,
      ].filter(Boolean),
    });
  }

  const long = direction === 'LONG';
  const initialRisk = long ? entry - stop : stop - entry;
  const reward = long ? target - entry : entry - target;
  const fullRange = long ? target - stop : stop - target;
  if (!(initialRisk > 0) || !(reward > 0) || !(fullRange > 0)) {
    return freeze({
      valid: false,
      rangeProgressPercent: null,
      entryMarkerPercent: null,
      progressToTargetPercent: null,
      rawProgressToTargetPercent: null,
      distanceToStopPercent: null,
      distanceToStopR: null,
      initialRiskPerShare: initialRisk,
      targetRewardPerShare: reward,
      rewardRisk: null,
      targetReached: false,
      stopReached: false,
      missing: ['INVALID_PRICE_ORDERING'],
    });
  }

  const rawRangeProgress = (long ? current - stop : stop - current) / fullRange * 100;
  const entryMarker = (long ? entry - stop : stop - entry) / fullRange * 100;
  const rawTargetProgress = (long ? current - entry : entry - current) / reward * 100;
  const stopDistance = long ? current - stop : stop - current;
  const targetReached = long ? current >= target : current <= target;
  const stopReached = long ? current <= stop : current >= stop;

  return freeze({
    valid: true,
    rangeProgressPercent: Number(clamp(rawRangeProgress).toFixed(2)),
    entryMarkerPercent: Number(clamp(entryMarker).toFixed(2)),
    progressToTargetPercent: Number(clamp(rawTargetProgress).toFixed(2)),
    rawProgressToTargetPercent: Number(rawTargetProgress.toFixed(2)),
    distanceToStopPercent: Number((Math.max(0, stopDistance) / current * 100).toFixed(4)),
    distanceToStopR: Number((stopDistance / initialRisk).toFixed(4)),
    initialRiskPerShare: Number(initialRisk.toFixed(8)),
    targetRewardPerShare: Number(reward.toFixed(8)),
    rewardRisk: Number((reward / initialRisk).toFixed(4)),
    targetReached,
    stopReached,
    missing: [],
  });
}

function positionState(lifecycle, metrics) {
  const lifecycleStatus = status(lifecycle?.lifecycleStatus);
  if (lifecycleStatus === 'CLOSED_TAKE_PROFIT' || metrics.targetReached) return 'TARGET_REACHED';
  if (lifecycleStatus === 'CLOSED_STOP_LOSS' || metrics.stopReached) return 'STOPPED';
  if (['ENTRY_REJECTED', 'ENTRY_CANCELLED', 'ENTRY_EXPIRED'].includes(lifecycleStatus)) return 'INVALIDATED';
  if (['PENDING_ENTRY', 'AWAITING_BROKER_CONFIRMATION', 'SUBMITTED'].includes(lifecycleStatus)) return 'ENTRY_PENDING';
  if (status(lifecycle?.protectionStatus) === 'UNPROTECTED') return 'PROTECTION_REQUIRED';
  if (status(lifecycle?.protectionStatus) === 'PARTIALLY_PROTECTED') return 'PROTECTION_PARTIAL';
  return lifecycle?.position ? 'MANAGING' : 'POSITION_ACTIVE';
}

function riskState(lifecycle, metrics) {
  if (!metrics.valid) return 'UNKNOWN';
  if (metrics.stopReached) return 'STOP_TRIGGERED';
  if (metrics.targetReached) return 'TARGET_REACHED';
  const protection = status(lifecycle?.protectionStatus);
  if (protection === 'UNPROTECTED') return 'CRITICAL';
  if (protection === 'PARTIALLY_PROTECTED') return 'WARNING';
  if (metrics.distanceToStopR <= 0.25) return 'DANGER';
  if (metrics.distanceToStopR <= 0.5) return 'WARNING';
  return 'NORMAL';
}

export function buildActivePositionIntelligence({ trades = [], lifecycleReport = null, takeProfitR = 2, now = Date.now() } = {}) {
  const selected = activeTrade(trades, lifecycleReport);
  if (!selected) {
    return freeze({
      available: false,
      positionStatus: 'NO_ACTIVE_POSITION',
      reason: 'No non-terminal trade or broker position is available.',
      generatedAt: new Date(Number(now) || Date.now()).toISOString(),
      readOnly: true,
      observationOnly: true,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
    });
  }

  const { trade, lifecycle } = selected;
  const direction = normalizeDirection(trade.direction, trade.side, lifecycle?.position?.side);
  const entry = positive(lifecycle?.averageFillPrice, lifecycle?.position?.averagePrice, trade.entryPrice, trade.entry, trade.averagePrice);
  const current = positive(lifecycle?.currentPrice, lifecycle?.position?.lastPrice, trade.currentPrice, trade.marketPrice, trade.lastPrice, trade.markPrice, entry);
  const initialStop = positive(trade.initialStopPrice, trade.initialStop, trade.stopLoss, trade.stopPrice, trade.stop, trade.sl);
  const stop = positive(lifecycle?.orders?.stopLoss?.stopPrice, lifecycle?.orders?.stopLoss?.limitPrice, trade.trailingStop, trade.trailingStopPrice, initialStop);
  const configuredTarget = positive(lifecycle?.orders?.takeProfit?.limitPrice, lifecycle?.orders?.takeProfit?.stopPrice, trade.takeProfit, trade.targetPrice, trade.target, trade.tp, trade.takeProfit1);
  const normalizedTakeProfitR = Math.max(0.1, finite(trade.takeProfitR, finite(takeProfitR, 2)));
  const initialRiskDistance = entry != null && initialStop != null ? Math.abs(entry - initialStop) : null;
  const calculatedTarget = entry != null && initialRiskDistance > 0
    ? direction === 'SHORT'
      ? entry - normalizedTakeProfitR * initialRiskDistance
      : entry + normalizedTakeProfitR * initialRiskDistance
    : null;
  const target = positive(configuredTarget, calculatedTarget);
  const target2 = positive(trade.takeProfit2, trade.targetPrice2, trade.tp2);
  const metrics = priceMetrics({ direction, entry, current, stop: initialStop, target });
  const state = positionState(lifecycle, metrics);
  const risk = riskState(lifecycle, metrics);
  const startedAt = trade.entryTime || trade.filledAt || trade.createdAt || null;
  const startedTimestamp = startedAt ? Date.parse(startedAt) : NaN;
  const timeInTradeSeconds = Number.isFinite(startedTimestamp)
    ? Math.max(0, Math.floor(((Number(now) || Date.now()) - startedTimestamp) / 1000))
    : null;
  const quantity = Math.abs(finite(lifecycle?.position?.quantity, finite(trade.quantity, 0)));
  const unrealizedPnl = finite(trade.unrealizedPnl, finite(trade.pnl, null));
  const breakevenLocked = entry != null && stop != null && direction !== 'UNKNOWN'
    ? direction === 'SHORT' ? stop <= entry : stop >= entry
    : false;
  const source = String(trade.source || trade.strategy || trade.decisionReplay?.source || trade.decisionReplay?.strategy || 'UNKNOWN').toUpperCase();
  const anomalies = Array.isArray(lifecycle?.anomalies) ? lifecycle.anomalies.slice(0, 12) : [];

  return freeze({
    available: true,
    tradeId: trade.id || null,
    signalId: trade.signalId || null,
    symbol: String(trade.symbol || lifecycle?.symbol || '').toUpperCase() || null,
    timeframe: trade.timeframe || null,
    direction,
    positionStatus: state,
    lifecycleStatus: lifecycle?.lifecycleStatus || status(trade.status) || 'UNKNOWN',
    riskState: risk,
    protectionStatus: lifecycle?.protectionStatus || 'UNKNOWN',
    entryPrice: entry,
    currentPrice: current,
    stopLoss: stop,
    stopPrice: stop,
    initialStopPrice: initialStop,
    takeProfit1: target,
    targetPrice: target,
    takeProfit2: target2,
    quantity,
    unrealizedPnl,
    timeInTradeSeconds,
    holdingSeconds: timeInTradeSeconds,
    breakevenLocked,
    source,
    takeProfitR: normalizedTakeProfitR,
    progress: metrics,
    timeline: timeline(trade, lifecycle, state),
    anomalies,
    attentionRequired: lifecycle?.attentionRequired === true || anomalies.length > 0 || ['CRITICAL', 'DANGER'].includes(risk),
    lastUpdatedAt: lifecycle?.checkedAt || lifecycleReport?.generatedAt || new Date(Number(now) || Date.now()).toISOString(),
    dataSource: lifecycleReport?.mode || 'TRADE_HISTORY_ONLY',
    readOnly: true,
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
