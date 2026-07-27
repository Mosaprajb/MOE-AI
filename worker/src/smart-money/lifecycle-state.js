export const OBSERVATION_STATES = Object.freeze({
  SCANNING: 'SCANNING',
  CANDIDATE: 'CANDIDATE',
  WAITING_CONFIRMATION: 'WAITING_CONFIRMATION',
  REJECTED: 'REJECTED',
  READY_FOR_SANDBOX: 'READY_FOR_SANDBOX',
  SUBMITTED: 'SUBMITTED',
  BLOCKED: 'BLOCKED',
  IDLE: 'IDLE',
});

const WAITING_SKIP_REASONS = new Set([
  'NO_ACTIVE_MARKET_SESSION',
  'WAITING_FOR_COMPLETED_OBSERVATION_CANDLE',
]);

const BLOCKED_SKIP_REASONS = new Set([
  'LIVE_TRADING_SAFETY_LOCK',
  'ALPACA_MARKET_DATA_SECRETS_MISSING',
  'OBSERVATION_UNIVERSE_EMPTY',
]);

export function observationLifecycleState(item = {}) {
  const candidate = item.candidate || {};
  const candidateStatus = String(candidate.status || '').toUpperCase();
  const dataMode = String(item.dataMode || '').toUpperCase();

  if (item.submitted === true || candidateStatus === 'SUBMITTED') return OBSERVATION_STATES.SUBMITTED;
  if (item.executionAllowed === true && item.pipelinePassed === true) return OBSERVATION_STATES.READY_FOR_SANDBOX;
  if (item.pipelinePassed === true) return OBSERVATION_STATES.CANDIDATE;
  if (item.failedStage || candidateStatus.includes('REJECT')) return OBSERVATION_STATES.REJECTED;
  if (dataMode === 'INSUFFICIENT_DATA' || candidateStatus.includes('WAIT')) return OBSERVATION_STATES.WAITING_CONFIRMATION;
  return OBSERVATION_STATES.SCANNING;
}

export function observationRunState({ enabled = true, skipped = null, topOpportunities = [] } = {}) {
  if (!enabled) return OBSERVATION_STATES.IDLE;
  if (BLOCKED_SKIP_REASONS.has(skipped)) return OBSERVATION_STATES.BLOCKED;
  if (WAITING_SKIP_REASONS.has(skipped)) return OBSERVATION_STATES.WAITING_CONFIRMATION;
  if (topOpportunities.some((item) => item.lifecycleState === OBSERVATION_STATES.READY_FOR_SANDBOX)) {
    return OBSERVATION_STATES.READY_FOR_SANDBOX;
  }
  if (topOpportunities.some((item) => item.lifecycleState === OBSERVATION_STATES.CANDIDATE)) {
    return OBSERVATION_STATES.CANDIDATE;
  }
  if (topOpportunities.length) return OBSERVATION_STATES.REJECTED;
  return OBSERVATION_STATES.SCANNING;
}

export function lifecycleStateCounts(items = []) {
  const counts = Object.fromEntries(Object.values(OBSERVATION_STATES).map((state) => [state, 0]));
  for (const item of items) {
    const state = item?.lifecycleState || observationLifecycleState(item);
    if (!(state in counts)) counts[state] = 0;
    counts[state] += 1;
  }
  return Object.freeze(counts);
}
