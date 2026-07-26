function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function blocked(reason) {
  return freeze({ stage: 'IMBALANCE', passed: false, status: 'BLOCKED', category: 'INSUFFICIENT_DATA', type: null, reason, score: 0, failedConditions: [reason], executionAllowed: false });
}

export function evaluateImbalanceStage({ absorption, smartMoneyResult, orderFlow = null, config } = {}) {
  if (!absorption?.passed) return blocked('BLOCKED_BY_ABSORPTION_STAGE');
  const direction = absorption.direction;
  const activeGaps = smartMoneyResult?.details?.fairValueGaps?.active || [];
  const compatible = activeGaps
    .filter((gap) => gap.direction === direction)
    .filter((gap) => Number(gap.fillPercent || 0) <= config.imbalance.maximumFillPercent)
    .filter((gap) => Number(gap.mitigationCount || 0) <= config.imbalance.maximumMitigations)
    .sort((left, right) => Number(right.displacementScore || 0) - Number(left.displacementScore || 0));
  const gap = compatible[0] || null;
  const failedConditions = [];
  let category = 'PRICE_IMBALANCE';
  let type = gap ? `${direction}_FAIR_VALUE_GAP` : null;
  let orderFlowMetrics = null;
  let score = gap ? Math.min(100, Math.round(
    Number(gap.displacementScore || 0) * 0.55
    + Math.max(0, 1 - Number(gap.fillPercent || 0)) * 25
    + Math.max(0, 2 - Number(gap.mitigationCount || 0)) * 7.5
    + Number(gap.sizeAtr || 0) * 5
  )) : 0;

  if (orderFlow && Number.isFinite(Number(orderFlow.bidVolume)) && Number.isFinite(Number(orderFlow.askVolume))) {
    const bidVolume = Number(orderFlow.bidVolume || 0);
    const askVolume = Number(orderFlow.askVolume || 0);
    const dominant = direction === 'BULLISH' ? askVolume : bidVolume;
    const opposing = direction === 'BULLISH' ? bidVolume : askVolume;
    const ratio = dominant / Math.max(opposing, 1);
    const stackedLevels = Number(orderFlow.stackedLevels || 0);
    orderFlowMetrics = { bidVolume, askVolume, imbalanceRatio: round(ratio), stackedLevels };
    if (ratio >= 1.5 && stackedLevels >= 2) {
      category = gap ? 'PRICE_AND_ORDER_FLOW' : 'ORDER_FLOW_IMBALANCE';
      type = gap ? `${type}_STACKED` : `${direction}_STACKED_EXECUTION_IMBALANCE`;
      score = Math.min(100, score + Math.min(20, (ratio - 1) * 10 + stackedLevels * 2));
    }
  }

  if (config.imbalance.requirePriceImbalance && !gap) failedConditions.push('NO_ACTIVE_PRICE_IMBALANCE');
  if (gap && Number(gap.displacementScore || 0) < config.imbalance.minimumDisplacementScore) failedConditions.push('IMBALANCE_DISPLACEMENT_TOO_WEAK');
  if (score < config.imbalance.minimumScore) failedConditions.push('IMBALANCE_SCORE_BELOW_MINIMUM');

  return freeze({
    stage: 'IMBALANCE',
    passed: failedConditions.length === 0,
    status: failedConditions.length === 0 ? 'PASSED' : 'REJECTED',
    category,
    type,
    direction,
    score,
    zone: gap ? {
      id: gap.gapId || gap.fvgId || null,
      lower: gap.lower,
      upper: gap.upper,
      midpoint: gap.midpoint,
      fillPercent: gap.fillPercent,
      mitigationCount: gap.mitigationCount,
      state: gap.state,
      invalidationLevel: gap.invalidationLevel,
    } : null,
    formation: gap ? {
      displacementScore: gap.displacementScore,
      displacementId: gap.displacementId,
      sizeAtr: gap.sizeAtr,
      structuralOriginId: gap.structuralOriginId,
    } : null,
    orderFlow: orderFlowMetrics,
    failedConditions,
    executionAllowed: false,
  });
}
