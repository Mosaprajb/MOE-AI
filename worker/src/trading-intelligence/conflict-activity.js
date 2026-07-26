const SUPPORT_STATUSES = new Set(['CONFIRMED']);
const CONFLICT_STATUSES = new Set(['REJECTED', 'BLOCKED', 'CONFLICTING', 'ERROR']);
const DEVELOPING_STATUSES = new Set(['WAITING_FOR_CONFIRMATION', 'DEVELOPING', 'VALIDATING', 'SCANNING']);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function finite(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function array(value) {
  return Array.isArray(value) ? value : [];
}

function normalized(value) {
  return text(value, 'UNKNOWN').toUpperCase().replace(/[\s-]+/g, '_');
}

function categoryForGauge(gauge = {}) {
  const id = text(gauge.id).toLowerCase();
  if (id === 'execution-quality') return 'EXECUTION';
  if (id === 'data-quality') return 'DATA';
  if (id === 'risk-quality') return 'RISK';
  if (['setup-confidence', 'higher-timeframe-bias', 'market-regime'].includes(id)) return 'CONTEXT';
  if (['liquidity-sweep', 'stop-run', 'smart-money', 'smt-divergence', 'absorption', 'market-imbalance', 'market-structure', 'relative-volume'].includes(id)) return 'MARKET';
  return normalized(gauge.category || 'OTHER');
}

function strengthForGauge(gauge = {}, conflict = false) {
  const score = finite(gauge.score, finite(gauge.confidence, conflict ? 70 : 50));
  const mandatoryBoost = gauge.mandatory ? 18 : 0;
  const blockingBoost = gauge.blocksExecution ? 15 : 0;
  const statusBoost = normalized(gauge.status) === 'ERROR' ? 15 : normalized(gauge.status) === 'BLOCKED' ? 10 : 0;
  return clamp((score == null ? 50 : score) + mandatoryBoost + blockingBoost + statusBoost, 0, 150);
}

function signalFromGauge(gauge, type, overrides = {}) {
  const blockers = array(gauge.blockers);
  const penalties = array(gauge.penalties);
  const reasons = type === 'SUPPORT'
    ? array(gauge.confirmationReasons)
    : [...blockers, ...penalties];
  return freeze({
    type,
    id: text(gauge.id) || null,
    label: text(gauge.name, gauge.shortLabel || gauge.id || 'Unknown signal'),
    category: overrides.category || categoryForGauge(gauge),
    status: normalized(gauge.status),
    score: finite(gauge.score),
    confidence: finite(gauge.confidence),
    direction: normalized(gauge.direction),
    mandatory: overrides.mandatory ?? gauge.mandatory === true,
    blocksReadiness: overrides.blocksReadiness ?? gauge.blocksExecution === true,
    strength: overrides.strength ?? strengthForGauge(gauge, type === 'CONFLICT'),
    summary: text(overrides.summary, gauge.summary || reasons[0] || gauge.status || 'No detailed explanation is available.'),
    reasons: [...new Set(reasons.map(String))].slice(0, 10),
    scope: overrides.scope || 'ANALYTICAL',
    source: overrides.source || 'TRADING_GAUGE',
  });
}

function portfolioSignals(portfolioRisk) {
  if (!portfolioRisk) return [];
  const severityStrength = portfolioRisk.status === 'CRITICAL' ? 145 : 125;
  return array(portfolioRisk.blockers).map((reason, index) => freeze({
    type: 'CONFLICT',
    id: `portfolio-${String(reason).toLowerCase().replaceAll('_', '-')}`,
    label: 'Portfolio Risk',
    category: 'PORTFOLIO',
    status: normalized(portfolioRisk.status || 'BLOCKED'),
    score: null,
    confidence: finite(portfolioRisk.capitalData?.coveragePercent),
    direction: 'NO_TRADE',
    mandatory: true,
    blocksReadiness: true,
    strength: severityStrength - index,
    summary: String(reason).replaceAll('_', ' '),
    reasons: [String(reason)],
    scope: 'PORTFOLIO_RISK_GATE',
    source: 'PORTFOLIO_CAPITAL_RISK',
  }));
}

function activePositionSignals(activePosition) {
  if (!activePosition?.available) return [];
  const output = [];
  const riskState = normalized(activePosition.riskState);
  const protection = normalized(activePosition.protectionStatus);
  if (['CRITICAL', 'DANGER', 'STOP_TRIGGERED'].includes(riskState)) {
    output.push(freeze({
      type: 'CONFLICT',
      id: `position-risk-${riskState.toLowerCase()}`,
      label: 'Active Position Risk',
      category: 'POSITION',
      status: riskState,
      score: null,
      confidence: null,
      direction: normalized(activePosition.direction),
      mandatory: true,
      blocksReadiness: true,
      strength: riskState === 'CRITICAL' || riskState === 'STOP_TRIGGERED' ? 150 : 138,
      summary: `${activePosition.symbol || 'Position'} risk state is ${riskState.replaceAll('_', ' ')}.`,
      reasons: [`POSITION_RISK_${riskState}`],
      scope: 'ACTIVE_POSITION',
      source: 'ACTIVE_POSITION_INTELLIGENCE',
    }));
  }
  if (['UNPROTECTED', 'PARTIALLY_PROTECTED'].includes(protection)) {
    output.push(freeze({
      type: 'CONFLICT',
      id: `position-protection-${protection.toLowerCase()}`,
      label: 'Position Protection',
      category: 'POSITION',
      status: protection,
      score: null,
      confidence: null,
      direction: normalized(activePosition.direction),
      mandatory: protection === 'UNPROTECTED',
      blocksReadiness: true,
      strength: protection === 'UNPROTECTED' ? 148 : 118,
      summary: `${activePosition.symbol || 'Position'} protection is ${protection.replaceAll('_', ' ')}.`,
      reasons: [`POSITION_${protection}`],
      scope: 'ACTIVE_POSITION',
      source: 'ACTIVE_POSITION_INTELLIGENCE',
    }));
  }
  return output;
}

function executionSignals(gauge) {
  if (!gauge || gauge.id !== 'execution-quality') return [];
  const metadata = gauge.metadata || {};
  const marketBlockers = array(metadata.marketBlockers);
  const safetyBlockers = array(metadata.safetyBlockers);
  const output = [];
  if (marketBlockers.length) {
    output.push(signalFromGauge(gauge, 'CONFLICT', {
      category: 'EXECUTION',
      mandatory: true,
      blocksReadiness: true,
      strength: 128,
      summary: marketBlockers[0].replaceAll('_', ' '),
      scope: 'EXECUTION_MARKET_QUALITY',
    }));
  } else if (safetyBlockers.length) {
    output.push(signalFromGauge(gauge, 'CONFLICT', {
      category: 'SAFETY',
      mandatory: true,
      blocksReadiness: true,
      strength: 65,
      summary: 'Execution remains disabled by observation-only safety locks.',
      scope: 'SAFETY_LOCK',
    }));
  }
  return output;
}

function compareStrength(left, right) {
  return right.strength - left.strength || Number(right.mandatory) - Number(left.mandatory) || String(left.label).localeCompare(String(right.label));
}

function emptyConflictSummary(reason = 'NO_OPPORTUNITY_AVAILABLE') {
  return freeze({
    available: false,
    status: 'UNAVAILABLE',
    reason,
    symbol: null,
    direction: 'NO_TRADE',
    strongestSupport: null,
    strongestConflict: null,
    supportiveSignals: [],
    conflicts: [],
    counts: { supportive: 0, conflicts: 0, mandatoryConflicts: 0, optionalConflicts: 0 },
    categories: {},
    primaryReason: reason,
    headline: 'No scanner opportunity is available for conflict analysis.',
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}

export function buildConflictSummary({ opportunity = null, portfolioRisk = null, activePosition = null } = {}) {
  if (!opportunity) return emptyConflictSummary();
  const gauges = array(opportunity.tradingIntelligence?.gauges);
  const supportiveSignals = [];
  const conflicts = [];

  for (const gauge of gauges) {
    const status = normalized(gauge.status);
    if (gauge.id === 'execution-quality') {
      conflicts.push(...executionSignals(gauge));
      continue;
    }
    if (SUPPORT_STATUSES.has(status)) {
      supportiveSignals.push(signalFromGauge(gauge, 'SUPPORT'));
      continue;
    }
    const unavailableMandatory = status === 'UNAVAILABLE' && gauge.mandatory === true;
    const developingMandatory = DEVELOPING_STATUSES.has(status) && gauge.mandatory === true;
    if (CONFLICT_STATUSES.has(status) || unavailableMandatory || developingMandatory || gauge.blocksExecution === true) {
      conflicts.push(signalFromGauge(gauge, 'CONFLICT', {
        scope: unavailableMandatory ? 'REQUIRED_DATA' : developingMandatory ? 'MANDATORY_CONFIRMATION_PENDING' : 'ANALYTICAL',
      }));
    }
  }

  conflicts.push(...portfolioSignals(portfolioRisk), ...activePositionSignals(activePosition));
  const uniqueConflicts = [...new Map(conflicts.map((item) => [`${item.source}:${item.id}:${item.summary}`, item])).values()].sort(compareStrength);
  const uniqueSupport = [...new Map(supportiveSignals.map((item) => [`${item.source}:${item.id}`, item])).values()].sort(compareStrength);
  const mandatoryConflicts = uniqueConflicts.filter((item) => item.mandatory || item.blocksReadiness);
  const optionalConflicts = uniqueConflicts.filter((item) => !item.mandatory && !item.blocksReadiness);
  const strongestSupport = uniqueSupport[0] || null;
  const strongestConflict = mandatoryConflicts[0] || uniqueConflicts[0] || null;
  const status = mandatoryConflicts.length ? 'BLOCKED' : optionalConflicts.length ? 'CONFLICTING' : uniqueSupport.length ? 'ALIGNED' : 'INSUFFICIENT_EVIDENCE';
  const categoryCounts = {};
  for (const item of uniqueConflicts) categoryCounts[item.category] = (categoryCounts[item.category] || 0) + 1;
  const primaryReason = strongestConflict?.reasons?.[0] || strongestConflict?.summary || opportunity.reason || 'NO_BLOCKING_CONFLICT';
  const headline = status === 'BLOCKED'
    ? `${opportunity.symbol || 'Setup'} is not ready: ${strongestConflict?.summary || primaryReason}`
    : status === 'CONFLICTING'
      ? `${opportunity.symbol || 'Setup'} has optional conflicting evidence.`
      : status === 'ALIGNED'
        ? `${opportunity.symbol || 'Setup'} analytical evidence is aligned, but execution remains observation-only.`
        : `${opportunity.symbol || 'Setup'} does not have enough confirmed evidence.`;

  return freeze({
    available: true,
    status,
    symbol: opportunity.symbol || null,
    timeframe: opportunity.timeframe || null,
    direction: normalized(opportunity.tradingIntelligence?.direction || opportunity.direction || 'NO_TRADE'),
    pipelineScore: finite(opportunity.pipelineScore, finite(opportunity.setupScore, 0)),
    pipelinePassed: opportunity.pipelinePassed === true,
    failedStage: opportunity.failedStage || null,
    evaluatedAt: opportunity.evaluatedAt || null,
    strongestSupport,
    strongestConflict,
    supportiveSignals: uniqueSupport.slice(0, 12),
    conflicts: uniqueConflicts.slice(0, 20),
    counts: {
      supportive: uniqueSupport.length,
      conflicts: uniqueConflicts.length,
      mandatoryConflicts: mandatoryConflicts.length,
      optionalConflicts: optionalConflicts.length,
    },
    categories: categoryCounts,
    primaryReason,
    headline,
    tradeReadiness: opportunity.tradingIntelligence?.tradeReadiness || null,
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}

function event({ type, severity = 'INFO', category = 'SYSTEM', symbol = null, title, detail, at, source, key = '' }) {
  const timestamp = at && !Number.isNaN(Date.parse(at)) ? new Date(at).toISOString() : new Date().toISOString();
  const fingerprint = [type, symbol || 'GLOBAL', key || detail || title].map((value) => normalized(value)).join(':');
  return freeze({
    type,
    severity,
    category,
    symbol,
    title,
    detail,
    at: timestamp,
    source,
    fingerprint,
  });
}

function gaugeById(opportunity, id) {
  return array(opportunity?.tradingIntelligence?.gauges).find((gauge) => gauge.id === id) || null;
}

function opportunityEvents(run, previousBySymbol) {
  const output = [];
  const runAt = run.recordedAt || run.evaluatedAt || new Date().toISOString();
  for (const opportunity of array(run.topOpportunities)) {
    const symbol = opportunity.symbol || null;
    const previous = previousBySymbol.get(symbol) || null;
    if (opportunity.pipelinePassed === true && previous?.pipelinePassed !== true) {
      output.push(event({ type: 'PIPELINE_CONFIRMED', severity: 'POSITIVE', category: 'MARKET', symbol, title: 'Institutional Flow pipeline confirmed', detail: `All mandatory analytical stages passed for ${symbol}.`, at: opportunity.evaluatedAt || runAt, source: 'SMART_MONEY_OBSERVATION', key: 'PIPELINE_CONFIRMED' }));
    }
    if (opportunity.failedStage && opportunity.failedStage !== previous?.failedStage) {
      output.push(event({ type: 'PIPELINE_STAGE_REJECTED', severity: 'WARNING', category: 'MARKET', symbol, title: `${String(opportunity.failedStage).replaceAll('_', ' ')} rejected`, detail: opportunity.reason || `Pipeline stopped at ${opportunity.failedStage}.`, at: opportunity.evaluatedAt || runAt, source: 'SMART_MONEY_OBSERVATION', key: opportunity.failedStage }));
    }

    const smt = gaugeById(opportunity, 'smt-divergence');
    const previousSmt = gaugeById(previous, 'smt-divergence');
    if (smt?.status === 'CONFIRMED' && previousSmt?.status !== 'CONFIRMED') {
      output.push(event({ type: 'SMT_DIVERGENCE_CONFIRMED', severity: 'POSITIVE', category: 'MARKET', symbol, title: 'SMT divergence confirmed', detail: smt.summary || 'Correlated-market divergence passed validation.', at: opportunity.evaluatedAt || runAt, source: 'SMT_DIVERGENCE', key: smt.metadata?.classification || smt.direction }));
    }

    const rvol = gaugeById(opportunity, 'relative-volume');
    const previousRvol = gaugeById(previous, 'relative-volume');
    const currentRvol = finite(rvol?.metadata?.relativeVolume);
    const priorRvol = finite(previousRvol?.metadata?.relativeVolume);
    if (currentRvol != null && currentRvol >= 1.5 && (priorRvol == null || priorRvol < 1.5)) {
      output.push(event({ type: 'SESSION_RVOL_ELEVATED', severity: 'INFO', category: 'VOLUME', symbol, title: 'Session RVOL elevated', detail: `${symbol} relative volume reached ${currentRvol.toFixed(2)}×.`, at: opportunity.evaluatedAt || runAt, source: 'RELATIVE_VOLUME', key: 'RVOL_ABOVE_1_5' }));
    }

    const execution = gaugeById(opportunity, 'execution-quality');
    const previousExecution = gaugeById(previous, 'execution-quality');
    const blockers = array(execution?.metadata?.marketBlockers);
    const previousBlockers = new Set(array(previousExecution?.metadata?.marketBlockers));
    for (const blocker of blockers) {
      if (previousBlockers.has(blocker)) continue;
      output.push(event({ type: 'EXECUTION_QUALITY_DEGRADED', severity: 'WARNING', category: 'EXECUTION', symbol, title: 'Execution quality degraded', detail: String(blocker).replaceAll('_', ' '), at: opportunity.evaluatedAt || runAt, source: 'EXECUTION_QUALITY', key: blocker }));
    }
    previousBySymbol.set(symbol, opportunity);
  }
  return output;
}

function portfolioEvents(portfolioRisk) {
  if (!portfolioRisk) return [];
  const output = [];
  const at = portfolioRisk.generatedAt || new Date().toISOString();
  if (portfolioRisk.portfolioAcceptsNewRisk === false) {
    output.push(event({ type: 'PORTFOLIO_RISK_GATE_BLOCKED', severity: portfolioRisk.status === 'CRITICAL' ? 'CRITICAL' : 'WARNING', category: 'PORTFOLIO', title: 'Portfolio risk gate blocked', detail: array(portfolioRisk.blockers)[0]?.replaceAll('_', ' ') || 'Portfolio cannot accept additional risk.', at, source: 'PORTFOLIO_CAPITAL_RISK', key: array(portfolioRisk.blockers).join('|') || 'BLOCKED' }));
  }
  for (const warning of array(portfolioRisk.warnings)) {
    if (!['DAILY_LOSS_LIMIT_NEAR', 'PARTIALLY_PROTECTED_POSITION_EXISTS', 'MARGIN_EXIT_WINDOW_ACTIVE', 'LIFECYCLE_ATTENTION_REQUIRED'].includes(warning)) continue;
    output.push(event({ type: warning, severity: 'WARNING', category: 'PORTFOLIO', title: String(warning).replaceAll('_', ' '), detail: 'Portfolio risk intelligence requires attention.', at, source: 'PORTFOLIO_CAPITAL_RISK', key: warning }));
  }
  return output;
}

function positionEvents(activePosition) {
  if (!activePosition?.available) return [];
  const output = [];
  const at = activePosition.lastUpdatedAt || new Date().toISOString();
  const symbol = activePosition.symbol || null;
  const riskState = normalized(activePosition.riskState);
  if (['WARNING', 'DANGER', 'CRITICAL', 'STOP_TRIGGERED'].includes(riskState)) {
    output.push(event({ type: 'POSITION_RISK_CHANGED', severity: ['CRITICAL', 'STOP_TRIGGERED'].includes(riskState) ? 'CRITICAL' : 'WARNING', category: 'POSITION', symbol, title: `Position risk ${riskState.replaceAll('_', ' ')}`, detail: activePosition.progress?.distanceToStopR == null ? `${symbol} requires attention.` : `${symbol} is ${Number(activePosition.progress.distanceToStopR).toFixed(2)}R from the stop.`, at, source: 'ACTIVE_POSITION_INTELLIGENCE', key: riskState }));
  }
  const protection = normalized(activePosition.protectionStatus);
  if (['UNPROTECTED', 'PARTIALLY_PROTECTED'].includes(protection)) {
    output.push(event({ type: 'POSITION_PROTECTION_INCOMPLETE', severity: protection === 'UNPROTECTED' ? 'CRITICAL' : 'WARNING', category: 'POSITION', symbol, title: 'Position protection incomplete', detail: `${symbol} protection status is ${protection.replaceAll('_', ' ')}.`, at, source: 'ACTIVE_POSITION_INTELLIGENCE', key: protection }));
  }
  if (activePosition.positionStatus === 'TARGET_REACHED') {
    output.push(event({ type: 'POSITION_TARGET_REACHED', severity: 'POSITIVE', category: 'POSITION', symbol, title: 'Position target reached', detail: `${symbol} reached the tracked target.`, at, source: 'ACTIVE_POSITION_INTELLIGENCE', key: activePosition.tradeId || 'TARGET' }));
  }
  return output;
}

export function buildActivityFeed({ observationHistory = [], portfolioRisk = null, activePosition = null, limit = 40 } = {}) {
  const history = array(observationHistory)
    .filter((run) => run && typeof run === 'object')
    .sort((left, right) => Date.parse(left.recordedAt || left.evaluatedAt || 0) - Date.parse(right.recordedAt || right.evaluatedAt || 0));
  const previousBySymbol = new Map();
  const generated = [];
  for (const run of history) generated.push(...opportunityEvents(run, previousBySymbol));
  generated.push(...portfolioEvents(portfolioRisk), ...positionEvents(activePosition));

  const newestByFingerprint = new Map();
  for (const item of generated) {
    const existing = newestByFingerprint.get(item.fingerprint);
    if (!existing || Date.parse(item.at) > Date.parse(existing.at)) newestByFingerprint.set(item.fingerprint, item);
  }
  const events = [...newestByFingerprint.values()]
    .sort((left, right) => Date.parse(right.at) - Date.parse(left.at) || left.fingerprint.localeCompare(right.fingerprint))
    .slice(0, Math.max(1, Math.min(100, Number(limit) || 40)));
  const counts = events.reduce((output, item) => {
    output[item.severity] = (output[item.severity] || 0) + 1;
    return output;
  }, {});
  return freeze({
    generatedAt: new Date().toISOString(),
    events,
    count: events.length,
    counts,
    deduplicated: true,
    sources: [...new Set(events.map((item) => item.source))],
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}

export function buildTradingCommandCenter({ observationStatus = null, selectedSymbol = null, portfolioRisk = null, activePosition = null } = {}) {
  const latest = observationStatus?.latest || null;
  const opportunities = array(latest?.topOpportunities);
  const requested = text(selectedSymbol).toUpperCase();
  const selectedOpportunity = opportunities.find((item) => text(item.symbol).toUpperCase() === requested) || opportunities[0] || null;
  const conflictSummary = buildConflictSummary({ opportunity: selectedOpportunity, portfolioRisk, activePosition });
  const activityFeed = buildActivityFeed({
    observationHistory: observationStatus?.recentRuns || (latest ? [latest] : []),
    portfolioRisk,
    activePosition,
  });
  return freeze({
    selectedSymbol: selectedOpportunity?.symbol || requested || null,
    availableSymbols: opportunities.map((item) => item.symbol).filter(Boolean),
    conflictSummary,
    activityFeed,
    portfolioRiskStatus: portfolioRisk?.status || 'UNAVAILABLE',
    activePositionStatus: activePosition?.positionStatus || 'NO_ACTIVE_POSITION',
    generatedAt: new Date().toISOString(),
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
