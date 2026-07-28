// MOE-AI Health routes
import { Hono } from 'hono';
import type { Env } from '../lib/types';
import { WebullClient } from '../lib/webull';
import { getKillSwitch } from '../lib/risk';

const health = new Hono<{ Bindings: Env }>();

health.get('/', async (c) => {
  const env = c.env;
  const [killSwitch, sandboxClient, liveClient] = await Promise.allSettled([
    getKillSwitch(env),
    Promise.resolve(WebullClient.fromEnv(env, 'SANDBOX')),
    Promise.resolve(WebullClient.fromEnv(env, 'LIVE')),
  ]);

  const sandboxOk = sandboxClient.status === 'fulfilled' && !!sandboxClient.value;
  const liveOk    = liveClient.status    === 'fulfilled' && !!liveClient.value;

  let dbOk = false;
  try {
    await env.DB?.prepare('SELECT 1').first();
    dbOk = true;
  } catch {}

  return c.json({
    ok: true,
    workerVersion:    env.WORKER_VERSION,
    strategyVersion:  env.STRATEGY_VERSION,
    cloudflareOk:     true,
    webullOk:         sandboxOk || liveOk,
    webullMode:       liveOk ? 'LIVE' : sandboxOk ? 'SANDBOX' : 'DISCONNECTED',
    databaseOk:       dbOk,
    queuesOk:         false,
    notificationsOk:  true,
    killSwitch:       killSwitch.status === 'fulfilled' ? killSwitch.value : true,
    liveCredentials:  liveOk,
    sandboxCredentials: sandboxOk,
    checkedAt:        new Date().toISOString(),
  });
});

health.get('/ping', (c) => c.text('pong'));

export { health };
