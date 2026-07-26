function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function noStage(reason, details = {}) {
  return freeze({
    stage: 'STOP_RUN',
    passed: false,
    status: 'REJECTED',
    classification: 'INVALID',
    reason,
    details,
    score: 0,
    direction: null,
    executionAllowed: false,
  });
}

export function evaluateStopRunStage({ liquiditySweepResult, config } = {}) {
  if (!liquiditySweepResult || liquiditySweepResult.tradeDecision !== 'PAPER_CANDIDATE') {
    return noStage('NO_CONFIRMED_STOP_RUN_CANDIDATE', {
      sourceDecision: liquiditySweepResult?.tradeDecision || 'NO_RESULT',
      sourceReason: liquiditySweepResult?.reason || null,
    });
  }

  const sweep = liquiditySweepResult.liquiditySweep || {};
  const pool = liquiditySweepResult.liquidityPool || {};
  const score = Number(liquiditySweepResult.liquiditySweepScore || 0);
  const rejectionScore = Number(sweep.rejectionScore || 0);
  const acceptanceScore = Number(sweep.acceptanceScore || 0);
  const penetrationAtr = Number(sweep.penetrationAtr || 0);
  const levelQuality = Number(pool.importanceScore || 0);
  const reclaimed = sweep.reclaimed === true;
  const reasons = [];

  if (score < config.stopRun.minimumScore) reasons.push('STOP_RUN_SCORE_BELOW_MINIMUM');
  if (levelQuality < config.stopRun.minimumLevelQuality) reasons.push('STOP_LEVEL_QUALITY_BELOW_MINIMUM');
  if (rejectionScore < config.stopRun.minimumRejectionScore) reasons.push('REJECTION_SCORE_BELOW_MINIMUM');
  if (acceptanceScore > config.stopRun.maximumAcceptanceScore) reasons.push('ACCEPTANCE_SCORE_TOO_HIGH');
  if (penetrationAtr < config.stopRun.minimumPenetrationAtr) reasons.push('PENETRATION_TOO_SHALLOW');
  if (penetrationAtr > config.stopRun.maximumReversalPenetrationAtr) reasons.push('PENETRATION_ACCEPTANCE_RISK');
  if (config.stopRun.requireReclaim && !reclaimed) reasons.push('STOP_RUN_RECLAIM_MISSING');

  const sourceClass = String(liquiditySweepResult.sweepClassification || sweep.classification || '').toUpperCase();
  const classification = acceptanceScore > rejectionScore
    ? 'STOP_RUN_CONTINUATION'
    : reclaimed
      ? 'STOP_RUN_REVERSAL'
      : sourceClass.includes('BREAKOUT')
        ? 'GENUINE_BREAKOUT'
        : 'AMBIGUOUS';

  return freeze({
    stage: 'STOP_RUN',
    passed: reasons.length === 0 && classification === 'STOP_RUN_REVERSAL',
    status: reasons.length === 0 && classification === 'STOP_RUN_REVERSAL' ? 'PASSED' : 'REJECTED',
    classification,
    probable: true,
    direction: sweep.direction === 'LONG' ? 'BULLISH' : sweep.direction === 'SHORT' ? 'BEARISH' : null,
    score: round(score),
    levelQuality: round(levelQuality),
    rejectionScore: round(rejectionScore),
    acceptanceScore: round(acceptanceScore),
    penetrationAtr: round(penetrationAtr),
    reclaimed,
    stopLevel: {
      type: pool.type || null,
      level: pool.referencePrice ?? null,
      zoneLower: pool.zoneLower ?? null,
      zoneUpper: pool.zoneUpper ?? null,
      poolId: pool.poolId || null,
    },
    raid: {
      sweepId: sweep.sweepId || null,
      timestamp: sweep.detectedAt || null,
      extreme: sweep.extremePrice ?? null,
      reclaimCandles: sweep.reclaimCandles ?? null,
      wickToBodyRatio: sweep.wickToBodyRatio ?? null,
      closeLocation: sweep.closeLocation ?? null,
    },
    failedConditions: reasons,
    executionAllowed: false,
  });
}
