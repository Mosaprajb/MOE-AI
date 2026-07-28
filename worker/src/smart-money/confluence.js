function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 2) {
  return Number(Number(value).toFixed(digits));
}

function latestBy(items, timestampField) {
  return [...items].sort((left, right) => Number(right[timestampField] || 0) - Number(left[timestampField] || 0))[0] || null;
}

function zoneForDirection(direction, orderBlocks, breakers, fairValueGaps) {
  const activeBlocks = orderBlocks.filter((item) => item.direction === direction
    && ['ACTIVE', 'PARTIALLY_MITIGATED'].includes(item.state));
  const activeBreakers = breakers.filter((item) => item.direction === direction && item.state === 'ACTIVE');
  const activeGaps = fairValueGaps.filter((item) => item.direction === direction
    && ['NEW', 'ACTIVE', 'PARTIALLY_MITIGATED'].includes(item.state));

  const breaker = latestBy(activeBreakers, 'retestAt');
  if (breaker) return { type: 'BREAKER_BLOCK', item: breaker, score: breaker.qualityScore };

  const block = [...activeBlocks].sort((left, right) => right.qualityScore - left.qualityScore)[0] || null;
  if (block) return { type: 'ORDER_BLOCK', item: block, score: block.qualityScore };

  const gap = [...activeGaps].sort((left, right) => right.displacementScore - left.displacementScore)[0] || null;
  if (gap) return { type: 'FAIR_VALUE_GAP', item: gap, score: gap.displacementScore };

  return null;
}

function locationPenalty(direction, dealingRange, config) {
  const position = dealingRange?.range?.position || 'UNKNOWN';
  if (direction === 'BULLISH' && ['PREMIUM', 'EXTREME_PREMIUM'].includes(position)) {
    return { amount: config.confluence.premiumLongPenalty, code: 'LONG_ENTRY_IN_PREMIUM' };
  }
  if (direction === 'BEARISH' && ['DISCOUNT', 'EXTREME_DISCOUNT'].includes(position)) {
    return { amount: config.confluence.discountShortPenalty, code: 'SHORT_ENTRY_IN_DISCOUNT' };
  }
  return null;
}

export function evaluateSmartMoneyConfluence({
  structure,
  displacement = [],
  fairValueGaps = [],
  orderBlocks = [],
  breakers = [],
  dealingRange = null,
  config,
} = {}) {
  if (!config?.confluence) throw new Error('Validated Smart Money confluence configuration is required');

  const latestStructure = structure?.latestEvent || null;
  const direction = latestStructure?.direction || null;
  const latestDisplacement = [...displacement].reverse().find((item) => !direction || item.direction === direction) || null;
  const zone = direction ? zoneForDirection(direction, orderBlocks, breakers, fairValueGaps) : null;
  const failedConditions = [];
  const penalties = [];
  const confirmations = [];

  if (!latestStructure || latestStructure.qualityScore < config.confluence.minimumStructureScore) {
    failedConditions.push('NO_QUALIFYING_STRUCTURE_EVENT');
  } else {
    confirmations.push(`STRUCTURE_${latestStructure.eventType}`);
  }

  if (!latestDisplacement || latestDisplacement.score < config.confluence.minimumDisplacementScore
    || latestDisplacement.classification === 'ABNORMAL_NEWS_DRIVEN') {
    failedConditions.push('NO_QUALIFYING_DISPLACEMENT');
  } else {
    confirmations.push(`DISPLACEMENT_${latestDisplacement.classification}`);
  }

  if (!zone || zone.score < config.confluence.minimumZoneScore) {
    failedConditions.push('NO_QUALIFYING_ENTRY_ZONE');
  } else {
    confirmations.push(`ENTRY_ZONE_${zone.type}`);
  }

  const penalty = direction ? locationPenalty(direction, dealingRange, config) : null;
  if (penalty) penalties.push(penalty);

  if (zone?.type === 'ORDER_BLOCK' && zone.item.mitigationCount > 1) {
    penalties.push({ amount: config.confluence.repeatedMitigationPenalty, code: 'REPEATED_ORDER_BLOCK_MITIGATION' });
  }

  const structureScore = latestStructure ? clamp(latestStructure.qualityScore, 0, 100) : 0;
  const displacementScore = latestDisplacement ? clamp(latestDisplacement.score, 0, 100) : 0;
  const zoneScore = zone ? clamp(zone.score, 0, 100) : 0;
  const contextScore = dealingRange?.range ? 80 : 35;
  const rawScore = structureScore * 0.3 + displacementScore * 0.3 + zoneScore * 0.3 + contextScore * 0.1;
  const penaltyTotal = penalties.reduce((sum, item) => sum + Number(item.amount || 0), 0);
  const totalScore = round(clamp(rawScore - penaltyTotal, 0, 100));
  const mandatoryPassed = failedConditions.length === 0;
  const approvedForObservation = mandatoryPassed && totalScore >= config.confluence.minimumMandatoryScore;

  return Object.freeze({
    direction,
    setupFamily: zone?.type === 'BREAKER_BLOCK'
      ? 'BREAKER_RETEST'
      : zone?.type === 'ORDER_BLOCK'
        ? 'STRUCTURE_ORDER_BLOCK_REPRICING'
        : zone?.type === 'FAIR_VALUE_GAP'
          ? 'FVG_REPRICING'
          : 'UNCLASSIFIED',
    totalScore,
    mandatoryPassed,
    approvedForObservation,
    structureScore: round(structureScore),
    displacementScore: round(displacementScore),
    entryZoneScore: round(zoneScore),
    contextScore: round(contextScore),
    entryZone: zone ? Object.freeze({ type: zone.type, item: zone.item }) : null,
    confirmations: Object.freeze(confirmations),
    failedConditions: Object.freeze(failedConditions),
    penalties: Object.freeze(penalties),
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
