import {
  Direction,
  EngineStatus,
  createEngineResult,
  createEngineSignal,
  createOpportunity,
} from './domain.js';

export const LIQUIDITY_SWEEP_ENGINE_ID = 'LIQUIDITY_SWEEP';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function stringList(...values) {
  return values
    .flat(Infinity)
    .map((value) => text(value))
    .filter(Boolean);
}

function explanationReasons(explanation = {}) {
  return stringList(
    explanation.reasons,
    explanation.acceptanceReasons,
    explanation.supportingReasons,
    explanation.evidence,
  );
}

function ensurePaperOnly(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Liquidity sweep result must be an object');
  }
  if (result.executionAllowed === true || result.automaticSubmissionAllowed === true) {
    throw new Error('Liquidity sweep adapter rejects execution-enabled results');
  }
  const mode = text(result.mode, 'PAPER_TRADING').toUpperCase();
  if (mode !== 'PAPER_TRADING') {
    throw new Error('Liquidity sweep adapter accepts PAPER_TRADING results only');
  }
}

function completedAt(result) {
  return result.evaluatedAt ?? result.createdAt ?? Date.now();
}

function noTradeStatus(result) {
  return text(result.reason).toUpperCase() === 'MARKET_DATA_REJECTED'
    ? EngineStatus.REJECTED
    : EngineStatus.NEUTRAL;
}

function adaptNoTrade(result, latencyMs) {
  const reason = text(result.reason, 'NO_TRADE');
  const reasons = [reason];
  const diagnostics = {
    tradeDecision: 'NO_TRADE',
    reason,
    details: result.details ?? {},
    executionAllowed: false,
    mode: 'PAPER_TRADING',
  };

  return Object.freeze({
    engineResult: createEngineResult({
      engine: LIQUIDITY_SWEEP_ENGINE_ID,
      status: noTradeStatus(result),
      signal: null,
      latencyMs,
      reasons,
      diagnostics,
      completedAt: completedAt(result),
    }),
    opportunity: null,
  });
}

function adaptPaperCandidate(result, latencyMs) {
  const setup = result.setup ?? {};
  const tradePlan = result.tradePlan ?? setup.tradePlan ?? {};
  const direction = text(setup.direction ?? result.liquiditySweep?.direction).toUpperCase();
  const score = finite(result.liquiditySweepScore ?? result.quality?.total);
  const reasons = stringList(
    explanationReasons(result.explanation),
    result.quality?.reasons,
    result.liquiditySweep?.evidence,
  );
  const diagnostics = {
    tradeDecision: 'PAPER_CANDIDATE',
    strategyVersion: result.strategyVersion ?? setup.strategyVersion ?? null,
    contextTimeframe: result.contextTimeframe ?? setup.contextTimeframe ?? null,
    sweepClassification: result.sweepClassification ?? result.liquiditySweep?.classification ?? null,
    acceptanceScore: result.acceptanceScore ?? result.liquiditySweep?.acceptanceScore ?? null,
    rejectionScore: result.rejectionScore ?? result.liquiditySweep?.rejectionScore ?? null,
    quality: result.quality ?? {},
    confirmation: result.confirmation ?? {},
    higherTimeframe: result.higherTimeframe ?? {},
    diagnostics: result.diagnostics ?? [],
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    mode: 'PAPER_TRADING',
  };

  const signal = createEngineSignal({
    engine: LIQUIDITY_SWEEP_ENGINE_ID,
    direction,
    score,
    confidence: score,
    confidenceSource: LIQUIDITY_SWEEP_ENGINE_ID,
    reasons,
    diagnostics,
    observedAt: result.evaluatedAt ?? setup.updatedAt ?? setup.createdAt ?? Date.now(),
  });

  const engineResult = createEngineResult({
    engine: LIQUIDITY_SWEEP_ENGINE_ID,
    status: EngineStatus.ACCEPTED,
    signal,
    latencyMs,
    reasons,
    diagnostics,
    completedAt: completedAt(result),
  });

  const opportunity = createOpportunity({
    id: setup.setupId ?? result.liquiditySweep?.sweepId,
    symbol: result.symbol ?? setup.symbol,
    direction: direction === Direction.SHORT ? Direction.SHORT : Direction.LONG,
    timeframe: result.executionTimeframe ?? setup.executionTimeframe,
    entry: tradePlan.entry,
    stopLoss: tradePlan.stopLoss,
    takeProfit: tradePlan.takeProfit,
    score,
    confidence: score,
    engineResults: [engineResult],
    reasons,
    metadata: {
      sourceEngine: LIQUIDITY_SWEEP_ENGINE_ID,
      setupId: setup.setupId ?? null,
      sweepId: result.liquiditySweep?.sweepId ?? setup.sweep?.sweepId ?? null,
      rewardToRisk: tradePlan.rewardToRisk ?? null,
      strategyVersion: result.strategyVersion ?? setup.strategyVersion ?? null,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      mode: 'PAPER_TRADING',
    },
    createdAt: result.evaluatedAt ?? setup.createdAt ?? Date.now(),
  });

  return Object.freeze({ engineResult, opportunity });
}

export function adaptLiquiditySweepResult(result, { latencyMs = 0 } = {}) {
  ensurePaperOnly(result);
  const decision = text(result.tradeDecision).toUpperCase();

  if (decision === 'NO_TRADE') return adaptNoTrade(result, finite(latencyMs));
  if (decision === 'PAPER_CANDIDATE') return adaptPaperCandidate(result, finite(latencyMs));

  throw new Error(`Unsupported liquidity sweep tradeDecision: ${decision || 'EMPTY'}`);
}
