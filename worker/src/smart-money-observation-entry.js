import tradingModeWorker, { AlertCoordinator as TradingAlertCoordinator } from './trading-mode-entry.js';
import { AUTO_SCANNER_SYMBOLS, activeTradingWindow } from './auto-scanner.js';
import { enhanceSmartMoneyDashboard } from './smart-money/dashboard-overlay.js';
import { runSmartMoneyObservation } from './smart-money/observation-service.js';
import { buildActivePositionIntelligence } from './trading-intelligence/active-position.js';
import { buildPortfolioRiskIntelligence } from './trading-intelligence/portfolio-risk.js';
import { buildProductionPortfolioRisk, liveWebullEnvironment } from './trading-intelligence/production-portfolio-risk.js';
import { enhancePortfolioRiskDashboard } from './trading-intelligence/portfolio-risk-overlay.js';
import { buildTradingCommandCenter } from './trading-intelligence/conflict-activity.js';
import { enhanceConflictActivityDashboard } from './trading-intelligence/conflict-activity-overlay.js';
import { getWebullAccountSnapshot } from './webull-client.js';
import { getWebullLiveOpenOrders } from './webull-live-client.js';

const OBSERVATION_STATUS_KEY = 'smart-money-observation:v1';
const OBSERVATION_HISTORY_KEY = 'smart-money-observation-history:v1';
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const ACTIVE_POSITION_PATH = '/api/trading-intelligence/active-position';
const PORTFOLIO_RISK_PATH = '/api/trading-intelligence/portfolio-risk';
const COMMAND_CENTER_PATH = '/api/trading-intelligence/command-center';

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

  async portfolioRiskIntelligence() {
    const [trades, reservations, lifecycleReport, control] = await Promise.all([
      this.listAllTrades(),
      this.listOrderReservations({ limit: 500 }),
      this.latestLifecycleReport(),
      this.getLiveControlState(),
    ]);

    const liveActive = control.liveTradingEnabled === true && control.killSwitch === false;
    if (liveActive) {
      const accountId = String(this.env.WEBULL_LIVE_ACCOUNT_ID || '').trim();
      let accountSnapshot = null;
      let openOrders = null;
      let accountError = null;
      if (!accountId) {
        accountError = 'WEBULL_LIVE_ACCOUNT_ID_MISSING';
      } else {
        const liveEnv = liveWebullEnvironment(this.env);
        const results = await Promise.allSettled([
          getWebullAccountSnapshot(accountId, liveEnv),
          getWebullLiveOpenOrders(accountId, { pageSize: 100 }, liveEnv),
        ]);
        if (results[0].status === 'fulfilled') accountSnapshot = results[0].value;
        else accountError = results[0].reason instanceof Error ? results[0].reason.message : 'Webull production account snapshot failed';
        if (results[1].status === 'fulfilled') openOrders = results[1].value;
        else accountError = [accountError, results[1].reason instanceof Error ? results[1].reason.message : 'Webull production open-order read failed'].filter(Boolean).join(' | ');
      }
      return buildProductionPortfolioRisk({
        trades,
        reservations,
        lifecycleReport,
        accountSnapshot,
        openOrders,
        accountError,
        control,
        env: this.env,
        now: Date.now(),
      });
    }

    let accountSnapshot = null;
    let accountError = null;
    const accountId = String(this.env.WEBULL_ACCOUNT_ID || '').trim();
    if (accountId) {
      try {
        accountSnapshot = await getWebullAccountSnapshot(accountId, this.env);
      } catch (error) {
        accountError = error instanceof Error ? error.message : 'Webull sandbox account snapshot failed';
      }
    } else {
      accountError = 'WEBULL_ACCOUNT_ID_MISSING';
    }
    return buildPortfolioRiskIntelligence({
      trades,
      reservations,
      lifecycleReport,
      accountSnapshot,
      accountError,
      env: this.env,
      now: Date.now(),
    });
  }

  async tradingCommandCenter(selectedSymbol = '') {
    const [observationStatus, portfolioRisk, activePosition] = await Promise.all([
      this.smartMoneyObservationStatus(),
      this.portfolioRiskIntelligence(),
      this.activePositionIntelligence(),
    ]);
    return buildTradingCommandCenter({
      observationStatus,
      selectedSymbol,
      portfolioRisk,
      activePosition,
    });
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
    const url = new URL(request.url);
    const path = url.pathname;
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
    if (path === PORTFOLIO_RISK_PATH) {
      const control = await coordinator(env).getLiveControlState();
      const liveActive = control.liveTradingEnabled === true && control.killSwitch === false;
      if (liveActive) {
        if (request.method !== 'POST') return secureJson({ ok: false, pinRequired: true, error: 'PIN required for Production portfolio data.' }, 401);
        let payload;
        try { payload = await request.json(); } catch { return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400); }
        try { await coordinator(env).verifyLiveControlPin(payload.pin); }
        catch (error) { return secureJson({ ok: false, error: error instanceof Error ? error.message : 'PIN verification failed' }, 403); }
      } else if (request.method !== 'GET') {
        return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      }
      try {
        const portfolioRisk = await coordinator(env).portfolioRiskIntelligence();
        return secureJson({ ok: true, portfolioRisk, storage: 'DURABLE_OBJECT' });
      } catch (error) {
        return secureJson({
          ok: false,
          error: error instanceof Error ? error.message : 'Portfolio risk intelligence failed',
          portfolioRisk: buildPortfolioRiskIntelligence(),
        }, 500);
      }
    }
    if (path === COMMAND_CENTER_PATH) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const commandCenter = await coordinator(env).tradingCommandCenter(url.searchParams.get('symbol') || '');
        return secureJson({ ok: true, commandCenter, storage: 'DURABLE_OBJECT' });
      } catch (error) {
        return secureJson({
          ok: false,
          error: error instanceof Error ? error.message : 'Trading command center failed',
          commandCenter: buildTradingCommandCenter(),
        }, 500);
      }
    }
    const response = await tradingModeWorker.fetch(request, env, ctx);
    if (!DASHBOARD_PATHS.has(path)) return response;
    const smartMoneyDashboard = await enhanceSmartMoneyDashboard(response);
    const portfolioRiskDashboard = await enhancePortfolioRiskDashboard(smartMoneyDashboard);
    return enhanceConflictActivityDashboard(portfolioRiskDashboard);
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