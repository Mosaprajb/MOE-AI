import { deterministicSmartMoneyId } from './contracts.js';

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

function closeLocation(candle, direction) {
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  return direction === 'BULLISH'
    ? (candle.close - candle.low) / range
    : (candle.high - candle.close) / range;
}

function oppositeDirection(direction) {
  return direction === 'BULLISH' ? 'BEARISH' : 'BULLISH';
}

export async function detectBreakerBlocks({ symbol, snapshot, config, orderBlocks = [], structureEvents = [] } = {}) {
  if (!snapshot?.candles?.length) throw new Error('snapshot.candles are required');
  if (!config?.breaker) throw new Error('Validated Smart Money breaker configuration is required');

  const breakers = [];
  const rejected = [];
  const candles = snapshot.candles;

  for (const block of orderBlocks) {
    if (block.state !== 'INVALIDATED' || block.invalidationIndex == null) continue;
    if (block.qualityScore < config.breaker.minimumOriginalBlockScore) {
      rejected.push({ blockId: block.blockId, reason: 'BREAKER_ORIGINAL_BLOCK_TOO_WEAK' });
      continue;
    }

    const direction = oppositeDirection(block.direction);
    const oppositeEvent = structureEvents.find((event) => event.index >= block.invalidationIndex
      && event.direction === direction
      && event.qualityScore >= config.breaker.minimumOppositeStructureScore);
    if (!oppositeEvent) {
      rejected.push({ blockId: block.blockId, reason: 'BREAKER_WITHOUT_OPPOSITE_STRUCTURE' });
      continue;
    }

    let retestIndex = null;
    let rejectionScore = 0;
    const lastIndex = Math.min(candles.length - 1, block.invalidationIndex + config.breaker.maximumRetestBars);
    for (let index = block.invalidationIndex + 1; index <= lastIndex; index += 1) {
      const candle = candles[index];
      const touches = candle.low <= block.upper && candle.high >= block.lower;
      if (!touches) continue;
      const directionalClose = direction === 'BULLISH' ? candle.close > candle.open : candle.close < candle.open;
      const location = closeLocation(candle, direction);
      if (directionalClose && location >= config.breaker.rejectionCloseLocation) {
        retestIndex = index;
        rejectionScore = Math.round(clamp(location * 100, 0, 100));
        break;
      }
    }

    if (retestIndex == null) {
      rejected.push({ blockId: block.blockId, reason: 'BREAKER_RETEST_NOT_CONFIRMED' });
      continue;
    }

    const qualityScore = round(clamp(
      block.qualityScore * 0.35
      + oppositeEvent.qualityScore * 0.4
      + rejectionScore * 0.25,
      0,
      100,
    ), 2);
    if (qualityScore < config.breaker.minimumQualityScore) {
      rejected.push({ blockId: block.blockId, reason: 'BREAKER_QUALITY_TOO_LOW', qualityScore });
      continue;
    }

    const retestCandle = candles[retestIndex];
    const breakerId = await deterministicSmartMoneyId('breaker', [
      config.strategy.version,
      symbol,
      snapshot.timeframe,
      block.blockId,
      oppositeEvent.eventId,
      retestCandle.timestamp,
    ]);

    breakers.push(freeze({
      breakerId,
      originalBlockId: block.blockId,
      symbol: String(symbol).toUpperCase(),
      timeframe: snapshot.timeframe,
      direction,
      lower: block.lower,
      upper: block.upper,
      midpoint: block.midpoint,
      invalidationLevel: direction === 'BULLISH' ? block.lower : block.upper,
      originalInvalidationIndex: block.invalidationIndex,
      oppositeStructureEventId: oppositeEvent.eventId,
      retestIndex,
      retestAt: retestCandle.timestamp,
      rejectionScore,
      qualityScore,
      state: 'ACTIVE',
      evidence: [
        'ORIGINAL_ORDER_BLOCK_FAILED',
        'OPPOSITE_STRUCTURE_CONFIRMED',
        'BREAKER_RETEST_REJECTED',
      ],
      penalties: [],
      executionAllowed: false,
      mode: 'PAPER_TRADING',
    }));
  }

  return freeze({ breakers, rejected });
}
