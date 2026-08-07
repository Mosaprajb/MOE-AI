import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStaticLivePolicy } from '../src/lib/live-policy.ts';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = join(workerRoot, '..');
const dashboardRoot = join(repositoryRoot, 'artifacts', 'trading-bot', 'src');

function env(overrides = {}) {
  return {
    WORKER_VERSION: 'test',
    STRATEGY_VERSION: 'test',
    MAX_OPEN_POSITIONS: '4',
    MAX_DAILY_TRADES: '8',
    MAX_DAILY_LOSS_PCT: '2',
    MAX_OPEN_RISK_PCT: '2',
    MAX_PORTFOLIO_HEAT: '6',
    ALLOWED_ORIGINS: '',
    MOE_DEPLOYMENT_ENV: 'production',
    MOE_EXECUTION_POLICY: 'live-read-only',
    MOE_LIVE_READ_ONLY: 'true',
    MOE_LIVE_EXECUTION_IMPLEMENTED: 'false',
    MOE_LIVE_WEBHOOK_EXECUTION_ENABLED: 'false',
    WEBULL_LIVE_TRADING: 'false',
    WEBULL_LIVE_ORDER_SUBMISSION: 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: 'false',
    WEBULL_LIVE_KILL_SWITCH: 'true',
    WEBULL_LIVE_APP_KEY: 'key',
    WEBULL_LIVE_APP_SECRET: 'secret',
    WEBULL_LIVE_ACCESS_TOKEN: 'token',
    WEBULL_LIVE_ACCOUNT_ID: 'account',
    ...overrides,
  };
}

test('production broker credentials allow observation without enabling execution', () => {
  const policy = getStaticLivePolicy(env());
  assert.equal(policy.liveBrokerCredentialsConfigured, true);
  assert.equal(policy.liveControlSecretsConfigured, false);
  assert.equal(policy.observationAllowed, true);
  assert.equal(policy.executionAllowedByConfig, false);
  assert.equal(policy.safeMode, 'SANDBOX');
  assert.deepEqual(policy.controlMissingSecrets.sort(), [
    'MOE_LIVE_SESSION_SECRET',
    'MOE_LIVE_TRADING_PIN',
  ]);
});

test('Sandbox never exposes Live observation even when broker credentials exist', () => {
  const policy = getStaticLivePolicy(env({ MOE_DEPLOYMENT_ENV: 'sandbox' }));
  assert.equal(policy.liveBrokerCredentialsConfigured, true);
  assert.equal(policy.observationAllowed, false);
  assert.ok(policy.blockers.some(blocker => blocker.code === 'LIVE_ENVIRONMENT_BLOCKED'));
});

test('dashboard uses the server status contract and never mutates execution mode', () => {
  const app = readFileSync(join(dashboardRoot, 'App.tsx'), 'utf8');
  const liveClient = readFileSync(join(dashboardRoot, 'lib', 'liveControl.ts'), 'utf8');

  assert.match(liveClient, /\/api\/trading\/live\/status/u);
  assert.match(liveClient, /observationAllowed/u);
  assert.match(app, /LIVE ACCOUNT · READ ONLY/u);
  assert.match(app, /server execution mode remains/u);
  assert.match(app, /currentPage === 'scanner' \? 'positions'/u);
  assert.match(app, /mode === 'LIVE' && item\.id === 'scanner'/u);
  assert.match(app, /disabled=\{mode === 'LIVE'\}/u);
  assert.doesNotMatch(app, /\/api\/trading\/mode/u);
  assert.doesNotMatch(app, /Switch to Live Trading/u);
});

test('dashboard fails closed when Live policy verification fails', () => {
  const app = readFileSync(join(dashboardRoot, 'App.tsx'), 'utf8');
  assert.match(app, /setMode\('SANDBOX'\)/u);
  assert.match(app, /policy verification failed/u);
  assert.match(app, /Live view closed because the server policy/u);
});
