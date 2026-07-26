function unique(items) {
  return [...new Set((items || []).filter(Boolean))];
}

function sentence(value) {
  return String(value || '').trim().replace(/_/g, ' ').toLowerCase();
}

export function explainLiquiditySweepDecision({ symbol, pool, sweep, confirmation, higherTimeframe, tradePlan, quality } = {}) {
  const evidence = unique([
    ...(pool?.evidence || []),
    ...(sweep?.evidence || []),
    ...(confirmation?.evidence || []),
    ...(higherTimeframe?.evidence || []),
    ...(tradePlan?.evidence || []),
    ...(quality?.evidence || []),
  ]);
  const rejectionReasons = unique([
    ...(pool?.penalties || []),
    ...(sweep?.rejectionReasons || []),
    ...(confirmation?.rejectionReasons || []),
    ...(higherTimeframe?.penalties || []),
    ...(tradePlan?.rejectionReasons || []),
    ...(quality?.rejectionReasons || []),
  ]);

  const approved = quality?.approved === true;
  const direction = sweep?.direction || 'UNKNOWN';
  const poolLabel = pool?.type || 'UNKNOWN_POOL';
  const score = Number.isFinite(Number(quality?.total)) ? Number(quality.total) : 0;
  const summary = approved
    ? `${symbol} has an approved ${direction.toLowerCase()} paper setup after a confirmed sweep of ${sentence(poolLabel)} with quality ${score}/100.`
    : `${symbol} remains NO_TRADE because the ${direction.toLowerCase()} liquidity thesis did not satisfy every mandatory requirement.`;

  const planSummary = tradePlan?.valid
    ? `Entry ${tradePlan.entry}, stop ${tradePlan.stopLoss}, target ${tradePlan.takeProfit}, reward/risk ${tradePlan.rewardToRisk}. Execution remains disabled.`
    : 'No executable trade plan was approved.';

  return Object.freeze({
    summary,
    planSummary,
    approved,
    action: quality?.action || 'REJECT',
    score,
    classification: sweep?.classification || 'INVALID_EVENT',
    confirmationPassed: confirmation?.passed === true,
    higherTimeframeBias: higherTimeframe?.bias || 'UNKNOWN',
    marketRegime: higherTimeframe?.marketRegime || 'UNKNOWN',
    evidence: Object.freeze(evidence),
    rejectionReasons: Object.freeze(rejectionReasons),
    auditMessage: approved
      ? `APPROVED_PAPER_ONLY:${symbol}:${direction}:${pool?.poolId || 'NO_POOL'}:${score}`
      : `NO_TRADE:${symbol}:${direction}:${rejectionReasons[0] || 'MANDATORY_REQUIREMENT_FAILED'}`,
    executionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
