import tradingWorker, { AlertCoordinator as TradingAlertCoordinator } from './trading-mode-entry.js';
import {
  LIVE_SCANNER_API_PATH,
  LIVE_SCANNER_STORAGE_KEY,
  enhanceLiveScannerDashboard,
  mergeLiveScannerSelection,
} from './dashboard/live-scanner.js';
import {
  SANDBOX_AUDIT_PATH,
  SANDBOX_HEALTH_PATH,
  SANDBOX_ORDERS_STATUS_PATH,
  SANDBOX_READINESS_PATH,
  buildSandboxHealth,
  buildSandboxOrdersStatus,
  buildSandboxPilotAudit,
  buildSandboxReadiness,
  recordSandboxPilotEvent,
} from './observability/sandbox-runtime-pilot.js';

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

function pilotObservabilityEnabled(env = {}) {
  return String(env.MOE_RUNTIME_ENVIRONMENT || '').trim().toUpperCase() === 'SANDBOX_PILOT'
    || String(env.MOE_SANDBOX_PILOT_OBSERVABILITY_ENABLED || '').trim().toLowerCase() === 'true';
}

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const PILOT_PATHS = new Set([
  SANDBOX_HEALTH_PATH,
  SANDBOX_READINESS_PATH,
  SANDBOX_AUDIT_PATH,
  SANDBOX_ORDERS_STATUS_PATH,
]);

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function authorized(request, env) {
  return Boolean(String(env.MOE_WEBHOOK_SECRET || '').trim())
    && String(request.headers.get('x-moe-webhook-secret') || '') === String(env.MOE_WEBHOOK_SECRET);
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

  async recordSandboxPilotEvent(record = {}) {
    return recordSandboxPilotEvent(this.ctx.storage, record, {
      limit: integer(this.env.MOE_SANDBOX_PILOT_EVENT_LIMIT, 1_000, 100, 5_000),
    });
  }

  async sandboxPilotHealth() {
    const control = await this.getLiveControlState();
    return buildSandboxHealth(this.env, { control });
  }

  async sandboxPilotReadiness() {
    const control = await this.getLiveControlState();
    return buildSandboxReadiness(this.env, { control, durableObjectAvailable: true });
  }

  async sandboxPilotAudit(options = {}) {
    const control = await this.getLiveControlState();
    return buildSandboxPilotAudit(this.ctx.storage, this.env, { ...options, control });
  }

  async sandboxOrderStatus(options = {}) {
    return buildSandboxOrdersStatus(this.ctx.storage, this.env, options);
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

    if (pilotObservabilityEnabled(this.env)) {
      try {
        const selection = record?.opportunitySelection ?? {};
        const summary = selection?.summary ?? {};
        await this.recordSandboxPilotEvent({
          type: record?.ok === false ? 'SCANNER_CYCLE_FAILED' : 'SCANNER_CYCLE_COMPLETED',
          status: record?.ok === false ? 'FAILED' : 'COMPLETED',
          code: record?.skipped || record?.code || null,
          scanned: record?.scanned,
          accepted: record?.accepted,
          selected: Array.isArray(selection?.selected) ? selection.selected.length : summary.selected,
          expired: summary.expired,
          duplicatesRemoved: summary.duplicatesRemoved,
          executionAttempted: false,
          protectedOrder: false,
          liveFundsUsed: false,
          reason: record?.error || record?.skipped || null,
        });
      } catch (error) {
        console.error(JSON.stringify({
          event: 'SANDBOX_RUNTIME_PILOT_SCANNER_AUDIT_FAILED',
          error: error instanceof Error ? error.message : 'Unknown Sandbox pilot scanner audit error',
          createdAt: new Date().toISOString(),
        }));
      }
    }
    return normalized;
  }
}

async function handlePilotEndpoint(request, env, pathname) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
  if (pathname !== SANDBOX_HEALTH_PATH && !authorized(request, env)) {
    return json({ ok: false, error: 'Unauthorized' }, 401);
  }

  try {
    const stub = coordinator(env);
    if (pathname === SANDBOX_HEALTH_PATH) return json(await stub.sandboxPilotHealth());
    if (pathname === SANDBOX_READINESS_PATH) {
      const readiness = await stub.sandboxPilotReadiness();
      return json(readiness, readiness.ready ? 200 : 503);
    }
    if (pathname === SANDBOX_AUDIT_PATH) return json(await stub.sandboxPilotAudit({ limit: 200 }));
    if (pathname === SANDBOX_ORDERS_STATUS_PATH) return json(await stub.sandboxOrderStatus({ limit: 200 }));
  } catch (error) {
    if (pathname === SANDBOX_HEALTH_PATH) {
      return json({
        ...buildSandboxHealth(env),
        ok: false,
        status: 'DEGRADED',
        durableObjectAvailable: false,
        error: error instanceof Error ? error.message : 'Sandbox health check failed',
      }, 503);
    }
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'Sandbox observability request failed',
    }, 500);
  }
  return json({ ok: false, error: 'Not found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (PILOT_PATHS.has(pathname)) return handlePilotEndpoint(request, env, pathname);
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
