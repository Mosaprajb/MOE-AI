import type { Env, TradingMode } from './types';

export interface LiveControlEnv extends Env {
  MOE_DEPLOYMENT_ENV?: string;
  MOE_EXECUTION_POLICY?: string;
  MOE_LIVE_READ_ONLY?: string;
  MOE_LIVE_EXECUTION_IMPLEMENTED?: string;
  MOE_LIVE_TRADING_PIN?: string;
  MOE_LIVE_SESSION_SECRET?: string;
  MOE_LIVE_SESSION_TTL_MINUTES?: string;
  MOE_LIVE_WEBHOOK_EXECUTION_ENABLED?: string;
  WEBULL_LIVE_TRADING?: string;
  WEBULL_LIVE_ORDER_SUBMISSION?: string;
  WEBULL_LIVE_AUTOMATION_ARMED?: string;
  WEBULL_LIVE_KILL_SWITCH?: string;
}

export interface LivePolicyBlocker {
  code: string;
  message: string;
}

export interface StaticLivePolicy {
  deploymentEnvironment: string;
  executionPolicy: string;
  readOnly: boolean;
  executionImplemented: boolean;
  webhookExecutionEnabled: boolean;
  liveCredentialsConfigured: boolean;
  liveBrokerCredentialsConfigured: boolean;
  liveControlSecretsConfigured: boolean;
  observationAllowed: boolean;
  missingSecrets: string[];
  brokerMissingSecrets: string[];
  controlMissingSecrets: string[];
  blockers: LivePolicyBlocker[];
  webhookBlockers: LivePolicyBlocker[];
  webhookSecretConfigured: boolean;
  executionAllowedByConfig: boolean;
  webhookExecutionAllowedByConfig: boolean;
  safeMode: TradingMode;
}

export function isEnabled(value: unknown): boolean {
  return String(value ?? '').trim().toLowerCase() === 'true';
}

function addBlocker(
  blockers: LivePolicyBlocker[],
  code: string,
  message: string,
): void {
  if (!blockers.some(blocker => blocker.code === code)) {
    blockers.push({ code, message });
  }
}

function missingSecrets(
  env: LiveControlEnv,
  names: Array<keyof LiveControlEnv>,
): string[] {
  return names
    .filter(name => !String(env[name] ?? '').trim())
    .map(String);
}

export function getStaticLivePolicy(env: LiveControlEnv): StaticLivePolicy {
  const blockers: LivePolicyBlocker[] = [];
  const deploymentEnvironment = String(env.MOE_DEPLOYMENT_ENV ?? 'unknown').trim().toLowerCase();
  const executionPolicy = String(env.MOE_EXECUTION_POLICY ?? 'sandbox-only').trim().toLowerCase();
  const readOnly = !Object.prototype.hasOwnProperty.call(env, 'MOE_LIVE_READ_ONLY')
    || isEnabled(env.MOE_LIVE_READ_ONLY);
  const executionImplemented = isEnabled(env.MOE_LIVE_EXECUTION_IMPLEMENTED);
  const webhookExecutionEnabled = isEnabled(env.MOE_LIVE_WEBHOOK_EXECUTION_ENABLED);

  const brokerMissingSecrets = missingSecrets(env, [
    'WEBULL_LIVE_APP_KEY',
    'WEBULL_LIVE_APP_SECRET',
    'WEBULL_LIVE_ACCESS_TOKEN',
    'WEBULL_LIVE_ACCOUNT_ID',
  ]);
  const controlMissingSecrets = missingSecrets(env, [
    'MOE_LIVE_TRADING_PIN',
    'MOE_LIVE_SESSION_SECRET',
  ]);
  const allMissingSecrets = [...brokerMissingSecrets, ...controlMissingSecrets];
  const liveBrokerCredentialsConfigured = brokerMissingSecrets.length === 0;
  const liveControlSecretsConfigured = controlMissingSecrets.length === 0;
  const liveCredentialsConfigured = allMissingSecrets.length === 0;
  const observationAllowed = deploymentEnvironment === 'production'
    && liveBrokerCredentialsConfigured;

  if (deploymentEnvironment !== 'production') {
    addBlocker(
      blockers,
      'LIVE_ENVIRONMENT_BLOCKED',
      'Live execution is restricted to the production deployment.',
    );
  }
  if (executionPolicy !== 'live-enabled') {
    addBlocker(
      blockers,
      'LIVE_POLICY_BLOCKED',
      'The committed execution policy does not allow Live orders.',
    );
  }
  if (!executionImplemented) {
    addBlocker(
      blockers,
      'LIVE_EXECUTION_NOT_IMPLEMENTED',
      'Live execution has not been explicitly marked as implemented.',
    );
  }
  if (readOnly) {
    addBlocker(
      blockers,
      'LIVE_READ_ONLY',
      'Live account access is observation-only.',
    );
  }
  if (!isEnabled(env.WEBULL_LIVE_TRADING)) {
    addBlocker(blockers, 'LIVE_TRADING_DISABLED', 'Live trading is disabled.');
  }
  if (!isEnabled(env.WEBULL_LIVE_ORDER_SUBMISSION)) {
    addBlocker(blockers, 'LIVE_SUBMISSION_DISABLED', 'Live order submission is disabled.');
  }
  if (!isEnabled(env.WEBULL_LIVE_AUTOMATION_ARMED)) {
    addBlocker(blockers, 'LIVE_AUTOMATION_DISARMED', 'Live automation is not armed.');
  }
  if (String(env.WEBULL_LIVE_KILL_SWITCH ?? '').trim().toLowerCase() !== 'false') {
    addBlocker(
      blockers,
      'LIVE_CONFIGURATION_KILL_SWITCH',
      'The committed Live kill switch is active or not explicitly disabled.',
    );
  }
  if (allMissingSecrets.length > 0) {
    addBlocker(
      blockers,
      'LIVE_SECRETS_MISSING',
      `Missing required Live secrets: ${allMissingSecrets.join(', ')}.`,
    );
  }

  const executionAllowedByConfig = blockers.length === 0;
  const webhookBlockers: LivePolicyBlocker[] = [];
  if (!webhookExecutionEnabled) {
    addBlocker(
      webhookBlockers,
      'LIVE_WEBHOOK_DISABLED',
      'TradingView Live webhook execution is disabled.',
    );
  }
  const webhookSecretConfigured = Boolean(String(env.MOE_WEBHOOK_SECRET ?? '').trim());
  if (!webhookSecretConfigured) {
    addBlocker(
      webhookBlockers,
      'LIVE_WEBHOOK_SECRET_MISSING',
      'MOE_WEBHOOK_SECRET is required for TradingView Live execution.',
    );
  }

  return {
    deploymentEnvironment,
    executionPolicy,
    readOnly,
    executionImplemented,
    webhookExecutionEnabled,
    liveCredentialsConfigured,
    liveBrokerCredentialsConfigured,
    liveControlSecretsConfigured,
    observationAllowed,
    missingSecrets: allMissingSecrets,
    brokerMissingSecrets,
    controlMissingSecrets,
    blockers,
    webhookBlockers,
    webhookSecretConfigured,
    executionAllowedByConfig,
    webhookExecutionAllowedByConfig:
      executionAllowedByConfig && webhookExecutionEnabled && webhookSecretConfigured,
    safeMode: executionAllowedByConfig ? 'LIVE' : 'SANDBOX',
  };
}
