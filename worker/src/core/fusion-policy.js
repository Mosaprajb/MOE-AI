import { Direction, EngineStatus } from './domain.js';

export const MarketRegime = Object.freeze({
  TRENDING: 'TRENDING',
  RANGE: 'RANGE',
  HIGH_VOLATILITY: 'HIGH_VOLATILITY',
  LOW_LIQUIDITY: 'LOW_LIQUIDITY',
  UNKNOWN: 'UNKNOWN',
});

export const SessionPhase = Object.freeze({
  PREMARKET: 'PREMARKET',
  OPENING: 'OPENING',
  MIDDAY: 'MIDDAY',
  POWER_HOUR: 'POWER_HOUR',
  AFTER_HOURS: 'AFTER_HOURS',
  UNKNOWN: 'UNKNOWN',
});

export const ConflictType = Object.freeze({
  NONE: 'NONE',
  LOW_QUALITY_OPPOSITION: 'LOW_QUALITY_OPPOSITION',
  HEDGING_DIVERGENCE: 'HEDGING_DIVERGENCE',
  FLOW_STRUCTURE_DIVERGENCE: 'FLOW_STRUCTURE_DIVERGENCE',
  TRUE_DIRECTIONAL_CONFLICT: 'TRUE_DIRECTIONAL_CONFLICT',
});

const REGIME_MULTIPLIERS = Object.freeze({
  [MarketRegime.TRENDING]: Object.freeze({
    SMART_MONEY: 1.12,
    INSTITUTIONAL_FLOW: 1.12,
    ORDER_FLOW: 1.08,
    VWAP: 1.06,
    POC: 0.94,
  }),
  [MarketRegime.RANGE]: Object.freeze({
    POC: 1.15,
    VWAP: 1.12,
    ABSORPTION: 1.1,
    LIQUIDITY_SWEEP: 1.08,
    ORDER_FLOW: 0.94,
  }),
  [MarketRegime.HIGH_VOLATILITY]: Object.freeze({
    LIQUIDITY_SWEEP: 1.12,
    STOP_RUN: 1.12,
    ABSORPTION: 1.08,
    GAMMA_GEX: 1.08,
    VWAP: 0.9,
  }),
  [MarketRegime.LOW_LIQUIDITY]: Object.freeze({
    INSTITUTIONAL_FLOW: 1.1,
    SMART_MONEY: 1.08,
    ORDER_FLOW: 0.82,
    IMBALANCE: 0.85,
    STOP_RUN: 0.88,
  }),
  [MarketRegime.UNKNOWN]: Object.freeze({}),
});

const SESSION_MULTIPLIERS = Object.freeze({
  [SessionPhase.PREMARKET]: Object.freeze({
    ORDER_FLOW: 0.8,
    IMBALANCE: 0.82,
    VWAP: 0.9,
    INSTITUTIONAL_FLOW: 1.08,
  }),
  [SessionPhase.OPENING]: Object.freeze({
    LIQUIDITY_SWEEP: 1.12,
    STOP_RUN: 1.12,
    IMBALANCE: 1.08,
    ORDER_FLOW: 1.08,
  }),
  [SessionPhase.MIDDAY]: Object.freeze({
    POC: 1.08,
    VWAP: 1.08,
    ABSORPTION: 1.06,
    ORDER_FLOW: 0.92,
  }),
  [SessionPhase.POWER_HOUR]: Object.freeze({
    ORDER_FLOW: 1.1,
    INSTITUTIONAL_FLOW: 1.1,
    SMART_MONEY: 1.06,
  }),
  [SessionPhase.AFTER_HOURS]: Object.freeze({
    ORDER_FLOW: 0.78,
    IMBALANCE: 0.8,
    STOP_RUN: 0.84,
    INSTITUTIONAL_FLOW: 1.06,
  }),
  [SessionPhase.UNKNOWN]: Object.freeze({}),
});

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value ?? fallback).trim().toUpperCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, finite(value)));
}

function qualityOf(result) {
  return clamp(
    result?.diagnostics?.dataQuality?.score
      ?? result?.diagnostics?.quality
      ?? result?.signal?.diagnostics?.dataQuality?.score
      ?? 100,
    0,
    100,
  );
}

export function normalizeFusionContext(context = {}) {
  const regime = normalizeEnum(context.regime, Object.values(MarketRegime), MarketRegime.UNKNOWN);
  const session = normalizeEnum(context.session, Object.values(SessionPhase), SessionPhase.UNKNOWN);
  return Object.freeze({
    regime,
    session,
    volatilityPercentile: clamp(context.volatilityPercentile ?? 50, 0, 100),
    liquidityScore: clamp(context.liquidityScore ?? 100, 0, 100),
  });
}

export function buildAdaptiveWeights(baseWeights, context = {}) {
  const normalized = normalizeFusionContext(context);
  const result = {};

  for (const [engine, baseWeight] of Object.entries(baseWeights || {})) {
    const regimeMultiplier = REGIME_MULTIPLIERS[normalized.regime]?.[engine] ?? 1;
    const sessionMultiplier = SESSION_MULTIPLIERS[normalized.session]?.[engine] ?? 1;
    let volatilityMultiplier = 1;
    let liquidityMultiplier = 1;

    if (normalized.volatilityPercentile >= 80) {
      volatilityMultiplier = ['LIQUIDITY_SWEEP', 'STOP_RUN', 'ABSORPTION', 'GAMMA_GEX'].includes(engine) ? 1.08 : 0.96;
    } else if (normalized.volatilityPercentile <= 20) {
      volatilityMultiplier = ['POC', 'VWAP', 'ABSORPTION'].includes(engine) ? 1.06 : 0.97;
    }

    if (normalized.liquidityScore < 45) {
      liquidityMultiplier = ['ORDER_FLOW', 'IMBALANCE', 'STOP_RUN'].includes(engine) ? 0.82 : 1;
    }

    result[engine] = Math.max(0, finite(baseWeight, 1))
      * regimeMultiplier
      * sessionMultiplier
      * volatilityMultiplier
      * liquidityMultiplier;
  }

  return Object.freeze(result);
}

function acceptedSignals(engineResults) {
  return engineResults.filter(
    (result) => result?.status === EngineStatus.ACCEPTED
      && result.signal
      && result.signal.direction !== Direction.NEUTRAL,
  );
}

export function resolveFusionConflict(engineResults, winningDirection, rawConflictScore) {
  const accepted = acceptedSignals(engineResults);
  const opposing = accepted.filter((result) => result.signal.direction !== winningDirection);
  if (!opposing.length || winningDirection === Direction.NEUTRAL) {
    return Object.freeze({
      type: opposing.length ? ConflictType.TRUE_DIRECTIONAL_CONFLICT : ConflictType.NONE,
      rawConflictScore,
      adjustedConflictScore: rawConflictScore,
      penaltyMultiplier: 1,
      reasons: Object.freeze([]),
    });
  }

  const averageOpposingQuality = opposing.reduce((sum, result) => sum + qualityOf(result), 0) / opposing.length;
  const opposingEngines = new Set(opposing.map((result) => result.engine));
  const winningEngines = new Set(
    accepted.filter((result) => result.signal.direction === winningDirection).map((result) => result.engine),
  );

  let type = ConflictType.TRUE_DIRECTIONAL_CONFLICT;
  let penaltyMultiplier = 1;
  const reasons = [];

  if (averageOpposingQuality < 45) {
    type = ConflictType.LOW_QUALITY_OPPOSITION;
    penaltyMultiplier = 0.45;
    reasons.push('OPPOSITION_DATA_QUALITY_LOW');
  } else if (
    opposingEngines.has('GAMMA_GEX')
    && (winningEngines.has('SMART_MONEY') || winningEngines.has('INSTITUTIONAL_FLOW'))
  ) {
    type = ConflictType.HEDGING_DIVERGENCE;
    penaltyMultiplier = 0.65;
    reasons.push('GAMMA_HEDGING_MAY_BE_NON_DIRECTIONAL');
  } else if (
    [...opposingEngines].some((engine) => ['ORDER_FLOW', 'IMBALANCE'].includes(engine))
    && [...winningEngines].some((engine) => ['SMART_MONEY', 'INSTITUTIONAL_FLOW', 'LIQUIDITY_SWEEP'].includes(engine))
  ) {
    type = ConflictType.FLOW_STRUCTURE_DIVERGENCE;
    penaltyMultiplier = 0.78;
    reasons.push('SHORT_TERM_FLOW_OPPOSES_HIGHER_ORDER_STRUCTURE');
  } else {
    reasons.push('HIGH_QUALITY_DIRECTIONAL_DISAGREEMENT');
  }

  return Object.freeze({
    type,
    rawConflictScore,
    adjustedConflictScore: clamp(rawConflictScore * penaltyMultiplier, 0, 100),
    penaltyMultiplier,
    opposingEngines: Object.freeze([...opposingEngines]),
    averageOpposingQuality,
    reasons: Object.freeze(reasons),
  });
}
