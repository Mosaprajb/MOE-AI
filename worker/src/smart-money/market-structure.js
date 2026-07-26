import { createSwingPoint, createStructuralEvent } from './contracts.js';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

function closeLocation(candle, direction) {
  const range = Math.max(candle.high - candle.low, Number.EPSILON);
  return direction === 'BULLISH'
    ? (candle.close - candle.low) / range
    : (candle.high - candle.close) / range;
}

function isPivotHigh(candles, index, left, right) {
  const value = candles[index].high;
  for (let i = index - left; i <= index + right; i += 1) {
    if (i === index) continue;
    if (i < index && candles[i].high >= value) return false;
    if (i > index && candles[i].high > value) return false;
  }
  return true;
}

function isPivotLow(candles, index, left, right) {
  const value = candles[index].low;
  for (let i = index - left; i <= index + right; i += 1) {
    if (i === index) continue;
    if (i < index && candles[i].low <= value) return false;
    if (i > index && candles[i].low < value) return false;
  }
  return true;
}

function prominenceAtr(candles, index, type, atr, left, right) {
  const surrounding = candles.slice(index - left, index + right + 1);
  if (type === 'SWING_HIGH') {
    const base = Math.max(...surrounding.filter((_, i) => i !== left).map((candle) => candle.high));
    return Math.max(0, (candles[index].high - base) / atr);
  }
  const base = Math.min(...surrounding.filter((_, i) => i !== left).map((candle) => candle.low));
  return Math.max(0, (base - candles[index].low) / atr);
}

function scopeFor(candles, index, type, windowBars) {
  const start = Math.max(0, index - windowBars);
  const end = Math.min(candles.length - 1, index + windowBars);
  const window = candles.slice(start, end + 1);
  if (type === 'SWING_HIGH') {
    return candles[index].high >= Math.max(...window.map((candle) => candle.high)) ? 'EXTERNAL' : 'INTERNAL';
  }
  return candles[index].low <= Math.min(...window.map((candle) => candle.low)) ? 'EXTERNAL' : 'INTERNAL';
}

export async function detectConfirmedSwings({ symbol, snapshot, config } = {}) {
  if (!snapshot?.candles?.length) throw new Error('snapshot.candles are required');
  const candles = snapshot.candles;
  const left = config.structure.pivotLeftBars;
  const right = config.structure.pivotRightBars;
  const atr = Math.max(Number(snapshot.atr), Number.EPSILON);
  const swings = [];

  for (let index = left; index < candles.length - right; index += 1) {
    const confirmationIndex = index + right;
    const candidates = [];
    if (isPivotHigh(candles, index, left, right)) candidates.push('SWING_HIGH');
    if (isPivotLow(candles, index, left, right)) candidates.push('SWING_LOW');
    for (const type of candidates) {
      const prominence = prominenceAtr(candles, index, type, atr, left, right);
      if (prominence < config.structure.minimumSwingProminenceAtr) continue;
      const scope = scopeFor(candles, index, type, config.structure.externalWindowBars);
      const strength = clamp(Math.round(
        35
        + Math.min(35, prominence / Math.max(config.structure.minimumSwingProminenceAtr, 0.0001) * 20)
        + (scope === 'EXTERNAL' ? 20 : 0)
        + Math.min(10, right * 2)
      ), 0, 100);
      swings.push(await createSwingPoint({
        symbol,
        timeframe: snapshot.timeframe,
        type,
        scope,
        index,
        confirmationIndex,
        timestamp: candles[index].timestamp,
        confirmedAt: candles[confirmationIndex].timestamp,
        price: type === 'SWING_HIGH' ? candles[index].high : candles[index].low,
        prominenceAtr: round(prominence),
        strength,
        reactions: 0,
        protected: false,
        liquidityUnswept: true,
        invalidated: false,
        evidence: ['PIVOT_CONFIRMED_AFTER_RIGHT_BARS', `${scope}_STRUCTURE`],
      }));
    }
  }
  return Object.freeze(swings.sort((a, b) => a.index - b.index || a.type.localeCompare(b.type)));
}

function priorDirectionalEvent(events, beforeIndex) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    if (events[i].index < beforeIndex) return events[i];
  }
  return null;
}

function classifyEventType(previous, direction, scope) {
  if (!previous) return 'BREAK_OF_STRUCTURE';
  if (previous.direction === direction) return 'BREAK_OF_STRUCTURE';
  return scope === 'EXTERNAL' ? 'MARKET_STRUCTURE_SHIFT' : 'CHANGE_OF_CHARACTER';
}

function latestUnbrokenSwing(swings, type, index, broken) {
  for (let i = swings.length - 1; i >= 0; i -= 1) {
    const swing = swings[i];
    if (swing.index >= index || swing.type !== type || broken.has(swing.swingId)) continue;
    return swing;
  }
  return null;
}

export async function detectStructuralEvents({ symbol, snapshot, config, swings = null } = {}) {
  const confirmedSwings = swings || await detectConfirmedSwings({ symbol, snapshot, config });
  const candles = snapshot.candles;
  const atr = Math.max(Number(snapshot.atr), Number.EPSILON);
  const tickSize = Math.max(Number(snapshot.tickSize), Number.EPSILON);
  const broken = new Set();
  const events = [];
  const rejected = [];

  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    for (const direction of ['BULLISH', 'BEARISH']) {
      const type = direction === 'BULLISH' ? 'SWING_HIGH' : 'SWING_LOW';
      const swing = latestUnbrokenSwing(confirmedSwings, type, index, broken);
      if (!swing || swing.confirmationIndex >= index) continue;
      const wickCross = direction === 'BULLISH' ? candle.high > swing.price : candle.low < swing.price;
      const closeCross = direction === 'BULLISH' ? candle.close > swing.price : candle.close < swing.price;
      if (!wickCross) continue;
      if (!closeCross) {
        rejected.push({ index, swingId: swing.swingId, reason: 'WICK_ONLY_FALSE_BREAK' });
        continue;
      }
      const penetration = Math.abs(candle.close - swing.price);
      const minimumPenetration = Math.max(
        atr * config.structure.minimumBosPenetrationAtr,
        tickSize * config.structure.minimumBosPenetrationTicks,
      );
      const bodyAtr = Math.abs(candle.close - candle.open) / atr;
      const location = closeLocation(candle, direction);
      const latestRvol = index === candles.length - 1 ? snapshot.relativeVolume : null;
      const rangeAtr = (candle.high - candle.low) / atr;
      const rvolAccepted = latestRvol != null && latestRvol >= config.structure.minimumBreakRelativeVolume;
      const expansionAccepted = config.structure.allowRangeExpansionWithoutRvol && rangeAtr >= 1;
      const reasons = [];
      if (penetration < minimumPenetration) reasons.push('INSUFFICIENT_CLOSE_PENETRATION');
      if (bodyAtr < config.structure.minimumBreakBodyAtr) reasons.push('BREAK_BODY_TOO_SMALL');
      if (location < config.structure.minimumDirectionalCloseLocation) reasons.push('POOR_DIRECTIONAL_CLOSE');
      if (!rvolAccepted && !expansionAccepted) reasons.push('NO_VOLUME_OR_RANGE_EXPANSION_CONFIRMATION');
      if (reasons.length) {
        rejected.push({ index, swingId: swing.swingId, reason: 'WEAK_STRUCTURE_BREAK', reasons });
        continue;
      }
      const previous = priorDirectionalEvent(events, index);
      const eventType = classifyEventType(previous, direction, swing.scope);
      const qualityScore = clamp(Math.round(
        25
        + Math.min(25, penetration / minimumPenetration * 10)
        + Math.min(20, bodyAtr / config.structure.minimumBreakBodyAtr * 10)
        + Math.min(15, location * 15)
        + (rvolAccepted ? 10 : 5)
        + (swing.scope === 'EXTERNAL' ? 10 : 0)
      ), 0, 100);
      const event = await createStructuralEvent({
        symbol,
        timeframe: snapshot.timeframe,
        eventType,
        direction,
        scope: swing.scope,
        sourceSwingId: swing.swingId,
        index,
        confirmedAt: candle.timestamp,
        level: swing.price,
        close: candle.close,
        penetration: round(penetration),
        penetrationAtr: round(penetration / atr),
        bodyAtr: round(bodyAtr),
        closeLocation: round(location),
        relativeVolume: latestRvol,
        qualityScore,
        evidence: [
          'CANDLE_CLOSE_BEYOND_CONFIRMED_SWING',
          'MINIMUM_PENETRATION_PASSED',
          'BODY_DISPLACEMENT_PASSED',
          rvolAccepted ? 'RELATIVE_VOLUME_CONFIRMED' : 'RANGE_EXPANSION_CONFIRMED',
        ],
        rejectionReasons: [],
      });
      events.push(event);
      broken.add(swing.swingId);
    }
  }

  const latestEvent = events.at(-1) || null;
  const bias = latestEvent?.direction || 'NEUTRAL';
  return Object.freeze({
    swings: confirmedSwings,
    events: Object.freeze(events),
    rejectedEvents: Object.freeze(rejected),
    currentBias: bias,
    latestEvent,
  });
}
