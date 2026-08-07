import { Hono } from 'hono';
import type { LiveControlEnv } from '../lib/live-policy';
import { getLiveExecutionPolicy } from '../lib/live-control';
import { WebullClient } from '../lib/webull';

const liveObservation = new Hono<{ Bindings: LiveControlEnv }>();

liveObservation.get('/', async c => {
  const policy = await getLiveExecutionPolicy(c.env);
  const client = WebullClient.fromEnv(c.env, 'LIVE');
  const observation = {
    brokerConfigured: Boolean(client),
    accountReadable: false,
    positionsReadable: false,
    openOrdersReadable: false,
  };

  const basePayload = {
    deploymentEnvironment: policy.deploymentEnvironment,
    executionPolicy: policy.executionPolicy,
    observationAllowed: policy.observationAllowed,
    liveReadOnly: policy.readOnly,
    liveExecutionAllowed: policy.executionAllowed,
    storedMode: policy.storedMode,
    effectiveMode: policy.currentMode,
    blockerCodes: policy.blockers.map(blocker => blocker.code),
  };

  if (!policy.observationAllowed || !client) {
    return c.json({
      ok: false,
      ...basePayload,
      observation,
      checkedAt: new Date().toISOString(),
    }, 503);
  }

  if (!policy.readOnly || policy.executionAllowed) {
    return c.json({
      ok: false,
      ...basePayload,
      observation,
      checkedAt: new Date().toISOString(),
    }, 423);
  }

  const [account, positions, openOrders] = await Promise.allSettled([
    client.getAccount(),
    client.getPositions(),
    client.getOrders(),
  ]);

  observation.accountReadable = account.status === 'fulfilled';
  observation.positionsReadable = positions.status === 'fulfilled';
  observation.openOrdersReadable = openOrders.status === 'fulfilled';

  const ok = observation.accountReadable
    && observation.positionsReadable
    && observation.openOrdersReadable;

  return c.json({
    ok,
    ...basePayload,
    observation,
    checkedAt: new Date().toISOString(),
  }, ok ? 200 : 502);
});

export { liveObservation };
