// Top-level Sandbox Simulation entry.
//
// This wrapper leaves the deployed Sandbox worker intact and adds a historical replay layer.
// During a running simulation, scheduled/live Sandbox scanner work is suppressed. Live trading
// remains statically locked and every simulated broker event stays inside Durable Object storage.

import baseWorker, { AlertCoordinator as BaseAlertCoordinator } from './sandbox-operations-v2-entry.js';
import {
  LIVE_SCANNER_STORAGE_KEY,
  createLiveScannerSnapshot,
} from './dashboard/live-scanner.js';
import { enhanceStrategySelectorDashboard } from './dashboard/strategy-selector.js';
import { enhanceSimulationDashboard } from './simulation/simulation-dashboard.js';
import {
  compactSimulationLiveScanner,
  compactSimulationState,
  SimulationDriver,
  stabilizeSimulationDashboardResponse,
} from './simulation/simulation-server-runtime.js';
import {
  readHistoricalSimulation,
  readHistoricalSimulationReport,
  startHistoricalSimulation,
  stopHistoricalSimulation,
  tickHistoricalSimulation,
} from './simulation/simulation-engine.js';
import {
  STRATEGY_CAPACITY_API_PATH,
  applyStrategyCapacityToSelection,
  buildStrategyCapacitySnapshot,
  finalizeStrategyOrderReservation,
  listStrategyCapacityAudit,
  recordStrategyCapacityAudit,
  releaseStrategyOrderReservation,
  reserveStrategyOrderSubmission,
} from './strategy/strategy-capacity.js';

export { SimulationDriver };

const PATHS = Object.freeze({
  session: '/api/sandbox/simulate/session',
  start: '/api/sandbox/simulate/start',
  tick: '/api/sandbox/simulate/tick',
  stop: '/api/sandbox/simulate/stop',
  status: '/api/sandbox/simulate/status',
  report: '/api/sandbox/simulate/report',
  liveScanner: '/api/scanner/opportunities/live',
});
const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/moe-ai', '/moe-ai/']);
const COOKIE_NAME = 'moe_simulation_session';
const SESSION_SCOPE = 'MOE_SANDBOX_SIMULATION_CONTROL';
const SESSION_TTL_SECONDS = 2 * 60 * 60;
const encoder = new TextEncoder();

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function enabled(value) {
  return text(value).toLowerCase() === 'true';
}

function json(payload, status = 200, headers = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-simulation': '1.0.0',
      ...headers,
    },
  });
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function simulationDriver(env) {
  return env.SIMULATION_DRIVER.getByName('global');
}

async function requestBody(request) {
  try { return await request.json(); } catch { return {}; }
}

function safetyBlockers(env = {}) {
  const blockers = [];
  if (!enabled(env.MOE_SIMULATION_ENABLED)) blockers.push('SIMULATION_DISABLED');
  if (text(env.WEBULL_ENVIRONMENT, 'sandbox').toLowerCase() !== 'sandbox') blockers.push('SANDBOX_ENVIRONMENT_REQUIRED');
  if (enabled(env.MOE_SANDBOX_PILOT_ENABLED)) blockers.push('REAL_SANDBOX_PILOT_MUST_BE_DISARMED');
  if (enabled(env.MOE_LIVE_MODE_UNLOCKED)) blockers.push('LIVE_MODE_MUST_REMAIN_LOCKED');
  if (enabled(env.MOE_LIVE_EXECUTION_IMPLEMENTED)) blockers.push('LIVE_EXECUTION_MUST_REMAIN_DISABLED');
  if (enabled(env.WEBULL_LIVE_TRADING)) blockers.push('LIVE_TRADING_MUST_REMAIN_DISABLED');
  if (enabled(env.WEBULL_LIVE_ORDER_SUBMISSION)) blockers.push('LIVE_SUBMISSION_MUST_REMAIN_DISABLED');
  if (enabled(env.WEBULL_LIVE_AUTOMATION_ARMED)) blockers.push('LIVE_AUTOMATION_MUST_REMAIN_DISARMED');
  if (!enabled(env.WEBULL_LIVE_KILL_SWITCH)) blockers.push('LIVE_KILL_SWITCH_MUST_REMAIN_ACTIVE');
  return blockers;
}

function base64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) difference |= left[index] ^ right[index];
  return difference === 0;
}

async function sha256(value) {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(String(value))));
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function cookieValue(request, name) {
  const raw = request.headers.get('cookie') || '';
  for (const item of raw.split(';')) {
    const [key, ...parts] = item.trim().split('=');
    if (key === name) return parts.join('=');
  }
  return '';
}

async function createControlSession(env) {
  const secret = text(env.MOE_SIMULATION_CONTROL_PIN);
  if (!secret) throw new Error('MOE_SIMULATION_CONTROL_PIN is not configured.');
  const issuedAt = Date.now();
  const payload = {
    scope: SESSION_SCOPE,
    issuedAt,
    expiresAt: issuedAt + SESSION_TTL_SECONDS * 1_000,
    nonce: crypto.randomUUID(),
  };
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  const signature = base64Url(await hmac(secret, body));
  return { token: `${body}.${signature}`, expiresAt: payload.expiresAt };
}

async function verifyControlSession(request, env) {
  const token = cookieValue(request, COOKIE_NAME);
  const secret = text(env.MOE_SIMULATION_CONTROL_PIN);
  if (!token || !secret) return false;
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  try {
    const expected = await hmac(secret, parts[0]);
    if (!constantTimeEqual(expected, decodeBase64Url(parts[1]))) return false;
    const payload = JSON.parse(new TextDecoder().decode(decodeBase64Url(parts[0])));
    return payload.scope === SESSION_SCOPE && Number(payload.expiresAt) > Date.now();
  } catch {
    return false;
  }
}

async function establishSession(request, env) {
  const configuredPin = text(env.MOE_SIMULATION_CONTROL_PIN);
  if (!configuredPin) return json({ ok: false, code: 'SIMULATION_PIN_NOT_CONFIGURED' }, 503);
  const body = await requestBody(request);
  const suppliedPin = text(body.pin);
  const [expected, supplied] = await Promise.all([sha256(configuredPin), sha256(suppliedPin)]);
  if (!suppliedPin || !constantTimeEqual(expected, supplied)) {
    return json({ ok: false, code: 'SIMULATION_PIN_INVALID', error: 'Invalid simulation control PIN.' }, 403);
  }
  const session = await createControlSession(env);
  const cookie = `${COOKIE_NAME}=${session.token}; Path=/; Max-Age=${SESSION_TTL_SECONDS}; HttpOnly; Secure; SameSite=Strict`;
  return json({
    ok: true,
    scope: SESSION_SCOPE,
    expiresAt: new Date(session.expiresAt).toISOString(),
    browserSecretStored: false,
  }, 200, { 'set-cookie': cookie });
}

async function requireSession(request, env) {
  return verifyControlSession(request, env);
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

  async strategyCapacitySnapshot() {
    return buildStrategyCapacitySnapshot(this.ctx.storage, this.env);
  }

  async strategyCapacityAudit(options = {}) {
    return listStrategyCapacityAudit(this.ctx.storage, options);
  }

  async reserveOrderSubmission(payload = {}) {
    return reserveStrategyOrderSubmission(this.ctx.storage, payload, this.env);
  }

  async finalizeOrderReservation(id, patch = {}) {
    return finalizeStrategyOrderReservation(this.ctx.storage, id, patch, this.env);
  }

  async releaseOrderReservation(id, reason = 'RELEASED') {
    return releaseStrategyOrderReservation(this.ctx.storage, id, reason);
  }

  async recordOpportunitySelection(selection = {}) {
    const capacity = await this.strategyCapacitySnapshot();
    const incoming = applyStrategyCapacityToSelection(selection, capacity);
    const merged = await super.recordOpportunitySelection(incoming.selection);
    const persisted = applyStrategyCapacityToSelection(merged?.opportunitySelection || {}, capacity);
    const sanitized = createLiveScannerSnapshot(persisted.selection, {
      now: Date.now(),
      topN: Number(merged?.topN || 10),
    });
    await this.ctx.storage.put(LIVE_SCANNER_STORAGE_KEY, sanitized);

    const blockedByKey = new Map();
    for (const blocked of [...incoming.blocked, ...persisted.blocked]) {
      blockedByKey.set(`${blocked.code}|${blocked.strategyId}|${blocked.opportunityId || blocked.symbol || ''}`, blocked);
    }
    for (const blocked of blockedByKey.values()) {
      await recordStrategyCapacityAudit(this.ctx.storage, {
        type: 'STRATEGY_OPPORTUNITY_BLOCKED',
        code: blocked.code,
        reason: blocked.code,
        strategyId: blocked.strategyId,
        symbol: blocked.symbol,
        opportunityId: blocked.opportunityId,
        dailyTrades: blocked.dailyTrades,
        maxDailyTrades: blocked.maxDailyTrades,
        concurrentPositions: blocked.concurrentPositions,
        maxConcurrentPositions: blocked.maxConcurrentPositions,
      });
    }
    return sanitized;
  }
}

async function handleSimulationApi(request, env, pathname) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (pathname === PATHS.session && request.method === 'POST') return establishSession(request, env);

  const stub = coordinator(env);
  const driver = simulationDriver(env);
  if (pathname === PATHS.status && request.method === 'GET') {
    const simulation = await stub.historicalSimulationStatus();
    if (simulation?.active) await driver.ensureArmed();
    return json({ ok: true, simulation: compactSimulationState(simulation) });
  }

  if (!(await requireSession(request, env))) {
    return json({ ok: false, code: 'SIMULATION_SESSION_REQUIRED', error: 'A valid simulation control session is required.' }, 401);
  }

  if (pathname === PATHS.start && request.method === 'POST') {
    const blockers = safetyBlockers(env);
    if (blockers.length) {
      return json({
        ok: false,
        code: 'SIMULATION_SAFETY_BLOCKED',
        blockers,
        liveLocked: !enabled(env.MOE_LIVE_MODE_UNLOCKED),
        pilotDisarmed: !enabled(env.MOE_SANDBOX_PILOT_ENABLED),
      }, 423);
    }
    const body = await requestBody(request);
    const simulation = await stub.startHistoricalSimulation({
      strategies: body.strategies,
      range: body.range,
      speedMultiplier: body.speedMultiplier,
    });
    await driver.arm(simulation.tickIntervalMs);
    return json({ ok: true, simulation: compactSimulationState(simulation) }, 201);
  }

  if (pathname === PATHS.tick && request.method === 'POST') {
    const simulation = await stub.tickHistoricalSimulation();
    if (simulation?.active) await driver.ensureArmed();
    else await driver.disarm('SIMULATION_COMPLETED');
    return json({ ok: true, simulation: compactSimulationState(simulation) });
  }

  if (pathname === PATHS.stop && request.method === 'POST') {
    const simulation = await stub.stopHistoricalSimulation();
    await driver.disarm('SIMULATION_STOPPED');
    return json({ ok: true, simulation: compactSimulationState(simulation) });
  }

  if (pathname === PATHS.report && request.method === 'GET') {
    const report = await stub.historicalSimulationReport();
    const filename = `MOE-SIMULATION-${report.runId || 'NO-RUN'}.json`;
    return new Response(JSON.stringify(report, null, 2), {
      status: 200,
      headers: {
        'cache-control': 'no-store',
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
        'x-moe-data-mode': 'SIMULATION_NOT_REAL_MARKET',
        'x-moe-broker': 'LOCAL_SIMULATOR_NO_WEBULL',
      },
    });
  }

  return json({ ok: false, error: 'Method not allowed' }, 405);
}

async function strategyCapacityResponse(env) {
  try {
    const stub = coordinator(env);
    const [capacity, recentAudit] = await Promise.all([
      stub.strategyCapacitySnapshot(),
      stub.strategyCapacityAudit({ limit: 50 }),
    ]);
    return json({
      ok: true,
      strategyCapacity: capacity,
      recentAudit,
      storage: 'DURABLE_OBJECT',
      mode: 'SANDBOX',
      liveFundsUsed: false,
      globalPortfolioRiskBypassed: false,
    });
  } catch (error) {
    return json({
      ok: false,
      code: 'STRATEGY_CAPACITY_UNAVAILABLE',
      error: error instanceof Error ? error.message : 'Strategy capacity is unavailable.',
      liveFundsUsed: false,
      globalPortfolioRiskBypassed: false,
    }, 500);
  }
}

async function simulationLiveScanner(env) {
  const simulation = await coordinator(env).historicalSimulationStatus();
  if (!simulation.active) return null;
  return json({
    ok: true,
    liveScanner: compactSimulationLiveScanner(simulation.liveScanner),
    storage: 'DURABLE_OBJECT',
    mode: 'SIMULATION',
    simulation: true,
    notRealMarketData: true,
    broker: 'LOCAL_SIMULATOR_NO_WEBULL',
    webullRequestsMade: 0,
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
    serverDriven: true,
    tickSource: 'DURABLE_OBJECT_ALARM',
  });
}

async function scheduledWithSimulationIsolation(controller, env, ctx) {
  try {
    const simulation = await coordinator(env).historicalSimulationStatus();
    if (simulation.active) {
      await simulationDriver(env).ensureArmed();
      const result = {
        ok: true,
        skipped: 'SIMULATION_MODE_ACTIVE',
        runId: simulation.runId,
        selectedStrategies: simulation.selectedStrategies,
        simulatedAt: simulation.simulatedAt,
        realSandboxScannerExecuted: false,
        liveExecutionAllowed: false,
        liveFundsUsed: false,
        simulationServerDriven: true,
        createdAt: new Date().toISOString(),
      };
      console.log(JSON.stringify({ event: 'REAL_SANDBOX_SCHEDULE_SUPPRESSED_FOR_SIMULATION', ...result }));
      return result;
    }
  } catch (error) {
    const result = {
      ok: false,
      skipped: 'SIMULATION_STATE_UNAVAILABLE_FAIL_CLOSED',
      error: error instanceof Error ? error.message : 'Simulation state check failed',
      realSandboxScannerExecuted: false,
      liveExecutionAllowed: false,
      liveFundsUsed: false,
      createdAt: new Date().toISOString(),
    };
    console.error(JSON.stringify({ event: 'SIMULATION_ISOLATION_CHECK_FAILED', ...result }));
    return result;
  }
  return baseWorker.scheduled(controller, env, ctx);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (pathname === STRATEGY_CAPACITY_API_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      return strategyCapacityResponse(env);
    }

    if (Object.values(PATHS).includes(pathname) && pathname !== PATHS.liveScanner) {
      try {
        return await handleSimulationApi(request, env, pathname);
      } catch (error) {
        return json({
          ok: false,
          code: 'SIMULATION_REQUEST_FAILED',
          error: error instanceof Error ? error.message : 'Simulation request failed.',
          pilotArmed: false,
          liveLocked: true,
          webullRequestsMade: 0,
        }, 500);
      }
    }

    if (pathname === PATHS.liveScanner && request.method === 'GET') {
      const simulated = await simulationLiveScanner(env);
      if (simulated) return simulated;
    }

    const response = await baseWorker.fetch(request, env, ctx);
    if (!DASHBOARD_PATHS.has(pathname)) return response;
    const withStrategySelector = await enhanceStrategySelectorDashboard(response);
    const withSimulation = await enhanceSimulationDashboard(withStrategySelector);
    return stabilizeSimulationDashboardResponse(withSimulation);
  },

  scheduled(controller, env, ctx) {
    const task = scheduledWithSimulationIsolation(controller, env, ctx);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
    return task;
  },
};
