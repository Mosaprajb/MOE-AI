const DEFAULT_THRESHOLDS = Object.freeze({
  maximumMarketDataDelaySeconds: 120,
  maximumSpreadPercent: 0.75,
  maximumQuoteAgeMs: 2_000,
  maximumTradeReportDelayMs: 3_000,
  minimumClassifiedVolumeShare: 0.6,
  maximumEstimatedSlippagePercent: 0.35,
});

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function finite(value, fallback = null) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function normalizeConnectivity(value) {
  const normalized = String(value || 'UNAVAILABLE').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['CONNECTED', 'HEALTHY', 'ONLINE', 'READY'].includes(normalized)) return 'CONNECTED';
  if (['DISCONNECTED', 'OFFLINE', 'ERROR', 'FAILED'].includes(normalized)) return 'DISCONNECTED';
  if (['DEGRADED', 'PARTIAL', 'WARNING'].includes(normalized)) return 'DEGRADED';
  return 'UNAVAILABLE';
}

function scoreBelowMaximum(value, maximum) {
  if (value == null || !(maximum > 0)) return null;
  return clamp(100 * (1 - value / maximum));
}

function component(id, label, score, weight, value, threshold, status, reason) {
  return freeze({
    id,
    label,
    score: score == null ? null : Number(clamp(score).toFixed(2)),
    weight,
    available: score != null,
    value: value == null ? null : value,
    threshold: threshold == null ? null : threshold,
    status,
    reason,
  });
}

function classification(score, coveragePercent) {
  if (score == null || coveragePercent < 30) return 'INSUFFICIENT_COVERAGE';
  if (score >= 85) return 'HIGH_QUALITY';
  if (score >= 70) return 'ACCEPTABLE';
  if (score >= 50) return 'DEGRADED';
  return 'POOR';
}

function orderFlowMetrics(orderFlow) {
  const quality = orderFlow?.quality || {};
  return {
    dataMode: orderFlow?.dataMode || null,
    classifiedVolumeShare: finite(quality.classifiedVolumeShare, finite(orderFlow?.classifiedVolumeShare)),
    classificationConfidence: finite(quality.classificationConfidence, finite(orderFlow?.classificationConfidence)),
    tradeIntensity: finite(quality.tradeIntensity, finite(orderFlow?.tradeIntensity)),
    latestQuoteAgeMs: finite(quality.latestQuoteAgeMs),
    latestSpreadPercent: finite(quality.latestSpreadPercent),
    averageTradeReportDelayMs: finite(quality.averageTradeReportDelayMs),
    maximumTradeReportDelayMs: finite(quality.maximumTradeReportDelayMs),
    quoteCount: finite(quality.quoteCount),
    tradeCount: finite(quality.tradeCount),
    rejectedQuoteCount: finite(quality.rejectedQuoteCount),
    rejectedTradeCount: finite(quality.rejectedTradeCount),
  };
}

export function buildExecutionQualitySnapshot({
  dataQuality = null,
  orderFlow = null,
  tradingMode = 'PAPER_TRADING',
  brokerConnectivity = 'UNAVAILABLE',
  observationOnly = true,
  executionAllowed = false,
  automaticSubmissionAllowed = false,
  liveExecutionAllowed = false,
  thresholds = {},
  evaluatedAt = null,
} = {}) {
  const limits = freeze({
    maximumMarketDataDelaySeconds: Math.max(1, finite(thresholds.maximumMarketDataDelaySeconds, DEFAULT_THRESHOLDS.maximumMarketDataDelaySeconds)),
    maximumSpreadPercent: Math.max(0.0001, finite(thresholds.maximumSpreadPercent, DEFAULT_THRESHOLDS.maximumSpreadPercent)),
    maximumQuoteAgeMs: Math.max(1, finite(thresholds.maximumQuoteAgeMs, DEFAULT_THRESHOLDS.maximumQuoteAgeMs)),
    maximumTradeReportDelayMs: Math.max(1, finite(thresholds.maximumTradeReportDelayMs, DEFAULT_THRESHOLDS.maximumTradeReportDelayMs)),
    minimumClassifiedVolumeShare: clamp(finite(thresholds.minimumClassifiedVolumeShare, DEFAULT_THRESHOLDS.minimumClassifiedVolumeShare), 0, 1),
    maximumEstimatedSlippagePercent: Math.max(0.0001, finite(thresholds.maximumEstimatedSlippagePercent, DEFAULT_THRESHOLDS.maximumEstimatedSlippagePercent)),
  });

  const flow = orderFlowMetrics(orderFlow);
  const dataScore = finite(dataQuality?.score);
  const dataDelaySeconds = finite(dataQuality?.dataDelaySeconds);
  const spreadPercent = finite(flow.latestSpreadPercent, finite(dataQuality?.spreadPercent));
  const quoteAgeMs = finite(flow.latestQuoteAgeMs);
  const tradeDelayMs = finite(flow.averageTradeReportDelayMs);
  const classifiedShare = flow.classifiedVolumeShare;
  const classificationConfidence = flow.classificationConfidence;
  const connectivity = normalizeConnectivity(brokerConnectivity);

  const orderFlowScore = classifiedShare == null && classificationConfidence == null
    ? null
    : ((classifiedShare == null ? 0 : clamp(classifiedShare * 100))
      + (classificationConfidence == null ? 0 : clamp(classificationConfidence * 100)))
      / (Number(classifiedShare != null) + Number(classificationConfidence != null));

  const estimatedSlippagePercent = spreadPercent == null
    ? null
    : Number((spreadPercent / 2
      + (classifiedShare == null ? 0 : Math.max(0, 1 - classifiedShare) * spreadPercent * 0.5))
      .toFixed(6));

  const components = [
    component('MARKET_DATA_QUALITY', 'Market Data Quality', dataScore, 25, dataScore, 70, dataScore == null ? 'UNAVAILABLE' : dataScore >= 70 ? 'PASS' : 'FAIL', dataScore == null ? 'MARKET_DATA_SCORE_UNAVAILABLE' : 'NORMALIZED_MARKET_DATA_SCORE'),
    component('MARKET_DATA_FRESHNESS', 'Market Data Freshness', scoreBelowMaximum(dataDelaySeconds, limits.maximumMarketDataDelaySeconds), 20, dataDelaySeconds, limits.maximumMarketDataDelaySeconds, dataDelaySeconds == null ? 'UNAVAILABLE' : dataDelaySeconds <= limits.maximumMarketDataDelaySeconds ? 'PASS' : 'FAIL', dataDelaySeconds == null ? 'MARKET_DATA_DELAY_UNAVAILABLE' : 'COMPLETED_BAR_DELAY_SECONDS'),
    component('SPREAD_QUALITY', 'Spread Quality', scoreBelowMaximum(spreadPercent, limits.maximumSpreadPercent), 15, spreadPercent, limits.maximumSpreadPercent, spreadPercent == null ? 'UNAVAILABLE' : spreadPercent <= limits.maximumSpreadPercent ? 'PASS' : 'FAIL', spreadPercent == null ? 'SPREAD_UNAVAILABLE' : 'OBSERVED_BID_ASK_SPREAD_PERCENT'),
    component('QUOTE_FRESHNESS', 'Quote Freshness', scoreBelowMaximum(quoteAgeMs, limits.maximumQuoteAgeMs), 10, quoteAgeMs, limits.maximumQuoteAgeMs, quoteAgeMs == null ? 'UNAVAILABLE' : quoteAgeMs <= limits.maximumQuoteAgeMs ? 'PASS' : 'FAIL', quoteAgeMs == null ? 'QUOTE_STREAM_UNAVAILABLE' : 'LATEST_QUOTE_AGE_MS'),
    component('TRADE_REPORT_DELAY', 'Trade Report Delay', scoreBelowMaximum(tradeDelayMs, limits.maximumTradeReportDelayMs), 10, tradeDelayMs, limits.maximumTradeReportDelayMs, tradeDelayMs == null ? 'UNAVAILABLE' : tradeDelayMs <= limits.maximumTradeReportDelayMs ? 'PASS' : 'FAIL', tradeDelayMs == null ? 'TRADE_REPORT_DELAY_UNAVAILABLE' : 'AVERAGE_TRADE_REPORT_DELAY_MS'),
    component('ORDER_FLOW_CLASSIFICATION', 'Order Flow Classification', orderFlowScore, 10, classifiedShare, limits.minimumClassifiedVolumeShare, orderFlowScore == null ? 'UNAVAILABLE' : classifiedShare != null && classifiedShare < limits.minimumClassifiedVolumeShare ? 'FAIL' : 'PASS', orderFlowScore == null ? 'TRUE_ORDER_FLOW_UNAVAILABLE' : 'CLASSIFIED_VOLUME_AND_CONFIDENCE'),
    component('SLIPPAGE_ESTIMATE', 'Slippage Estimate', scoreBelowMaximum(estimatedSlippagePercent, limits.maximumEstimatedSlippagePercent), 5, estimatedSlippagePercent, limits.maximumEstimatedSlippagePercent, estimatedSlippagePercent == null ? 'UNAVAILABLE' : estimatedSlippagePercent <= limits.maximumEstimatedSlippagePercent ? 'PASS' : 'FAIL', estimatedSlippagePercent == null ? 'SLIPPAGE_PROXY_UNAVAILABLE' : 'HALF_SPREAD_PLUS_CLASSIFICATION_UNCERTAINTY_PROXY'),
    component('BROKER_CONNECTIVITY', 'Broker Connectivity', connectivity === 'UNAVAILABLE' ? null : connectivity === 'CONNECTED' ? 100 : connectivity === 'DEGRADED' ? 50 : 0, 5, connectivity, 'CONNECTED', connectivity === 'UNAVAILABLE' ? 'UNAVAILABLE' : connectivity === 'CONNECTED' ? 'PASS' : 'FAIL', connectivity === 'UNAVAILABLE' ? 'BROKER_HEARTBEAT_UNAVAILABLE' : `BROKER_${connectivity}`),
  ];

  const available = components.filter((item) => item.available);
  const availableWeight = available.reduce((sum, item) => sum + item.weight, 0);
  const totalWeight = components.reduce((sum, item) => sum + item.weight, 0);
  const coveragePercent = totalWeight > 0 ? Number((availableWeight / totalWeight * 100).toFixed(2)) : 0;
  const score = availableWeight > 0
    ? Number((available.reduce((sum, item) => sum + item.score * item.weight, 0) / availableWeight).toFixed(2))
    : null;

  const marketBlockers = [];
  if (dataQuality?.accepted === false) marketBlockers.push('MARKET_DATA_REJECTED');
  if (dataDelaySeconds != null && dataDelaySeconds > limits.maximumMarketDataDelaySeconds) marketBlockers.push('MARKET_DATA_STALE');
  if (spreadPercent != null && spreadPercent > limits.maximumSpreadPercent) marketBlockers.push('SPREAD_TOO_WIDE');
  if (quoteAgeMs != null && quoteAgeMs > limits.maximumQuoteAgeMs) marketBlockers.push('QUOTE_STALE');
  if (tradeDelayMs != null && tradeDelayMs > limits.maximumTradeReportDelayMs) marketBlockers.push('TRADE_REPORT_DELAY_EXCESSIVE');
  if (classifiedShare != null && classifiedShare < limits.minimumClassifiedVolumeShare) marketBlockers.push('CLASSIFIED_VOLUME_SHARE_LOW');
  if (estimatedSlippagePercent != null && estimatedSlippagePercent > limits.maximumEstimatedSlippagePercent) marketBlockers.push('ESTIMATED_SLIPPAGE_HIGH');
  if (connectivity === 'DISCONNECTED') marketBlockers.push('BROKER_DISCONNECTED');
  if (connectivity === 'DEGRADED') marketBlockers.push('BROKER_CONNECTIVITY_DEGRADED');

  const safetyBlockers = [];
  if (observationOnly !== false) safetyBlockers.push('OBSERVATION_ONLY');
  if (executionAllowed !== true) safetyBlockers.push('EXECUTION_PERMISSION_FALSE');
  if (automaticSubmissionAllowed !== true) safetyBlockers.push('AUTOMATIC_SUBMISSION_DISABLED');
  if (liveExecutionAllowed !== true) safetyBlockers.push('LIVE_EXECUTION_DISABLED');
  if (String(tradingMode || '').toUpperCase() !== 'LIVE') safetyBlockers.push('NON_LIVE_TRADING_MODE');

  const qualityClassification = classification(score, coveragePercent);
  const status = safetyBlockers.length ? 'BLOCKED'
    : marketBlockers.length ? 'REJECTED'
      : qualityClassification === 'INSUFFICIENT_COVERAGE' ? 'UNAVAILABLE'
        : score >= 70 ? 'CONFIRMED' : 'VALIDATING';

  return freeze({
    engine: 'EXECUTION_QUALITY',
    status,
    classification: qualityClassification,
    score,
    confidence: coveragePercent,
    coveragePercent,
    tradingMode: String(tradingMode || 'PAPER_TRADING').toUpperCase(),
    brokerConnectivity: connectivity,
    dataMode: flow.dataMode || 'INSUFFICIENT_DATA',
    estimatedSlippagePercent,
    estimateMethod: estimatedSlippagePercent == null ? null : classifiedShare == null ? 'HALF_SPREAD_PROXY' : 'HALF_SPREAD_PLUS_CLASSIFICATION_UNCERTAINTY_PROXY',
    components,
    marketBlockers,
    safetyBlockers,
    blockers: [...marketBlockers, ...safetyBlockers],
    evaluatedAt,
    thresholds: limits,
    inputs: freeze({
      dataQualityScore: dataScore,
      dataDelaySeconds,
      spreadPercent,
      quoteAgeMs,
      averageTradeReportDelayMs: tradeDelayMs,
      maximumTradeReportDelayMs: flow.maximumTradeReportDelayMs,
      classifiedVolumeShare: classifiedShare,
      classificationConfidence,
      tradeIntensity: flow.tradeIntensity,
      quoteCount: flow.quoteCount,
      tradeCount: flow.tradeCount,
      rejectedQuoteCount: flow.rejectedQuoteCount,
      rejectedTradeCount: flow.rejectedTradeCount,
    }),
    readOnly: true,
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
