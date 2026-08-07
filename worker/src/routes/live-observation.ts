import { Hono } from 'hono';
import type { LiveControlEnv } from '../lib/live-policy';
import { getLiveExecutionPolicy } from '../lib/live-control';
import { WebullClient } from '../lib/webull';
import { checkLiveWebullToken, type WebullTokenCheckResult } from '../lib/webull-token-status';

const liveObservation = new Hono<{ Bindings: LiveControlEnv }>();

interface SafeBrokerFailure {
  httpStatus: number | null;
  errorCode: string | null;
  category: 'HTTP' | 'NETWORK_OR_RUNTIME';
}

function safeBrokerFailure(reason: unknown): SafeBrokerFailure {
  const message = reason instanceof Error ? reason.message : String(reason ?? '');
  try {
    const parsed = JSON.parse(message) as {
      response?: {
        status?: unknown;
        parsedBody?: unknown;
      };
    };
    const rawStatus = Number(parsed.response?.status);
    const body = parsed.response?.parsedBody;
    const object = body && typeof body === 'object' && !Array.isArray(body)
      ? body as Record<string, unknown>
      : null;
    const rawCode = object?.error_code ?? object?.code;
    return {
      httpStatus: Number.isFinite(rawStatus) ? rawStatus : null,
      errorCode: rawCode == null ? null : String(rawCode).slice(0, 80),
      category: 'HTTP',
    };
  } catch {
    return {
      httpStatus: null,
      errorCode: null,
      category: 'NETWORK_OR_RUNTIME',
    };
  }
}

liveObservation.get('/', async c => {
  const policy = await getLiveExecutionPolicy(c.env);
  const client = WebullClient.fromEnv(c.env, 'LIVE');
  const observation = {
    brokerConfigured: Boolean(client),
    tokenStatus: 'UNKNOWN' as WebullTokenCheckResult['status'],
    accountReadable: false,
    positionsReadable: false,
    openOrdersReadable: false,
  };
  const diagnostics: {
    token: WebullTokenCheckResult | null;
    account: SafeBrokerFailure | null;
    positions: SafeBrokerFailure | null;
    openOrders: SafeBrokerFailure | null;
  } = {
    token: null,
    account: null,
    positions: null,
    openOrders: null,
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
      diagnostics,
      checkedAt: new Date().toISOString(),
    }, 503);
  }

  if (!policy.readOnly || policy.executionAllowed) {
    return c.json({
      ok: false,
      ...basePayload,
      observation,
      diagnostics,
      checkedAt: new Date().toISOString(),
    }, 423);
  }

  const tokenCheck = await checkLiveWebullToken(c.env);
  observation.tokenStatus = tokenCheck.status;
  diagnostics.token = tokenCheck;

  // Do not fan out account requests with a token that Webull itself does not
  // report as NORMAL. This keeps the probe read-only and avoids repeated 401s.
  if (!tokenCheck.ok || tokenCheck.status !== 'NORMAL') {
    return c.json({
      ok: false,
      ...basePayload,
      observation,
      diagnostics,
      checkedAt: new Date().toISOString(),
    }, 502);
  }

  const [account, positions, openOrders] = await Promise.allSettled([
    client.getAccount(),
    client.getPositions(),
    client.getOrders(),
  ]);

  observation.accountReadable = account.status === 'fulfilled';
  observation.positionsReadable = positions.status === 'fulfilled';
  observation.openOrdersReadable = openOrders.status === 'fulfilled';
  diagnostics.account = account.status === 'rejected' ? safeBrokerFailure(account.reason) : null;
  diagnostics.positions = positions.status === 'rejected' ? safeBrokerFailure(positions.reason) : null;
  diagnostics.openOrders = openOrders.status === 'rejected' ? safeBrokerFailure(openOrders.reason) : null;

  const ok = observation.accountReadable
    && observation.positionsReadable
    && observation.openOrdersReadable;

  return c.json({
    ok,
    ...basePayload,
    observation,
    diagnostics,
    checkedAt: new Date().toISOString(),
  }, ok ? 200 : 502);
});

export { liveObservation, safeBrokerFailure };
