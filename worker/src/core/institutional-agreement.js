import { Direction, EngineStatus, clampScore } from './domain.js';

export const EngineRole = Object.freeze({
  LEADING: 'LEADING',
  CONFIRMING: 'CONFIRMING',
  CONTEXT: 'CONTEXT',
});

export const DEFAULT_ENGINE_ROLES = Object.freeze({
  SMART_MONEY: EngineRole.LEADING,
  INSTITUTIONAL_FLOW: EngineRole.LEADING,
  LIQUIDITY_SWEEP: EngineRole.LEADING,
  ORDER_FLOW: EngineRole.CONFIRMING,
  VWAP: EngineRole.CONFIRMING,
  POC: EngineRole.CONFIRMING,
  ABSORPTION: EngineRole.CONFIRMING,
  GAMMA_GEX: EngineRole.CONTEXT,
  IMBALANCE: EngineRole.CONTEXT,
  STOP_RUN: EngineRole.CONTEXT,
});

const ROLE_WEIGHTS = Object.freeze({
  [EngineRole.LEADING]: 1.25,
  [EngineRole.CONFIRMING]: 1,
  [EngineRole.CONTEXT]: 0.72,
});

const NATURAL_PAIRS = new Set([
  'INSTITUTIONAL_FLOW|SMART_MONEY',
  'LIQUIDITY_SWEEP|SMART_MONEY',
  'INSTITUTIONAL_FLOW|ORDER_FLOW',
  'POC|VWAP',
  'ABSORPTION|LIQUIDITY_SWEEP',
  'IMBALANCE|ORDER_FLOW',
  'STOP_RUN|LIQUIDITY_SWEEP',
]);

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function qualityOf(result) {
  const value = result?.diagnostics?.dataQuality?.score
    ?? result?.diagnostics?.quality
    ?? result?.signal?.diagnostics?.dataQuality?.score
    ?? 100;
  return clampScore(finite(value, 100));
}

function confidenceOf(result) {
  return clampScore(result?.signal?.confidence?.value ?? result?.signal?.score ?? 0);
}

function pairKey(a, b) {
  return [a, b].sort().join('|');
}

function acceptedDirectional(engineResults) {
  return engineResults.filter((result) => (
    result?.status === EngineStatus.ACCEPTED
    && result.signal
    && [Direction.LONG, Direction.SHORT].includes(result.signal.direction)
  ));
}

function roleFor(engine, roles) {
  return roles[engine] ?? EngineRole.CONTEXT;
}

function supportStrength(result, roles, weights) {
  const role = roleFor(result.engine, roles);
  const roleWeight = ROLE_WEIGHTS[role] ?? ROLE_WEIGHTS[EngineRole.CONTEXT];
  const configuredWeight = Math.max(0, finite(weights?.[result.engine], 1));
  return roleWeight
    * configuredWeight
    * (confidenceOf(result) / 100)
    * (qualityOf(result) / 100);
}

export function buildInstitutionalAgreement(engineResults, options = {}) {
  if (!Array.isArray(engineResults)) throw new Error('engineResults must be an array');

  const roles = Object.freeze({ ...DEFAULT_ENGINE_ROLES, ...(options.roles || {}) });
  const weights = Object.freeze({ ...(options.weights || {}) });
  const accepted = acceptedDirectional(engineResults);

  let longSupport = 0;
  let shortSupport = 0;
  const nodes = accepted.map((result) => {
    const role = roleFor(result.engine, roles);
    const strength = supportStrength(result, roles, weights);
    if (result.signal.direction === Direction.LONG) longSupport += strength;
    if (result.signal.direction === Direction.SHORT) shortSupport += strength;
    return Object.freeze({
      engine: result.engine,
      role,
      direction: result.signal.direction,
      strength,
      confidence: confidenceOf(result),
      quality: qualityOf(result),
    });
  });

  const winningDirection = longSupport === shortSupport
    ? Direction.NEUTRAL
    : longSupport > shortSupport ? Direction.LONG : Direction.SHORT;

  const edges = [];
  let alignedPairStrength = 0;
  let conflictingPairStrength = 0;
  let naturalPairStrength = 0;

  for (let index = 0; index < nodes.length; index += 1) {
    for (let other = index + 1; other < nodes.length; other += 1) {
      const left = nodes[index];
      const right = nodes[other];
      const aligned = left.direction === right.direction;
      const pairStrength = (left.strength + right.strength) / 2;
      const naturalPair = NATURAL_PAIRS.has(pairKey(left.engine, right.engine));
      if (aligned) alignedPairStrength += pairStrength;
      else conflictingPairStrength += pairStrength;
      if (aligned && naturalPair) naturalPairStrength += pairStrength;

      edges.push(Object.freeze({
        from: left.engine,
        to: right.engine,
        relationship: aligned ? 'ALIGNED' : 'CONFLICTING',
        naturalPair,
        strength: pairStrength,
      }));
    }
  }

  const winnerNodes = nodes.filter((node) => node.direction === winningDirection);
  const leaderNodes = winnerNodes.filter((node) => node.role === EngineRole.LEADING);
  const confirmationNodes = winnerNodes.filter((node) => node.role === EngineRole.CONFIRMING);
  const contextNodes = winnerNodes.filter((node) => node.role === EngineRole.CONTEXT);

  const totalDirectionalSupport = longSupport + shortSupport;
  const institutionalAgreementScore = totalDirectionalSupport > 0
    ? clampScore((Math.max(longSupport, shortSupport) / totalDirectionalSupport) * 100)
    : 0;
  const confirmationScore = winnerNodes.length > 0
    ? clampScore((confirmationNodes.length / winnerNodes.length) * 100)
    : 0;
  const contextScore = winnerNodes.length > 0
    ? clampScore((contextNodes.length / winnerNodes.length) * 100)
    : 0;
  const pairTotal = alignedPairStrength + conflictingPairStrength;
  const pairAlignmentScore = pairTotal > 0
    ? clampScore((alignedPairStrength / pairTotal) * 100)
    : 0;
  const naturalPairScore = alignedPairStrength > 0
    ? clampScore((naturalPairStrength / alignedPairStrength) * 100)
    : 0;
  const leadershipCoverage = clampScore(Math.min(1, leaderNodes.length / 2) * 100);
  const structuralIntegrityScore = clampScore(
    (institutionalAgreementScore * 0.4)
    + (pairAlignmentScore * 0.25)
    + (leadershipCoverage * 0.2)
    + (naturalPairScore * 0.15),
  );

  const reasons = [];
  if (winningDirection === Direction.NEUTRAL) reasons.push('NO_INSTITUTIONAL_DIRECTION');
  if (leaderNodes.length === 0) reasons.push('NO_LEADING_ENGINE_SUPPORT');
  if (confirmationNodes.length === 0) reasons.push('NO_CONFIRMATION_ENGINE_SUPPORT');
  if (conflictingPairStrength > alignedPairStrength) reasons.push('STRUCTURAL_CONFLICT_DOMINANT');
  if (
    winningDirection !== Direction.NEUTRAL
    && leaderNodes.length > 0
    && confirmationNodes.length > 0
    && structuralIntegrityScore >= 70
  ) reasons.push('INSTITUTIONAL_STRUCTURE_CONFIRMED');

  return Object.freeze({
    winningDirection,
    institutionalAgreementScore,
    confirmationScore,
    contextScore,
    structuralIntegrityScore,
    leadershipCoverage,
    pairAlignmentScore,
    naturalPairScore,
    longSupport,
    shortSupport,
    leadingSupportCount: leaderNodes.length,
    confirmingSupportCount: confirmationNodes.length,
    contextSupportCount: contextNodes.length,
    supportingEngines: Object.freeze(winnerNodes.map((node) => node.engine)),
    opposingEngines: Object.freeze(nodes.filter((node) => node.direction !== winningDirection).map((node) => node.engine)),
    reasons: Object.freeze(reasons),
    nodes: Object.freeze(nodes),
    edges: Object.freeze(edges),
    observationOnly: true,
    executionAllowed: false,
  });
}
