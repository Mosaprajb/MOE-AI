import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getStaticLivePolicy } from '../src/lib/live-policy.ts';
import {
  createLiveSession,
  verifyLivePin,
  verifyLiveSessionToken,
} from '../src/lib/live-session.ts';

const workerRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const enabledEnv = {
  MOE_DEPLOYMENT_ENV: 'production',
  MOE_EXECUTION_POLICY: 'live-enabled',
  MOE_LIVE_READ_ONLY: 'false',
  MOE_LIVE_EXECUTION_IMPLEMENTED: 'true',
  MOE_LIVE_WEBHOOK_EXECUTION_ENABLED: 'false',
  MOE_LIVE_TRADING_PIN: '246810',
  MOE_LIVE_SESSION_SECRET: 'live-session-secret-0123456789abcdef',
  WEBULL_LIVE_TRADING: 'true',
  WEBULL_LIVE_ORDER_SUBMISSION: 'true',
  WEBULL_LIVE_AUTOMATION_ARMED: 'true',
  WEBULL_LIVE_KILL_SWITCH: 'false',
  WEBULL_LIVE_APP_KEY: 'key',
  WEBULL_LIVE_APP_SECRET: 'secret',
  WEBULL_LIVE_ACCESS_TOKEN: 'token',
  WEBULL_LIVE_ACCOUNT_ID: 'account',
};

test('Live policy fails closed without configuration', () => {
  const policy = getStaticLivePolicy({});
  assert.equal(policy.executionAllowedByConfig, false);
  assert.equal(policy.safeMode, 'SANDBOX');
  assert.ok(policy.blockers.length > 0);
});

test('Sandbox and staging cannot arm Live execution', () => {
  for (const deploymentEnvironment of ['sandbox', 'staging']) {
    const policy = getStaticLivePolicy({ ...enabledEnv, MOE_DEPLOYMENT_ENV: deploymentEnvironment });
    assert.equal(policy.executionAllowedByConfig, false);
    assert.ok(policy.blockers.some(blocker => blocker.code === 'LIVE_ENVIRONMENT_BLOCKED'));
  }
});

test('Live sessions require the PIN and reject tampering', async () => {
  assert.equal(await verifyLivePin('246810', enabledEnv), true);
  assert.equal(await verifyLivePin('000000', enabledEnv), false);
  const session = await createLiveSession(enabledEnv);
  assert.equal((await verifyLiveSessionToken(session.token, enabledEnv)).ok, true);
  const replacement = session.token.endsWith('a') ? 'b' : 'a';
  const tampered = `${session.token.slice(0, -1)}${replacement}`;
  assert.equal((await verifyLiveSessionToken(tampered, enabledEnv)).ok, false);
});

test('Committed Wrangler environments remain read-only and fail closed', () => {
  const config = JSON.parse(readFileSync(join(workerRoot, 'wrangler.jsonc'), 'utf8'));
  for (const [environment, value] of Object.entries(config.env)) {
    const vars = value.vars ?? {};
    assert.equal(vars.MOE_DEPLOYMENT_ENV, environment);
    assert.equal(vars.MOE_LIVE_READ_ONLY, 'true');
    assert.equal(vars.MOE_LIVE_EXECUTION_IMPLEMENTED, 'false');
    assert.equal(vars.MOE_LIVE_WEBHOOK_EXECUTION_ENABLED, 'false');
    assert.equal(vars.WEBULL_LIVE_TRADING, 'false');
    assert.equal(vars.WEBULL_LIVE_ORDER_SUBMISSION, 'false');
    assert.equal(vars.WEBULL_LIVE_AUTOMATION_ARMED, 'false');
    assert.equal(vars.WEBULL_LIVE_KILL_SWITCH, 'true');
  }
});

test('Execution paths and deploy workflows use the central safety policy', () => {
  const index = readFileSync(join(workerRoot, 'src/index.ts'), 'utf8');
  const trading = readFileSync(join(workerRoot, 'src/routes/trading.ts'), 'utf8');
  const sandboxWorkflow = readFileSync(join(workerRoot, '../.github/workflows/deploy-cloudflare-sandbox.yml'), 'utf8');
  const productionWorkflow = readFileSync(join(workerRoot, '../.github/workflows/deploy-cloudflare-worker.yml'), 'utf8');
  assert.match(index, /LIVE_WEBHOOK_EXECUTION_BLOCKED/u);
  assert.match(index, /\/api\/tradingview\/position\/close/u);
  assert.match(index, /authorizeLiveControl/u);
  assert.match(trading, /authorizeLiveExecution/u);
  assert.match(trading, /storedMode/u);
  assert.match(sandboxWorkflow, /verify-deployment-safety\.mjs/u);
  assert.match(productionWorkflow, /verify-deployment-safety\.mjs/u);
});
