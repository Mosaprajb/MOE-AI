import {
  Direction,
  EngineStatus,
  createEngineResult,
  createEngineSignal,
} from './domain.js';

export const SMART_MONEY_ENGINE_ID = 'SMART_MONEY';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function items(value) {
  if (value == null) return [];
  return (Array.isArray(value) ? value : [value])
    .flat(Infinity)
    .map((item) => text(item))
    .filter(Boolean);
}

function validateResult(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) {
    throw new Error('Smart money result must be an object');
  }
  if (result.executionAllowed === true || result.automaticSubmissionAllowed === true) {
    throw new Error('Smart money result is not observation-only');
  }
  if (text(result.mode, 'PAPER_TRADING').toUpperCase() !== 'PAPER_TRADING') {
    throw new Error('Smart money result mode must be PAPER_TRADING');
  }
}

function mapDirection(details = {}) {
  const value = text(
    details.confluence?.direction
      ?? details.structure?.currentBias
      ?? details.candidate?.direction,
  ).toUpperCase();

  if (value === 'BULLISH' || value === 'LONG') return Direction.LONG;
  if (value === 'BEARISH' || value === 'SHORT') return Direction.SHORT;
  return Direction.NEUTRAL;
}

export function adaptSmartMoneyResult(result, { latencyMs = 0 } = {}) {
  validateResult(result);

  const decision = text(result.tradeDecision).toUpperCase();
  if (decision !== 'NO_TRADE') {
    throw new Error(`Unsupported smart money tradeDecision: ${decision || 'EMPTY'}`);
  }

  const details = result.details ?? {};
  const reason = text(result.reason, 'NO_HIGH_QUALITY_SMART_MONEY_SETUP');
  const reasons = [reason, ...items(result.failedConditions)];
  const score = finite(result.setupScore);
  const direction = mapDirection(details);
  const observedAt = details.evaluatedAt ?? Date.now();
  const diagnostics = {
    tradeDecision: 'NO_TRADE',
    reason,
    failedConditions: items(result.failedConditions),
    setupScore: score,
    strategyVersion: details.strategyVersion ?? null,
    symbol: details.symbol ?? null,
    executionTimeframe: details.executionTimeframe ?? null,
    contextTimeframe: details.contextTimeframe ?? null,
    observationOnly: true,
    structure: details.structure ?? {},
    displacement: details.displacement ?? {},
    fairValueGaps: details.fairValueGaps ?? {},
    orderBlocks: details.orderBlocks ?? {},
    breakerBlocks: details.breakerBlocks ?? {},
    dealingRange: details.dealingRange ?? {},
    confluence: details.confluence ?? {},
    setupFamily: details.setupFamily ?? {},
    entryZoneSelection: details.entryZoneSelection ?? {},
    riskEvaluation: details.riskEvaluation ?? {},
    candidate: details.candidate ?? null,
    candidateLifecycle: details.candidateLifecycle ?? null,
    positionSizing: details.positionSizing ?? {},
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    mode: 'PAPER_TRADING',
  };

  const signal = direction === Direction.NEUTRAL
    ? null
    : createEngineSignal({
      engine: SMART_MONEY_ENGINE_ID,
      direction,
      score,
      confidence: score,
      confidenceSource: SMART_MONEY_ENGINE_ID,
      reasons,
      diagnostics,
      observedAt,
    });

  return Object.freeze({
    engineResult: createEngineResult({
      engine: SMART_MONEY_ENGINE_ID,
      status: reason.toUpperCase() === 'MARKET_DATA_REJECTED'
        ? EngineStatus.REJECTED
        : EngineStatus.NEUTRAL,
      signal,
      latencyMs: finite(latencyMs),
      reasons,
      diagnostics,
      completedAt: observedAt,
    }),
    opportunity: null,
  });
}
