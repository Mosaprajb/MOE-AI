import { Direction, clampScore } from './domain.js';
import { OpportunityStatus } from './opportunity-builder.js';

export const RiskDecision = Object.freeze({
  APPROVED: 'APPROVED',
  REDUCED: 'REDUCED',
  REJECTED: 'REJECTED',
});

export const RiskGrade = Object.freeze({
  LOW: 'LOW',
  MODERATE: 'MODERATE',
  HIGH: 'HIGH',
  BLOCKED: 'BLOCKED',
});

function finite(value, field, minimum = 0, maximum = Infinity) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be a finite number between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function freezeArray(value) {
  return Object.freeze([...(value || [])]);
}

function normalizePositions(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('portfolio.openPositions must be an array');
  return value.map((position) => ({
    symbol: String(position.symbol ?? '').toUpperCase(),
    sector: String(position.sector ?? 'UNKNOWN').toUpperCase(),
    notional: finite(position.notional ?? 0, 'position.notional'),
    direction: String(position.direction ?? '').toUpperCase(),
    correlationGroup: String(position.correlationGroup ?? position.sector ?? 'UNKNOWN').toUpperCase(),
  }));
}

function getRiskPerShare(opportunity) {
  return opportunity.direction === Direction.LONG
    ? opportunity.entry - opportunity.stopLoss
    : opportunity.stopLoss - opportunity.entry;
}

function gradeFor(utilization, dailyLossRatio, exposureRatio) {
  if (utilization >= 1 || dailyLossRatio >= 1 || exposureRatio >= 1) return RiskGrade.BLOCKED;
  if (utilization >= 0.8 || dailyLossRatio >= 0.75 || exposureRatio >= 0.8) return RiskGrade.HIGH;
  if (utilization >= 0.55 || dailyLossRatio >= 0.5 || exposureRatio >= 0.6) return RiskGrade.MODERATE;
  return RiskGrade.LOW;
}

export function evaluateOpportunityRisk(opportunity, portfolio = {}, policy = {}) {
  if (!opportunity || typeof opportunity !== 'object') throw new Error('opportunity is required');
  if (opportunity.status !== OpportunityStatus.CANDIDATE) {
    return Object.freeze({
      decision: RiskDecision.REJECTED,
      grade: RiskGrade.BLOCKED,
      reasons: Object.freeze(['OPPORTUNITY_NOT_CANDIDATE']),
      observationOnly: true,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
    });
  }
  if (opportunity.observationOnly !== true || opportunity.executionAllowed === true) {
    throw new Error('risk engine accepts observation-only opportunities only');
  }

  const accountEquity = finite(portfolio.accountEquity, 'portfolio.accountEquity', Number.MIN_VALUE);
  const cashAvailable = finite(portfolio.cashAvailable ?? accountEquity, 'portfolio.cashAvailable');
  const realizedDailyPnl = finite(portfolio.realizedDailyPnl ?? 0, 'portfolio.realizedDailyPnl', -Infinity);
  const openRisk = finite(portfolio.openRisk ?? 0, 'portfolio.openRisk');
  const positions = normalizePositions(portfolio.openPositions);

  const riskPerTradePct = finite(policy.riskPerTradePct ?? 0.5, 'policy.riskPerTradePct', 0.01, 5);
  const maxDailyLossPct = finite(policy.maxDailyLossPct ?? 2, 'policy.maxDailyLossPct', 0.1, 20);
  const maxPortfolioRiskPct = finite(policy.maxPortfolioRiskPct ?? 4, 'policy.maxPortfolioRiskPct', 0.1, 30);
  const maxPositionPct = finite(policy.maxPositionPct ?? 15, 'policy.maxPositionPct', 0.1, 100);
  const maxSectorExposurePct = finite(policy.maxSectorExposurePct ?? 30, 'policy.maxSectorExposurePct', 1, 100);
  const maxCorrelationExposurePct = finite(policy.maxCorrelationExposurePct ?? 35, 'policy.maxCorrelationExposurePct', 1, 100);
  const minimumShares = Math.floor(finite(policy.minimumShares ?? 1, 'policy.minimumShares', 1));

  const riskPerShare = getRiskPerShare(opportunity);
  if (!Number.isFinite(riskPerShare) || riskPerShare <= 0) throw new Error('opportunity risk per share must be positive');

  const allowedTradeRisk = accountEquity * (riskPerTradePct / 100);
  const maxDailyLoss = accountEquity * (maxDailyLossPct / 100);
  const maxPortfolioRisk = accountEquity * (maxPortfolioRiskPct / 100);
  const maxPositionNotional = accountEquity * (maxPositionPct / 100);

  const dailyLossUsed = Math.max(0, -realizedDailyPnl);
  const dailyRiskRemaining = Math.max(0, maxDailyLoss - dailyLossUsed);
  const portfolioRiskRemaining = Math.max(0, maxPortfolioRisk - openRisk);
  const effectiveRiskBudget = Math.min(allowedTradeRisk, dailyRiskRemaining, portfolioRiskRemaining);

  const sharesByRisk = Math.floor(effectiveRiskBudget / riskPerShare);
  const sharesByPosition = Math.floor(maxPositionNotional / opportunity.entry);
  const sharesByCash = Math.floor(cashAvailable / opportunity.entry);
  let quantity = Math.max(0, Math.min(sharesByRisk, sharesByPosition, sharesByCash));

  const sector = String(opportunity.metadata?.sector ?? 'UNKNOWN').toUpperCase();
  const correlationGroup = String(opportunity.metadata?.correlationGroup ?? sector).toUpperCase();
  const currentSectorNotional = positions
    .filter((position) => position.sector === sector)
    .reduce((sum, position) => sum + position.notional, 0);
  const currentCorrelationNotional = positions
    .filter((position) => position.correlationGroup === correlationGroup)
    .reduce((sum, position) => sum + position.notional, 0);

  const maxSectorNotional = accountEquity * (maxSectorExposurePct / 100);
  const maxCorrelationNotional = accountEquity * (maxCorrelationExposurePct / 100);
  const sectorCapacity = Math.max(0, maxSectorNotional - currentSectorNotional);
  const correlationCapacity = Math.max(0, maxCorrelationNotional - currentCorrelationNotional);

  quantity = Math.min(
    quantity,
    Math.floor(sectorCapacity / opportunity.entry),
    Math.floor(correlationCapacity / opportunity.entry),
  );

  const reasons = [];
  if (dailyRiskRemaining <= 0) reasons.push('DAILY_LOSS_LIMIT_REACHED');
  if (portfolioRiskRemaining <= 0) reasons.push('PORTFOLIO_RISK_LIMIT_REACHED');
  if (sectorCapacity <= 0) reasons.push('SECTOR_EXPOSURE_LIMIT_REACHED');
  if (correlationCapacity <= 0) reasons.push('CORRELATION_EXPOSURE_LIMIT_REACHED');
  if (cashAvailable < opportunity.entry) reasons.push('INSUFFICIENT_CASH');
  if (quantity < minimumShares) reasons.push('POSITION_SIZE_BELOW_MINIMUM');

  const proposedRisk = quantity * riskPerShare;
  const proposedNotional = quantity * opportunity.entry;
  const utilization = allowedTradeRisk > 0 ? proposedRisk / allowedTradeRisk : 1;
  const dailyLossRatio = maxDailyLoss > 0 ? dailyLossUsed / maxDailyLoss : 1;
  const exposureRatio = maxPositionNotional > 0 ? proposedNotional / maxPositionNotional : 1;

  const rejected = reasons.length > 0 && quantity < minimumShares;
  const reduced = !rejected && (
    quantity < sharesByRisk
    || effectiveRiskBudget < allowedTradeRisk
    || sectorCapacity < maxSectorNotional
    || correlationCapacity < maxCorrelationNotional
  );

  const decision = rejected
    ? RiskDecision.REJECTED
    : reduced ? RiskDecision.REDUCED : RiskDecision.APPROVED;
  const grade = rejected
    ? RiskGrade.BLOCKED
    : gradeFor(utilization, dailyLossRatio, exposureRatio);

  const riskScore = clampScore(
    (utilization * 35)
    + (dailyLossRatio * 25)
    + (Math.min(1, openRisk / maxPortfolioRisk) * 25)
    + (exposureRatio * 15),
  );

  return Object.freeze({
    decision,
    grade,
    riskScore,
    quantity,
    proposedRisk,
    proposedNotional,
    riskPerShare,
    allowedTradeRisk,
    effectiveRiskBudget,
    dailyRiskRemaining,
    portfolioRiskRemaining,
    sectorCapacity,
    correlationCapacity,
    reasons: freezeArray(reasons),
    diagnostics: Object.freeze({
      sharesByRisk,
      sharesByPosition,
      sharesByCash,
      currentSectorNotional,
      currentCorrelationNotional,
      riskPerTradePct,
      maxDailyLossPct,
      maxPortfolioRiskPct,
      maxPositionPct,
      maxSectorExposurePct,
      maxCorrelationExposurePct,
    }),
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    manualApprovalRequired: true,
  });
}
