function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function roundToTick(price, tickSize) {
  return Number((Math.round(Number(price) / tickSize) * tickSize).toFixed(8));
}

export function buildVolumeAtPrice({ classified, tickSize = 0.01, config } = {}) {
  if (!classified?.trades) throw new Error('classified trades are required');
  const levels = new Map();
  for (const trade of classified.trades) {
    const price = roundToTick(trade.price, tickSize);
    const level = levels.get(price) || { price, bidVolume: 0, askVolume: 0, uncertainVolume: 0, tradeCount: 0 };
    if (trade.aggressorSide === 'BUY') level.askVolume += trade.size;
    else if (trade.aggressorSide === 'SELL') level.bidVolume += trade.size;
    else level.uncertainVolume += trade.size;
    level.tradeCount += 1;
    levels.set(price, level);
  }

  const ordered = [...levels.values()]
    .sort((left, right) => left.price - right.price)
    .slice(-config.volumeAtPrice.maximumLevels)
    .map((level) => {
      const askRatio = level.askVolume / Math.max(level.bidVolume, 1);
      const bidRatio = level.bidVolume / Math.max(level.askVolume, 1);
      let imbalance = 'BALANCED';
      if (level.askVolume >= config.volumeAtPrice.minimumVolumePerLevel && askRatio >= config.volumeAtPrice.imbalanceRatio) imbalance = 'ASK_DOMINANT';
      if (level.bidVolume >= config.volumeAtPrice.minimumVolumePerLevel && bidRatio >= config.volumeAtPrice.imbalanceRatio) imbalance = 'BID_DOMINANT';
      return freeze({ ...level, totalVolume: level.bidVolume + level.askVolume + level.uncertainVolume, askRatio, bidRatio, imbalance });
    });

  let bullishStack = 0;
  let bearishStack = 0;
  let maximumBullishStack = 0;
  let maximumBearishStack = 0;
  for (const level of ordered) {
    bullishStack = level.imbalance === 'ASK_DOMINANT' ? bullishStack + 1 : 0;
    bearishStack = level.imbalance === 'BID_DOMINANT' ? bearishStack + 1 : 0;
    maximumBullishStack = Math.max(maximumBullishStack, bullishStack);
    maximumBearishStack = Math.max(maximumBearishStack, bearishStack);
  }

  return freeze({
    levels: ordered,
    bullishStackedLevels: maximumBullishStack,
    bearishStackedLevels: maximumBearishStack,
    stackedLevels: Math.max(maximumBullishStack, maximumBearishStack),
    observationOnly: true,
    executionAllowed: false,
  });
}
