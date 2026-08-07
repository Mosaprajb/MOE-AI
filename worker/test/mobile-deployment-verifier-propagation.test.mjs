import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyDeploymentSafety } from '../scripts/verify-deployment-safety.mjs';
import { verifyLiveObservation } from '../scripts/verify-live-observation.mjs';

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function currentSafetyPayload(pathname) {
  if (pathname === '/api/health') {
    return {
      ok: true,
      deploymentEnvironment: 'production',
      liveExecutionAllowed: false,
      tradingMode: 'SANDBOX',
      workerVersion: 'test-production',
    };
  }
  if (pathname === '/api/trading/live/status') {
    return {
      ok: true,
      deploymentEnvironment: 'production',
      executionAllowed: false,
      currentMode: 'SANDBOX',
      storedMode: 'SANDBOX',
      blockers: [{ code: 'LIVE_READ_ONLY' }],
    };
  }
  if (pathname === '/api/trading/mode') {
    return {
      mode: 'SANDBOX',
      storedMode: 'SANDBOX',
      liveExecutionAllowed: false,
    };
  }
  throw new Error(`Unexpected safety path: ${pathname}`);
}

function currentObservationPayload(overrides = {}) {
  return {
    ok: true,
    deploymentEnvironment: 'production',
    executionPolicy: 'live-read-only',
    observationAllowed: true,
    liveReadOnly: true,
    liveExecutionAllowed: false,
    storedMode: 'SANDBOX',
    effectiveMode: 'SANDBOX',
    observation: {
      brokerConfigured: true,
      accountReadable: true,
      positionsReadable: true,
      openOrdersReadable: true,
    },
    blockerCodes: ['LIVE_READ_ONLY'],
    ...overrides,
  };
}

test('deployment safety verifier retries stale runtime with cache-busted no-cache probes', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ parsed, init });
    const probe = parsed.searchParams.get('_moe_probe');
    const payload = currentSafetyPayload(parsed.pathname);
    if (probe?.endsWith('-1')) payload.deploymentEnvironment = 'unknown';
    return jsonResponse(payload);
  };

  const result = await verifyDeploymentSafety({
    environment: 'production',
    baseUrl: 'https://example.test',
    fetchImpl,
    attempts: 2,
    retryDelayMs: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.environment, 'production');
  assert.equal(result.effectiveMode, 'SANDBOX');
  assert.equal(result.liveExecutionAllowed, false);
  assert.equal(calls.length, 6);

  const probeValues = calls.map(call => call.parsed.searchParams.get('_moe_probe'));
  assert.equal(probeValues.every(Boolean), true);
  assert.equal(new Set(probeValues.slice(0, 3)).size, 1);
  assert.equal(new Set(probeValues.slice(3)).size, 1);
  assert.notEqual(probeValues[0], probeValues[3]);
  for (const call of calls) {
    assert.match(call.init.headers['cache-control'], /no-cache/u);
    assert.equal(call.init.headers.pragma, 'no-cache');
  }
});

test('live observation verifier retries stale runtime with cache-busted no-cache probes', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    calls.push({ parsed, init });
    const probe = parsed.searchParams.get('_moe_probe');
    if (probe?.endsWith('-1')) {
      return jsonResponse(currentObservationPayload({
        deploymentEnvironment: 'unknown',
        executionPolicy: 'sandbox-only',
        observationAllowed: false,
      }));
    }
    return jsonResponse(currentObservationPayload());
  };

  const result = await verifyLiveObservation({
    baseUrl: 'https://example.test',
    fetchImpl,
    attempts: 2,
    retryDelayMs: 0,
  });

  assert.equal(result.ok, true);
  assert.equal(result.deploymentEnvironment, 'production');
  assert.equal(result.liveExecutionAllowed, false);
  assert.equal(calls.length, 2);
  assert.notEqual(
    calls[0].parsed.searchParams.get('_moe_probe'),
    calls[1].parsed.searchParams.get('_moe_probe'),
  );
  for (const call of calls) {
    assert.match(call.init.headers['cache-control'], /no-cache/u);
    assert.equal(call.init.headers.pragma, 'no-cache');
  }
});

test('live observation verifier remains fail-closed when execution is allowed', async () => {
  await assert.rejects(
    verifyLiveObservation({
      baseUrl: 'https://example.test',
      fetchImpl: async () => jsonResponse(currentObservationPayload({ liveExecutionAllowed: true })),
      attempts: 1,
      retryDelayMs: 0,
    }),
    /Live execution must remain disabled/u,
  );
});
