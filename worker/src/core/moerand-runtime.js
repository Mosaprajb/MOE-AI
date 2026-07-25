import { eventBus } from './event-bus.js';
import { featureStore } from './feature-store.js';
import { contextEngine } from './context-engine.js';
import { decisionPipeline } from './decision-pipeline.js';
import { generateLearningReport } from '../learning-service.js';
import { evaluateTimeframeAlignment } from '../intelligence/multi-timeframe-engine.js';
import { buildAdaptiveLevels } from '../intelligence/adaptive-risk-engine.js';
import { scoreOpportunity } from '../intelligence/confidence-engine.js';
import { opportunityEngine } from '../intelligence/opportunity-engine.js';

let initialized = false;
let stagesRegistered = false;

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

  decisionPipeline.use('adaptive-risk-levels', async (state) => {
    const entryPrice = Number(state.signal.limitPrice || state.context.marketPrice);
    const atr = Number(state.context.atr || state.context.features?.atr);
    if (!Number.isFinite(entryPrice) || !Number.isFinite(atr) || entryPrice <= 0 || atr <= 0) return state;

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

  if (!evaluation?.accepted) return { ...decision, opportunity: null };

  const opportunity = opportunityEngine.evaluate({
    symbol: signal.symbol,
    direction: String(signal.side || '').toUpperCase() === 'SELL' ? 'short' : 'long',
    timeframe: signal.timeframe || tradingContext.timeframe,
    confidence: evaluation.score,
    entryPrice: Number(decision.signal.limitPrice || tradingContext.marketPrice),
    stopLoss: Number(decision.signal.stopLoss),
    takeProfit: Number(decision.signal.takeProfit),
    createdAt: signal.timestamp || Date.now(),
    expiresAt: signal.expiresAt,
  });

  await eventBus.emit(opportunity.replaced ? 'opportunity:replaced' : 'opportunity:evaluated', opportunity);
  return { ...decision, opportunity };
}

export async function notifyTradeOpened(trade) {
  await eventBus.emit('trade:opened', { ...trade, timestamp: trade?.timestamp || Date.now() });
}

export async function notifyTradeClosed(trade) {
  opportunityEngine.remove(trade?.symbol);
  await eventBus.emit('trade:closed', { ...trade, timestamp: trade?.timestamp || Date.now() });
}
