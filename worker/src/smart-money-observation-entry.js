import tradingModeWorker, { AlertCoordinator as TradingAlertCoordinator } from './trading-mode-entry.js';
import { AUTO_SCANNER_SYMBOLS, activeTradingWindow } from './auto-scanner.js';
import { enhanceSmartMoneyDashboard } from './smart-money/dashboard-overlay.js';
import { runSmartMoneyObservation } from './smart-money/observation-service.js';
import { buildActivePositionIntelligence } from './trading-intelligence/active-position.js';

const OBSERVATION_STATUS_KEY = 'smart-money-observation:v1';
const OBSERVATION_HISTORY_KEY = 'smart-money-observation-history:v1';
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const ACTIVE_POSITION_PATH = '/api/trading-intelligence/active-position';

function observationEnabled(env = {}) {
  return String(env.SMART_MONEY_OBSERVATION_ENABLED || '').toLowerCase() === 'true';
}

function secureJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
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

  async activePositionIntelligence() {
    const [trades, lifecycleReport] = await Promise.all([
      this.listAllTrades(),
      this.latestLifecycleReport(),
    ]);
    return buildActivePositionIntelligence({ trades, lifecycleReport, now: Date.now() });
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
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === ACTIVE_POSITION_PATH) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const activePosition = await coordinator(env).activePositionIntelligence();
        return secureJson({ ok: true, activePosition, storage: 'DURABLE_OBJECT' });
      } catch (error) {
        return secureJson({
          ok: false,
          error: error instanceof Error ? error.message : 'Active position intelligence failed',
          activePosition: buildActivePositionIntelligence(),
        }, 500);
      }
    }
    const response = await tradingModeWorker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(path) ? enhanceSmartMoneyDashboard(response) : response;
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
