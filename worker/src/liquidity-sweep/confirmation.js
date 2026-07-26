function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function body(candle) {
  return Math.abs(candle.close - candle.open);
}

function directionMove(candle, direction) {
  return direction === 'LONG' ? candle.close - candle.open : candle.open - candle.close;
}

function closesInDirection(candle, direction) {
  return direction === 'LONG' ? candle.close > candle.open : candle.close < candle.open;
}

function structuralPivot(candles, direction) {
  if (candles.length < 3) return null;
  const beforeLast = candles.slice(0, -1);
  return direction === 'LONG'
    ? Math.max(...beforeLast.map((candle) => candle.high))
    : Math.min(...beforeLast.map((candle) => candle.low));
}

function breaksPivot(candle, pivot, direction) {
  if (!Number.isFinite(pivot)) return false;
  return direction === 'LONG' ? candle.close > pivot : candle.close < pivot;
}

function imbalancePresent(previous, current, direction, tickSize) {
  if (!previous || !current) return false;
  return direction === 'LONG'
    ? current.low > previous.high + tickSize * 0.5
    : current.high < previous.low - tickSize * 0.5;
}

function retestsPool(candle, pool, tolerance, direction) {
  if (direction === 'LONG') {
    return candle.low <= pool.zoneUpper + tolerance && candle.close >= pool.zoneLower;
  }
  return candle.high >= pool.zoneLower - tolerance && candle.close <= pool.zoneUpper;
}

function rejectsRetest(candle, pool, direction) {
  return direction === 'LONG'
    ? candle.close > pool.zoneUpper && candle.close > candle.open
    : candle.close < pool.zoneLower && candle.close < candle.open;
}

export function evaluatePostSweepConfirmation({ snapshot, pool, sweep, config } = {}) {
  if (!snapshot?.candles?.length || !(snapshot.atr > 0) || !(snapshot.tickSize > 0)) throw new Error('Normalized market snapshot is required');
  if (!pool?.poolId || !sweep?.sweepId || sweep.poolId !== pool.poolId) throw new Error('Matching pool and sweep are required');
  if (!config?.confirmation) throw new Error('Validated liquidity-sweep configuration is required');

  const direction = sweep.direction;
  const startIndex = snapshot.candles.findIndex((candle) => candle.timestamp >= (sweep.reclaimedAt ?? sweep.detectedAt));
  if (startIndex < 0) throw new Error('Sweep timestamp is outside the supplied candle snapshot');

  const windowEnd = Math.min(snapshot.candles.length, startIndex + Math.max(config.confirmation.retestMaximumBars + 4, 6));
  const candles = snapshot.candles.slice(startIndex, windowEnd);
  const evidence = [];
  const rejectionReasons = [];
  const displacementThreshold = snapshot.atr * config.confirmation.minimumDisplacementAtr;
  const pivot = structuralPivot(snapshot.candles.slice(Math.max(0, startIndex - 8), startIndex + 1), direction);

  let displacement = null;
  let displacementIndex = null;
  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const move = directionMove(candle, direction);
    if (closesInDirection(candle, direction) && move >= displacementThreshold) {
      displacement = candle;
      displacementIndex = index;
      break;
    }
  }

  const displacementAtr = displacement ? directionMove(displacement, direction) / snapshot.atr : 0;
  if (displacement) evidence.push('POST_SWEEP_DISPLACEMENT');
  else rejectionReasons.push('MISSING_POST_SWEEP_DISPLACEMENT');

  const structureShift = displacement ? breaksPivot(displacement, pivot, direction) : false;
  if (structureShift) evidence.push('INTERNAL_STRUCTURE_SHIFT');
  else if (config.confirmation.requireStructureShift) rejectionReasons.push('REQUIRED_STRUCTURE_SHIFT_MISSING');

  const previous = displacementIndex > 0 ? candles[displacementIndex - 1] : snapshot.candles[startIndex - 1];
  const imbalance = displacement ? imbalancePresent(previous, displacement, direction, snapshot.tickSize) : false;
  if (imbalance) evidence.push('DISPLACEMENT_IMBALANCE');

  const tolerance = Math.max(snapshot.tickSize * 2, snapshot.atr * 0.08);
  let retest = null;
  let retestIndex = null;
  if (displacementIndex != null) {
    const limit = Math.min(candles.length, displacementIndex + 1 + config.confirmation.retestMaximumBars);
    for (let index = displacementIndex + 1; index < limit; index += 1) {
      if (retestsPool(candles[index], pool, tolerance, direction)) {
        retest = candles[index];
        retestIndex = index;
        break;
      }
    }
  }

  const retestRejected = retest ? rejectsRetest(retest, pool, direction) : false;
  if (retestRejected) evidence.push('POOL_RETEST_REJECTED');
  else if (retest) rejectionReasons.push('RETEST_DID_NOT_REJECT');
  else if (config.confirmation.requireRetest) rejectionReasons.push('REQUIRED_RETEST_MISSING');

  const postReclaim = candles[0];
  const failedContinuation = direction === 'LONG'
    ? Math.min(...candles.map((candle) => candle.low)) >= sweep.extremePrice
    : Math.max(...candles.map((candle) => candle.high)) <= sweep.extremePrice;
  if (failedContinuation) evidence.push('FAILED_CONTINUATION_BEYOND_SWEEP_EXTREME');
  else rejectionReasons.push('SWEEP_EXTREME_RETESTED_OR_BROKEN');

  const latest = candles.at(-1);
  const movementTowardOpposingLiquidity = direction === 'LONG'
    ? latest.close > postReclaim.close
    : latest.close < postReclaim.close;
  if (movementTowardOpposingLiquidity) evidence.push('MOVING_AWAY_FROM_SWEPT_LIQUIDITY');

  const baselineVolumes = snapshot.candles.slice(Math.max(0, startIndex - (config.dataQuality?.volumeLookback || 20)), startIndex)
    .map((candle) => finite(candle.volume))
    .filter((value) => value > 0);
  const averageVolume = baselineVolumes.length ? baselineVolumes.reduce((sum, value) => sum + value, 0) / baselineVolumes.length : 0;
  const confirmationVolume = displacement ? finite(displacement.volume) : finite(postReclaim.volume);
  const reversalRelativeVolume = averageVolume > 0 ? confirmationVolume / averageVolume : null;
  if (reversalRelativeVolume != null && reversalRelativeVolume >= 1) evidence.push('REVERSAL_VOLUME_CONFIRMED');

  let score = 0;
  score += displacement ? clamp(Math.round(displacementAtr / Math.max(config.confirmation.minimumDisplacementAtr, 0.01) * 30), 18, 30) : 0;
  score += structureShift ? 20 : config.confirmation.requireStructureShift ? 0 : 8;
  score += retestRejected ? 18 : !config.confirmation.requireRetest && !retest ? 8 : 0;
  score += imbalance ? 10 : 0;
  score += failedContinuation ? 12 : 0;
  score += movementTowardOpposingLiquidity ? 5 : 0;
  score += reversalRelativeVolume != null ? clamp(Math.round(reversalRelativeVolume * 5), 0, 5) : 0;
  score = clamp(Math.round(score), 0, 100);

  const mandatoryPassed = Boolean(displacement)
    && failedContinuation
    && (!config.confirmation.requireStructureShift || structureShift)
    && (!config.confirmation.requireRetest || retestRejected);
  const passed = mandatoryPassed && score >= config.confirmation.minimumScore;
  if (!passed && score < config.confirmation.minimumScore) rejectionReasons.push('CONFIRMATION_SCORE_BELOW_THRESHOLD');

  return Object.freeze({
    passed,
    score,
    direction,
    evaluatedAt: new Date().toISOString(),
    displacement: displacement ? Object.freeze({
      timestamp: displacement.timestamp,
      priceMove: Number(directionMove(displacement, direction).toFixed(8)),
      atr: Number(displacementAtr.toFixed(4)),
      body: Number(body(displacement).toFixed(8)),
    }) : null,
    structureShift,
    structurePivot: Number.isFinite(pivot) ? Number(pivot.toFixed(8)) : null,
    imbalance,
    retest: retest ? Object.freeze({
      timestamp: retest.timestamp,
      rejected: retestRejected,
      barsAfterDisplacement: retestIndex - displacementIndex,
    }) : null,
    failedContinuation,
    movementTowardOpposingLiquidity,
    reversalRelativeVolume: reversalRelativeVolume == null ? null : Number(reversalRelativeVolume.toFixed(4)),
    context: Object.freeze({
      confirmationPassed: passed,
      opposingDisplacement: Boolean(displacement),
      failedContinuation,
      retestRejected,
      reversalRelativeVolume: reversalRelativeVolume != null && reversalRelativeVolume >= 1,
      movingTowardOpposingLiquidity: movementTowardOpposingLiquidity,
    }),
    evidence: Object.freeze(unique(evidence)),
    rejectionReasons: Object.freeze(unique(rejectionReasons)),
  });
}
