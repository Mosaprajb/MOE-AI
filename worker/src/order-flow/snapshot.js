import { createOrderFlowConfig } from './config.js';
import { normalizeOrderFlowData } from './normalization.js';
import { classifyAggressorSide } from './aggressor-classification.js';
import { buildVolumeAtPrice } from './volume-at-price.js';

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function mean(values = []) {
  const finite = values.map(Number).filter(Number.isFinite);
  return finite.length ? finite.reduce((sum, value) => sum + value, 0) / finite.length : null;
}

export function buildOrderFlowSnapshot({ trades = [], quotes = [], now = Date.now(), tickSize = 0.01, startPrice = null, endPrice = null, repeatedAttempts = null, config = null } = {}) {
  const validatedConfig = config || createOrderFlowConfig();
  const evaluatedAt = Number(now);
  const normalized = normalizeOrderFlowData({ trades, quotes, now: evaluatedAt, tickSize, config: validatedConfig });
  const classified = classifyAggressorSide({ normalized, config: validatedConfig });
  const volumeAtPrice = buildVolumeAtPrice({ classified, tickSize: normalized.tickSize, config: validatedConfig });
  const priceProgress = Number.isFinite(Number(startPrice)) && Number.isFinite(Number(endPrice))
    ? Math.abs(Number(endPrice) - Number(startPrice))
    : 0;
  const totalTrades = classified.trades.length;
  const averageConfidence = totalTrades
    ? classified.trades.reduce((sum, trade) => sum + Number(trade.classificationConfidence || 0), 0) / totalTrades
    : 0;
  const attempts = Number.isFinite(Number(repeatedAttempts))
    ? Number(repeatedAttempts)
    : volumeAtPrice.levels.filter((level) => level.tradeCount >= 2).length;
  const latestQuote = normalized.quotes.at(-1) || null;
  const quoteAgeMs = latestQuote ? Math.max(0, evaluatedAt - Number(latestQuote.timestamp)) : null;
  const reportDelays = normalized.trades.map((trade) => Number(trade.reportDelayMs)).filter(Number.isFinite);
  const averageTradeReportDelayMs = mean(reportDelays);
  const maximumTradeReportDelayMs = reportDelays.length ? Math.max(...reportDelays) : null;

  return freeze({
    dataMode: classified.classificationAccepted ? 'TRUE_ORDER_FLOW' : 'INSUFFICIENT_DATA',
    aggressiveBuyVolume: classified.aggressiveBuyVolume,
    aggressiveSellVolume: classified.aggressiveSellVolume,
    bidVolume: classified.aggressiveSellVolume,
    askVolume: classified.aggressiveBuyVolume,
    uncertainVolume: classified.uncertainVolume,
    delta: classified.delta,
    cumulativeDelta: classified.delta,
    tradeIntensity: totalTrades,
    classifiedVolumeShare: round(classified.classifiedVolumeShare),
    classificationConfidence: round(averageConfidence),
    priceProgress: round(priceProgress),
    repeatedAttempts: Math.max(0, attempts),
    stackedLevels: volumeAtPrice.stackedLevels,
    bullishStackedLevels: volumeAtPrice.bullishStackedLevels,
    bearishStackedLevels: volumeAtPrice.bearishStackedLevels,
    volumeAtPrice,
    quality: freeze({
      classifiedVolumeShare: round(classified.classifiedVolumeShare),
      classificationConfidence: round(averageConfidence),
      tradeIntensity: totalTrades,
      quoteCount: normalized.quotes.length,
      tradeCount: normalized.trades.length,
      rejectedQuoteCount: normalized.rejectedQuotes.length,
      rejectedTradeCount: normalized.rejectedTrades.length,
      latestQuoteAgeMs: quoteAgeMs == null ? null : round(quoteAgeMs, 3),
      latestSpreadPercent: latestQuote ? round(latestQuote.spreadPercent, 6) : null,
      averageTradeReportDelayMs: averageTradeReportDelayMs == null ? null : round(averageTradeReportDelayMs, 3),
      maximumTradeReportDelayMs: maximumTradeReportDelayMs == null ? null : round(maximumTradeReportDelayMs, 3),
      evaluatedAt,
    }),
    rejectedTrades: normalized.rejectedTrades,
    rejectedQuotes: normalized.rejectedQuotes,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    observationOnly: true,
    mode: 'PAPER_TRADING',
  });
}
