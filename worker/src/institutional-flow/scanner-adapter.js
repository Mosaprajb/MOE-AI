import { evaluateInstitutionalFlowPipeline } from './engine.js';
import { INSTITUTIONAL_FLOW_STAGE_ORDER } from './config.js';

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function normalizedSymbols(symbols = [], limit = 25) {
  const maximum = Math.max(1, Math.min(100, Number(limit) || 25));
  return [...new Set(symbols.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean))].slice(0, maximum);
}

function compactStage(stage, name) {
  if (!stage) return {
    name,
    passed: false,
    status: 'NOT_EVALUATED',
    score: 0,
    classification: null,
    failedConditions: ['STAGE_RESULT_MISSING'],
  };
  return {
    name,
    passed: stage.passed === true,
    status: stage.status || (stage.passed ? 'PASSED' : 'REJECTED'),
    score: Number(stage.score || 0),
    classification: stage.classification || stage.type || stage.category || null,
    failedConditions: Array.isArray(stage.failedConditions) ? stage.failedConditions.slice(0, 8) : [],
  };
}

function reachedStage(result) {
  if (result.pipelinePassed) return 'RISK_ENGINE';
  const failedIndex = INSTITUTIONAL_FLOW_STAGE_ORDER.indexOf(result.failedStage);
  if (failedIndex <= 0) return 'STOP_RUN';
  return INSTITUTIONAL_FLOW_STAGE_ORDER[failedIndex - 1];
}

function compactObservation(result) {
  const candidate = result.candidate || null;
  const stages = Object.fromEntries(INSTITUTIONAL_FLOW_STAGE_ORDER.map((name) => [name, compactStage(result.stages?.[name], name)]));
  return freeze({
    symbol: result.symbol,
    pipelinePassed: result.pipelinePassed === true,
    pipelineScore: Number(result.pipelineScore || 0),
    currentStage: reachedStage(result),
    failedStage: result.failedStage || null,
    reason: result.reason || null,
    direction: result.direction || null,
    dataMode: result.dataMode || 'INSUFFICIENT_DATA',
    candidate,
    stages,
    stageOrder: INSTITUTIONAL_FLOW_STAGE_ORDER,
    tradeDecision: 'NO_TRADE',
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}

export async function evaluateInstitutionalFlowScannerBatch({
  symbols = [],
  marketDataBySymbol = {},
  timeframe = '5m',
  now = Date.now(),
  limit = 25,
  evaluator = evaluateInstitutionalFlowPipeline,
  accountEquity = null,
  maximumRiskPercent = 0.5,
  maximumNotionalPercent = 10,
} = {}) {
  const uniqueSymbols = normalizedSymbols(symbols, limit);
  const observations = [];
  const rejected = [];

  for (const symbol of uniqueSymbols) {
    const payload = marketDataBySymbol[symbol];
    if (!payload?.bars?.length) {
      rejected.push({ symbol, reason: 'SCANNER_MARKET_DATA_MISSING' });
      continue;
    }
    try {
      const result = await evaluator({
        symbol,
        bars: payload.bars,
        timeframe: payload.timeframe || timeframe,
        now,
        source: payload.source || 'INSTITUTIONAL_FLOW_SCANNER_OBSERVATION',
        bid: payload.bid ?? null,
        ask: payload.ask ?? null,
        tickSize: payload.tickSize ?? null,
        orderFlow: payload.orderFlow ?? null,
        accountEquity,
        maximumRiskPercent,
        maximumNotionalPercent,
      });
      observations.push(compactObservation(result));
    } catch (error) {
      rejected.push({
        symbol,
        reason: 'INSTITUTIONAL_FLOW_ANALYSIS_FAILED',
        error: error instanceof Error ? error.message : 'Unknown institutional-flow scanner error',
      });
    }
  }

  observations.sort((left, right) =>
    Number(right.pipelinePassed) - Number(left.pipelinePassed)
    || Number(right.pipelineScore) - Number(left.pipelineScore)
    || left.symbol.localeCompare(right.symbol));

  const stageDistribution = Object.fromEntries(INSTITUTIONAL_FLOW_STAGE_ORDER.map((name) => [name, 0]));
  let completedCandidates = 0;
  for (const item of observations) {
    if (item.pipelinePassed) completedCandidates += 1;
    else if (item.failedStage && Object.hasOwn(stageDistribution, item.failedStage)) stageDistribution[item.failedStage] += 1;
  }

  return freeze({
    evaluatedAt: Number(now),
    timeframe,
    observations,
    rejected,
    completedCandidates,
    stageDistribution,
    stageOrder: INSTITUTIONAL_FLOW_STAGE_ORDER,
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
