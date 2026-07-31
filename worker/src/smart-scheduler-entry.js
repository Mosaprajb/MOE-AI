import tradingWorker, { AlertCoordinator } from './trading-mode-control-v2-entry.js';
import { runSmartAutoScannerMinute } from './auto-scanner-scheduler.js';
import {
  createAutoScannerDisabledEnv,
  createCapturedExecutionContext,
  smartSchedulerEnabled,
} from './scanner/smart-scheduler-runtime.js';

async function runDelegatedScheduledWork(controller, env, parentContext) {
  if (!tradingWorker || typeof tradingWorker.scheduled !== 'function') return [];
  const captured = createCapturedExecutionContext(parentContext);
  let returned;
  try {
    returned = tradingWorker.scheduled(controller, createAutoScannerDisabledEnv(env), captured.context);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'SMART_SCHEDULER_DELEGATED_WORK_FAILED',
      error: error instanceof Error ? error.message : 'Unknown delegated scheduled failure',
      createdAt: new Date().toISOString(),
    }));
    return [];
  }

  const outcomes = await captured.waitForAll(returned);
  for (const outcome of outcomes) {
    if (outcome.status !== 'rejected') continue;
    console.error(JSON.stringify({
      event: 'SMART_SCHEDULER_DELEGATED_TASK_REJECTED',
      error: outcome.reason instanceof Error ? outcome.reason.message : String(outcome.reason || 'Unknown rejection'),
      createdAt: new Date().toISOString(),
    }));
  }
  return outcomes;
}

async function executeScheduled(controller, env, ctx) {
  if (!smartSchedulerEnabled(env)) {
    if (!tradingWorker || typeof tradingWorker.scheduled !== 'function') return undefined;
    return tradingWorker.scheduled(controller, env, ctx);
  }

  await runDelegatedScheduledWork(controller, env, ctx);
  const scheduledTime = Number(controller?.scheduledTime) || Date.now();
  const result = await runSmartAutoScannerMinute(env, scheduledTime);
  console.log(JSON.stringify({
    event: 'SMART_SCANNER_SCHEDULER_RESULT',
    phase: result?.phase || 'UNKNOWN',
    cadenceMs: result?.cadenceMs ?? null,
    ticksPlanned: result?.ticksPlanned || 0,
    ticksCompleted: result?.ticksCompleted || 0,
    skipped: result?.skipped || null,
    ok: result?.ok !== false,
    executionAuthorityChanged: false,
    createdAt: new Date().toISOString(),
  }));
  return result;
}

export { AlertCoordinator };
export default {
  fetch(request, env, ctx) {
    return tradingWorker.fetch(request, env, ctx);
  },
  scheduled(controller, env, ctx) {
    const task = executeScheduled(controller, env, ctx);
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
    return task;
  },
};
