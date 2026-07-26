import { deterministicSmartMoneyId } from './contracts.js';

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

export async function createSmartMoneySetupCandidate({
  symbol,
  timeframe,
  strategyVersion,
  setupFamily,
  direction,
  confluence,
  entryZone,
  riskEvaluation,
  createdAt,
  expiresAt,
  invalidationReasons = [],
} = {}) {
  const normalizedSymbol = text(symbol).toUpperCase();
  if (!normalizedSymbol) throw new Error('candidate.symbol is required');
  if (!['BULLISH', 'BEARISH'].includes(direction)) throw new Error('candidate.direction is invalid');
  if (!entryZone?.selected) throw new Error('candidate.entryZone.selected is required');

  const selected = entryZone.selected;
  const candidateId = await deterministicSmartMoneyId('sm_candidate', [
    strategyVersion,
    normalizedSymbol,
    timeframe,
    setupFamily,
    direction,
    selected.type,
    selected.id,
    createdAt,
  ]);

  const analyticalStatus = riskEvaluation?.status === 'OBSERVATION_ACCEPTED'
    && confluence?.approvedForObservation === true
    && invalidationReasons.length === 0
    ? 'OBSERVATION_CANDIDATE'
    : 'REJECTED';

  return freeze({
    candidateId,
    symbol: normalizedSymbol,
    timeframe,
    strategyVersion,
    setupFamily: text(setupFamily, 'UNCLASSIFIED').toUpperCase(),
    direction,
    analyticalStatus,
    setupScore: finite(confluence?.totalScore, 0),
    entryZone: selected,
    entryPrice: finite(riskEvaluation?.entryPrice, 0),
    stopPrice: finite(riskEvaluation?.stopPrice, 0),
    targetPrice: finite(riskEvaluation?.targetPrice, 0),
    rewardRisk: finite(riskEvaluation?.rewardRisk, 0),
    createdAt: Number(createdAt),
    expiresAt: Number(expiresAt),
    invalidationReasons: [...invalidationReasons],
    confirmations: [...(confluence?.confirmations || [])],
    failedConditions: [...new Set([
      ...(confluence?.failedConditions || []),
      ...(riskEvaluation?.failedConditions || []),
      ...invalidationReasons,
    ])],
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
