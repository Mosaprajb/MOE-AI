import { eventBus } from './event-bus.js';
import { featureStore } from './feature-store.js';
import { contextEngine } from './context-engine.js';
import { decisionPipeline } from './decision-pipeline.js';
import { generateLearningReport } from '../learning-service.js';
import { evaluateTimeframeAlignment } from '../intelligence/multi-timeframe-engine.js';
import { buildAdaptiveLevels } from '../intelligence/adaptive-risk-engine.js';
import { scoreOpportunity } from '../intelligence/confidence-engine.js';
import { opportunityEngine } from '../intelligence/opportunity-engine.js';
import { analyzeLiquidity } from '../intelligence/liquidity-engine.js';
import { buildSmartZone } from '../intelligence/smart-zone-engine.js';

let initialized = false;
let stagesRegistered = false;

function finiteNumber(...values) {
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}

function registerDecisionStages() {
  if (stagesRegistered) return;

  decisionPipeline.use('multi-timeframe-alignment', async (state) => {
    const alignment = evaluateTimeframeAlignment({
      timeframe: state.signal.timeframe || state.context.timeframe,
      localTrend: state.context.marketTrend || state.context.localTrend,
      higherTimeframeTrend: state.context.higherTimeframeTrend,
    });

    return {
      ...state,
      context: {
        ...state.context,
        htfAligned: alignment.aligned,
        higherTimeframe: alignment.higherTimeframe,
        higherTimeframeDirection: alignment.direction,
        timeframeAlignment: alignment,
      },
    };
  });

  decisionPipeline.use('liquidity-analysis', async (state) => {
    const features = state.context.features || {};
    const liquidity = analyzeLiquidity({
      candles: features.candles,
      high: features.high,
      low: features.low,
      open: features.open,
      close: features.close || state.context.marketPrice,
      previousHigh: features.previousHigh || features.swingHigh,
      previousLow: features.previousLow || features.swingLow,
      volume: features.volume,
      averageVolume: features.averageVolume,
      atr: state.context.atr || features.atr,
      lookback: state.env.MOE_LIQUIDITY_LOOKBACK,
      minimumScore: state.env.MOE_LIQUIDITY_MIN_SCORE,
    });

    return {
      ...state,
      context: {
        ...state.context,
        liquidity,
        liquidityScore: Math.max(liquidity.bullishScore || 0, liquidity.bearishScore || 0),
      },
    };
  });

  decisionPipeline.use('confidence-scoring', async (state) => {
    const confidence = scoreOpportunity(state.context);
    return {
      ...state,
      context: {
        ...state.context,
        signalScore: confidence.score,
        confidenceGrade: confidence.grade,
        confidenceBreakdown: confidence.breakdown,
      },
    };
  });

  decisionPipeline.use('smart-zone-construction', async (state) => {
    const features = state.context.features || {};
    const marketPrice = finiteNumber(state.signal.limitPrice, state.context.marketPrice, features.close);
    const atr = finiteNumber(state.context.atr, features.atr);
    if (marketPrice <= 0 || atr <= 0) return state;

    const zone = buildSmartZone({
      side: state.signal.side,
      marketPrice,
      atr,
      confidence: state.context.signalScore,
      liquidity: state.context.liquidity,
      env: state.env,
      now: finiteNumber(state.signal.timestamp, Date.now()),
    });

    if (!zone.valid) {
      return {
        ...state,
        context: {
          ...state.context,
          smartZone: zone,
          signalExpired: true,
          rejectionReason: zone.invalidReason,
        },
      };
    }

    return {
      ...state,
      signal: {
        ...state.signal,
        limitPrice: zone.entryReference,
        lowerZone: zone.lower,
        upperZone: zone.upper,
        stopLoss: zone.stopLoss,
        takeProfit: zone.takeProfit,
        expiresAt: zone.expiresAt,
      },
      context: {
        ...state.context,
        smartZone: zone,
      },
    };
  });

  decisionPipeline.use('adaptive-risk-fallback', async (state) => {
    if (state.context.smartZone?.valid) return state;

    const entryPrice = finiteNumber(state.signal.limitPrice, state.context.marketPrice);
    const atr = finiteNumber(state.context.atr, state.context.features?.atr);
    if (entryPrice <= 0 || atr <= 0) return state;

    const levels = buildAdaptiveLevels({
      side: state.signal.side,
      entryPrice,
      atr,
      volatilityPercent: state.context.atrPercent || state.context.features?.atrPercent,
      confidence: state.context.signalScore,
      env: state.env,
    });

    return {
      ...state,
      signal: {
        ...state.signal,
        stopLoss: levels.stopLoss,
        takeProfit: levels.takeProfit,
      },
      context: {
        ...state.context,
        adaptiveRisk: levels,
      },
    };
  });

  stagesRegistered = true;
}

export function initializeMoerandRuntime({ storage, env = {} } = {}) {
  registerDecisionStages();
  if (initialized) return { eventBus, featureStore, contextEngine, decisionPipeline, opportunityEngine };

  eventBus.on('trade:closed', async () => {
    if (!storage) return;
    await generateLearningReport(storage, env);
    await eventBus.emit('learning:report-generated', { timestamp: Date.now() });
  });

  initialized = true;
  return { eventBus, featureStore, contextEngine, decisionPipeline, opportunityEngine };
}

export async function evaluateSignalWithCore({ signal, features, context = {}, env = {} }) {
  registerDecisionStages();

  const snapshot = featureStore.set({
    symbol: signal.symbol,
    timeframe: signal.timeframe || context.timeframe || 'UNKNOWN',
    timestamp: signal.timestamp || Date.now(),
    values: features || {},
  });

  const tradingContext = contextEngine.build(snapshot, context);
  await eventBus.emit('features:ready', snapshot);
  await eventBus.emit('context:ready', tradingContext);

  const decision = await decisionPipeline.run(signal, tradingContext, env);
  const evaluation = decision.tradePlan?.evaluation;
  const smartZone = decision.context?.smartZone;

  if (!evaluation?.accepted || (smartZone && !smartZone.valid)) {
    return { ...decision, opportunity: null };
  }

  const opportunity = opportunityEngine.evaluate({
    symbol: signal.symbol,
    direction: String(signal.side || '').toUpperCase() === 'SELL' ? 'short' : 'long',
    timeframe: signal.timeframe || tradingContext.timeframe,
    confidence: evaluation.score,
    entryPrice: finiteNumber(decision.signal.limitPrice, tradingContext.marketPrice),
    lowerZone: finiteNumber(decision.signal.lowerZone),
    upperZone: finiteNumber(decision.signal.upperZone),
    stopLoss: finiteNumber(decision.signal.stopLoss),
    takeProfit: finiteNumber(decision.signal.takeProfit),
    riskReward: finiteNumber(smartZone?.riskReward),
    liquidity: decision.context?.liquidity,
    zoneAnchor: smartZone?.anchor,
    createdAt: signal.timestamp || Date.now(),
    expiresAt: decision.signal.expiresAt || signal.expiresAt,
    minimumImprovement: finiteNumber(env.MOE_OPPORTUNITY_MIN_IMPROVEMENT, 3),
  });

  if (opportunity.accepted) {
    await eventBus.emit(opportunity.replaced ? 'opportunity:replaced' : 'opportunity:created', opportunity);
  } else {
    await eventBus.emit('opportunity:rejected', opportunity);
  }

  return { ...decision, opportunity };
}

export async function notifyTradeOpened(trade) {
  await eventBus.emit('trade:opened', { ...trade, timestamp: trade?.timestamp || Date.now() });
}

export async function notifyTradeClosed(trade) {
  opportunityEngine.remove(trade?.symbol);
  await eventBus.emit('trade:closed', { ...trade, timestamp: trade?.timestamp || Date.now() });
}
