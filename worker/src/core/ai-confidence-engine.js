import { eventBus } from './event-bus.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, number(value)));
}

const DEFAULT_WEIGHTS = Object.freeze({
  trend: 0.2,
  momentum: 0.15,
  volatility: 0.1,
  liquidity: 0.15,
  structure: 0.15,
  timeframeAlignment: 0.15,
  riskReward: 0.1,
});

function normalizeFactor(value) {
  if (value == null) return 0;
  const parsed = number(value);
  if (parsed > 1) return clamp(parsed / 100);
  return clamp(parsed);
}

function normalizeRiskReward(value) {
  const ratio = Math.max(0, number(value));
  return clamp(ratio / 3);
}

export function scoreOpportunity(opportunity = {}, weights = DEFAULT_WEIGHTS) {
  const factors = {
    trend: normalizeFactor(opportunity.trendScore ?? opportunity.trendStrength),
    momentum: normalizeFactor(opportunity.momentumScore ?? opportunity.momentum),
    volatility: normalizeFactor(opportunity.volatilityScore ?? opportunity.volatilityQuality),
    liquidity: normalizeFactor(opportunity.liquidityScore ?? opportunity.liquidity),
    structure: normalizeFactor(opportunity.structureScore ?? opportunity.marketStructure),
    timeframeAlignment: normalizeFactor(
      opportunity.timeframeAlignmentScore ?? opportunity.timeframeAlignment,
    ),
    riskReward: normalizeRiskReward(opportunity.riskReward),
  };

  let weightedTotal = 0;
  let weightTotal = 0;

  for (const [name, rawWeight] of Object.entries(weights || DEFAULT_WEIGHTS)) {
    const weight = Math.max(0, number(rawWeight));
    if (!weight) continue;
    weightedTotal += normalizeFactor(factors[name]) * weight;
    weightTotal += weight;
  }

  const confidence = weightTotal > 0 ? clamp(weightedTotal / weightTotal) : 0;
  const confidencePercent = Math.round(confidence * 100);

  return {
    confidence,
    confidencePercent,
    grade:
      confidencePercent >= 85 ? 'A' :
      confidencePercent >= 75 ? 'B' :
      confidencePercent >= 65 ? 'C' :
      confidencePercent >= 50 ? 'D' : 'F',
    factors,
    weights: { ...weights },
  };
}

export class AIConfidenceEngine {
  constructor({ weights = DEFAULT_WEIGHTS, minimumConfidence = 0.65 } = {}) {
    this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    this.minimumConfidence = clamp(minimumConfidence);
    this.unsubscribers = [];
  }

  evaluate(opportunity = {}) {
    const result = scoreOpportunity(opportunity, this.weights);
    return {
      ...opportunity,
      confidence: result.confidence,
      confidencePercent: result.confidencePercent,
      confidenceGrade: result.grade,
      confidenceFactors: result.factors,
      acceptedByConfidence: result.confidence >= this.minimumConfidence,
    };
  }

  async evaluateAndPublish(opportunity = {}) {
    const evaluated = this.evaluate(opportunity);
    await eventBus.emit('confidence:evaluated', evaluated);
    if (evaluated.acceptedByConfidence) {
      await eventBus.emit('confidence:accepted', evaluated);
    } else {
      await eventBus.emit('confidence:rejected', evaluated);
    }
    return evaluated;
  }

  start() {
    if (this.unsubscribers.length) return this;
    this.unsubscribers.push(
      eventBus.on('opportunity:candidate', (payload) => this.evaluateAndPublish(payload)),
      eventBus.on('scanner:opportunity-found', (payload) => this.evaluateAndPublish(payload)),
    );
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}

export function initializeAIConfidenceEngine(options = {}) {
  return new AIConfidenceEngine(options).start();
}

export { DEFAULT_WEIGHTS as AI_CONFIDENCE_DEFAULT_WEIGHTS };
