import { API_BASE } from './config';
import type { TradingMode } from './config';

export interface LivePolicyBlocker {
  code: string;
  message: string;
}

export interface LiveControlStatus {
  ok: boolean;
  deploymentEnvironment: string;
  executionPolicy: string;
  readOnly: boolean;
  observationAllowed: boolean;
  liveBrokerCredentialsConfigured: boolean;
  liveControlSecretsConfigured: boolean;
  brokerMissingSecrets: string[];
  controlMissingSecrets: string[];
  blockers: LivePolicyBlocker[];
  currentMode: TradingMode;
  storedMode: TradingMode;
  runtimeKillSwitch: boolean;
  executionAllowed: boolean;
  webhookExecutionAllowed: boolean;
  controlUnlockAllowed: boolean;
  sessionActive: boolean;
  sessionExpiresAt: string | null;
  checkedAt?: string;
}

function tradingMode(value: unknown): TradingMode {
  return String(value ?? '').toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX';
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter(item => typeof item === 'string')
    : [];
}

function blockers(value: unknown): LivePolicyBlocker[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap(item => {
    if (!item || typeof item !== 'object') return [];
    const candidate = item as { code?: unknown; message?: unknown };
    if (typeof candidate.code !== 'string' || typeof candidate.message !== 'string') return [];
    return [{ code: candidate.code, message: candidate.message }];
  });
}

export async function fetchLiveControlStatus(): Promise<LiveControlStatus> {
  const response = await fetch(`${API_BASE}/api/trading/live/status`, {
    method: 'GET',
    mode: 'cors',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  const payload = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) {
    const message = typeof payload.error === 'string'
      ? payload.error
      : `Live policy request failed with HTTP ${response.status}`;
    throw new Error(message);
  }

  return {
    ok: payload.ok === true,
    deploymentEnvironment: String(payload.deploymentEnvironment ?? 'unknown'),
    executionPolicy: String(payload.executionPolicy ?? 'sandbox-only'),
    readOnly: payload.readOnly !== false,
    observationAllowed: payload.observationAllowed === true,
    liveBrokerCredentialsConfigured: payload.liveBrokerCredentialsConfigured === true,
    liveControlSecretsConfigured: payload.liveControlSecretsConfigured === true,
    brokerMissingSecrets: stringArray(payload.brokerMissingSecrets),
    controlMissingSecrets: stringArray(payload.controlMissingSecrets),
    blockers: blockers(payload.blockers),
    currentMode: tradingMode(payload.currentMode),
    storedMode: tradingMode(payload.storedMode),
    runtimeKillSwitch: payload.runtimeKillSwitch === true,
    executionAllowed: payload.executionAllowed === true,
    webhookExecutionAllowed: payload.webhookExecutionAllowed === true,
    controlUnlockAllowed: payload.controlUnlockAllowed === true,
    sessionActive: payload.sessionActive === true,
    sessionExpiresAt: typeof payload.sessionExpiresAt === 'string'
      ? payload.sessionExpiresAt
      : null,
    checkedAt: typeof payload.checkedAt === 'string' ? payload.checkedAt : undefined,
  };
}

export function summarizeLiveBlockers(status: LiveControlStatus | null): string {
  if (!status) return 'Live policy is unavailable.';
  if (status.brokerMissingSecrets.length > 0) {
    return `Missing production broker secrets: ${status.brokerMissingSecrets.join(', ')}.`;
  }
  const messages = status.blockers
    .map(blocker => blocker.message)
    .filter(Boolean)
    .slice(0, 3);
  return messages.length > 0
    ? messages.join(' ')
    : 'Live execution remains disabled by server policy.';
}
