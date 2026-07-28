import tradeRouter, { AlertCoordinator as TradeAlertCoordinator } from './trade-router.js';
import {
  approveLearningRecommendation,
  generateLearningReport,
  getLatestLearningReport,
  getLearningSettings,
  listLearningApprovals,
  rejectLearningRecommendation,
  updateLearningSettings,
} from './learning-service.js';

const LEARNING_PREFIX = '/api/learning';
const DEFAULT_REFRESH_MINUTES = 15;

export class AlertCoordinator extends TradeAlertCoordinator {
  async getLearningReport() {
    return getLatestLearningReport(this.ctx.storage, this.env);
  }

  async generateLearningReport() {
    return generateLearningReport(this.ctx.storage, this.env);
  }

  async refreshLearningReport(now = Date.now(), minimumIntervalMs = DEFAULT_REFRESH_MINUTES * 60_000) {
    const current = await getLatestLearningReport(this.ctx.storage, this.env);
    const generatedAt = Date.parse(current?.generatedAt || '');
    const interval = Math.max(60_000, Number(minimumIntervalMs) || DEFAULT_REFRESH_MINUTES * 60_000);

    if (Number.isFinite(generatedAt) && Number(now) - generatedAt < interval) {
      return { skipped: true, reason: 'LEARNING_REPORT_FRESH', report: current };
    }

    return { skipped: false, report: await generateLearningReport(this.ctx.storage, this.env) };
  }

  async getLearningSettings() {
    return getLearningSettings(this.ctx.storage, this.env);
  }

  async updateLearningSettings(patch = {}) {
    return updateLearningSettings(this.ctx.storage, patch, this.env);
  }

  async approveLearningRecommendation(recommendationId, actor = 'OWNER') {
    return approveLearningRecommendation(this.ctx.storage, recommendationId, actor);
  }

  async rejectLearningRecommendation(recommendationId, actor = 'OWNER', reason = '') {
    return rejectLearningRecommendation(this.ctx.storage, recommendationId, actor, reason);
  }

  async listLearningApprovals() {
    return listLearningApprovals(this.ctx.storage);
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function secureJson(data, status = 200, headers = {}) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  if (origin === env.APP_ORIGIN || origin === 'http://localhost:3000') return origin;
  return false;
}

function cors(origin) {
  return origin ? {
    'access-control-allow-origin': origin,
    'access-control-allow-methods': 'GET, POST, PUT, OPTIONS',
    'access-control-allow-headers': 'content-type,x-moe-webhook-secret',
    vary: 'Origin',
  } : {};
}

function authorizedWrite(request, env) {
  const supplied = request.headers.get('x-moe-webhook-secret') || '';
  return Boolean(env.MOE_WEBHOOK_SECRET) && supplied === env.MOE_WEBHOOK_SECRET;
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('Invalid JSON payload');
  }
}

function recommendationAction(path) {
  const match = path.match(/^\/api\/learning\/recommendations\/([^/]+)\/(approve|reject)$/);
  if (!match) return null;
  return { id: decodeURIComponent(match[1]), action: match[2] };
}

async function handleLearningRequest(request, env) {
  const origin = allowedOrigin(request, env);
  const headers = cors(origin || null);
  if (request.method === 'OPTIONS') {
    if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);
    return new Response(null, { status: 204, headers });
  }
  if (origin === false) return secureJson({ ok: false, error: 'Origin not allowed' }, 403, headers);

  const stub = coordinator(env);
  const path = new URL(request.url).pathname;

  if (path === `${LEARNING_PREFIX}/report` && request.method === 'GET') {
    return secureJson({ ok: true, report: await stub.getLearningReport(), storage: 'DURABLE_OBJECT' }, 200, headers);
  }

  if (path === `${LEARNING_PREFIX}/report/generate` && request.method === 'POST') {
    if (!authorizedWrite(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);
    return secureJson({ ok: true, report: await stub.generateLearningReport(), storage: 'DURABLE_OBJECT' }, 200, headers);
  }

  if (path === `${LEARNING_PREFIX}/settings`) {
    if (request.method === 'GET') {
      return secureJson({ ok: true, settings: await stub.getLearningSettings(), storage: 'DURABLE_OBJECT' }, 200, headers);
    }
    if (request.method === 'PUT') {
      if (!authorizedWrite(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);
      return secureJson({ ok: true, settings: await stub.updateLearningSettings(await parseJson(request)), storage: 'DURABLE_OBJECT' }, 200, headers);
    }
  }

  if (path === `${LEARNING_PREFIX}/approvals` && request.method === 'GET') {
    const approvals = await stub.listLearningApprovals();
    return secureJson({ ok: true, count: approvals.length, approvals, storage: 'DURABLE_OBJECT' }, 200, headers);
  }

  const action = recommendationAction(path);
  if (action && request.method === 'POST') {
    if (!authorizedWrite(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401, headers);
    const payload = await parseJson(request);
    const actor = String(payload.actor || 'OWNER').slice(0, 64);
    const approval = action.action === 'approve'
      ? await stub.approveLearningRecommendation(action.id, actor)
      : await stub.rejectLearningRecommendation(action.id, actor, payload.reason || '');
    return secureJson({ ok: true, approval, storage: 'DURABLE_OBJECT' }, 200, headers);
  }

  return secureJson({ ok: false, error: 'Method not allowed' }, 405, headers);
}

function refreshIntervalMs(env) {
  const minutes = Number(env.MOE_LEARNING_REFRESH_MINUTES || DEFAULT_REFRESH_MINUTES);
  return Math.max(1, Math.min(1440, Number.isFinite(minutes) ? minutes : DEFAULT_REFRESH_MINUTES)) * 60_000;
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith(`${LEARNING_PREFIX}/`)) return tradeRouter.fetch(request, env, ctx);

    try {
      return await handleLearningRequest(request, env);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Learning request failed';
      const status = message === 'Learning recommendation not found' ? 404 : 400;
      return secureJson({ ok: false, error: message }, status);
    }
  },

  async scheduled(controller, env, ctx) {
    const baseTask = Promise.resolve(tradeRouter.scheduled(controller, env, ctx));
    const learningTask = coordinator(env)
      .refreshLearningReport(controller.scheduledTime || Date.now(), refreshIntervalMs(env))
      .then((result) => {
        console.log(JSON.stringify({
          event: 'MOE_LEARNING_REPORT_REFRESH',
          skipped: result.skipped === true,
          reason: result.reason || null,
          status: result.report?.status || null,
          closedTradesAnalyzed: result.report?.closedTradesAnalyzed || 0,
          recommendations: result.report?.recommendations?.length || 0,
          createdAt: new Date().toISOString(),
        }));
        return result;
      })
      .catch((error) => {
        console.error(JSON.stringify({
          event: 'MOE_LEARNING_REPORT_REFRESH_FAILED',
          error: error instanceof Error ? error.message : 'Unknown learning refresh error',
          createdAt: new Date().toISOString(),
        }));
        return null;
      });

    if (ctx?.waitUntil) ctx.waitUntil(learningTask);
    return baseTask;
  },
};
