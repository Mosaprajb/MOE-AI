import { createSweepEvent } from './contracts.js';

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function scoreFlag(condition, weight) {
  return condition ? weight : 0;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function breakoutEvidence(event, context = {}) {
  const acceptance = [];
  if (!event.reclaimed) acceptance.push('NO_RECLAIM');
  if (event.candlesOutside >= 2) acceptance.push('MULTIPLE_CLOSES_OUTSIDE_POOL');
  if (context.bodyPercentBeyondPool >= 0.5) acceptance.push('BODY_ACCEPTED_BEYOND_POOL');
  if (context.successfulBreakoutRetest === true) acceptance.push('SUCCESSFUL_BREAKOUT_RETEST');
  if (context.continuationVolume === true) acceptance.push('CONTINUATION_VOLUME');
  if (context.breakoutDisplacement === true) acceptance.push('BREAKOUT_DISPLACEMENT');
  if (context.higherTimeframeAligned === true) acceptance.push('HIGHER_TIMEFRAME_ALIGNMENT');
  if (context.distanceMaintainedAtr >= 0.2) acceptance.push('DISTANCE_MAINTAINED_BEYOND_POOL');
  return acceptance;
}

function rejectionEvidence(event, context = {}) {
  const rejection = [...(event.evidence || [])];
  if (context.opposingDisplacement === true) rejection.push('OPPOSING_DISPLACEMENT');
  if (context.failedContinuation === true) rejection.push('FAILED_CONTINUATION');
  if (context.retestRejected === true) rejection.push('RETEST_REJECTION');
  if (context.reversalRelativeVolume === true) rejection.push('REVERSAL_RELATIVE_VOLUME');
  if (context.movingTowardOpposingLiquidity === true) rejection.push('MOVING_TOWARD_OPPOSING_LIQUIDITY');
  return unique(rejection);
}

export function calculateSweepClassificationScores(event, context = {}) {
  if (!event?.sweepId) throw new Error('A normalized sweep event is required');
  const reclaimSpeedScore = event.reclaimed && event.reclaimCandles != null
    ? event.reclaimCandles <= 1 ? 20 : event.reclaimCandles <= 3 ? 12 : 4
    : 0;
  const rejectionScore = clamp(Math.round(
    reclaimSpeedScore
    + scoreFlag(event.reclaimed, 20)
    + scoreFlag(event.wickToBodyRatio >= 1.25, 15)
    + scoreFlag(context.opposingDisplacement === true, 15)
    + scoreFlag(context.failedContinuation === true, 10)
    + scoreFlag(context.retestRejected === true, 10)
    + scoreFlag(context.reversalRelativeVolume === true, 5)
    + scoreFlag(context.movingTowardOpposingLiquidity === true, 5)
  ), 0, 100);

  const acceptanceScore = clamp(Math.round(
    scoreFlag(event.candlesOutside >= 2, 20)
    + scoreFlag(context.bodyPercentBeyondPool >= 0.5, 15)
    + scoreFlag((context.timeOutsideBars ?? event.candlesOutside) >= 2, 10)
    + scoreFlag(context.successfulBreakoutRetest === true, 20)
    + scoreFlag(context.continuationVolume === true, 10)
    + scoreFlag(context.breakoutDisplacement === true, 10)
    + scoreFlag(context.higherTimeframeAligned === true, 10)
    + scoreFlag(context.distanceMaintainedAtr >= 0.2, 5)
  ), 0, 100);

  return {
    rejectionScore,
    acceptanceScore,
    scoreLead: rejectionScore - acceptanceScore,
    rejectionEvidence: rejectionEvidence(event, context),
    acceptanceEvidence: breakoutEvidence(event, context),
  };
}

export async function classifySweepEvent(event, { config, context = {} } = {}) {
  if (!config?.classification) throw new Error('Validated liquidity-sweep configuration is required');
  const scores = calculateSweepClassificationScores(event, context);
  const thresholds = config.classification;
  const absoluteLead = Math.abs(scores.scoreLead);
  const confirmedSweep = event.reclaimed
    && scores.rejectionScore >= thresholds.confirmedSweepRejectionMinimum
    && scores.acceptanceScore <= thresholds.confirmedSweepAcceptanceMaximum
    && scores.scoreLead >= thresholds.minimumScoreLead
    && context.confirmationPassed === true;
  const probableSweep = event.reclaimed
    && scores.rejectionScore >= thresholds.probableSweepRejectionMinimum
    && scores.scoreLead >= thresholds.minimumScoreLead;
  const confirmedBreakout = !event.reclaimed
    && scores.acceptanceScore >= thresholds.confirmedBreakoutAcceptanceMinimum
    && -scores.scoreLead >= thresholds.minimumScoreLead
    && (context.successfulBreakoutRetest === true || context.breakoutDisplacement === true);
  const probableBreakout = !event.reclaimed
    && scores.acceptanceScore >= thresholds.probableBreakoutAcceptanceMinimum
    && -scores.scoreLead >= thresholds.minimumScoreLead;

  let classification = 'UNCONFIRMED_PENETRATION';
  const rejectionReasons = [...(event.rejectionReasons || [])];
  if (absoluteLead < thresholds.ambiguityMargin || (scores.rejectionScore >= 50 && scores.acceptanceScore >= 50)) {
    classification = 'AMBIGUOUS_EVENT';
    rejectionReasons.push('AMBIGUOUS_ACCEPTANCE_REJECTION_BALANCE');
  } else if (confirmedSweep) {
    classification = 'CONFIRMED_LIQUIDITY_SWEEP';
  } else if (probableSweep) {
    classification = 'PROBABLE_LIQUIDITY_SWEEP';
    rejectionReasons.push('CONFIRMATION_INCOMPLETE');
  } else if (confirmedBreakout) {
    classification = 'CONFIRMED_BREAKOUT';
    rejectionReasons.push('REVERSAL_BLOCKED_BY_CONFIRMED_BREAKOUT');
  } else if (probableBreakout) {
    classification = 'PROBABLE_BREAKOUT';
    rejectionReasons.push('REVERSAL_BLOCKED_BY_PROBABLE_BREAKOUT');
  } else if (event.reclaimed) {
    classification = 'FAILED_SWEEP';
    rejectionReasons.push('REJECTION_SCORE_BELOW_THRESHOLD');
  }

  const confidence = clamp(Math.round(Math.max(scores.rejectionScore, scores.acceptanceScore) - Math.min(20, absoluteLead < 20 ? 10 : 0)), 0, 100);
  return createSweepEvent({
    ...event,
    acceptanceScore: scores.acceptanceScore,
    rejectionScore: scores.rejectionScore,
    classification,
    confidence,
    evidence: unique([...(event.evidence || []), ...scores.rejectionEvidence, ...scores.acceptanceEvidence]),
    rejectionReasons: unique(rejectionReasons),
  });
}

export function reversalTradeAllowed(classifiedEvent) {
  return classifiedEvent?.classification === 'CONFIRMED_LIQUIDITY_SWEEP';
}
