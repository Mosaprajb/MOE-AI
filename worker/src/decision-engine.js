export const MOE_DECISION_ENGINE_VERSION = '1.0.0';

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, finite(value, min)));
}

function boolScore(value, positive = 100, negative = 35, unknown = 60) {
  if (value === true) return positive;
  if (value === false) return negative;
  return unknown;
}

function normalizeRegime(value) {
  return String(value || 'UNKNOWN').trim().toUpperCase();
}

function regimeScore(regime) {
  const normalized = normalizeRegime(regime);
  if (['TREND', 'TRENDING', 'BULL_TREND', 'BEAR_TREND'].includes(normalized)) return 90;
  if (['BREAKOUT', 'MOMENTUM'].includes(normalized)) return 85;
  if (['RANGE', 'CHOP', 'CHOPPY'].includes(normalized)) return 48;
  if (['NEWS', 'EVENT', 'HALTED'].includes(normalized)) return 25;
  return 60;
}

function relativeVolumeScore(value) {
  const rv = finite(value);
  if (rv == null) return 60;
  if (rv >= 2) return 100;
  if (rv >= 1.5) return 90;
  if (rv >= 1.1) return 78;
  if (rv >= 0.8) return 60;
  return 35;
}

function spreadScore(value) {
  const spread = finite(value);
  if (spread == null) return 65;
  if (spread <= 0.05) return 100;
  if (spread <= 0.1) return 90;
  if (spread <= 0.2) return 75;
  if (spread <= 0.4) return 50;
  return 20;
}

function riskRewardScore(value) {
  const rr = finite(value, 0);
  if (rr >= 3) return 100;
  if (rr >= 2) return 90;
  if (rr >= 1.5) return 75;
  if (rr >= 1.2) return 60;
  return 30;
}

function grade(score) {
  if (score >= 92) return 'ELITE';
  if (score >= 84) return 'A';
  if (score >= 74) return 'B';
  if (score >= 64) return 'C';
  return 'REJECT';
}

function status(score, accepted) {
  if (!accepted) return 'NO_TRADE';
  if (score >= 92) return 'ELITE_OPPORTUNITY';
  if (score >= 84) return 'STRONG_OPPORTUNITY';
  return 'QUALIFIED_OPPORTUNITY';
}

function reason(label, score, detail) {
  return { label, score: Math.round(score), detail };
}

export function evaluateDecision({ signal = {}, context = {}, plan = {}, brain = {}, portfolio = {}, accountSafety = {} } = {}, env = {}) {
  const evaluation = plan.evaluation || {};
  const marketRegime = normalizeRegime(context.marketRegime || brain.marketRegime);
  const components = {
    trend: clamp(context.trendScore ?? context.higherTimeframeScore ?? brain.trendScore ?? 60),
    momentum: clamp(context.momentumScore ?? context.signalScore ?? evaluation.score ?? brain.score ?? 60),
    volume: relativeVolumeScore(context.relativeVolume),
    volatility: clamp(context.volatilityScore ?? (finite(context.atr) != null ? 72 : 60)),
    liquidity: spreadScore(context.spreadPercent),
    marketState: regimeScore(marketRegime),
    timing: clamp(context.timingScore ?? boolScore(context.sessionAllowed, 90, 25, 65)),
    riskReward: riskRewardScore(evaluation.riskReward),
    portfolio: boolScore(portfolio.accepted, 92, 15, 70),
    accountSafety: boolScore(accountSafety.accepted, 95, 10, 75),
    brain: boolScore(brain.accepted, clamp(brain.score ?? evaluation.score ?? 85), 20, 70),
  };

  const weights = {
    trend: 0.14,
    momentum: 0.13,
    volume: 0.10,
    volatility: 0.07,
    liquidity: 0.10,
    marketState: 0.10,
    timing: 0.07,
    riskReward: 0.11,
    portfolio: 0.08,
    accountSafety: 0.06,
    brain: 0.04,
  };

  const confidence = Number(Object.entries(weights)
    .reduce((sum, [key, weight]) => sum + components[key] * weight, 0)
    .toFixed(2));

  const minimumConfidence = clamp(env.MOE_DECISION_MIN_CONFIDENCE || 72, 1, 100);
  const hardBlocks = [];
  if (brain.accepted === false) hardBlocks.push(...(brain.rejectionReasons || ['MOE AI Brain rejected the candidate']));
  if (portfolio.accepted === false) hardBlocks.push(...(portfolio.reasons || ['Portfolio risk rejected the candidate']));
  if (accountSafety.accepted === false) hardBlocks.push(...(accountSafety.reasons || ['Account safety rejected the candidate']));
  if (evaluation.accepted === false) hardBlocks.push(...(evaluation.reasons || ['Trade engine rejected the candidate']));
  if (confidence < minimumConfidence) hardBlocks.push(`Decision confidence ${confidence} is below minimum ${minimumConfidence}`);

  const uniqueBlocks = [...new Set(hardBlocks.map(String))];
  const accepted = uniqueBlocks.length === 0;
  const explanations = [
    reason('Trend', components.trend, components.trend >= 75 ? 'Higher-timeframe direction supports the setup.' : 'Trend alignment is incomplete or weak.'),
    reason('Momentum', components.momentum, components.momentum >= 75 ? 'Momentum supports continuation.' : 'Momentum does not provide strong confirmation.'),
    reason('Volume', components.volume, components.volume >= 75 ? 'Relative volume confirms participation.' : 'Volume confirmation is limited.'),
    reason('Liquidity', components.liquidity, components.liquidity >= 75 ? 'Spread and liquidity are suitable.' : 'Execution quality may be reduced by spread or liquidity.'),
    reason('Market state', components.marketState, `Detected market regime: ${marketRegime}.`),
    reason('Risk/reward', components.riskReward, `Trade engine risk/reward: ${finite(evaluation.riskReward, 0)}.`),
    reason('Portfolio', components.portfolio, portfolio.accepted === false ? 'Portfolio constraints rejected this exposure.' : 'Portfolio exposure is within configured limits.'),
    reason('Account safety', components.accountSafety, accountSafety.accepted === false ? 'Broker account safety checks failed.' : 'Broker account safety checks passed or were unavailable.'),
  ];

  return {
    version: MOE_DECISION_ENGINE_VERSION,
    accepted,
    enforce: env.MOE_DECISION_ENGINE_ENFORCE === 'true',
    confidence,
    minimumConfidence,
    grade: grade(confidence),
    status: status(confidence, accepted),
    marketRegime,
    components,
    weights,
    hardBlocks: uniqueBlocks,
    explanations,
    summary: accepted
      ? `${signal.symbol || 'Candidate'} passed the explainable decision engine with ${confidence}% confidence.`
      : `${signal.symbol || 'Candidate'} was rejected by the explainable decision engine with ${confidence}% confidence.`,
    generatedAt: new Date().toISOString(),
  };
}
