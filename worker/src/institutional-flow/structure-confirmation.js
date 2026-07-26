function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function blocked(reason) {
  return freeze({ stage: 'STRUCTURE_CONFIRMATION', passed: false, status: 'BLOCKED', reason, score: 0, failedConditions: [reason], executionAllowed: false });
}

export function evaluateStructureConfirmationStage({ imbalance, smartMoneyResult, config } = {}) {
  if (!imbalance?.passed) return blocked('BLOCKED_BY_IMBALANCE_STAGE');
  const direction = imbalance.direction;
  const structure = smartMoneyResult?.details?.structure || {};
  const events = Array.isArray(structure.events) ? structure.events : [];
  const compatible = events
    .filter((event) => event.direction === direction)
    .filter((event) => config.structure.acceptedEventTypes.includes(event.eventType))
    .sort((left, right) => Number(right.confirmedAt || 0) - Number(left.confirmedAt || 0));
  const event = compatible[0] || null;
  const failedConditions = [];
  if (!event) failedConditions.push('NO_DIRECTIONAL_STRUCTURE_CONFIRMATION');
  if (event && Number(event.qualityScore || 0) < config.structure.minimumQualityScore) failedConditions.push('STRUCTURE_QUALITY_BELOW_MINIMUM');
  if (config.structure.requirePostEventConfirmation && event && Number(event.confirmedAt || 0) < Number(imbalance.zone?.createdAt || 0)) {
    failedConditions.push('STRUCTURE_PRECEDES_REQUIRED_SEQUENCE');
  }

  return freeze({
    stage: 'STRUCTURE_CONFIRMATION',
    passed: failedConditions.length === 0,
    status: failedConditions.length === 0 ? 'PASSED' : 'REJECTED',
    direction,
    score: Number(event?.qualityScore || 0),
    event: event ? {
      eventId: event.eventId,
      eventType: event.eventType,
      direction: event.direction,
      scope: event.scope,
      level: event.level,
      close: event.close,
      confirmedAt: event.confirmedAt,
      qualityScore: event.qualityScore,
      evidence: event.evidence || [],
    } : null,
    currentBias: structure.currentBias || 'NEUTRAL',
    failedConditions,
    executionAllowed: false,
  });
}
