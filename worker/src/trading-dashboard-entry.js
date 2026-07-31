import tradingWorker, { AlertCoordinator as TradingAlertCoordinator } from './trading-mode-entry.js';
import {
  LIVE_SCANNER_API_PATH,
  LIVE_SCANNER_STORAGE_KEY,
  enhanceLiveScannerDashboard,
  mergeLiveScannerSelection,
} from './dashboard/live-scanner.js';

function integer(value, fallback, minimum, maximum) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function liveScannerOptions(env = {}) {
  return {
    topN: integer(env.MOE_DASHBOARD_LIVE_SCANNER_TOP_N, 10, 1, 50),
    ttlMs: integer(env.MOE_DASHBOARD_LIVE_SCANNER_TTL_SECONDS, 900, 10, 86_400) * 1_000,
    minimumScore: integer(env.MOE_DASHBOARD_LIVE_SCANNER_MIN_SCORE, 0, 0, 100),
    minimumConfidence: integer(env.MOE_DASHBOARD_LIVE_SCANNER_MIN_CONFIDENCE, 0, 0, 100),
  };
}

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
    },
  });
}

export class AlertCoordinator extends TradingAlertCoordinator {
  async recordOpportunitySelection(selection = {}) {
    const previous = await this.ctx.storage.get(LIVE_SCANNER_STORAGE_KEY);
    const snapshot = mergeLiveScannerSelection(previous, selection, {
      ...liveScannerOptions(this.env),
      now: Date.now(),
    });
    await this.ctx.storage.put(LIVE_SCANNER_STORAGE_KEY, snapshot);
    return snapshot;
  }

  async liveScannerSnapshot() {
    const previous = await this.ctx.storage.get(LIVE_SCANNER_STORAGE_KEY);
    return mergeLiveScannerSelection(previous, null, {
      ...liveScannerOptions(this.env),
      now: Date.now(),
    });
  }

  async recordBotStatus(record = {}) {
    const normalized = await super.recordBotStatus(record);
    try {
      await this.recordOpportunitySelection(record?.opportunitySelection ?? record);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'DASHBOARD_LIVE_SCANNER_PERSIST_FAILED',
        error: error instanceof Error ? error.message : 'Unknown live scanner persistence error',
        createdAt: new Date().toISOString(),
      }));
    }
    return normalized;
  }
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === LIVE_SCANNER_API_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const liveScanner = await coordinator(env).liveScannerSnapshot();
        return json({
          ok: true,
          liveScanner,
          storage: 'DURABLE_OBJECT',
          observationOnly: true,
          executionEnabled: false,
          executionAllowed: false,
        });
      } catch (error) {
        return json({
          ok: false,
          error: error instanceof Error ? error.message : 'Dashboard Live Scanner failed',
        }, 500);
      }
    }
    const response = await tradingWorker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(pathname) ? enhanceLiveScannerDashboard(response) : response;
  },
  scheduled(controller, env, ctx) {
    return tradingWorker.scheduled(controller, env, ctx);
  },
};
