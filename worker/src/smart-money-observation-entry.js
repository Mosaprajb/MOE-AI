import tradingModeWorker, { AlertCoordinator as TradingAlertCoordinator } from './trading-mode-entry.js';
import { AUTO_SCANNER_SYMBOLS, activeTradingWindow } from './auto-scanner.js';
import { runSmartMoneyObservation } from './smart-money/observation-service.js';

const OBSERVATION_STATUS_KEY = 'smart-money-observation:v1';
const OBSERVATION_HISTORY_KEY = 'smart-money-observation-history:v1';

function observationEnabled(env = {}) {
  return String(env.SMART_MONEY_OBSERVATION_ENABLED || '').toLowerCase() === 'true';
}

export class AlertCoordinator extends TradingAlertCoordinator {
  async recordSmartMoneyObservation(record = {}) {
    const normalized = {
      ...record,
      observationOnly: true,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
      recordedAt: new Date().toISOString(),
    };
    const history = await this.ctx.storage.get(OBSERVATION_HISTORY_KEY);
    await this.ctx.storage.put({
      [OBSERVATION_STATUS_KEY]: normalized,
      [OBSERVATION_HISTORY_KEY]: [normalized, ...(Array.isArray(history) ? history : [])].slice(0, 50),
    });
    return normalized;
  }

  async smartMoneyObservationStatus() {
    const latest = await this.ctx.storage.get(OBSERVATION_STATUS_KEY) || null;
    const history = await this.ctx.storage.get(OBSERVATION_HISTORY_KEY) || [];
    return {
      enabled: observationEnabled(this.env),
      latest,
      recentRuns: Array.isArray(history) ? history.slice(0, 10) : [],
      observationOnly: true,
      mode: 'PAPER_TRADING',
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
    };
  }

  async scannerStatus() {
    const [scanner, smartMoneyObservation] = await Promise.all([
      super.scannerStatus(),
      this.smartMoneyObservationStatus(),
    ]);
    return { ...scanner, smartMoneyObservation };
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

async function runObservationSidecar(controller, env) {
  const scheduledTime = Number(controller?.scheduledTime) || Date.now();
  const window = activeTradingWindow(new Date(scheduledTime), env);
  let result;
  try {
    result = await runSmartMoneyObservation({
      env,
      scheduledTime,
      window,
      universe: AUTO_SCANNER_SYMBOLS,
    });
  } catch (error) {
    result = {
      ok: false,
      error: error instanceof Error ? error.message : 'Smart Money observation failed',
      evaluatedAt: new Date(scheduledTime).toISOString(),
      session: window.label || 'UNKNOWN',
      topOpportunities: [],
      observationOnly: true,
      mode: 'PAPER_TRADING',
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
    };
  }
  const stored = await coordinator(env).recordSmartMoneyObservation(result);
  console.log(JSON.stringify({ event: 'SMART_MONEY_OBSERVATION_RESULT', ...stored }));
  return stored;
}

export default {
  fetch(request, env, ctx) {
    return tradingModeWorker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    const observationTask = runObservationSidecar(controller, env).catch((error) => {
      console.error(JSON.stringify({
        event: 'SMART_MONEY_OBSERVATION_PERSIST_FAILED',
        error: error instanceof Error ? error.message : 'Unknown Smart Money observation error',
        createdAt: new Date().toISOString(),
      }));
      return null;
    });
    if (ctx?.waitUntil) ctx.waitUntil(observationTask);
    return tradingModeWorker.scheduled(controller, env, ctx);
  },
};
