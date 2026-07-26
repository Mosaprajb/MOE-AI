function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  return Number(Number(value).toFixed(digits));
}

export function evaluateAnalyticalPositionSize({
  accountEquity,
  maximumRiskPercent = 0.5,
  entryPrice,
  stopPrice,
  maximumNotionalPercent = 10,
} = {}) {
  const equity = finite(accountEquity, 0);
  const riskPercent = finite(maximumRiskPercent, 0);
  const entry = finite(entryPrice, 0);
  const stop = finite(stopPrice, 0);
  const notionalPercent = finite(maximumNotionalPercent, 0);
  const failedConditions = [];

  if (!(equity > 0)) failedConditions.push('ACCOUNT_EQUITY_REQUIRED');
  if (!(riskPercent > 0 && riskPercent <= 2)) failedConditions.push('RISK_PERCENT_OUT_OF_RANGE');
  if (!(entry > 0 && stop > 0)) failedConditions.push('VALID_ENTRY_AND_STOP_REQUIRED');

  const riskPerShare = Math.abs(entry - stop);
  if (!(riskPerShare > 0)) failedConditions.push('NON_ZERO_RISK_PER_SHARE_REQUIRED');

  const riskBudget = equity * (riskPercent / 100);
  const riskLimitedShares = riskPerShare > 0 ? Math.floor(riskBudget / riskPerShare) : 0;
  const maximumNotional = equity * (notionalPercent / 100);
  const notionalLimitedShares = entry > 0 ? Math.floor(maximumNotional / entry) : 0;
  const analyticalShares = Math.max(0, Math.min(riskLimitedShares, notionalLimitedShares));

  if (analyticalShares < 1) failedConditions.push('ANALYTICAL_SIZE_BELOW_ONE_SHARE');

  return Object.freeze({
    status: failedConditions.length ? 'REJECTED' : 'ANALYTICAL_SIZE_AVAILABLE',
    accountEquity: round(equity, 2),
    maximumRiskPercent: round(riskPercent, 4),
    riskBudget: round(riskBudget, 2),
    riskPerShare: round(riskPerShare, 6),
    maximumNotionalPercent: round(notionalPercent, 4),
    maximumNotional: round(maximumNotional, 2),
    riskLimitedShares,
    notionalLimitedShares,
    analyticalShares,
    estimatedNotional: round(analyticalShares * entry, 2),
    estimatedMaximumLoss: round(analyticalShares * riskPerShare, 2),
    failedConditions: Object.freeze(failedConditions),
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
