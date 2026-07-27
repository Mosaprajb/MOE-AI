import worker, { AlertCoordinator as BaseAlertCoordinator } from './scanner-live-entry.js';
import { getScannerProgress } from './scanner-progress-service.js';

const PROGRESS_PATH = '/api/scanner/progress';

function secureJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function finalizedProgress(progress = {}) {
  const rows = Array.isArray(progress.rows) ? progress.rows : [];
  const latestRow = [...rows].sort((left, right) => Date.parse(right?.updatedAt || 0) - Date.parse(left?.updatedAt || 0))[0] || null;
  const waitingForResult = progress.phase === 'WAITING_FOR_SCANNER_RESULT' && Boolean(progress.completedAt);
  const complete = progress.status === 'COMPLETE' || waitingForResult;
  return {
    ...progress,
    status: complete ? 'COMPLETE' : progress.status,
    phase: complete ? 'COMPLETE' : progress.phase,
    currentSymbol: progress.currentSymbol || latestRow?.symbol || null,
    progressPercent: complete && Number(progress.totalSymbols || 0) > 0
      ? 100
      : Number(progress.progressPercent || 0),
  };
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async getFinalizedScannerProgress() {
    return finalizedProgress(await getScannerProgress(this.ctx.storage));
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === PROGRESS_PATH) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      try {
        return secureJson({ ok: true, progress: await coordinator(env).getFinalizedScannerProgress() });
      } catch (error) {
        return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Scanner progress unavailable' }, 500);
      }
    }
    return worker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};

export { finalizedProgress };
