import {
  Direction,
  clampScore,
  createOpportunity,
  normalizeSymbol,
  validatePriceLevels,
} from './domain.js';

export const OpportunityStatus = Object.freeze({
  CANDIDATE: 'CANDIDATE',
  REJECTED: 'REJECTED',
  EXPIRED: 'EXPIRED',
});

export const OpportunityGrade = Object.freeze({
  AAA_PLUS: 'AAA+',
  AAA: 'AAA',
  AA: 'AA',
  A: 'A',
  BBB: 'BBB',
  REJECT: 'REJECT',
});

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function requiredText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function freezeArray(value) {
  return Object.freeze([...(value || [])]);
}

function normalizedDirection(value) {
  const direction = String(value ?? '').toUpperCase();
  if (![Direction.LONG, Direction.SHORT].includes(direction)) {
    throw new Error('opportunity direction must be LONG or SHORT');
  }
  return direction;
}

function probabilityFor({ fusion, agreement, expectedRR }) {
  const fusionConfidence = clampScore(fusion?.confidence ?? 0);
  const institutional = clampScore(agreement?.institutionalAgreementScore ?? fusion?.agreementScore ?? 0);
  const structure = clampScore(agreement?.structuralIntegrityScore ?? institutional);
  const conflict = clampScore(fusion?.conflictScore ?? 100);
  const rrScore = clampScore(Math.min(100, Math.max(0, finite(expectedRR) / 3 * 100)));
  return clampScore(
    (fusionConfidence * 0.35)
    + (institutional * 0.25)
    + (structure * 0.2)
    + ((100 - conflict) * 0.12)
    + (rrScore * 0.08),
  );
}

function gradeFor({ probability, structure, expectedRR, conflict }) {
  if (probability >= 94 && structure >= 90 && expectedRR >= 2.5 && conflict <= 10) return OpportunityGrade.AAA_PLUS;
  if (probability >= 90 && structure >= 84 && expectedRR >= 2.2 && conflict <= 15) return OpportunityGrade.AAA;
  if (probability >= 84 && structure >= 76 && expectedRR >= 2 && conflict <= 22) return OpportunityGrade.AA;
  if (probability >= 76 && structure >= 68 && expectedRR >= 1.7 && conflict <= 30) return OpportunityGrade.A;
  if (probability >= 68 && structure >= 58 && expectedRR >= 1.5 && conflict <= 38) return OpportunityGrade.BBB;
  return OpportunityGrade.REJECT;
}

function calculateExpectedRR(direction, entry, stopLoss, takeProfit) {
  const risk = direction === Direction.LONG ? entry - stopLoss : stopLoss - entry;
  const reward = direction === Direction.LONG ? takeProfit - entry : entry - takeProfit;
  return risk > 0 ? reward / risk : 0;
}

function normalizeTakeProfits(direction, entry, takeProfits) {
  if (!Array.isArray(takeProfits) || takeProfits.length === 0) {
    throw new Error('takeProfits must contain at least one target');
  }
  const normalized = takeProfits.map((value) => finite(value, NaN));
  if (normalized.some((value) => !Number.isFinite(value) || value <= 0)) {
    throw new Error('takeProfits must contain positive finite prices');
  }
  const sorted = [...normalized].sort((a, b) => direction === Direction.LONG ? a - b : b - a);
  if (sorted.some((value) => direction === Direction.LONG ? value <= entry : value >= entry)) {
    throw new Error('takeProfits are invalid for opportunity direction');
  }
  return Object.freeze(sorted);
}

export function buildTradingOpportunity(input = {}) {
  const fusion = input.fusion;
  const agreement = input.agreement;
  if (!fusion || typeof fusion !== 'object') throw new Error('fusion result is required');
  if (!agreement || typeof agreement !== 'object') throw new Error('institutional agreement is required');

  const symbol = normalizeSymbol(input.symbol);
  const timeframe = requiredText(input.timeframe, 'timeframe').toLowerCase();
  const direction = normalizedDirection(fusion.direction ?? agreement.winningDirection);

  if (fusion.observationOnly !== true || agreement.observationOnly !== true) {
    throw new Error('opportunity builder accepts observation-only inputs');
  }
  if (fusion.executionAllowed === true || agreement.executionAllowed === true) {
    throw new Error('execution-enabled inputs are not allowed');
  }
  if (agreement.winningDirection !== direction) {
    throw new Error('fusion and institutional agreement directions must match');
  }

  const entry = finite(input.entry, NaN);
  const stopLoss = finite(input.stopLoss, NaN);
  const takeProfits = normalizeTakeProfits(direction, entry, input.takeProfits);
  const primaryTakeProfit = takeProfits[0];
  validatePriceLevels({ direction, entry, stopLoss, takeProfit: primaryTakeProfit });

  const expectedRR = calculateExpectedRR(direction, entry, stopLoss, primaryTakeProfit);
  const probability = probabilityFor({ fusion, agreement, expectedRR });
  const structure = clampScore(agreement.structuralIntegrityScore ?? 0);
  const conflict = clampScore(fusion.conflictScore ?? 100);
  const grade = gradeFor({ probability, structure, expectedRR, conflict });

  const reasons = [
    ...(fusion.reasons || []),
    ...(agreement.reasons || []),
  ];
  if (expectedRR < finite(input.minimumRR, 1.5)) reasons.push('EXPECTED_RR_BELOW_MINIMUM');
  if (grade === OpportunityGrade.REJECT) reasons.push('OPPORTUNITY_GRADE_REJECTED');
  if ((agreement.leadingSupportCount ?? 0) < 1) reasons.push('LEADING_ENGINE_SUPPORT_REQUIRED');
  if ((agreement.confirmingSupportCount ?? 0) < 1) reasons.push('CONFIRMATION_ENGINE_SUPPORT_REQUIRED');

  const blocked = grade === OpportunityGrade.REJECT
    || expectedRR < finite(input.minimumRR, 1.5)
    || (agreement.leadingSupportCount ?? 0) < 1
    || (agreement.confirmingSupportCount ?? 0) < 1;

  const createdAt = input.createdAt ?? new Date().toISOString();
  const expiresAt = new Date(new Date(createdAt).getTime() + Math.max(1, finite(input.ttlMinutes, 15)) * 60_000).toISOString();
  const id = requiredText(
    input.id ?? `${symbol}-${timeframe}-${direction}-${new Date(createdAt).getTime()}`,
    'id',
  );

  const baseOpportunity = createOpportunity({
    id,
    symbol,
    direction,
    timeframe,
    entry,
    stopLoss,
    takeProfit: primaryTakeProfit,
    score: probability,
    confidence: fusion.confidence,
    engineResults: input.engineResults ?? [],
    reasons,
    metadata: {
      grade,
      expectedRR,
      takeProfits,
      institutionalAgreementScore: agreement.institutionalAgreementScore,
      structuralIntegrityScore: agreement.structuralIntegrityScore,
      fusionAgreementScore: fusion.agreementScore,
      conflictScore: fusion.conflictScore,
    },
    createdAt,
  });

  return Object.freeze({
    ...baseOpportunity,
    status: blocked ? OpportunityStatus.REJECTED : OpportunityStatus.CANDIDATE,
    grade,
    probability,
    expectedRR,
    takeProfits,
    supportingEngines: freezeArray(agreement.supportingEngines),
    opposingEngines: freezeArray(agreement.opposingEngines),
    expiresAt,
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    riskReviewRequired: true,
  });
}

export function expireTradingOpportunity(opportunity, now = Date.now()) {
  if (!opportunity || typeof opportunity !== 'object') throw new Error('opportunity is required');
  const expired = new Date(opportunity.expiresAt).getTime() <= new Date(now).getTime();
  return expired
    ? Object.freeze({ ...opportunity, status: OpportunityStatus.EXPIRED, executionAllowed: false })
    : opportunity;
}

export function rankTradingOpportunities(opportunities) {
  if (!Array.isArray(opportunities)) throw new Error('opportunities must be an array');
  return Object.freeze([...opportunities].sort((left, right) => {
    if (left.status !== right.status) {
      if (left.status === OpportunityStatus.CANDIDATE) return -1;
      if (right.status === OpportunityStatus.CANDIDATE) return 1;
    }
    return finite(right.probability) - finite(left.probability)
      || finite(right.metadata?.structuralIntegrityScore) - finite(left.metadata?.structuralIntegrityScore)
      || finite(right.expectedRR) - finite(left.expectedRR);
  }));
}
