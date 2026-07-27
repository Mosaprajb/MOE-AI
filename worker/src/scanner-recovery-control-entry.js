import worker, { AlertCoordinator as BaseAlertCoordinator } from './scanner-operational-repair-entry.js';

const REPAIR_PATH = '/api/scanner/operational-repair';
const REPAIR_KEY = 'scanner-operational-repair:v2';
const BUILD_ID = 'scanner-recovery-control-v1-20260727';

function enabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function safeSandboxConfigured(env = {}) {
  return String(env.WEBULL_ENVIRONMENT || '').toLowerCase() === 'sandbox'
    && enabled(env.AUTO_SCANNER_ENABLED)
    && enabled(env.WEBULL_AUTOMATION_ARMED)
    && enabled(env.WEBULL_SANDBOX_ENABLED)
    && enabled(env.WEBULL_SANDBOX_ORDER_SUBMISSION)
    && enabled(env.WEBULL_AUTO_SUBMIT_SANDBOX)
    && !enabled(env.WEBULL_LIVE_TRADING)
    && !enabled(env.WEBULL_LIVE_ORDER_SUBMISSION)
    && enabled(env.WEBULL_LIVE_KILL_SWITCH);
}

function suppliedSecret(request) {
  const authorization = request.headers.get('authorization') || '';
  if (authorization.toLowerCase().startsWith('bearer ')) return authorization.slice(7).trim();
  return String(request.headers.get('x-moe-webhook-secret') || '').trim();
}

function authorized(request, env = {}) {
  const expected = String(env.MOE_WEBHOOK_SECRET || '').trim();
  const supplied = suppliedSecret(request);
  return expected.length >= 16 && supplied.length === expected.length && supplied === expected;
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async forceSandboxScannerRepair() {
    if (!safeSandboxConfigured(this.env)) {
      return {
        ok: false,
        repaired: false,
        safeConfigured: false,
        error: 'Recovery rejected because the Worker is not fully locked to Sandbox.',
      };
    }

    await this.ctx.storage.delete(REPAIR_KEY);
    const result = await this.ensureSandboxScannerRuntime();
    const audit = await this.scannerOperationalAudit();

    return {
      ok: result?.safeConfigured === true,
      repaired: result?.repaired === true,
      safeConfigured: result?.safeConfigured === true,
      result,
      audit,
      build: BUILD_ID,
      completedAt: new Date().toISOString(),
    };
  }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    if (url.pathname === REPAIR_PATH) {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      if (!authorized(request, env)) return json({ ok: false, error: 'Unauthorized recovery request' }, 401);

      try {
        const recovery = await coordinator(env).forceSandboxScannerRepair();
        return json(recovery, recovery.ok ? 200 : 409);
      } catch (error) {
        return json({
          ok: false,
          error: error instanceof Error ? error.message : 'Scanner recovery failed',
          build: BUILD_ID,
        }, 500);
      }
    }

    return worker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
