// Final Sandbox entry: adds symbol-source selection without changing strategy, risk, or execution.

import baseWorker, {
  AlertCoordinator as BaseAlertCoordinator,
  SimulationDriver,
} from './sandbox-simulation-rpc-entry.js';
import { AUTO_SCANNER_SYMBOLS } from './auto-scanner.js';
import { enhanceScanModeDashboard } from './dashboard/scan-mode-selector.js';
import {
  handleMobilePasscode,
  isMobileClientRequest,
  isMobileDashboardPath,
  isMobileProtectedApiPath,
  mobileSessionErrorResponse,
  serveMobileDashboard,
} from './dashboard/mobile-dashboard.js';
import { handleAuthenticatedMobileApi } from './dashboard/mobile-dashboard-api.js';
import {
  readHistoricalSimulation,
  readHistoricalSimulationReport,
  startHistoricalSimulation,
  stopHistoricalSimulation,
  tickHistoricalSimulation,
} from './simulation/simulation-engine-v2.js';
import {
  SCAN_SOURCE_MODE_API_PATH,
  SCAN_SOURCE_MODES,
  createScanFilteredFetch,
  listScanSourceModeAudit,
  readScanSourceMode,
  selectedScanSymbols,
  updateScanSourceMode,
} from './scanner/scan-source-mode.js';

export { SimulationDriver };

const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/moe-ai', '/moe-ai/']);

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-scan-mode': '1.0.0',
    },
  });
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function sameOriginControlAllowed(request, env = {}) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  let appOrigin = '';
  try { appOrigin = env.APP_URL ? new URL(env.APP_URL).origin : ''; } catch { appOrigin = ''; }
  return origin === requestOrigin
    || origin === String(env.APP_ORIGIN || '').replace(/\/$/, '')
    || origin === appOrigin
    || origin === 'http://localhost:3000';
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async startHistoricalSimulation(options = {}) {
    return startHistoricalSimulation(this.ctx.storage, this.env, options);
  }

  async tickHistoricalSimulation() {
    return tickHistoricalSimulation(this.ctx.storage, this.env);
  }

  async stopHistoricalSimulation() {
    return stopHistoricalSimulation(this.ctx.storage, this.env);
  }

  async historicalSimulationStatus() {
    return readHistoricalSimulation(this.ctx.storage);
  }

  async historicalSimulationReport() {
    return readHistoricalSimulationReport(this.ctx.storage);
  }

  async scanSourceMode() {
    return readScanSourceMode(this.ctx.storage, { fullUniverseSize: AUTO_SCANNER_SYMBOLS.length });
  }

  async updateScanSourceMode(patch = {}, actor = 'DASHBOARD') {
    return updateScanSourceMode(this.ctx.storage, patch, {
      actor,
      fullUniverseSize: AUTO_SCANNER_SYMBOLS.length,
    });
  }

  async scanSourceModeAudit(options = {}) {
    return listScanSourceModeAudit(this.ctx.storage, options);
  }
}

async function handleScanModeApi(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!sameOriginControlAllowed(request, env)) {
    return json({ ok: false, code: 'ORIGIN_NOT_ALLOWED', error: 'Origin not allowed.' }, 403);
  }
  const stub = coordinator(env);
  if (request.method === 'GET') {
    const [scanMode, recentAudit] = await Promise.all([
      stub.scanSourceMode(),
      stub.scanSourceModeAudit({ limit: 25 }),
    ]);
    return json({
      ok: true,
      scanMode,
      recentAudit,
      storage: 'DURABLE_OBJECT',
      defaultMode: SCAN_SOURCE_MODES.FULL_UNIVERSE,
      symbolSelectionOnly: true,
      riskGatesBypassed: false,
      liveLockBypassed: false,
    });
  }
  if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed.' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Valid JSON is required.' }, 400); }
  try {
    const result = await stub.updateScanSourceMode(body, 'DASHBOARD');
    return json({
      ok: true,
      ...result,
      storage: 'DURABLE_OBJECT',
      symbolSelectionOnly: true,
      riskGatesBypassed: false,
      liveLockBypassed: false,
    });
  } catch (error) {
    return json({
      ok: false,
      code: error?.code || 'SCAN_MODE_UPDATE_FAILED',
      error: error instanceof Error ? error.message : 'Scan mode update failed.',
      invalidSymbols: error?.invalidSymbols || [],
    }, 422);
  }
}

async function runScheduledWithSelectedSymbols(controller, env, ctx) {
  const scanMode = await coordinator(env).scanSourceMode();
  if (scanMode.mode === SCAN_SOURCE_MODES.FULL_UNIVERSE) {
    return baseWorker.scheduled(controller, env, ctx);
  }

  const symbols = selectedScanSymbols(scanMode, AUTO_SCANNER_SYMBOLS);
  if (!symbols.length) {
    console.warn(JSON.stringify({
      event: 'AUTO_SCANNER_SKIPPED_EMPTY_MANUAL_UNIVERSE',
      scanMode: scanMode.mode,
      createdAt: new Date().toISOString(),
    }));
    return baseWorker.scheduled(controller, { ...env, AUTO_SCANNER_ENABLED: 'false' }, ctx);
  }

  // The legacy scanner batches the Full Universe internally. This fetch adapter intersects each
  // Alpaca batch with the selected manual universe, so only selected symbols receive bars and can
  // enter any strategy pipeline. It does not alter strategy calculations or any downstream gate.
  const originalFetch = globalThis.fetch;
  const capturedTasks = [];
  const scopedContext = {
    ...ctx,
    waitUntil(promise) {
      capturedTasks.push(Promise.resolve(promise));
    },
  };
  const scopedEnv = {
    ...env,
    AUTO_SCANNER_SCAN_MODE: scanMode.mode,
    AUTO_SCANNER_SELECTED_SYMBOLS: symbols.join(','),
  };

  globalThis.fetch = createScanFilteredFetch(originalFetch.bind(globalThis), symbols);
  try {
    const returned = baseWorker.scheduled(controller, scopedEnv, scopedContext);
    if (returned && typeof returned.then === 'function') await returned;
    if (capturedTasks.length) await Promise.allSettled(capturedTasks);
    console.log(JSON.stringify({
      event: 'AUTO_SCANNER_MANUAL_UNIVERSE_APPLIED',
      scanMode: scanMode.mode,
      symbols,
      symbolCount: symbols.length,
      strategyLogicAffected: false,
      riskGatesAffected: false,
      liveLockAffected: false,
      createdAt: new Date().toISOString(),
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (isMobileDashboardPath(pathname)) return serveMobileDashboard(request);

    const stub = coordinator(env);
    if (pathname === '/api/trading/mode' && request.method === 'POST') {
      const passcodeResponse = await handleMobilePasscode(request, env, stub);
      if (passcodeResponse) return passcodeResponse;
    }

    const mobileRequest = isMobileClientRequest(request) && isMobileProtectedApiPath(pathname);
    if (mobileRequest) {
      const sessionError = await mobileSessionErrorResponse(request, env);
      if (sessionError) return sessionError;
      const mobileResponse = await handleAuthenticatedMobileApi(request, env, stub, {
        baseFetch: (nextRequest) => baseWorker.fetch(nextRequest, env, ctx),
      });
      if (mobileResponse) return mobileResponse;
    }

    if (pathname === SCAN_SOURCE_MODE_API_PATH) return handleScanModeApi(request, env);
    const response = await baseWorker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(pathname) ? enhanceScanModeDashboard(response) : response;
  },
  scheduled(controller, env, ctx) {
    const task = runScheduledWithSelectedSymbols(controller, env, ctx).catch((error) => {
      console.error(JSON.stringify({
        event: 'SCAN_MODE_SCHEDULE_FAILED_CLOSED',
        error: error instanceof Error ? error.message : 'Scan mode scheduler failed.',
        scannerExecuted: false,
        liveFundsUsed: false,
        createdAt: new Date().toISOString(),
      }));
      throw error;
    });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
    return task;
  },
};
