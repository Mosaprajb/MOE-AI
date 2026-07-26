import { createLiquiditySweepConfig } from '../liquidity-sweep/config.js';
import { evaluateLiquiditySweepEngine } from '../liquidity-sweep/engine.js';
import { normalizeMarketData } from '../liquidity-sweep/normalization.js';
import { evaluateSmartMoneyFoundation } from '../smart-money/engine.js';
import { createInstitutionalFlowConfig, INSTITUTIONAL_FLOW_STAGE_ORDER } from './config.js';
import { evaluateStopRunStage } from './stop-run.js';
import { evaluateAbsorptionStage } from './absorption.js';
import { evaluateImbalanceStage } from './imbalance.js';
import { evaluateStructureConfirmationStage } from './structure-confirmation.js';
import { evaluateInstitutionalRiskStage } from './risk-engine.js';

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstFailed(stages) {
  return INSTITUTIONAL_FLOW_STAGE_ORDER.find((name) => stages[name]?.passed !== true) || null;
}

function overallScore(stages) {
  const weighted = [
    ['STOP_RUN', 0.2],
    ['ABSORPTION', 0.2],
    ['IMBALANCE', 0.2],
    ['STRUCTURE_CONFIRMATION', 0.2],
    ['RISK_ENGINE', 0.2],
  ];
  return Math.round(weighted.reduce((sum, [name, weight]) => sum + Number(stages[name]?.score || stages[name]?.rewardRisk * 20 || 0) * weight, 0));
}

function compactHigherTimeframe(value) {
  if (!value) return null;
  return freeze({
    timeframe: value.timeframe || null,
    direction: value.direction || null,
    bias: value.bias || 'NEUTRAL',
    aligned: value.aligned === true,
    countertrend: value.countertrend === true,
    structure: value.structure || 'NEUTRAL',
    marketRegime: value.marketRegime || null,
    score: finite(value.score),
    rangeLocation: finite(value.rangeLocation),
    atrPercent: finite(value.atrPercent),
    realizedVolatilityPercent: finite(value.realizedVolatilityPercent),
    evidence: Array.isArray(value.evidence) ? value.evidence.slice(0, 10) : [],
    penalties: Array.isArray(value.penalties) ? value.penalties.slice(0, 10) : [],
  });
}

function compactDataQuality(snapshot) {
  const rvol = snapshot.relativeVolumeDetails || null;
  return freeze({
    accepted: snapshot.quality?.accepted === true,
    score: finite(snapshot.quality?.score),
    source: snapshot.source || null,
    session: snapshot.session || null,
    normalizedAt: snapshot.normalizedAt || null,
    dataDelaySeconds: finite(snapshot.quality?.dataDelaySeconds),
    missingBars: finite(snapshot.quality?.missingBars, 0),
    zeroVolumeBars: finite(snapshot.quality?.zeroVolumeBars, 0),
    excludedIncompleteBars: finite(snapshot.quality?.excludedIncompleteBars, 0),
    completedBars: finite(snapshot.quality?.completedBars, 0),
    spreadPercent: finite(snapshot.spread?.spreadPercent),
    relativeVolume: finite(snapshot.relativeVolume),
    relativeVolumeMethod: snapshot.relativeVolumeMethod || null,
    relativeVolumeDetails: rvol ? {
      value: finite(rvol.value),
      available: rvol.available === true,
      fallbackUsed: rvol.fallbackUsed === true,
      fallbackReason: rvol.fallbackReason || null,
      latestVolume: finite(rvol.latestVolume),
      baselineVolume: finite(rvol.baselineVolume),
      sampleCount: finite(rvol.sampleCount, 0),
      requiredSamples: finite(rvol.requiredSamples, 0),
      maximumSessions: finite(rvol.maximumSessions, 0),
      session: rvol.session || null,
      slotMinutes: finite(rvol.slotMinutes),
      dateKey: rvol.dateKey || null,
      baselineDates: Array.isArray(rvol.baselineDates) ? rvol.baselineDates.slice(0, 30) : [],
      fallbackLookbackBars: finite(rvol.fallbackLookbackBars),
    } : null,
  });
}

export async function evaluateInstitutionalFlowPipeline({
  symbol,
  bars,
  timeframe = '5m',
  contextSnapshot = null,
  now = Date.now(),
  source = 'ALPACA_IEX',
  bid = null,
  ask = null,
  tickSize = null,
  orderFlow = null,
  accountEquity = null,
  maximumRiskPercent = 0.5,
  maximumNotionalPercent = 10,
  institutionalConfig = null,
  liquidityConfig = null,
  smartMoneyConfig = null,
  eventRisk = {},
} = {}) {
  const normalizedSymbol = text(symbol).toUpperCase();
  if (!normalizedSymbol) throw new Error('symbol is required');
  const config = institutionalConfig || createInstitutionalFlowConfig();
  const marketConfig = liquidityConfig || createLiquiditySweepConfig();

  let snapshot;
  try {
    snapshot = normalizeMarketData({ bars, timeframe, now, source, bid, ask, tickSize, config: marketConfig });
  } catch (error) {
    return freeze({
      tradeDecision: 'NO_TRADE',
      reason: 'INSTITUTIONAL_FLOW_MARKET_DATA_REJECTED',
      symbol: normalizedSymbol,
      evaluatedAt: new Date(Number(now)).toISOString(),
      stageOrder: INSTITUTIONAL_FLOW_STAGE_ORDER,
      failedStage: 'STOP_RUN',
      error: error instanceof Error ? error.message : 'Unknown market-data error',
      stages: {},
      diagnostics: {
        dataQuality: null,
        marketDataError: error instanceof Error ? error.message : 'Unknown market-data error',
      },
      observationOnly: true,
      mode: 'PAPER_TRADING',
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
    });
  }

  const [liquiditySweepResult, smartMoneyResult] = await Promise.all([
    evaluateLiquiditySweepEngine({
      symbol: normalizedSymbol,
      bars,
      timeframe,
      contextSnapshot,
      now,
      source,
      bid,
      ask,
      tickSize,
      config: marketConfig,
      eventRisk,
    }),
    evaluateSmartMoneyFoundation({
      symbol: normalizedSymbol,
      bars,
      timeframe,
      now,
      source,
      bid,
      ask,
      tickSize,
      accountEquity,
      maximumRiskPercent,
      maximumNotionalPercent,
      smartMoneyConfig,
      marketDataConfig: marketConfig,
    }),
  ]);

  const stopRun = evaluateStopRunStage({ liquiditySweepResult, config });
  const absorption = evaluateAbsorptionStage({ stopRun, snapshot, orderFlow, config });
  const imbalance = evaluateImbalanceStage({ absorption, smartMoneyResult, orderFlow, config });
  const structureConfirmation = evaluateStructureConfirmationStage({ imbalance, smartMoneyResult, config });
  const riskEngine = evaluateInstitutionalRiskStage({ structureConfirmation, smartMoneyResult, snapshot, config });
  const stages = freeze({
    STOP_RUN: stopRun,
    ABSORPTION: absorption,
    IMBALANCE: imbalance,
    STRUCTURE_CONFIRMATION: structureConfirmation,
    RISK_ENGINE: riskEngine,
  });
  const failedStage = firstFailed(stages);
  const pipelinePassed = failedStage == null;
  const smartDetails = smartMoneyResult?.details || {};
  const higherTimeframe = compactHigherTimeframe(liquiditySweepResult?.higherTimeframe || null);
  const dataQuality = compactDataQuality(snapshot);

  return freeze({
    eventType: 'INSTITUTIONAL_FLOW_SETUP',
    strategyVersion: config.strategy.version,
    tradeDecision: 'NO_TRADE',
    reason: pipelinePassed ? 'INSTITUTIONAL_FLOW_OBSERVATION_ONLY' : `${failedStage}_STAGE_REJECTED`,
    symbol: normalizedSymbol,
    executionTimeframe: snapshot.timeframe,
    contextTimeframe: marketConfig.timeframes[snapshot.timeframe],
    evaluatedAt: new Date(Number(now)).toISOString(),
    stageOrder: INSTITUTIONAL_FLOW_STAGE_ORDER,
    pipelinePassed,
    failedStage,
    pipelineScore: overallScore(stages),
    direction: stopRun.direction,
    dataMode: absorption.absorptionMode,
    stages,
    candidate: pipelinePassed ? {
      status: 'OBSERVATION_CANDIDATE',
      direction: stopRun.direction,
      stopRunClassification: stopRun.classification,
      absorptionClassification: absorption.classification,
      imbalanceType: imbalance.type,
      structureEvent: structureConfirmation.event,
      entry: riskEngine.entry,
      stopLoss: riskEngine.stop,
      takeProfit: riskEngine.target,
      rewardRisk: riskEngine.rewardRisk,
      observationOnly: true,
      executionAllowed: false,
    } : null,
    diagnostics: {
      liquiditySweepDecision: liquiditySweepResult.tradeDecision,
      liquiditySweepReason: liquiditySweepResult.reason || null,
      liquiditySweepScore: finite(liquiditySweepResult.liquiditySweepScore, finite(stopRun.score, 0)),
      smartMoneyReason: smartMoneyResult.reason || null,
      smartMoneyScore: finite(smartMoneyResult.setupScore, 0),
      higherTimeframe,
      marketRegime: higherTimeframe?.marketRegime || null,
      dataQuality,
      smartMoneyContext: {
        currentBias: smartDetails.structure?.currentBias || null,
        confluenceDirection: smartDetails.confluence?.direction || null,
        confluenceScore: finite(smartDetails.confluence?.totalScore),
      },
    },
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
