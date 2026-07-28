import { evaluateSmartMoneyFoundation } from './engine.js';

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

export async function evaluateSmartMoneyScannerBatch({ symbols = [], marketDataBySymbol = {}, timeframe = '5m', now = Date.now(), limit = 25 } = {}) {
  const uniqueSymbols = [...new Set(symbols.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean))].slice(0, Math.max(1, Number(limit) || 25));
  const observations = [];
  const rejected = [];

  for (const symbol of uniqueSymbols) {
    const payload = marketDataBySymbol[symbol];
    if (!payload?.bars?.length) {
      rejected.push({ symbol, reason: 'SCANNER_MARKET_DATA_MISSING' });
      continue;
    }
    try {
      const result = await evaluateSmartMoneyFoundation({
        symbol,
        bars: payload.bars,
        timeframe: payload.timeframe || timeframe,
        now,
        source: payload.source || 'SCANNER_OBSERVATION',
        bid: payload.bid ?? null,
        ask: payload.ask ?? null,
        tickSize: payload.tickSize ?? null,
      });
      observations.push({
        symbol,
        tradeDecision: result.tradeDecision,
        reason: result.reason,
        setupScore: result.setupScore || 0,
        setupFamily: result.details?.setupFamily?.family || 'UNCLASSIFIED',
        direction: result.details?.setupFamily?.direction || null,
        candidate: result.details?.candidate || null,
        failedConditions: result.failedConditions || [],
        observationOnly: true,
        executionAllowed: false,
        automaticSubmissionAllowed: false,
        liveExecutionAllowed: false,
      });
    } catch (error) {
      rejected.push({ symbol, reason: 'SCANNER_ANALYSIS_FAILED', error: error instanceof Error ? error.message : 'Unknown scanner error' });
    }
  }

  observations.sort((left, right) => Number(right.setupScore || 0) - Number(left.setupScore || 0) || left.symbol.localeCompare(right.symbol));

  return freeze({
    evaluatedAt: Number(now),
    timeframe,
    observations,
    rejected,
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
