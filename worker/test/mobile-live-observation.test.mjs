import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.ts';
import { safeBrokerFailure } from '../src/routes/live-observation.ts';

class FakeKV {
  constructor() {
    this.values = new Map();
  }
  async get(key) {
    return this.values.get(key) ?? null;
  }
  async put(key, value) {
    this.values.set(key, value);
  }
}

function createEnv(overrides = {}) {
  return {
    CONFIG: new FakeKV(),
    MOE_DEPLOYMENT_ENV: 'production',
    MOE_EXECUTION_POLICY: 'live-read-only',
    MOE_LIVE_READ_ONLY: 'true',
    MOE_LIVE_EXECUTION_IMPLEMENTED: 'false',
    MOE_LIVE_WEBHOOK_EXECUTION_ENABLED: 'false',
    WEBULL_LIVE_TRADING: 'false',
    WEBULL_LIVE_ORDER_SUBMISSION: 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: 'false',
    WEBULL_LIVE_KILL_SWITCH: 'true',
    MOE_MOBILE_SESSION_SECRET: 's'.repeat(48),
    ...overrides,
  };
}

test('detailed Live account reads require an authenticated mobile session', async () => {
  for (const path of ['dashboard', 'account', 'positions', 'orders']) {
    const response = await app.request(
      `https://worker.example/api/trading/live/${path}`,
      { method: 'GET' },
      createEnv(),
    );
    assert.equal(response.status, 401, path);
    assert.deepEqual(await response.json(), {
      ok: false,
      error: 'Authentication required',
    });
  }
});

test('sanitized Live observation probe stays public without exposing account payloads', async () => {
  const response = await app.request(
    'https://worker.example/api/trading/live/observation',
    { method: 'GET' },
    createEnv(),
  );

  assert.equal(response.status, 503);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/u);
  const payload = await response.json();
  assert.equal(payload.ok, false);
  assert.equal(payload.observation.brokerConfigured, false);
  assert.equal(payload.liveReadOnly, true);
  assert.equal(payload.liveExecutionAllowed, false);
  assert.deepEqual(payload.diagnostics, {
    token: null,
    account: null,
    positions: null,
    openOrders: null,
  });
  assert.equal(Object.hasOwn(payload, 'account'), false);
  assert.equal(Object.hasOwn(payload, 'positions'), false);
  assert.equal(Object.hasOwn(payload, 'orders'), false);
});

test('broker failure diagnostics keep only HTTP status and broker error code', () => {
  const sensitiveDiagnostic = new Error(JSON.stringify({
    request: {
      query: { account_id: 'SECRET_ACCOUNT_ID' },
      nonce: 'SECRET_NONCE',
    },
    response: {
      status: 401,
      rawBody: '{"error_code":"UNAUTHORIZED","message":"SECRET_MESSAGE"}',
      parsedBody: {
        error_code: 'UNAUTHORIZED',
        message: 'SECRET_MESSAGE',
      },
    },
  }));

  const diagnostic = safeBrokerFailure(sensitiveDiagnostic);
  assert.deepEqual(diagnostic, {
    httpStatus: 401,
    errorCode: 'UNAUTHORIZED',
    category: 'HTTP',
  });
  const serialized = JSON.stringify(diagnostic);
  assert.doesNotMatch(serialized, /SECRET_ACCOUNT_ID|SECRET_NONCE|SECRET_MESSAGE/u);
});

test('non-HTTP broker failures are reduced to a generic category', () => {
  assert.deepEqual(safeBrokerFailure(new Error('network failure with private context')), {
    httpStatus: null,
    errorCode: null,
    category: 'NETWORK_OR_RUNTIME',
  });
});
