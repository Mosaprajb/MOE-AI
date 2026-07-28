import worker, { AlertCoordinator as BaseAlertCoordinator } from './scanner-external-runtime-entry.js';
import { activeTradingWindow, AUTO_SCANNER_SYMBOLS, scannerProfiles } from './auto-scanner.js';

const AUDIT_PATH = '/api/scanner/operational-audit';
const MODE_KEY = 'moe-trading-mode';
const CONTROL_KEY = 'live-control:v1';
const SELECTION_KEY = 'scanner-selection-settings:v1';
const REPAIR_KEY = 'scanner-operational-repair:v2';
const BOT_STATUS_KEY = 'bot-status:v2';
const BOT_HISTORY_KEY = 'bot-status-history:v2';
const BUILD_ID = 'scanner-operational-repair-v2-20260727';

function enabled(value) {
  return String(value || '').toLowerCase() === 'true';
}

function present(env, key) {
  return Boolean(String(env?.[key] || '').trim());
}

function secureJson(payload, status = 200) {
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

function defaultControl(env = {}) {
  return {
    version: 4,
    sandboxAutomationEnabled: enabled(env.AUTO_SCANNER_ENABLED) && enabled(env.WEBULL_AUTOMATION_ARMED),
    liveControlsUnlocked: false,
    liveAutomationArmed: false,
    killSwitch: true,
    updatedAt: null,
    updatedBy: null,
    lastAction: 'DEFAULT_SAFE_SANDBOX',
  };
}

function mergedControl(saved, env = {}) {
  return {
    ...defaultControl(env),
    ...(saved && typeof saved === 'object' ? saved : {}),
  };
}

function selectedMode(saved, env = {}) {
  const value = String(saved?.selectedMode || env.MOE_TRADING_MODE_DEFAULT || 'SANDBOX').trim().toUpperCase();
  return ['DRY_RUN', 'SANDBOX', 'LIVE'].includes(value) ? value : 'SANDBOX';
}

function heartbeatAgeSeconds(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? Math.max(0, Math.floor((Date.now() - timestamp) / 1000)) : null;
}

function publicRun(record) {
  if (!record || typeof record !== 'object') return null;
  const completedAt = record.completedAt || record.recordedAt || null;
  return {
    ok: record.ok !== false,
    skipped: record.skipped || null,
    error: record.error || null,
    session: record.session || record.sessionWindow?.label || null,
    scanned: Number(record.scanned || 0),
    candidates: Number(record.candidates || 0),
    prepared: Number(record.prepared || 0),
    rankedAccepted: Number(record.rankedAccepted || 0),
    attempted: Number(record.attempted || 0),
    accepted: Number(record.accepted || 0),
    submitted: Number(record.submitted || 0),
    minimumScore: Number(record.minimumScore || 0),
    minimumRelativeVolume: Number(record.minimumRelativeVolume || 0),
    scheduledAt: record.scheduledAt || null,
    completedAt,
    heartbeatAgeSeconds: heartbeatAgeSeconds(completedAt),
    durationMs: Number(record.durationMs || 0),
    profiles: Array.isArray(record.profiles) ? record.profiles.map((item) => ({
      profile: item.profile || null,
      scanned: Number(item.scanned || 0),
      rawCandidates: Number(item.rawCandidates || 0),
      prepared: Number(item.prepared || 0),
      accepted: Number(item.accepted || 0),
      rejected: Number(item.rejected || 0),
      topRejected: Array.isArray(item.topRejected) ? item.topRejected.slice(0, 3) : [],
    })) : [],
  };
}

function computeBlockers({ env, mode, control, window, secrets, lastRun }) {
  const searchBlockers = [];
  const submissionBlockers = [];

  if (!enabled(env.AUTO_SCANNER_ENABLED)) searchBlockers.push('AUTO_SCANNER_ENABLED_FALSE');
  if (!enabled(env.WEBULL_AUTOMATION_ARMED)) searchBlockers.push('WEBULL_AUTOMATION_DISARMED');
  if (String(env.WEBULL_ENVIRONMENT || '').toLowerCase() !== 'sandbox') searchBlockers.push('WEBULL_ENVIRONMENT_NOT_SANDBOX');
  if (enabled(env.WEBULL_LIVE_TRADING) || enabled(env.WEBULL_LIVE_ORDER_SUBMISSION)) searchBlockers.push('LIVE_FLAGS_ACTIVE_DURING_SANDBOX_TEST');
  if (!enabled(env.WEBULL_LIVE_KILL_SWITCH)) searchBlockers.push('LIVE_KILL_SWITCH_NOT_ACTIVE');
  if (mode !== 'SANDBOX') searchBlockers.push(`DURABLE_MODE_${mode || 'UNKNOWN'}`);
  if (control.sandboxAutomationEnabled !== true) searchBlockers.push('DURABLE_SANDBOX_AUTOMATION_DISABLED');
  if (control.liveControlsUnlocked === true || control.liveAutomationArmed === true || control.killSwitch === false) searchBlockers.push('DURABLE_LIVE_CONTROL_NOT_LOCKED');
  if (!window.open) searchBlockers.push('NO_CONFIGURED_MARKET_SESSION_OPEN');
  if (!secrets.alpacaKey || !secrets.alpacaSecret) searchBlockers.push('ALPACA_MARKET_DATA_SECRETS_MISSING');
  if (!secrets.webhookSecret) searchBlockers.push('MOE_WEBHOOK_SECRET_MISSING');
  if (!lastRun) searchBlockers.push('NO_SCANNER_HEARTBEAT_RECORDED');
  else {
    if (lastRun.heartbeatAgeSeconds == null || lastRun.heartbeatAgeSeconds > 180) searchBlockers.push('SCANNER_HEARTBEAT_STALE');
    if (lastRun.error) searchBlockers.push(`LAST_RUN_ERROR:${lastRun.error}`);
    if (lastRun.skipped) searchBlockers.push(`LAST_RUN_SKIPPED:${lastRun.skipped}`);
  }

  if (!enabled(env.WEBULL_SANDBOX_ENABLED) || !enabled(env.WEBULL_SANDBOX_ORDER_SUBMISSION) || !enabled(env.WEBULL_AUTO_SUBMIT_SANDBOX)) {
    submissionBlockers.push('SANDBOX_SUBMISSION_FLAGS_DISABLED');
  }
  if (!secrets.webullAccountId) submissionBlockers.push('WEBULL_ACCOUNT_ID_MISSING');
  if (!secrets.webullAppKey || !secrets.webullAppSecret || !secrets.webullAccessToken) {
    submissionBlockers.push('WEBULL_SANDBOX_CREDENTIALS_MISSING');
  }

  return {
    searchBlockers: [...new Set(searchBlockers)],
    submissionBlockers: [...new Set(submissionBlockers)],
  };
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async ensureSandboxScannerRuntime() {
    const configured = safeSandboxConfigured(this.env);
    const [previousRepair, storedMode, storedControl, storedSelection] = await Promise.all([
      this.ctx.storage.get(REPAIR_KEY),
      this.ctx.storage.get(MODE_KEY),
      this.ctx.storage.get(CONTROL_KEY),
      this.ctx.storage.get(SELECTION_KEY),
    ]);

    if (!configured) {
      return {
        repaired: false,
        safeConfigured: false,
        reason: 'Static Worker settings are not a fully locked Sandbox configuration.',
        previousRepair: previousRepair || null,
      };
    }

    if (previousRepair?.version === 2 && previousRepair?.completed === true) {
      return { repaired: false, safeConfigured: true, alreadyRepaired: true, repair: previousRepair };
    }

    const beforeControl = mergedControl(storedControl, this.env);
    const now = new Date().toISOString();
    const repair = {
      version: 2,
      completed: true,
      completedAt: now,
      safeConfigured: true,
      changes: {
        tradingMode: `${selectedMode(storedMode, this.env)} -> SANDBOX`,
        sandboxAutomationEnabled: `${beforeControl.sandboxAutomationEnabled === true} -> true`,
        liveControlsUnlocked: `${beforeControl.liveControlsUnlocked === true} -> false`,
        liveAutomationArmed: `${beforeControl.liveAutomationArmed === true} -> false`,
        killSwitch: `${beforeControl.killSwitch !== false} -> true`,
        selectionLevel: `${String(storedSelection?.level || 'UNSET').toUpperCase()} -> ACTIVE`,
      },
    };

    await this.ctx.storage.put({
      [MODE_KEY]: {
        version: 2,
        selectedMode: 'SANDBOX',
        updatedAt: now,
        updatedBy: 'SCANNER_OPERATIONAL_REPAIR_V2',
      },
      [CONTROL_KEY]: {
        ...beforeControl,
        version: 4,
        sandboxAutomationEnabled: true,
        liveControlsUnlocked: false,
        liveAutomationArmed: false,
        killSwitch: true,
        updatedAt: now,
        updatedBy: 'SCANNER_OPERATIONAL_REPAIR_V2',
        lastAction: 'SANDBOX_AUTOMATION_REPAIRED_AND_LIVE_LOCKED',
      },
      [SELECTION_KEY]: {
        level: 'ACTIVE',
        updatedAt: now,
        updatedBy: 'SCANNER_OPERATIONAL_REPAIR_V2',
      },
      [REPAIR_KEY]: repair,
    });

    return { repaired: true, safeConfigured: true, repair };
  }

  async scannerOperationalAudit() {
    const [storedMode, storedControl, selection, repair, bot, history] = await Promise.all([
      this.ctx.storage.get(MODE_KEY),
      this.ctx.storage.get(CONTROL_KEY),
      this.ctx.storage.get(SELECTION_KEY),
      this.ctx.storage.get(REPAIR_KEY),
      this.ctx.storage.get(BOT_STATUS_KEY),
      this.ctx.storage.get(BOT_HISTORY_KEY),
    ]);

    const mode = selectedMode(storedMode, this.env);
    const control = mergedControl(storedControl, this.env);
    const window = activeTradingWindow(new Date(), this.env);
    const lastRun = publicRun(bot);
    const secrets = {
      alpacaKey: present(this.env, 'ALPACA_KEY_ID'),
      alpacaSecret: present(this.env, 'ALPACA_SECRET_KEY'),
      webhookSecret: present(this.env, 'MOE_WEBHOOK_SECRET'),
      webullAccountId: present(this.env, 'WEBULL_ACCOUNT_ID'),
      webullAppKey: present(this.env, 'WEBULL_APP_KEY'),
      webullAppSecret: present(this.env, 'WEBULL_APP_SECRET'),
      webullAccessToken: present(this.env, 'WEBULL_ACCESS_TOKEN'),
    };
    const blockers = computeBlockers({ env: this.env, mode, control, window, secrets, lastRun });

    return {
      build: BUILD_ID,
      scannerCanSearch: blockers.searchBlockers.length === 0,
      scannerCanSubmitSandbox: blockers.searchBlockers.length === 0 && blockers.submissionBlockers.length === 0,
      mode: {
        selected: mode,
        staticDefault: String(this.env.MOE_TRADING_MODE_DEFAULT || 'SANDBOX').toUpperCase(),
      },
      control: {
        sandboxAutomationEnabled: control.sandboxAutomationEnabled === true,
        liveControlsUnlocked: control.liveControlsUnlocked === true,
        liveAutomationArmed: control.liveAutomationArmed === true,
        killSwitch: control.killSwitch !== false,
        lastAction: control.lastAction || null,
      },
      staticSafety: {
        environment: this.env.WEBULL_ENVIRONMENT || 'sandbox',
        scannerEnabled: enabled(this.env.AUTO_SCANNER_ENABLED),
        automationArmed: enabled(this.env.WEBULL_AUTOMATION_ARMED),
        sandboxSubmissionEnabled: enabled(this.env.WEBULL_SANDBOX_ENABLED)
          && enabled(this.env.WEBULL_SANDBOX_ORDER_SUBMISSION)
          && enabled(this.env.WEBULL_AUTO_SUBMIT_SANDBOX),
        liveTrading: enabled(this.env.WEBULL_LIVE_TRADING),
        liveSubmission: enabled(this.env.WEBULL_LIVE_ORDER_SUBMISSION),
        liveKillSwitch: enabled(this.env.WEBULL_LIVE_KILL_SWITCH),
        longOnly: String(this.env.MOE_DIRECTION_POLICY || '').toUpperCase() === 'LONG_ONLY'
          && !enabled(this.env.MOE_ALLOW_SHORT_ENTRIES),
      },
      market: window,
      secrets,
      universeSize: AUTO_SCANNER_SYMBOLS.length,
      profiles: scannerProfiles(this.env),
      thresholds: {
        selectionLevel: String(selection?.level || 'ACTIVE').toUpperCase(),
        initialScoreCore: Number(this.env.AUTO_SCANNER_MIN_SCORE || 65),
        initialScoreExtended: Number(this.env.AUTO_SCANNER_MIN_SCORE_EXTENDED || 65),
        initialScoreNight: Number(this.env.AUTO_SCANNER_MIN_SCORE_NIGHT || 65),
        engineScore: Number(this.env.AUTO_SCANNER_ENGINE_MIN_SCORE || 58),
        moeAiCore: Number(this.env.MOE_AI_MIN_SCORE_CORE || 68),
        moeAiExtended: Number(this.env.MOE_AI_MIN_SCORE_EXTENDED || 68),
        moeAiNight: Number(this.env.MOE_AI_MIN_SCORE_NIGHT || 68),
        minimumRiskReward: Number(this.env.MOE_AI_MIN_RISK_REWARD || 2),
      },
      lastRun,
      recentRuns: Array.isArray(history) ? history.slice(0, 5).map(publicRun) : [],
      repair: repair || null,
      searchBlockers: blockers.searchBlockers,
      submissionBlockers: blockers.submissionBlockers,
      parity: {
        decisionLogicShared: true,
        sandboxExecutionTarget: true,
        liveExecutionTargetEnabled: false,
      },
      generatedAt: new Date().toISOString(),
    };
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === AUDIT_PATH) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      try {
        return secureJson({ ok: true, audit: await coordinator(env).scannerOperationalAudit() });
      } catch (error) {
        return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Scanner operational audit failed' }, 500);
      }
    }
    return worker.fetch(request, env, ctx);
  },

  async scheduled(controller, env, ctx) {
    const run = Promise.resolve()
      .then(() => coordinator(env).ensureSandboxScannerRuntime())
      .catch((error) => {
        console.error(JSON.stringify({
          event: 'SANDBOX_SCANNER_REPAIR_FAILED',
          error: error instanceof Error ? error.message : 'Unknown repair error',
          createdAt: new Date().toISOString(),
        }));
        return null;
      })
      .then(() => worker.scheduled(controller, env, ctx));

    if (ctx?.waitUntil) ctx.waitUntil(run);
    return run;
  },
};
