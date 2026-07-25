import { eventBus } from './event-bus.js';
import { featureStore } from './feature-store.js';
import { contextEngine } from './context-engine.js';
import { decisionPipeline } from './decision-pipeline.js';
import { generateLearningReport } from '../learning-service.js';

let initialized = false;

export function initializeMoerandRuntime({ storage, env = {} } = {}) {
  if (initialized) return { eventBus, featureStore, contextEngine, decisionPipeline };

  eventBus.on('trade:closed', async () => {
    if (!storage) return;
    await generateLearningReport(storage, env);
    await eventBus.emit('learning:report-generated', { timestamp: Date.now() });
  });

  initialized = true;
  return { eventBus, featureStore, contextEngine, decisionPipeline };
}

export async function evaluateSignalWithCore({ signal, features, context = {}, env = {} }) {
  const snapshot = featureStore.set({
    symbol: signal.symbol,
    timeframe: signal.timeframe || context.timeframe || 'UNKNOWN',
    timestamp: signal.timestamp || Date.now(),
    values: features || {},
  });

  const tradingContext = contextEngine.build(snapshot, context);
  await eventBus.emit('features:ready', snapshot);
  await eventBus.emit('context:ready', tradingContext);

  return decisionPipeline.run(signal, tradingContext, env);
}

export async function notifyTradeOpened(trade) {
  await eventBus.emit('trade:opened', { ...trade, timestamp: trade?.timestamp || Date.now() });
}

export async function notifyTradeClosed(trade) {
  await eventBus.emit('trade:closed', { ...trade, timestamp: trade?.timestamp || Date.now() });
}
