import { Hono } from 'hono';
import {
  LIVE_CONTROL_BUILD_ID,
  createLiveSession,
  getLiveExecutionPolicy,
  verifyLivePin,
  verifyLiveSession,
} from '../lib/live-control';
import type { LiveControlEnv } from '../lib/live-policy';
import { setKillSwitch, setTradingMode } from '../lib/risk';

const liveControl = new Hono<{ Bindings: LiveControlEnv }>();

liveControl.use('*', async (c, next) => {
  await next();
  c.res.headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  c.res.headers.set('pragma', 'no-cache');
  c.res.headers.set('x-content-type-options', 'nosniff');
  c.res.headers.set('x-moe-live-control', LIVE_CONTROL_BUILD_ID);
});

liveControl.get('/status', async c => {
  const [policy, session] = await Promise.all([
    getLiveExecutionPolicy(c.env),
    verifyLiveSession(c.req.raw, c.env),
  ]);
  return c.json({
    ok: true,
    ...policy,
    controlUnlockAllowed: policy.executionAllowedByConfig,
    sessionActive: session.ok,
    sessionExpiresAt: session.ok && session.payload
      ? new Date(session.payload.expiresAt).toISOString()
      : null,
  });
});

liveControl.post('/unlock', async c => {
  let body: { pin?: string };
  try {
    body = await c.req.json<{ pin?: string }>();
  } catch {
    return c.json({ ok: false, code: 'INVALID_JSON', error: 'Valid JSON is required.' }, 400);
  }
  const policy = await getLiveExecutionPolicy(c.env);
  if (!policy.executionAllowedByConfig) {
    return c.json({
      ok: false,
      code: 'LIVE_EXECUTION_BLOCKED',
      error: 'Live control is blocked by the static server policy.',
      policy,
      blockers: policy.blockers,
    }, 423);
  }
  if (!(await verifyLivePin(String(body.pin ?? ''), c.env))) {
    return c.json({ ok: false, code: 'LIVE_PIN_INVALID', error: 'Invalid Live trading PIN.' }, 403);
  }
  const session = await createLiveSession(c.env);
  console.log(JSON.stringify({
    event: 'LIVE_CONTROL_SESSION_CREATED',
    expiresAt: session.expiresAt,
    build: LIVE_CONTROL_BUILD_ID,
  }));
  return c.json({
    ok: true,
    build: LIVE_CONTROL_BUILD_ID,
    mode: 'LIVE',
    sessionToken: session.token,
    expiresAt: session.expiresAt,
    ttlMinutes: session.ttlMinutes,
  });
});

liveControl.post('/lock', async c => {
  await Promise.all([
    setKillSwitch(c.env, true),
    setTradingMode(c.env, 'SANDBOX'),
  ]);
  console.log(JSON.stringify({
    event: 'LIVE_CONTROL_LOCKED',
    build: LIVE_CONTROL_BUILD_ID,
  }));
  return c.json({
    ok: true,
    mode: 'SANDBOX',
    killSwitch: true,
    sessionActive: false,
    clientMustDiscardSessionToken: true,
  });
});

export { liveControl };
