import tradingWorker, { AlertCoordinator as TradingAlertCoordinator } from './smart-scheduler-entry.js';
import { sandboxPilotSubmissionGate } from './observability/sandbox-runtime-pilot.js';

const EXECUTE_PATH = '/api/trading/orders/execute';
const BUILD_ID = 'real-sandbox-runtime-pilot-20260731';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function pilotEnvironment(env = {}) {
  return text(env.MOE_RUNTIME_ENVIRONMENT).toUpperCase() === 'SANDBOX_PILOT';
}

function brokerHost(env = {}) {
  try {
    return new URL(text(env.WEBULL_API_BASE_URL, 'https://api.sandbox.webull.com')).host;
  } catch {
    return null;
  }
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-sandbox-pilot': BUILD_ID,
    },
  });
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

async function requestBody(request) {
  try {
    return await request.clone().json();
  } catch {
    return null;
  }
}

function reservationId(result = {}) {
  return result?.duplicateProtection?.finalized?.reservation?.id
    || result?.duplicateProtection?.released?.reservation?.id
    || result?.duplicateProtection?.reservation?.id
    || null;
}

async function recordOutcome(stub, result = {}, env = {}) {
  if (!stub || typeof stub.recordSandboxPilotEvent !== 'function') return null;
  const status = text(result.status, result.ok ? 'COMPLETED' : 'FAILED').toUpperCase();
  const type = status === 'SUBMITTED'
    ? 'SANDBOX_ORDER_SUBMITTED'
    : status === 'PREVIEW'
      ? 'SANDBOX_ORDER_PREVIEWED'
      : status === 'REJECTED'
        ? 'SANDBOX_ORDER_REJECTED'
        : status === 'FAILED'
          ? 'SANDBOX_ORDER_FAILED'
          : 'SANDBOX_ORDER_BLOCKED';
  return stub.recordSandboxPilotEvent({
    type,
    status,
    code: result.code || null,
    symbol: result.order?.symbol || result.opportunity?.symbol || null,
    opportunityId: result.opportunity?.id || null,
    reservationId: reservationId(result),
    tradeId: result.sandbox?.tradeId || null,
    brokerHost: brokerHost(env),
    brokerStatus: result.statusCode || null,
    protectedOrder: result.protectedOrder === true,
    liveFundsUsed: result.liveFundsUsed === true,
    duplicate: result.duplicate === true,
    executionAttempted: result.executionAttempted === true,
    reason: result.error || result.sandbox?.error || result.blockers?.join(', ') || null,
  });
}

async function pilotExecute(request, env, ctx) {
  const body = await requestBody(request);
  if (!body || text(body.mode, 'sandbox').toLowerCase() !== 'sandbox') {
    return tradingWorker.fetch(request, env, ctx);
  }

  const stub = coordinator(env);
  if (body.confirm === true) {
    const orderStatus = typeof stub.sandboxOrderStatus === 'function'
      ? await stub.sandboxOrderStatus({ limit: 200 })
      : { summary: { submitted: 0 } };
    const gate = sandboxPilotSubmissionGate(env, orderStatus);
    if (!gate.allowed) {
      const result = {
        schema: 'MOE.SelectedOpportunitySandboxControl',
        schemaVersion: '1.0.0',
        ok: false,
        status: 'BLOCKED',
        statusCode: gate.blockers.includes('SANDBOX_PILOT_SUBMISSION_LIMIT_REACHED') ? 409 : 423,
        code: gate.blockers[0],
        blockers: gate.blockers,
        mode: 'SANDBOX',
        pilot: gate,
        executionAttempted: false,
        liveFundsUsed: false,
        protectedOrder: true,
      };
      const task = recordOutcome(stub, result, env);
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
      else await task;
      return json(result, result.statusCode);
    }
  }

  const response = await tradingWorker.fetch(request, env, ctx);
  const result = await response.clone().json().catch(() => ({
    ok: response.ok,
    status: response.ok ? 'COMPLETED' : 'FAILED',
    statusCode: response.status,
    error: 'Sandbox pilot execution returned a non-JSON response.',
  }));
  const task = recordOutcome(stub, result, env);
  if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
  else await task;
  return response;
}

async function pilotScheduled(controller, env, ctx) {
  if (pilotEnvironment(env) && text(env.MOE_SANDBOX_PILOT_ENABLED).toLowerCase() !== 'true') {
    const result = {
      ok: true,
      skipped: 'SANDBOX_PILOT_NOT_ARMED',
      executionAuthorityChanged: false,
      liveFundsUsed: false,
      createdAt: new Date().toISOString(),
    };
    console.log(JSON.stringify({ event: 'SANDBOX_RUNTIME_PILOT_SCHEDULE_SKIPPED', ...result }));
    try {
      const task = coordinator(env).recordSandboxPilotEvent({
        type: 'SCANNER_CYCLE_SKIPPED',
        status: 'SKIPPED',
        code: result.skipped,
        executionAttempted: false,
        liveFundsUsed: false,
        reason: 'Sandbox pilot must be explicitly armed before scheduled scanner work begins.',
      });
      if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
      else await task;
    } catch (error) {
      console.error(JSON.stringify({
        event: 'SANDBOX_RUNTIME_PILOT_SKIP_AUDIT_FAILED',
        error: error instanceof Error ? error.message : 'Unknown Sandbox pilot audit failure',
        createdAt: new Date().toISOString(),
      }));
    }
    return result;
  }
  return tradingWorker.scheduled(controller, env, ctx);
}

export class AlertCoordinator extends TradingAlertCoordinator {}

export default {
  fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pilotEnvironment(env) && pathname === EXECUTE_PATH && request.method === 'POST') {
      return pilotExecute(request, env, ctx);
    }
    return tradingWorker.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    const task = pilotScheduled(controller, env, ctx);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
    return task;
  },
};
