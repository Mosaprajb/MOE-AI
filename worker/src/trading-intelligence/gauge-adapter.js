import { GAUGE_DIRECTIONS, GAUGE_STATUSES, TRADING_GAUGE_REGISTRY } from './gauge-registry.js';

function clamp(value, minimum = 0, maximum = 100) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : null;
}

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function direction(value) {
  const normalized = String(value || '').toUpperCase();
  if (normalized === 'BULLISH') return 'LONG';
  if (normalized === 'BEARISH') return 'SHORT';
  return GAUGE_DIRECTIONS.includes(normalized) ? normalized : 'NO_TRADE';
}

function statusForStage(stage, blocked = false) {
  if (blocked) return 'BLOCKED';
  if (!stage) return 'UNAVAILABLE';
  if (stage.passed === true) return 'CONFIRMED';
  if (stage.status === 'BLOCKED') return 'BLOCKED';
  if (stage.status === 'REJECTED') return 'REJECTED';
  return 'VALIDATING';
}

function safeStatus(value) {
  return GAUGE_STATUSES.includes(value) ? value : 'ERROR';
}

function stageGauge(definition, stage, item, options = {}) {
  const score = definition.scored ? clamp(stage?.score) : null;
  const confidence = clamp(stage?.confidence ?? stage?.score ?? score);
  const status = safeStatus(options.status || statusForStage(stage, options.blocked));
  const failedConditions = Array.isArray(stage?.failedConditions) ? stage.failedConditions.slice(0, 8) : [];
  return freeze({
    id: definition.id,
    name: definition.label,
    shortLabel: definition.shortLabel,
    category: definition.category,
    score,
    confidence,
    direction: direction(stage?.direction || item.direction),
    status,
    activity: ['SCANNING', 'DETECTED', 'VALIDATING', 'DEVELOPING', 'WAITING_FOR_CONFIRMATION'].includes(status),
    contribution: definition.officialWeight != null && score != null ? Number((score * definition.officialWeight).toFixed(2)) : null,
    weight: definition.officialWeight,
    mandatory: definition.mandatory,
    blocksExecution: definition.mandatory && status !== 'CONFIRMED',
    timeframe: item.timeframe || null,
    lastUpdatedAt: item.evaluatedAt || null,
    summary: options.summary || stage?.reason || stage?.classification || item.reason || 'No detailed explanation is available.',
    confirmationReasons: Array.isArray(stage?.confirmationReasons) ? stage.confirmationReasons.slice(0, 8) : [],
    penalties: Array.isArray(stage?.penalties) ? stage.penalties.slice(0, 8) : [],
    blockers: failedConditions,
    metadata: options.metadata || stage || {},
  });
}

function unavailable(definition, item, summary) {
  return freeze({
    id: definition.id,
    name: definition.label,
    shortLabel: definition.shortLabel,
    category: definition.category,
    score: null,
    confidence: null,
    direction: 'NO_TRADE',
    status: 'UNAVAILABLE',
    activity: false,
    contribution: null,
    weight: definition.officialWeight,
    mandatory: definition.mandatory,
    blocksExecution: definition.mandatory,
    timeframe: item.timeframe || null,
    lastUpdatedAt: item.evaluatedAt || null,
    summary,
    confirmationReasons: [],
    penalties: [],
    blockers: definition.mandatory ? ['REQUIRED_DATA_UNAVAILABLE'] : [],
    metadata: {},
  });
}

export function buildTradingIntelligenceSnapshot(item = {}) {
  const stages = item.stages || {};
  const byId = Object.fromEntries(TRADING_GAUGE_REGISTRY.map((definition) => [definition.id, definition]));
  const stopRun = stages.STOP_RUN || null;
  const absorption = stages.ABSORPTION || null;
  const imbalance = stages.IMBALANCE || null;
  const structure = stages.STRUCTURE_CONFIRMATION || null;
  const risk = stages.RISK_ENGINE || null;
  const smartMoneyScore = clamp(item.diagnostics?.smartMoneyScore);
  const liquidityScore = clamp(item.diagnostics?.liquiditySweepScore ?? stopRun?.score);
  const dataMode = item.dataMode || absorption?.absorptionMode || 'INSUFFICIENT_DATA';
  const dataAvailable = dataMode !== 'INSUFFICIENT_DATA';

  const gauges = [
    unavailable(byId['higher-timeframe-bias'], item, 'Higher-timeframe score is not yet exposed by the compact scanner contract.'),
    unavailable(byId['market-regime'], item, 'Market regime exists in the engine but is not yet exposed by the compact scanner contract.'),
    unavailable(byId['relative-volume'], item, 'A dedicated RVOL engine has not been implemented yet.'),
    stageGauge(byId['liquidity-sweep'], { ...stopRun, score: liquidityScore }, item, { summary: item.diagnostics?.liquiditySweepReason || stopRun?.classification || 'Liquidity sweep evaluation.' }),
    stageGauge(byId['stop-run'], stopRun, item),
    stageGauge(byId['smart-money'], { score: smartMoneyScore, direction: item.direction, passed: smartMoneyScore != null && smartMoneyScore > 0, status: smartMoneyScore != null ? 'PASSED' : 'BLOCKED' }, item, { summary: item.diagnostics?.smartMoneyReason || 'Smart Money confluence evaluation.' }),
    unavailable(byId['smt-divergence'], item, 'SMT Divergence engine has not been implemented yet.'),
    stageGauge(byId.absorption, absorption, item, { summary: `${absorption?.classification || 'Absorption unavailable'} · ${dataMode}` }),
    stageGauge(byId['market-imbalance'], imbalance, item),
    stageGauge(byId['market-structure'], structure, item),
    stageGauge(byId['risk-quality'], risk, item),
    stageGauge(byId['setup-confidence'], { score: item.pipelineScore, direction: item.direction, passed: item.pipelinePassed, status: item.pipelinePassed ? 'PASSED' : 'REJECTED', failedConditions: item.failedStage ? [item.reason || `${item.failedStage}_FAILED`] : [] }, item, { status: item.pipelinePassed ? 'CONFIRMED' : 'WAITING_FOR_CONFIRMATION', summary: item.pipelinePassed ? 'All Institutional Flow stages passed in observation mode.' : `Waiting on ${item.failedStage || 'required conditions'}.` }),
    dataAvailable
      ? stageGauge(byId['data-quality'], { score: dataMode === 'TRUE_ORDER_FLOW' ? 100 : 65, direction: 'NEUTRAL', passed: true, status: 'PASSED' }, item, { summary: dataMode === 'TRUE_ORDER_FLOW' ? 'True trade-level order-flow data is available.' : 'OHLCV proxy mode is active; true aggressor data is unavailable.' })
      : unavailable(byId['data-quality'], item, 'Required data is insufficient for a reliable order-flow classification.'),
    unavailable(byId['execution-quality'], item, 'Execution quality is intentionally unavailable because this scanner is observation-only and disconnected from order submission.'),
  ].sort((left, right) => (byId[left.id]?.priority || 999) - (byId[right.id]?.priority || 999));

  const mandatoryBlockers = gauges.filter((gauge) => gauge.mandatory && gauge.blocksExecution).map((gauge) => gauge.id);
  const masterStatus = item.pipelinePassed && mandatoryBlockers.length === 0 ? 'CONFIRMED' : item.failedStage ? 'WAITING_FOR_CONFIRMATION' : 'SCANNING';

  return freeze({
    symbol: item.symbol || null,
    timeframe: item.timeframe || null,
    direction: direction(item.direction),
    evaluatedAt: item.evaluatedAt || null,
    tradeReadiness: {
      score: clamp(item.pipelineScore) ?? 0,
      status: masterStatus,
      direction: direction(item.direction),
      mandatoryCompleted: gauges.filter((gauge) => gauge.mandatory && !gauge.blocksExecution).length,
      mandatoryTotal: gauges.filter((gauge) => gauge.mandatory).length,
      blockers: mandatoryBlockers,
      executionPermission: false,
      observationOnly: true,
      mode: 'PAPER_TRADING',
    },
    gauges,
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
