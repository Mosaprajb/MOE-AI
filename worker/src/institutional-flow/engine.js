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
      smartMoneyReason: smartMoneyResult.reason || null,
      smartMoneyScore: smartMoneyResult.setupScore || 0,
    },
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
