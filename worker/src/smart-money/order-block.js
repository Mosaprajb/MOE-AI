import { deterministicSmartMoneyId } from './contracts.js';

export const ORDER_BLOCK_STATES = Object.freeze([
  'NEW', 'ACTIVE', 'PARTIALLY_MITIGATED', 'FULLY_MITIGATED', 'INVALIDATED', 'EXPIRED',
]);

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function oppositeCandle(candle, direction) {
  return direction === 'BULLISH' ? candle.close < candle.open : candle.close > candle.open;
}

function findOriginIndex(candles, eventIndex, direction, lookback) {
  const start = Math.max(0, eventIndex - lookback);
  for (let index = eventIndex - 1; index >= start; index -= 1) {
    if (oppositeCandle(candles[index], direction)) return index;
  }
  return null;
}

function blockBoundaries(candle, direction, useBodyProximal) {
  if (direction === 'BULLISH') {
    return {
      lower: candle.low,
      upper: useBodyProximal ? Math.max(candle.open, candle.close) : candle.high,
      proximal: useBodyProximal ? Math.max(candle.open, candle.close) : candle.high,
      distal: candle.low,
    };
  }
  return {
    lower: useBodyProximal ? Math.min(candle.open, candle.close) : candle.low,
    upper: candle.high,
    proximal: useBodyProximal ? Math.min(candle.open, candle.close) : candle.low,
    distal: candle.high,
  };
}

function supportingDisplacement(displacements, event) {
  return [...displacements]
    .filter((item) => item.direction === event.direction && Math.abs(item.index - event.index) <= 1)
    .sort((left, right) => right.score - left.score)[0] || null;
}

function supportingFvg(gaps, event, maximumLagBars) {
  return [...gaps]
    .filter((gap) => gap.direction === event.direction
      && gap.creationIndex >= event.index
      && gap.creationIndex <= event.index + maximumLagBars
      && !['INVALIDATED', 'EXPIRED'].includes(gap.state))
    .sort((left, right) => right.displacementScore - left.displacementScore)[0] || null;
}

function evaluateLifecycle({ candles, eventIndex, direction, lower, upper, distal, fullMitigationPercent, maximumMitigations }) {
  const size = Math.max(upper - lower, Number.EPSILON);
  let fillPercent = 0;
  let mitigationCount = 0;
  let firstTouchAt = null;
  let invalidatedAt = null;
  let invalidationIndex = null;

  for (let index = eventIndex + 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const invalidated = direction === 'BULLISH' ? candle.close < distal : candle.close > distal;
    if (invalidated) {
      invalidatedAt = candle.timestamp;
      invalidationIndex = index;
      break;
    }
    const touched = candle.low <= upper && candle.high >= lower;
    if (!touched) continue;
    mitigationCount += 1;
    if (firstTouchAt == null) firstTouchAt = candle.timestamp;
    const fill = direction === 'BULLISH'
      ? (upper - Math.max(candle.low, lower)) / size
      : (Math.min(candle.high, upper) - lower) / size;
    fillPercent = Math.max(fillPercent, clamp(fill, 0, 1));
  }

  let state = 'ACTIVE';
  if (invalidatedAt != null) state = 'INVALIDATED';
  else if (fillPercent >= fullMitigationPercent || mitigationCount > maximumMitigations) state = 'FULLY_MITIGATED';
  else if (fillPercent > 0) state = 'PARTIALLY_MITIGATED';

  return {
    state,
    fillPercent: round(fillPercent),
    mitigationCount,
    firstTouchAt,
    invalidatedAt,
    invalidationIndex,
  };
}

function blockQuality({ event, displacement, fvg, widthAtr, lifecycle, config }) {
  let score = 0;
  const evidence = [];
  const penalties = [];

  score += clamp(event.qualityScore / 100, 0, 1) * 25;
  if (event.qualityScore >= config.orderBlock.minimumStructureScore) evidence.push('STRUCTURAL_ORIGIN_CONFIRMED');

  score += clamp(displacement.score / 100, 0, 1) * 25;
  if (displacement.score >= config.orderBlock.minimumDisplacementScore) evidence.push('DISPLACEMENT_CONFIRMED');

  if (fvg) {
    score += clamp(fvg.displacementScore / 100, 0, 1) * 20;
    evidence.push('FVG_CREATED_AFTER_ORIGIN');
  } else {
    penalties.push('NO_SUPPORTING_FVG');
  }

  score += clamp(1 - lifecycle.fillPercent, 0, 1) * 15;
  if (lifecycle.mitigationCount === 0) evidence.push('UNMITIGATED_ORIGIN');
  if (lifecycle.mitigationCount > 1) penalties.push('REPEATED_MITIGATION');

  score += clamp(1 - widthAtr / Math.max(config.orderBlock.maximumWidthAtr, Number.EPSILON), 0, 1) * 10;
  if (widthAtr <= config.orderBlock.preferredMaximumWidthAtr) evidence.push('EFFICIENT_BLOCK_WIDTH');
  else penalties.push('WIDE_ORDER_BLOCK');

  if (event.scope === 'EXTERNAL') {
    score += 5;
    evidence.push('EXTERNAL_STRUCTURE_ORIGIN');
  }

  if (lifecycle.state === 'FULLY_MITIGATED') penalties.push('BLOCK_EXCESSIVELY_MITIGATED');
  if (lifecycle.state === 'INVALIDATED') penalties.push('BLOCK_INVALIDATED');

  score -= Math.min(20, Math.max(0, lifecycle.mitigationCount - 1) * config.orderBlock.mitigationPenalty);
  if (!fvg) score -= config.orderBlock.missingFvgPenalty;
  if (lifecycle.state === 'FULLY_MITIGATED') score -= 20;
  if (lifecycle.state === 'INVALIDATED') score = 0;

  return {
    score: round(clamp(score, 0, 100), 2),
    evidence,
    penalties,
  };
}

export async function detectOrderBlocks({
  symbol,
  snapshot,
  config,
  structureEvents = [],
  displacements = [],
  fairValueGaps = [],
} = {}) {
  if (!snapshot?.candles?.length) throw new Error('snapshot.candles are required');
  if (!config?.orderBlock) throw new Error('Validated Smart Money order-block configuration is required');

  const candles = snapshot.candles;
  const atr = Math.max(Number(snapshot.atr), Number.EPSILON);
  const blocks = [];
  const rejected = [];

  for (const event of structureEvents) {
    if (!['BREAK_OF_STRUCTURE', 'CHANGE_OF_CHARACTER', 'MARKET_STRUCTURE_SHIFT'].includes(event.eventType)) continue;
    if (event.qualityScore < config.orderBlock.minimumStructureScore) {
      rejected.push({ structuralEventId: event.eventId, reason: 'ORDER_BLOCK_STRUCTURE_TOO_WEAK' });
      continue;
    }

    const displacement = supportingDisplacement(displacements, event);
    if (!displacement || displacement.score < config.orderBlock.minimumDisplacementScore
      || displacement.classification === 'ABNORMAL_NEWS_DRIVEN') {
      rejected.push({ structuralEventId: event.eventId, reason: 'ORDER_BLOCK_WITHOUT_VALID_DISPLACEMENT' });
      continue;
    }

    const originIndex = findOriginIndex(candles, event.index, event.direction, config.orderBlock.originLookbackBars);
    if (originIndex == null) {
      rejected.push({ structuralEventId: event.eventId, reason: 'NO_OPPOSITE_ORIGIN_CANDLE' });
      continue;
    }

    const origin = candles[originIndex];
    const boundaries = blockBoundaries(origin, event.direction, config.orderBlock.useBodyAsProximalBoundary);
    const width = boundaries.upper - boundaries.lower;
    const widthAtr = width / atr;
    if (!(width > 0) || widthAtr > config.orderBlock.maximumWidthAtr) {
      rejected.push({ structuralEventId: event.eventId, originIndex, reason: 'ORDER_BLOCK_TOO_WIDE', widthAtr: round(widthAtr) });
      continue;
    }

    const fvg = supportingFvg(fairValueGaps, event, config.orderBlock.maximumFvgLagBars);
    if (config.orderBlock.requireFvg && !fvg) {
      rejected.push({ structuralEventId: event.eventId, originIndex, reason: 'ORDER_BLOCK_WITHOUT_FVG' });
      continue;
    }

    const lifecycle = evaluateLifecycle({
      candles,
      eventIndex: event.index,
      direction: event.direction,
      lower: boundaries.lower,
      upper: boundaries.upper,
      distal: boundaries.distal,
      fullMitigationPercent: config.orderBlock.fullMitigationPercent,
      maximumMitigations: config.orderBlock.maximumMitigations,
    });
    const quality = blockQuality({ event, displacement, fvg, widthAtr, lifecycle, config });
    const blockId = await deterministicSmartMoneyId('order_block', [
      config.strategy.version,
      symbol,
      snapshot.timeframe,
      event.direction,
      event.eventId,
      origin.timestamp,
      round(boundaries.lower),
      round(boundaries.upper),
    ]);

    blocks.push(freeze({
      blockId,
      symbol: String(symbol).toUpperCase(),
      timeframe: snapshot.timeframe,
      direction: event.direction,
      lower: round(boundaries.lower),
      upper: round(boundaries.upper),
      proximal: round(boundaries.proximal),
      distal: round(boundaries.distal),
      midpoint: round((boundaries.lower + boundaries.upper) / 2),
      width: round(width),
      widthAtr: round(widthAtr),
      originIndex,
      originTimestamp: origin.timestamp,
      structuralEventId: event.eventId,
      structuralEventType: event.eventType,
      displacementId: displacement.displacementId,
      displacementScore: displacement.score,
      fvgId: fvg?.fvgId || null,
      createdAt: candles[event.index].timestamp,
      state: lifecycle.state,
      fillPercent: lifecycle.fillPercent,
      mitigationCount: lifecycle.mitigationCount,
      firstTouchAt: lifecycle.firstTouchAt,
      invalidatedAt: lifecycle.invalidatedAt,
      invalidationIndex: lifecycle.invalidationIndex,
      invalidationLevel: round(boundaries.distal),
      expiresAt: candles[event.index].timestamp + snapshot.timeframeMs * config.orderBlock.maximumAgeBars,
      qualityScore: quality.score,
      evidence: quality.evidence,
      penalties: quality.penalties,
      executionAllowed: false,
      mode: 'PAPER_TRADING',
    }));
  }

  return freeze({ blocks, rejected });
}
