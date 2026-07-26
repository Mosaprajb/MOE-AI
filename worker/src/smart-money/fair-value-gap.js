import { createFairValueGap } from './contracts.js';
import { evaluateDisplacementAt } from './displacement.js';

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function fillState({ direction, lower, upper, candles, creationIndex, fullMitigationPercent, inversionBuffer }) {
  const size = upper - lower;
  let deepestFill = 0;
  let firstTouchAt = null;
  let mitigationCount = 0;
  let inverted = false;
  for (let index = creationIndex + 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const touches = candle.low <= upper && candle.high >= lower;
    if (!touches) continue;
    mitigationCount += 1;
    if (firstTouchAt == null) firstTouchAt = candle.timestamp;
    const fill = direction === 'BULLISH'
      ? (upper - Math.max(candle.low, lower)) / size
      : (Math.min(candle.high, upper) - lower) / size;
    deepestFill = Math.max(deepestFill, Math.min(1, Math.max(0, fill)));
    if (direction === 'BULLISH' && candle.close < lower - inversionBuffer) inverted = true;
    if (direction === 'BEARISH' && candle.close > upper + inversionBuffer) inverted = true;
  }
  let state = 'ACTIVE';
  if (inverted) state = 'INVERTED';
  else if (deepestFill >= fullMitigationPercent) state = 'FULLY_MITIGATED';
  else if (deepestFill > 0) state = 'PARTIALLY_MITIGATED';
  return { fillPercent: round(deepestFill, 6), firstTouchAt, mitigationCount, state };
}

export async function detectFairValueGaps({ symbol, snapshot, config, structureEvents = [] } = {}) {
  if (!snapshot?.candles?.length) throw new Error('snapshot.candles are required');
  const candles = snapshot.candles;
  const atr = Math.max(Number(snapshot.atr), Number.EPSILON);
  const tickSize = Math.max(Number(snapshot.tickSize), Number.EPSILON);
  const gaps = [];
  const rejected = [];
  const expirationMs = snapshot.timeframeMs * config.fvg.maximumAgeBars;

  for (let index = 2; index < candles.length; index += 1) {
    const first = candles[index - 2];
    const middle = candles[index - 1];
    const third = candles[index];
    const candidates = [];
    if (third.low > first.high) candidates.push({ direction: 'BULLISH', lower: first.high, upper: third.low });
    if (third.high < first.low) candidates.push({ direction: 'BEARISH', lower: third.high, upper: first.low });
    for (const candidate of candidates) {
      const size = candidate.upper - candidate.lower;
      const minimumSize = Math.max(atr * config.fvg.minimumSizeAtr, tickSize * config.fvg.minimumSizeTicks);
      if (size < minimumSize) {
        rejected.push({ index, direction: candidate.direction, reason: 'TINY_INVALID_FVG', size, minimumSize });
        continue;
      }
      const displacement = await evaluateDisplacementAt({ symbol, snapshot, index: index - 1, config });
      if (displacement.direction !== candidate.direction || displacement.score < config.fvg.minimumDisplacementScore
        || displacement.classification === 'ABNORMAL_NEWS_DRIVEN') {
        rejected.push({ index, direction: candidate.direction, reason: 'FVG_WITHOUT_VALID_DISPLACEMENT', displacementScore: displacement.score });
        continue;
      }
      const inversionBuffer = atr * config.fvg.inversionCloseBufferAtr;
      const lifecycle = fillState({
        direction: candidate.direction,
        lower: candidate.lower,
        upper: candidate.upper,
        candles,
        creationIndex: index,
        fullMitigationPercent: config.fvg.fullMitigationPercent,
        inversionBuffer,
      });
      const relevantStructure = [...structureEvents].reverse().find((event) => event.index <= index && event.direction === candidate.direction) || null;
      gaps.push(await createFairValueGap({
        symbol,
        timeframe: snapshot.timeframe,
        direction: candidate.direction,
        lower: candidate.lower,
        upper: candidate.upper,
        sizeAtr: round(size / atr),
        creationIndex: index,
        createdAt: third.timestamp,
        displacementId: displacement.displacementId,
        displacementScore: displacement.score,
        structuralOriginId: relevantStructure?.eventId || '',
        fillPercent: lifecycle.fillPercent,
        firstTouchAt: lifecycle.firstTouchAt,
        mitigationCount: lifecycle.mitigationCount,
        state: lifecycle.state,
        invalidationLevel: candidate.direction === 'BULLISH' ? candidate.lower : candidate.upper,
        expiresAt: third.timestamp + expirationMs,
        evidence: [
          'THREE_CANDLE_IMBALANCE_CONFIRMED',
          'MINIMUM_ATR_TICK_SIZE_PASSED',
          'MIDDLE_CANDLE_DISPLACEMENT_CONFIRMED',
        ],
        rejectionReasons: lifecycle.state === 'INVERTED' ? ['ORIGINAL_FVG_DIRECTION_FAILED'] : [],
      }));
    }
  }
  return Object.freeze({ gaps: Object.freeze(gaps), rejected: Object.freeze(rejected) });
}
