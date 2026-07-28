// MOE-AI Health Check Routes
import { Hono } from 'hono';
import type { Env } from '../lib/types';
import { WebullClient } from '../lib/webull';
import { getKillSwitch, getTradingMode } from '../lib/risk';

const health = new Hono<{ Bindings: Env }>();

health.get('/', async (c) => {
  const env = c.env;

  const [killSwitch, mode, sandboxClient, liveClient] = await Promise.allSettled([
    getKillSwitch(env),
    getTradingMode(env),
    Promise.resolve(WebullClient.fromEnv(env, 'SANDBOX')),
    Promise.resolve(WebullClient.fromEnv(env, 'LIVE')),
  ]);

  const sandboxOk = sandboxClient.status === 'fulfilled' && !!sandboxClient.value;
  const liveOk    = liveClient.status    === 'fulfilled' && !!liveClient.value;

  let dbOk = false;
  try { await env.DB?.prepare('SELECT 1').first(); dbOk = true; } catch {}

  return c.json({
    ok:                 true,
    workerVersion:      env.WORKER_VERSION,
    cloudflareOk:       true,
    sandboxCredentials: sandboxOk,
    liveCredentials:    liveOk,
    webullOk:           sandboxOk || liveOk,
    webullMode:         liveOk ? 'LIVE' : sandboxOk ? 'SANDBOX' : 'DISCONNECTED',
    databaseOk:         dbOk,
    killSwitch:         killSwitch.status === 'fulfilled' ? killSwitch.value : false,
    tradingMode:        mode.status       === 'fulfilled' ? mode.value       : 'SANDBOX',
    webhookUrl:         'POST /api/tradingview/webhook',
    checkedAt:          new Date().toISOString(),
  });
});

health.get('/ping', (c) => c.text('pong'));

export { health };
