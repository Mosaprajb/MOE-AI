import { buildLearningReport, LEARNING_VERSION } from './learning-engine.js';
import { listTrades } from './trade-history.js';

const REPORT_KEY = 'learning:latest-report';
const SETTINGS_KEY = 'learning:settings';
const APPROVAL_PREFIX = 'learning:approval:';

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultSettings(env = {}) {
  return {
    enabled: String(env.MOE_LEARNING_ENABLED || 'true').toLowerCase() !== 'false',
    minimumSample: Math.max(3, number(env.MOE_LEARNING_MINIMUM_SAMPLE, 8)),
    autoApplyEnabled: false,
    liveTradingChangesAllowed: false,
    updatedAt: null,
  };
}

export async function getLearningSettings(storage, env = {}) {
  const saved = await storage.get(SETTINGS_KEY);
  return {
    ...defaultSettings(env),
    ...(saved && typeof saved === 'object' ? saved : {}),
    autoApplyEnabled: false,
    liveTradingChangesAllowed: false,
  };
}

export async function updateLearningSettings(storage, patch = {}, env = {}) {
  const current = await getLearningSettings(storage, env);
  const next = {
    ...current,
    enabled: patch.enabled == null ? current.enabled : patch.enabled === true,
    minimumSample: patch.minimumSample == null
      ? current.minimumSample
      : Math.max(3, Math.min(500, number(patch.minimumSample, current.minimumSample))),
    autoApplyEnabled: false,
    liveTradingChangesAllowed: false,
    updatedAt: new Date().toISOString(),
  };
  await storage.put(SETTINGS_KEY, next);
  return next;
}

export async function generateLearningReport(storage, env = {}) {
  const settings = await getLearningSettings(storage, env);
  if (!settings.enabled) {
    const disabled = {
      version: LEARNING_VERSION,
      generatedAt: new Date().toISOString(),
      status: 'DISABLED',
      closedTradesAnalyzed: 0,
      minimumSample: settings.minimumSample,
      safety: {
        autoApplyEnabled: false,
        approvalRequired: true,
        liveTradingChangesAllowed: false,
      },
      performance: {},
      recommendations: [],
    };
    await storage.put(REPORT_KEY, disabled);
    return disabled;
  }

  const trades = await listTrades(storage, { limit: 5000, status: 'CLOSED' });
  const report = buildLearningReport(trades, { minimumSample: settings.minimumSample });
  await storage.put(REPORT_KEY, report);
  return report;
}

export async function getLatestLearningReport(storage, env = {}) {
  const report = await storage.get(REPORT_KEY);
  if (report && typeof report === 'object') return report;
  return generateLearningReport(storage, env);
}

export async function approveLearningRecommendation(storage, recommendationId, actor = 'OWNER') {
  const id = String(recommendationId || '').trim();
  if (!id) throw new Error('Recommendation id is required');

  const report = await storage.get(REPORT_KEY);
  const recommendation = report?.recommendations?.find((item) => item.id === id);
  if (!recommendation) throw new Error('Learning recommendation not found');

  const approval = {
    recommendationId: id,
    recommendation,
    approved: true,
    actor: String(actor || 'OWNER').slice(0, 64),
    approvedAt: new Date().toISOString(),
    applied: false,
    appliedAt: null,
    safety: {
      liveTradingChange: false,
      automaticApplication: false,
    },
  };

  await storage.put(`${APPROVAL_PREFIX}${id}`, approval);
  return approval;
}

export async function rejectLearningRecommendation(storage, recommendationId, actor = 'OWNER', reason = '') {
  const id = String(recommendationId || '').trim();
  if (!id) throw new Error('Recommendation id is required');

  const report = await storage.get(REPORT_KEY);
  const recommendation = report?.recommendations?.find((item) => item.id === id);
  if (!recommendation) throw new Error('Learning recommendation not found');

  const approval = {
    recommendationId: id,
    recommendation,
    approved: false,
    actor: String(actor || 'OWNER').slice(0, 64),
    reason: String(reason || '').slice(0, 500),
    rejectedAt: new Date().toISOString(),
    applied: false,
    safety: {
      liveTradingChange: false,
      automaticApplication: false,
    },
  };

  await storage.put(`${APPROVAL_PREFIX}${id}`, approval);
  return approval;
}

export async function listLearningApprovals(storage) {
  const entries = await storage.list({ prefix: APPROVAL_PREFIX });
  return [...entries.values()].sort((a, b) => {
    const left = new Date(a.approvedAt || a.rejectedAt || 0).getTime();
    const right = new Date(b.approvedAt || b.rejectedAt || 0).getTime();
    return right - left;
  });
}
