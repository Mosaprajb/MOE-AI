import { createSweepEvent } from './contracts.js';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bodySize(candle) {
  return Math.abs(candle.close - candle.open);
}

function candleRange(candle) {
  return Math.max(0, candle.high - candle.low);
}

function closeLocation(candle, direction) {
  const range = candleRange(candle);
  if (!(range > 0)) return 0.5;
  return direction === 'LONG'
    ? clamp((candle.close - candle.low) / range, 0, 1)
    : clamp((candle.high - candle.close) / range, 0, 1);
}

function wickToBody(candle, direction, tickSize) {
  const body = Math.max(bodySize(candle), tickSize);
  const wick = direction === 'LONG'
    ? Math.max(0, Math.min(candle.open, candle.close) - candle.low)
    : Math.max(0, candle.high - Math.max(candle.open, candle.close));
  return wick / body;
}

function eventDirection(pool) {
  return pool.side === 'SELL_SIDE' ? 'LONG' : 'SHORT';
}

function penetrates(candle, pool, minimumDistance) {
  return pool.side === 'SELL_SIDE'
    ? pool.zoneLower - candle.low >= minimumDistance
    : candle.high - pool.zoneUpper >= minimumDistance;
}

function penetrationDistance(candle, pool) {
  return pool.side === 'SELL_SIDE'
    ? Math.max(0, pool.zoneLower - candle.low)
    : Math.max(0, candle.high - pool.zoneUpper);
}

function reclaimed(candle, pool) {
  return pool.side === 'SELL_SIDE'
    ? candle.close >= pool.zoneLower
    : candle.close <= pool.zoneUpper;
}

function closesOutside(candle, pool) {
  return pool.side === 'SELL_SIDE'
    ? candle.close < pool.zoneLower
    : candle.close > pool.zoneUpper;
}

function extremePrice(candles, pool) {
  return pool.side === 'SELL_SIDE'
    ? Math.min(...candles.map((candle) => candle.low))
    : Math.max(...candles.map((candle) => candle.high));
}

function relativeVolumeAt(snapshot, index, lookback = 20) {
  const candles = snapshot.candles;
  const current = candles[index]?.volume;
  if (!(current >= 0)) return null;
  const baseline = candles.slice(Math.max(0, index - lookback), index).map((candle) => candle.volume).filter((value) => value > 0);
  if (!baseline.length) return null;
  return current / (baseline.reduce((sum, value) => sum + value, 0) / baseline.length);
}

function rejectionEvidence({ sweepCandle, reclaimCandle, direction, wickRatio, location, reclaimBars, relativeVolume, config }) {
  const evidence = [];
  const rejectionReasons = [];
  if (reclaimBars <= 1) evidence.push('FAST_RECLAIM');
  else if (reclaimBars <= config.sweep.maximumReclaimCandles) evidence.push('TIMELY_RECLAIM');
  if (wickRatio >= config.sweep.minimumWickToBodyRatio) evidence.push(direction === 'LONG' ? 'STRONG_LOWER_WICK' : 'STRONG_UPPER_WICK');
  else rejectionReasons.push('WEAK_WICK_REJECTION');
  if (location >= config.sweep.minimumCloseLocation) evidence.push('CLOSE_FAVORS_REVERSAL');
  else rejectionReasons.push('WEAK_RECLAIM_CLOSE');
  if (relativeVolume != null && relativeVolume >= config.sweep.minimumRelativeVolume) evidence.push('ADEQUATE_SWEEP_VOLUME');
  else rejectionReasons.push('LOW_SWEEP_RELATIVE_VOLUME');
  if (reclaimCandle && direction === 'LONG' && reclaimCandle.close > reclaimCandle.open) evidence.push('BULLISH_RECLAIM_CANDLE');
  if (reclaimCandle && direction === 'SHORT' && reclaimCandle.close < reclaimCandle.open) evidence.push('BEARISH_RECLAIM_CANDLE');
  if (sweepCandle && reclaimCandle && reclaimCandle.timestamp > sweepCandle.timestamp) evidence.push('POST_PENETRATION_CONFIRMATION');
  return { evidence, rejectionReasons };
}

export async function detectLiquiditySweep({ symbol, snapshot, pool, config } = {}) {
  if (!symbol) throw new Error('symbol is required for sweep detection');
  if (!snapshot?.candles?.length || !(snapshot.atr > 0) || !(snapshot.tickSize > 0)) throw new Error('Normalized market snapshot is required');
  if (!pool?.poolId || !['BUY_SIDE', 'SELL_SIDE'].includes(pool.side)) throw new Error('A valid liquidity pool is required');
  if (!config?.sweep) throw new Error('Validated liquidity-sweep configuration is required');

  const minimumDistance = Math.max(
    snapshot.atr * config.sweep.minimumPenetrationAtr,
    snapshot.tickSize * config.sweep.minimumPenetrationTicks,
  );
  const maximumDistance = snapshot.atr * config.sweep.maximumPenetrationAtr;
  const startIndex = Math.max(0, snapshot.candles.findIndex((candle) => candle.timestamp >= pool.createdAt));
  const direction = eventDirection(pool);
  const events = [];

  for (let index = startIndex; index < snapshot.candles.length; index += 1) {
    const candle = snapshot.candles[index];
    if (!penetrates(candle, pool, minimumDistance)) continue;
    const depth = penetrationDistance(candle, pool);
    const penetrationAtr = depth / snapshot.atr;
    const maximumWindowEnd = Math.min(snapshot.candles.length - 1, index + config.sweep.maximumReclaimCandles);
    let reclaimIndex = null;
    let outsideCount = closesOutside(candle, pool) ? 1 : 0;

    for (let cursor = index; cursor <= maximumWindowEnd; cursor += 1) {
      const candidate = snapshot.candles[cursor];
      if (cursor > index && closesOutside(candidate, pool)) outsideCount += 1;
      if (reclaimed(candidate, pool)) {
        reclaimIndex = cursor;
        break;
      }
    }

    const eventCandles = snapshot.candles.slice(index, (reclaimIndex ?? maximumWindowEnd) + 1);
    const reclaimCandle = reclaimIndex == null ? null : snapshot.candles[reclaimIndex];
    const reclaimBars = reclaimIndex == null ? null : reclaimIndex - index;
    const representative = reclaimCandle || candle;
    const wickRatio = wickToBody(representative, direction, snapshot.tickSize);
    const location = closeLocation(representative, direction);
    const relativeVolume = relativeVolumeAt(snapshot, reclaimIndex ?? index, config.dataQuality?.volumeLookback || 20);
    const evidenceBundle = rejectionEvidence({
      sweepCandle: candle,
      reclaimCandle,
      direction,
      wickRatio,
      location,
      reclaimBars: reclaimBars ?? config.sweep.maximumReclaimCandles + 1,
      relativeVolume,
      config,
    });
    const rejectionReasons = [...evidenceBundle.rejectionReasons];
    if (depth > maximumDistance) rejectionReasons.push('PENETRATION_TOO_DEEP');
    if (outsideCount > config.sweep.maximumCandlesOutside) rejectionReasons.push('TOO_MANY_CLOSES_OUTSIDE_POOL');
    if (reclaimIndex == null) rejectionReasons.push('NO_RECLAIM_WITHIN_WINDOW');

    events.push(await createSweepEvent({
      poolId: pool.poolId,
      symbol,
      direction,
      detectedAt: candle.timestamp,
      extremePrice: extremePrice(eventCandles, pool),
      penetrationDistance: Number(depth.toFixed(8)),
      penetrationAtr: Number(penetrationAtr.toFixed(6)),
      candlesOutside: outsideCount,
      reclaimed: reclaimIndex != null,
      reclaimedAt: reclaimCandle?.timestamp ?? null,
      reclaimCandles: reclaimBars,
      wickToBodyRatio: Number(wickRatio.toFixed(4)),
      closeLocation: Number(location.toFixed(4)),
      acceptanceScore: 0,
      rejectionScore: 0,
      classification: reclaimIndex == null ? 'UNCONFIRMED_PENETRATION' : 'PROBABLE_LIQUIDITY_SWEEP',
      confidence: 0,
      evidence: [
        'MEANINGFUL_POOL_PENETRATION',
        ...evidenceBundle.evidence,
        ...(depth <= maximumDistance ? ['PENETRATION_WITHIN_ADAPTIVE_LIMIT'] : []),
      ],
      rejectionReasons,
    }));
  }

  return Object.freeze({
    symbol: String(symbol).toUpperCase(),
    poolId: pool.poolId,
    direction,
    evaluatedAt: new Date().toISOString(),
    minimumPenetrationDistance: Number(minimumDistance.toFixed(8)),
    maximumPenetrationDistance: Number(maximumDistance.toFixed(8)),
    eventCount: events.length,
    events: Object.freeze(events),
  });
}
