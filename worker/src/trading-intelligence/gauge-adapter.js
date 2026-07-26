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
    timeframe: options.timeframe || item.timeframe || null,
    lastUpdatedAt: item.evaluatedAt || null,
    summary: options.summary || stage?.reason || stage?.classification || item.reason || 'No detailed explanation is available.',
    confirmationReasons: Array.isArray(options.confirmationReasons) ? options.confirmationReasons.slice(0, 8) : Array.isArray(stage?.confirmationReasons) ? stage.confirmationReasons.slice(0, 8) : [],
    penalties: Array.isArray(options.penalties) ? options.penalties.slice(0, 8) : Array.isArray(stage?.penalties) ? stage.penalties.slice(0, 8) : [],
    blockers: options.blockers || failedConditions,
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

function higherTimeframeGauge(definition, item) {
  const htf = item.diagnostics?.higherTimeframe;
  if (!htf) return unavailable(definition, item, 'Higher-timeframe context is unavailable for this scanner result.');
  const biasDirection = direction(htf.bias);
  const status = htf.countertrend ? 'CONFLICTING' : htf.aligned ? 'CONFIRMED' : 'VALIDATING';
  return stageGauge(definition, {
    score: htf.score,
    confidence: htf.score,
    direction: htf.bias,
    passed: htf.aligned,
    status: htf.countertrend ? 'REJECTED' : htf.aligned ? 'PASSED' : 'VALIDATING',
    failedConditions: htf.penalties || [],
  }, item, {
    status,
    timeframe: htf.timeframe || item.contextTimeframe,
    summary: `${htf.bias || 'NEUTRAL'} higher-timeframe bias · ${htf.structure || 'NEUTRAL'} structure.`,
    confirmationReasons: htf.evidence || [],
    penalties: htf.penalties || [],
    metadata: htf,
  });
}

function regimeGauge(definition, item) {
  const htf = item.diagnostics?.higherTimeframe;
  const regime = item.diagnostics?.marketRegime || htf?.marketRegime;
  if (!regime) return unavailable(definition, item, 'Market regime is unavailable for this scanner result.');
  const unsafe = ['ILLIQUID_OR_UNSAFE'].includes(regime);
  const score = unsafe ? 0 : clamp(htf?.score ?? 50);
  return stageGauge(definition, {
    score,
    confidence: score,
    direction: htf?.bias || 'NEUTRAL',
    passed: !unsafe,
    status: unsafe ? 'REJECTED' : 'PASSED',
    failedConditions: unsafe ? ['UNSAFE_MARKET_REGIME'] : [],
  }, item, {
    status: unsafe ? 'BLOCKED' : 'CONFIRMED',
    summary: `Current regime: ${String(regime).replaceAll('_', ' ')}.`,
    metadata: { regime, atrPercent: htf?.atrPercent ?? null, realizedVolatilityPercent: htf?.realizedVolatilityPercent ?? null },
  });
}

function relativeVolumeGauge(definition, item) {
  const quality = item.diagnostics?.dataQuality;
  const rvol = Number(quality?.relativeVolume);
  if (!Number.isFinite(rvol)) return unavailable(definition, item, 'Relative volume could not be calculated from completed candles.');
  const score = clamp(rvol * 50);
  const supports = rvol >= 1;
  return stageGauge({ ...definition, scored: true }, {
    score,
    confidence: Math.min(100, Math.round(Math.abs(rvol - 1) * 50 + 50)),
    direction: supports ? item.direction : 'NEUTRAL',
    passed: supports,
    status: supports ? 'PASSED' : 'VALIDATING',
    failedConditions: supports ? [] : ['RELATIVE_VOLUME_BELOW_BASELINE'],
  }, item, {
    status: supports ? 'CONFIRMED' : 'DEVELOPING',
    summary: `Relative volume is ${rvol.toFixed(2)}× the recent completed-candle baseline.`,
    metadata: { relativeVolume: rvol, method: quality.relativeVolumeMethod || null },
  });
}

function dataQualityGauge(definition, item) {
  const quality = item.diagnostics?.dataQuality;
  if (!quality) return unavailable(definition, item, item.diagnostics?.marketDataError || 'Market-data quality details are unavailable.');
  const score = clamp(quality.score);
  const accepted = quality.accepted === true;
  return stageGauge(definition, {
    score,
    confidence: score,
    direction: 'NEUTRAL',
    passed: accepted,
    status: accepted ? 'PASSED' : 'REJECTED',
    failedConditions: accepted ? [] : ['MARKET_DATA_REJECTED'],
  }, item, {
    status: accepted ? 'CONFIRMED' : 'BLOCKED',
    summary: `${quality.source || 'Unknown source'} · ${quality.dataDelaySeconds ?? '—'}s delay · ${quality.completedBars ?? 0} completed bars.`,
    metadata: { ...quality, absorptionMode: item.dataMode || 'INSUFFICIENT_DATA' },
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

  const gauges = [
    higherTimeframeGauge(byId['higher-timeframe-bias'], item),
    regimeGauge(byId['market-regime'], item),
    relativeVolumeGauge(byId['relative-volume'], item),
    stageGauge(byId['liquidity-sweep'], { ...stopRun, score: liquidityScore }, item, { summary: item.diagnostics?.liquiditySweepReason || stopRun?.classification || 'Liquidity sweep evaluation.' }),
    stageGauge(byId['stop-run'], stopRun, item),
    stageGauge(byId['smart-money'], { score: smartMoneyScore, direction: item.direction, passed: smartMoneyScore != null && smartMoneyScore > 0, status: smartMoneyScore != null ? 'PASSED' : 'BLOCKED' }, item, { summary: item.diagnostics?.smartMoneyReason || 'Smart Money confluence evaluation.', metadata: item.diagnostics?.smartMoneyContext || {} }),
    unavailable(byId['smt-divergence'], item, 'SMT Divergence engine has not been implemented yet.'),
    stageGauge(byId.absorption, absorption, item, { summary: `${absorption?.classification || 'Absorption unavailable'} · ${dataMode}` }),
    stageGauge(byId['market-imbalance'], imbalance, item),
    stageGauge(byId['market-structure'], structure, item),
    stageGauge(byId['risk-quality'], risk, item),
    stageGauge(byId['setup-confidence'], { score: item.pipelineScore, direction: item.direction, passed: item.pipelinePassed, status: item.pipelinePassed ? 'PASSED' : 'REJECTED', failedConditions: item.failedStage ? [item.reason || `${item.failedStage}_FAILED`] : [] }, item, { status: item.pipelinePassed ? 'CONFIRMED' : 'WAITING_FOR_CONFIRMATION', summary: item.pipelinePassed ? 'All Institutional Flow stages passed in observation mode.' : `Waiting on ${item.failedStage || 'required conditions'}.` }),
    dataQualityGauge(byId['data-quality'], item),
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
