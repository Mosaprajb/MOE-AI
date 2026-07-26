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

export function buildOrderFlowSnapshot({ trades = [], quotes = [], now = Date.now(), tickSize = 0.01, startPrice = null, endPrice = null, repeatedAttempts = null, config = null } = {}) {
  const validatedConfig = config || createOrderFlowConfig();
  const normalized = normalizeOrderFlowData({ trades, quotes, now, tickSize, config: validatedConfig });
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
    rejectedTrades: normalized.rejectedTrades,
    rejectedQuotes: normalized.rejectedQuotes,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    observationOnly: true,
    mode: 'PAPER_TRADING',
  });
}
