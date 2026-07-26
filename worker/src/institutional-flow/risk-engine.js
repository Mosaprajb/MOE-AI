function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function blocked(reason) {
  return freeze({ stage: 'RISK_ENGINE', passed: false, status: 'BLOCKED', reason, failedConditions: [reason], executionAllowed: false, automaticSubmissionAllowed: false, liveExecutionAllowed: false, mode: 'PAPER_TRADING' });
}

export function evaluateInstitutionalRiskStage({ structureConfirmation, smartMoneyResult, snapshot, config } = {}) {
  if (!structureConfirmation?.passed) return blocked('BLOCKED_BY_STRUCTURE_CONFIRMATION_STAGE');
  const risk = smartMoneyResult?.details?.riskEvaluation || {};
  const spreadPercent = Number(snapshot?.spreadPercent ?? snapshot?.quality?.spreadPercent ?? 0);
  const failedConditions = [...(risk.failedConditions || [])];
  if (risk.observationAccepted !== true) failedConditions.push('SMART_MONEY_RISK_REJECTED');
  if (Number(risk.rewardRisk || 0) < config.risk.minimumRewardRisk) failedConditions.push('REWARD_RISK_BELOW_PIPELINE_MINIMUM');
  if (Number(risk.stopAtr || Infinity) > config.risk.maximumStopAtr) failedConditions.push('STOP_DISTANCE_EXCEEDS_PIPELINE_MAXIMUM');
  if (Number.isFinite(spreadPercent) && spreadPercent > config.risk.maximumSpreadPercent) failedConditions.push('SPREAD_EXCEEDS_PIPELINE_MAXIMUM');

  return freeze({
    stage: 'RISK_ENGINE',
    passed: failedConditions.length === 0,
    status: failedConditions.length === 0 ? 'PASSED' : 'REJECTED',
    direction: risk.direction || structureConfirmation.direction,
    entry: risk.entry ?? null,
    stop: risk.stop ?? null,
    target: risk.target ?? null,
    riskPerShare: risk.riskPerShare ?? null,
    rewardPerShare: risk.rewardPerShare ?? null,
    rewardRisk: risk.rewardRisk ?? 0,
    stopAtr: risk.stopAtr ?? null,
    spreadPercent: Number.isFinite(spreadPercent) ? spreadPercent : null,
    positionSizing: smartMoneyResult?.details?.positionSizing || null,
    failedConditions: [...new Set(failedConditions)],
    observationAccepted: failedConditions.length === 0,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
