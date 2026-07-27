export const INSTITUTIONAL_CONSENSUS_VERSION = '1.0.0';

const DEFAULT_WEIGHTS = {
  brain: 0.24,
  market: 0.16,
  sector: 0.10,
  multiTimeframe: 0.16,
  liquidity: 0.10,
  orderFlow: 0.12,
  portfolio: 0.12,
};

function numeric(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

function normalizeScore(value, fallback = 50) {
  const parsed = numeric(value, fallback);
  return clamp(parsed);
}

function booleanScore(value, positive = 100, negative = 0, fallback = 50) {
  if (value === true) return positive;
  if (value === false) return negative;
  return fallback;
}

function portfolioScore(portfolio = {}) {
  if (portfolio.accepted === false) return 0;
  const heat = numeric(portfolio.metrics?.positionHeatPercent, null);
  const exposure = numeric(portfolio.metrics?.totalExposurePercent, null);
  const heatPenalty = heat == null ? 0 : clamp(heat * 2, 0, 45);
  const exposurePenalty = exposure == null ? 0 : clamp(Math.max(0, exposure - 40) * 0.75, 0, 35);
  const allocation = numeric(portfolio.allocation?.multiplier, 1);
  return clamp(100 - heatPenalty - exposurePenalty) * clamp(allocation, 0, 1);
}

function liquidityScore(context = {}) {
  const explicit = numeric(context.liquidityScore, null);
  if (explicit != null) return normalizeScore(explicit);
  const spread = numeric(context.spreadPercent, null);
  const relativeVolume = numeric(context.relativeVolume, null);
  let score = 65;
  if (spread != null) score -= clamp(spread * 120, 0, 45);
  if (relativeVolume != null) score += clamp((relativeVolume - 1) * 18, -20, 25);
  return clamp(score);
}

function orderFlowScore(context = {}) {
  const explicit = numeric(context.orderFlowScore, null);
  if (explicit != null) return normalizeScore(explicit);
  const absorption = normalizeScore(context.absorptionScore, 50);
  const imbalance = normalizeScore(context.imbalanceScore, 50);
  const stopRun = normalizeScore(context.stopRunScore, 50);
  return clamp(absorption * 0.4 + imbalance * 0.35 + stopRun * 0.25);
}

function multiTimeframeScore(context = {}) {
  return normalizeScore(
    context.multiTimeframeScore ?? context.timeframeAlignmentScore ?? context.alignmentScore,
    50,
  );
}

function brainScore(brain = {}, plan = {}) {
  return normalizeScore(brain.score ?? brain.confidence ?? plan.evaluation?.score, 50);
}

function classify(score, vetoes) {
  if (vetoes.length) return 'VETOED';
  if (score >= 85) return 'STRONG_CONSENSUS';
  if (score >= 72) return 'CONSENSUS';
  if (score >= 60) return 'WEAK_CONSENSUS';
  return 'NO_CONSENSUS';
}

export function evaluateInstitutionalConsensus({ signal, context = {}, brain = {}, plan = {}, portfolio = {}, accountSafety = {} } = {}, env = {}) {
  const weights = {
    brain: numeric(env.MOE_CONSENSUS_WEIGHT_BRAIN, DEFAULT_WEIGHTS.brain),
    market: numeric(env.MOE_CONSENSUS_WEIGHT_MARKET, DEFAULT_WEIGHTS.market),
    sector: numeric(env.MOE_CONSENSUS_WEIGHT_SECTOR, DEFAULT_WEIGHTS.sector),
    multiTimeframe: numeric(env.MOE_CONSENSUS_WEIGHT_MTF, DEFAULT_WEIGHTS.multiTimeframe),
    liquidity: numeric(env.MOE_CONSENSUS_WEIGHT_LIQUIDITY, DEFAULT_WEIGHTS.liquidity),
    orderFlow: numeric(env.MOE_CONSENSUS_WEIGHT_ORDER_FLOW, DEFAULT_WEIGHTS.orderFlow),
    portfolio: numeric(env.MOE_CONSENSUS_WEIGHT_PORTFOLIO, DEFAULT_WEIGHTS.portfolio),
  };
  const totalWeight = Object.values(weights).reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const components = {
    brain: brainScore(brain, plan),
    market: normalizeScore(context.marketScore, 50),
    sector: normalizeScore(context.sectorScore, 50),
    multiTimeframe: multiTimeframeScore(context),
    liquidity: liquidityScore(context),
    orderFlow: orderFlowScore(context),
    portfolio: portfolioScore(portfolio),
  };
  const weightedScore = Object.entries(components).reduce(
    (sum, [key, value]) => sum + value * Math.max(0, weights[key]),
    0,
  ) / totalWeight;

  const vetoes = [];
  const warnings = [];
  const minimumMarketScore = numeric(env.MOE_CONSENSUS_MIN_MARKET_SCORE, 35);
  const minimumLiquidityScore = numeric(env.MOE_CONSENSUS_MIN_LIQUIDITY_SCORE, 35);
  const minimumTimeframeScore = numeric(env.MOE_CONSENSUS_MIN_MTF_SCORE, 40);
  if (brain.accepted === false) vetoes.push('MOE AI Brain rejected the candidate');
  if (portfolio.accepted === false) vetoes.push('Portfolio Intelligence rejected the candidate');
  if (accountSafety.accepted === false) vetoes.push('Account safety rejected the candidate');
  if (components.market < minimumMarketScore) vetoes.push(`Market score ${components.market.toFixed(1)} is below ${minimumMarketScore}`);
  if (components.liquidity < minimumLiquidityScore) vetoes.push(`Liquidity score ${components.liquidity.toFixed(1)} is below ${minimumLiquidityScore}`);
  if (components.multiTimeframe < minimumTimeframeScore) warnings.push(`Multi-timeframe alignment ${components.multiTimeframe.toFixed(1)} is weak`);
  if (components.orderFlow < 45) warnings.push(`Order-flow confirmation ${components.orderFlow.toFixed(1)} is weak`);

  const score = Number(clamp(weightedScore).toFixed(2));
  const minimumScore = numeric(env.MOE_CONSENSUS_MIN_SCORE, 68);
  const enforce = String(env.MOE_CONSENSUS_ENFORCED_SANDBOX || '').toLowerCase() === 'true';
  const accepted = vetoes.length === 0 && score >= minimumScore;
  const classification = classify(score, vetoes);
  const direction = String(signal?.side || '').toUpperCase() || 'UNKNOWN';

  return {
    version: INSTITUTIONAL_CONSENSUS_VERSION,
    accepted,
    enforce,
    score,
    minimumScore,
    classification,
    direction,
    vetoes,
    warnings,
    components: Object.fromEntries(Object.entries(components).map(([key, value]) => [key, Number(value.toFixed(2))])),
    weights: Object.fromEntries(Object.entries(weights).map(([key, value]) => [key, Number((Math.max(0, value) / totalWeight).toFixed(4))])),
    rationale: accepted
      ? `${classification} reached for ${direction} with score ${score}.`
      : vetoes.length
        ? `Institutional consensus was vetoed: ${vetoes.join('; ')}.`
        : `Institutional consensus score ${score} is below ${minimumScore}.`,
  };
}
