function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function weighted(rawScore, weight) {
  return Number((clamp(finite(rawScore), 0, 100) / 100 * weight).toFixed(2));
}

function sweepQuality(sweep = {}) {
  let score = finite(sweep.rejectionScore);
  if (sweep.classification !== 'CONFIRMED_LIQUIDITY_SWEEP') score = Math.min(score, 45);
  if (!sweep.reclaimed) score = Math.min(score, 25);
  if (finite(sweep.penetrationAtr) > 0.55) score -= 15;
  if (finite(sweep.candlesOutside) > 3) score -= 15;
  return clamp(score, 0, 100);
}

function riskQuality(tradePlan = {}, config = {}) {
  if (!tradePlan.valid) return 0;
  const minimumRewardToRisk = finite(config.risk?.minimumRewardToRisk, 2);
  const maximumStopAtr = finite(config.risk?.maximumStopAtr, 1.5);
  const rr = finite(tradePlan.rewardToRisk);
  const stopAtr = finite(tradePlan.stopAtr, maximumStopAtr * 2);
  let score = 55;
  score += clamp((rr - minimumRewardToRisk) * 18, 0, 30);
  score += clamp((maximumStopAtr - stopAtr) / Math.max(maximumStopAtr, 0.01) * 15, 0, 15);
  return clamp(Math.round(score), 0, 100);
}

function executionQuality(snapshot = {}, tradePlan = {}) {
  let score = finite(tradePlan.executionQuality, 50);
  score = score * 0.7 + finite(snapshot.quality?.score, 50) * 0.3;
  return clamp(Math.round(score), 0, 100);
}

export function scoreLiquiditySweepOpportunity({
  pool,
  sweep,
  confirmation,
  higherTimeframe,
  tradePlan,
  snapshot,
  config,
  eventRisk = {},
} = {}) {
  if (!config?.scoring?.weights) throw new Error('Validated liquidity-sweep configuration is required');
  const weights = config.scoring.weights;
  const rejectionReasons = [];
  const evidence = [];

  if (!pool?.poolId) rejectionReasons.push('MISSING_LIQUIDITY_POOL');
  if (!sweep?.sweepId) rejectionReasons.push('MISSING_SWEEP_EVENT');
  if (sweep?.classification !== 'CONFIRMED_LIQUIDITY_SWEEP') rejectionReasons.push('SWEEP_NOT_CONFIRMED');
  if (!confirmation?.passed) rejectionReasons.push('POST_SWEEP_CONFIRMATION_FAILED');
  if (!tradePlan?.valid) rejectionReasons.push('TRADE_PLAN_INVALID');
  if (snapshot?.quality?.accepted === false) rejectionReasons.push('MARKET_DATA_QUALITY_REJECTED');
  if (eventRisk.earnings === true && config.eventRisk?.blockEarnings) rejectionReasons.push('EARNINGS_RISK_BLOCK');
  if (eventRisk.scheduledMacro === true && config.eventRisk?.blockScheduledMacroEvents) rejectionReasons.push('MACRO_EVENT_RISK_BLOCK');
  if (eventRisk.halted === true && config.eventRisk?.blockHaltedSymbols) rejectionReasons.push('HALTED_SYMBOL_BLOCK');
  if (eventRisk.newsStateDelayed === true && config.eventRisk?.blockDelayedNewsState) rejectionReasons.push('DELAYED_NEWS_STATE_BLOCK');

  const rawComponents = {
    liquidity: clamp(finite(pool?.importanceScore), 0, 100),
    sweep: sweepQuality(sweep),
    confirmation: clamp(finite(confirmation?.score), 0, 100),
    context: clamp(finite(higherTimeframe?.score, 50), 0, 100),
    risk: riskQuality(tradePlan, config),
    execution: executionQuality(snapshot, tradePlan),
  };

  if (rawComponents.liquidity >= 75) evidence.push('HIGH_IMPORTANCE_LIQUIDITY_POOL');
  if (rawComponents.sweep >= 70) evidence.push('HIGH_QUALITY_SWEEP_REJECTION');
  if (rawComponents.confirmation >= 70) evidence.push('STRONG_POST_SWEEP_CONFIRMATION');
  if (higherTimeframe?.aligned) evidence.push('HIGHER_TIMEFRAME_ALIGNMENT');
  if (higherTimeframe?.countertrend) rejectionReasons.push('COUNTERTREND_SETUP');
  if (finite(tradePlan?.rewardToRisk) >= 2) evidence.push('ACCEPTABLE_REWARD_TO_RISK');
  if (rawComponents.execution >= 70) evidence.push('EXECUTION_CONDITIONS_ACCEPTABLE');

  const components = Object.freeze({
    liquidity: weighted(rawComponents.liquidity, weights.liquidity),
    sweep: weighted(rawComponents.sweep, weights.sweep),
    confirmation: weighted(rawComponents.confirmation, weights.confirmation),
    context: weighted(rawComponents.context, weights.context),
    risk: weighted(rawComponents.risk, weights.risk),
    execution: weighted(rawComponents.execution, weights.execution),
  });

  let total = Object.values(components).reduce((sum, value) => sum + value, 0);
  const penalties = [];
  if (higherTimeframe?.countertrend) {
    penalties.push({ code: 'COUNTERTREND', points: 10 });
    total -= 10;
  }
  if (snapshot?.session === 'PREMARKET') {
    penalties.push({ code: 'PREMARKET_RISK', points: config.sessions?.openingScorePenalty || 8 });
    total -= config.sessions?.openingScorePenalty || 8;
  }
  if (snapshot?.session === 'AFTER_HOURS' || snapshot?.session === 'OVERNIGHT') {
    penalties.push({ code: 'EXTENDED_HOURS_RISK', points: config.sessions?.middayScorePenalty || 5 });
    total -= config.sessions?.middayScorePenalty || 5;
  }
  total = clamp(Math.round(total), 0, 100);

  const mandatoryPassed = rejectionReasons.every((reason) => reason === 'COUNTERTREND_SETUP');
  let action = 'REJECT';
  if (mandatoryPassed && total >= config.scoring.minimumAutomaticScore) action = total >= 90 ? 'EXCEPTIONAL_PAPER_CANDIDATE' : 'HIGH_QUALITY_PAPER_CANDIDATE';
  else if (mandatoryPassed && total >= config.scoring.minimumValidScore) action = 'VALID_PAPER_CANDIDATE';
  else if (mandatoryPassed && total >= config.scoring.watchlistScore) action = 'WATCHLIST_ONLY';

  if (higherTimeframe?.countertrend && total < config.scoring.countertrendMinimumScore) {
    action = total >= config.scoring.watchlistScore ? 'WATCHLIST_ONLY' : 'REJECT';
  }

  const approved = ['EXCEPTIONAL_PAPER_CANDIDATE', 'HIGH_QUALITY_PAPER_CANDIDATE', 'VALID_PAPER_CANDIDATE'].includes(action);
  return Object.freeze({
    approved,
    action,
    total,
    rawComponents: Object.freeze(rawComponents),
    components,
    penalties: Object.freeze(penalties.map(Object.freeze)),
    evidence: Object.freeze(unique(evidence)),
    rejectionReasons: Object.freeze(unique(rejectionReasons)),
    executionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
