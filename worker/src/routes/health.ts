// MOE-AI Health Check Routes
import { Hono } from 'hono';
import type { LiveControlEnv } from '../lib/live-policy';
import { WebullClient } from '../lib/webull';
import { getLiveExecutionPolicy } from '../lib/live-control';
import { getKillSwitch } from '../lib/risk';

const health = new Hono<{ Bindings: LiveControlEnv }>();

health.get('/', async c => {
  const env = c.env;
  const [killSwitch, livePolicy, sandboxClient, liveClient] = await Promise.allSettled([
    getKillSwitch(env),
    getLiveExecutionPolicy(env),
    Promise.resolve(WebullClient.fromEnv(env, 'SANDBOX')),
    Promise.resolve(WebullClient.fromEnv(env, 'LIVE')),
  ]);

  const sandboxOk = sandboxClient.status === 'fulfilled' && Boolean(sandboxClient.value);
  const liveOk = liveClient.status === 'fulfilled' && Boolean(liveClient.value);
  let databaseOk = false;
  try {
    await env.DB?.prepare('SELECT 1').first();
    databaseOk = true;
  } catch {
    databaseOk = false;
  }

  const safePolicy = livePolicy.status === 'fulfilled' ? livePolicy.value : null;
  return c.json({
    ok: true,
    workerVersion: env.WORKER_VERSION,
    deploymentEnvironment: env.MOE_DEPLOYMENT_ENV ?? 'unknown',
    cloudflareOk: true,
    sandboxCredentials: sandboxOk,
    liveCredentials: liveOk,
    webullOk: sandboxOk || liveOk,
    webullMode: liveOk ? 'LIVE' : sandboxOk ? 'SANDBOX' : 'DISCONNECTED',
    databaseOk,
    killSwitch: killSwitch.status === 'fulfilled' ? killSwitch.value : true,
    tradingMode: safePolicy?.currentMode ?? 'SANDBOX',
    storedTradingMode: safePolicy?.storedMode ?? 'SANDBOX',
    liveReadOnly: safePolicy?.readOnly ?? true,
    liveExecutionAllowed: safePolicy?.executionAllowed ?? false,
    liveBlockers: safePolicy?.blockers ?? [{
      code: 'LIVE_POLICY_UNAVAILABLE',
      message: 'Live policy could not be evaluated.',
    }],
    webhookUrl: 'POST /api/tradingview/webhook',
    checkedAt: new Date().toISOString(),
  });
});

health.get('/ping', c => c.text('pong'));

export { health };
