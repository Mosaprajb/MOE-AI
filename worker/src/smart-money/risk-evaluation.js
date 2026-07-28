function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

export function evaluateSmartMoneyRisk({
  direction,
  entryZone,
  currentPrice,
  confluence,
  setupFamily,
  minimumRewardRisk = 2,
  maximumStopAtr = 2.5,
  atr,
  opposingLiquidityTarget = null,
} = {}) {
  const failedConditions = [];
  if (!['BULLISH', 'BEARISH'].includes(direction)) failedConditions.push('INVALID_DIRECTION');
  if (!entryZone) failedConditions.push('NO_ENTRY_ZONE');
  if (!confluence?.mandatoryPassed) failedConditions.push('CONFLUENCE_MANDATORY_CONDITIONS_FAILED');
  if (!setupFamily?.classified) failedConditions.push('UNCLASSIFIED_SETUP_FAMILY');

  const normalizedAtr = Number(atr);
  const entry = Number(entryZone?.midpoint ?? currentPrice);
  const stop = Number(entryZone?.invalidationLevel);
  const target = Number(opposingLiquidityTarget);
  if (!(entry > 0)) failedConditions.push('INVALID_ENTRY_PRICE');
  if (!(stop > 0)) failedConditions.push('INVALID_STOP_PRICE');

  const risk = direction === 'BULLISH' ? entry - stop : stop - entry;
  const reward = direction === 'BULLISH' ? target - entry : entry - target;
  if (!(risk > 0)) failedConditions.push('NON_POSITIVE_RISK_DISTANCE');
  if (!(target > 0) || !(reward > 0)) failedConditions.push('NO_VALID_OPPOSING_LIQUIDITY_TARGET');

  const rewardRisk = risk > 0 && reward > 0 ? reward / risk : 0;
  const stopAtr = risk > 0 && normalizedAtr > 0 ? risk / normalizedAtr : Infinity;
  if (rewardRisk < minimumRewardRisk) failedConditions.push('REWARD_RISK_BELOW_MINIMUM');
  if (stopAtr > maximumStopAtr) failedConditions.push('STOP_DISTANCE_TOO_WIDE');

  const observationAccepted = failedConditions.length === 0;
  return freeze({
    observationAccepted,
    status: observationAccepted ? 'OBSERVATION_ACCEPTED' : 'REJECTED',
    direction,
    entry: Number.isFinite(entry) ? round(entry) : null,
    stop: Number.isFinite(stop) ? round(stop) : null,
    target: Number.isFinite(target) ? round(target) : null,
    riskPerShare: Number.isFinite(risk) ? round(risk) : null,
    rewardPerShare: Number.isFinite(reward) ? round(reward) : null,
    rewardRisk: round(rewardRisk),
    stopAtr: Number.isFinite(stopAtr) ? round(stopAtr) : null,
    failedConditions,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
