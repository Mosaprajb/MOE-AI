function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundToTick(value, tickSize, mode = 'nearest') {
  const scaled = value / tickSize;
  const rounded = mode === 'up' ? Math.ceil(scaled) : mode === 'down' ? Math.floor(scaled) : Math.round(scaled);
  return Number((rounded * tickSize).toFixed(8));
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function validOpposingPools(pools, direction, entry) {
  return (pools || []).filter((pool) => {
    if (!pool || pool.status === 'INVALIDATED' || pool.status === 'EXPIRED') return false;
    return direction === 'LONG'
      ? pool.side === 'BUY_SIDE' && pool.zoneLower > entry
      : pool.side === 'SELL_SIDE' && pool.zoneUpper < entry;
  });
}

function nearestOpposingPool(pools, direction, entry) {
  const candidates = validOpposingPools(pools, direction, entry);
  candidates.sort((left, right) => direction === 'LONG'
    ? left.zoneLower - right.zoneLower
    : right.zoneUpper - left.zoneUpper);
  return candidates[0] || null;
}

export function buildLiquidityTradePlan({ snapshot, pool, sweep, confirmation, liquidityPools = [], config } = {}) {
  if (!snapshot?.latest || !(snapshot.atr > 0) || !(snapshot.tickSize > 0)) throw new Error('Normalized market snapshot is required');
  if (!pool?.poolId || !sweep?.sweepId || sweep.poolId !== pool.poolId) throw new Error('Matching pool and sweep are required');
  if (!confirmation?.passed) throw new Error('Passed post-sweep confirmation is required');
  if (!config?.risk || !config?.confirmation) throw new Error('Validated liquidity-sweep configuration is required');

  const direction = sweep.direction;
  const tickSize = snapshot.tickSize;
  const atr = snapshot.atr;
  const latestPrice = snapshot.latest.close;
  const invalidation = sweep.extremePrice;
  const stopBuffer = Math.max(atr * config.risk.stopBufferAtr, tickSize * config.risk.stopBufferTicks);
  const stopLoss = direction === 'LONG'
    ? roundToTick(invalidation - stopBuffer, tickSize, 'down')
    : roundToTick(invalidation + stopBuffer, tickSize, 'up');

  const reclaimBoundary = direction === 'LONG' ? pool.zoneUpper : pool.zoneLower;
  const displacementPrice = confirmation.displacement
    ? direction === 'LONG'
      ? reclaimBoundary + confirmation.displacement.priceMove * 0.45
      : reclaimBoundary - confirmation.displacement.priceMove * 0.45
    : latestPrice;
  const rawEntry = direction === 'LONG'
    ? Math.min(latestPrice, Math.max(reclaimBoundary, displacementPrice))
    : Math.max(latestPrice, Math.min(reclaimBoundary, displacementPrice));
  const entry = roundToTick(rawEntry, tickSize, direction === 'LONG' ? 'up' : 'down');
  const entryZoneHalf = Math.max(tickSize * 2, atr * 0.08);
  const entryZoneLower = roundToTick(entry - entryZoneHalf, tickSize, 'down');
  const entryZoneUpper = roundToTick(entry + entryZoneHalf, tickSize, 'up');
  const entryExtensionAtr = Math.abs(latestPrice - reclaimBoundary) / atr;

  const riskPerShare = direction === 'LONG' ? entry - stopLoss : stopLoss - entry;
  if (!(riskPerShare > 0)) throw new Error('Trade plan risk per share must be positive');
  const stopAtr = riskPerShare / atr;
  const minimumReward = riskPerShare * config.risk.minimumRewardToRisk;
  const fallbackTarget = direction === 'LONG' ? entry + minimumReward : entry - minimumReward;
  const opposingPool = nearestOpposingPool(liquidityPools, direction, entry);
  const structuralTarget = opposingPool
    ? direction === 'LONG' ? opposingPool.zoneLower : opposingPool.zoneUpper
    : null;

  let target = structuralTarget;
  const evidence = ['STOP_BEYOND_SWEEP_EXTREME', 'ATR_AND_TICK_BUFFERED_STOP'];
  const rejectionReasons = [];
  if (target == null) {
    target = fallbackTarget;
    evidence.push('MINIMUM_RISK_REWARD_TARGET_FALLBACK');
  } else {
    evidence.push('TARGETS_OPPOSING_LIQUIDITY');
  }

  let rewardPerShare = direction === 'LONG' ? target - entry : entry - target;
  if (!(rewardPerShare > 0) || rewardPerShare / riskPerShare < config.risk.minimumRewardToRisk) {
    target = fallbackTarget;
    rewardPerShare = minimumReward;
    evidence.push('OPPOSING_LIQUIDITY_TOO_CLOSE_USING_MINIMUM_RR');
  }
  target = roundToTick(target, tickSize, direction === 'LONG' ? 'down' : 'up');
  rewardPerShare = direction === 'LONG' ? target - entry : entry - target;
  const rewardToRisk = rewardPerShare / riskPerShare;

  if (entryExtensionAtr > config.confirmation.maximumEntryExtensionAtr) rejectionReasons.push('ENTRY_TOO_EXTENDED_FROM_RECLAIM');
  if (stopAtr > config.risk.maximumStopAtr) rejectionReasons.push('STOP_DISTANCE_EXCEEDS_MAXIMUM_ATR');
  if (rewardToRisk < config.risk.minimumRewardToRisk) rejectionReasons.push('REWARD_TO_RISK_BELOW_MINIMUM');
  if (snapshot.spread?.spreadPercent != null && snapshot.spread.spreadPercent > config.risk.maximumSpreadPercent) rejectionReasons.push('SPREAD_EXCEEDS_MAXIMUM');

  const valid = rejectionReasons.length === 0;
  const executionQuality = clamp(Math.round(
    100
    - Math.min(35, entryExtensionAtr / Math.max(config.confirmation.maximumEntryExtensionAtr, 0.01) * 35)
    - Math.min(30, stopAtr / Math.max(config.risk.maximumStopAtr, 0.01) * 30)
    + Math.min(20, Math.max(0, rewardToRisk - config.risk.minimumRewardToRisk) * 8)
    - Math.min(15, (snapshot.spread?.spreadPercent || 0) / Math.max(config.risk.maximumSpreadPercent, 0.001) * 15)
  ), 0, 100);

  return Object.freeze({
    valid,
    direction,
    orderType: 'LIMIT',
    entry: Number(entry.toFixed(8)),
    entryZoneLower: Number(entryZoneLower.toFixed(8)),
    entryZoneUpper: Number(entryZoneUpper.toFixed(8)),
    stopLoss: Number(stopLoss.toFixed(8)),
    takeProfit: Number(target.toFixed(8)),
    invalidationPrice: Number(invalidation.toFixed(8)),
    riskPerShare: Number(riskPerShare.toFixed(8)),
    rewardPerShare: Number(rewardPerShare.toFixed(8)),
    rewardToRisk: Number(rewardToRisk.toFixed(4)),
    stopAtr: Number(stopAtr.toFixed(4)),
    entryExtensionAtr: Number(entryExtensionAtr.toFixed(4)),
    executionQuality,
    targetPoolId: opposingPool?.poolId || null,
    targetPoolType: opposingPool?.type || null,
    executionAllowed: false,
    mode: 'PAPER_TRADING',
    evidence: Object.freeze(unique(evidence)),
    rejectionReasons: Object.freeze(unique(rejectionReasons)),
  });
}
