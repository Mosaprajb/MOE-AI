function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

export function evaluateCandidateLifecycle({ candidate, latestPrice, now = Date.now(), latestStructureDirection = null } = {}) {
  if (!candidate) throw new Error('candidate is required');
  const price = Number(latestPrice);
  const timestamp = Number(now);
  const reasons = [];

  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('candidate lifecycle timestamp is invalid');
  if (!Number.isFinite(price) || price <= 0) reasons.push('LATEST_PRICE_REQUIRED');
  if (Number(candidate.expiresAt) <= timestamp) reasons.push('CANDIDATE_EXPIRED');
  if (latestStructureDirection && latestStructureDirection !== candidate.direction) reasons.push('OPPOSITE_STRUCTURE_CONFIRMED');

  if (Number.isFinite(price) && price > 0) {
    if (candidate.direction === 'BULLISH' && price <= Number(candidate.stopPrice)) reasons.push('STOP_INVALIDATION_REACHED');
    if (candidate.direction === 'BEARISH' && price >= Number(candidate.stopPrice)) reasons.push('STOP_INVALIDATION_REACHED');
    if (candidate.direction === 'BULLISH' && price >= Number(candidate.targetPrice)) reasons.push('TARGET_ALREADY_REACHED');
    if (candidate.direction === 'BEARISH' && price <= Number(candidate.targetPrice)) reasons.push('TARGET_ALREADY_REACHED');
  }

  const state = reasons.includes('TARGET_ALREADY_REACHED')
    ? 'COMPLETED_OBSERVATION'
    : reasons.length
      ? 'INVALIDATED'
      : 'ACTIVE_OBSERVATION';

  return freeze({
    candidateId: candidate.candidateId,
    state,
    evaluatedAt: timestamp,
    latestPrice: Number.isFinite(price) ? price : null,
    invalidationReasons: reasons,
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
