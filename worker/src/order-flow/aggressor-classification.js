function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function quoteAtOrBefore(quotes, timestamp) {
  let selected = null;
  for (const quote of quotes) {
    if (quote.timestamp > timestamp) break;
    selected = quote;
  }
  return selected;
}

export function classifyAggressorSide({ normalized, config } = {}) {
  if (!normalized?.trades || !normalized?.quotes) throw new Error('normalized order flow data is required');
  const classified = [];
  let previousPrice = null;
  let previousDirection = null;

  for (const trade of normalized.trades) {
    const quote = quoteAtOrBefore(normalized.quotes, trade.timestamp);
    let side = 'UNCERTAIN';
    let method = 'UNCLASSIFIED';
    let confidence = 0;
    const reasons = [];

    if (trade.providerSide) {
      side = trade.providerSide;
      method = 'PROVIDER_FLAG';
      confidence = config.classification.providerFlagConfidence;
    } else if (quote && trade.timestamp - quote.timestamp <= config.validation.maximumQuoteAgeMs) {
      const tolerance = normalized.tickSize * config.classification.quoteToleranceTicks;
      if (trade.price >= quote.ask - tolerance) {
        side = 'BUY';
        method = 'QUOTE_TEST';
        confidence = config.classification.quoteTestConfidence;
      } else if (trade.price <= quote.bid + tolerance) {
        side = 'SELL';
        method = 'QUOTE_TEST';
        confidence = config.classification.quoteTestConfidence;
      } else {
        reasons.push('TRADE_INSIDE_SPREAD');
      }
    } else if (!quote) {
      reasons.push('NO_PRECEDING_QUOTE');
    } else {
      reasons.push('STALE_PRECEDING_QUOTE');
    }

    if (side === 'UNCERTAIN' && config.classification.allowTickTestFallback && previousPrice != null) {
      if (trade.price > previousPrice) {
        side = 'BUY';
        method = 'TICK_TEST';
        confidence = config.classification.tickTestConfidence;
      } else if (trade.price < previousPrice) {
        side = 'SELL';
        method = 'TICK_TEST';
        confidence = config.classification.tickTestConfidence;
      } else if (previousDirection) {
        side = previousDirection;
        method = 'TICK_TEST_ZERO_TICK';
        confidence = config.classification.tickTestConfidence * 0.8;
      }
    }

    if (side !== 'UNCERTAIN') previousDirection = side;
    previousPrice = trade.price;
    classified.push(freeze({ ...trade, aggressorSide: side, classificationMethod: method, classificationConfidence: confidence, quoteId: quote?.quoteId || null, reasons }));
  }

  const totals = classified.reduce((accumulator, trade) => {
    accumulator.totalVolume += trade.size;
    if (trade.aggressorSide === 'BUY') accumulator.aggressiveBuyVolume += trade.size;
    else if (trade.aggressorSide === 'SELL') accumulator.aggressiveSellVolume += trade.size;
    else accumulator.uncertainVolume += trade.size;
    return accumulator;
  }, { totalVolume: 0, aggressiveBuyVolume: 0, aggressiveSellVolume: 0, uncertainVolume: 0 });
  const classifiedVolume = totals.aggressiveBuyVolume + totals.aggressiveSellVolume;
  const classifiedVolumeShare = totals.totalVolume > 0 ? classifiedVolume / totals.totalVolume : 0;

  return freeze({
    trades: classified,
    ...totals,
    delta: totals.aggressiveBuyVolume - totals.aggressiveSellVolume,
    classifiedVolumeShare,
    classificationAccepted: classifiedVolumeShare >= config.validation.minimumClassifiedVolumeShare,
    observationOnly: true,
    executionAllowed: false,
  });
}
