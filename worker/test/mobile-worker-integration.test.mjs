import test from 'node:test';
import assert from 'node:assert/strict';
import app from '../src/index.ts';

class FakeStatement {
  constructor(database, query) {
    this.database = database;
    this.query = query;
    this.values = [];
  }
  bind(...values) {
    this.values = values;
    return this;
  }
  async first() {
    if (this.query.includes('mobile_login_attempts')) return null;
    if (this.query.includes('COUNT(*) AS count')) return { count: 0 };
    if (this.query.includes('created_at FROM decisions')) return null;
    return null;
  }
  async all() {
    return { results: [] };
  }
  async run() {
    this.database.runs.push({ query: this.query, values: this.values });
    return { meta: { changes: 1 } };
  }
}

class FakeDatabase {
  constructor() {
    this.runs = [];
  }
  async exec() {}
  prepare(query) {
    return new FakeStatement(this, query);
  }
}

class FakeKV {
  constructor() {
    this.values = new Map();
  }
  async get(key, type) {
    const value = this.values.get(key);
    if (value == null) return null;
    return type === 'json' ? JSON.parse(value) : value;
  }
  async put(key, value) {
    this.values.set(key, value);
  }
}

function createEnv(overrides = {}) {
  return {
    DB: new FakeDatabase(),
    CONFIG: new FakeKV(),
    WORKER_VERSION: 'test',
    STRATEGY_VERSION: 'test',
    MAX_OPEN_POSITIONS: '2',
    MAX_DAILY_TRADES: '4',
    MAX_DAILY_LOSS_PCT: '1',
    MAX_OPEN_RISK_PCT: '1',
    MAX_PORTFOLIO_HEAT: '2',
    ALLOWED_ORIGINS: '',
    MOE_MOBILE_CONTROL_PIN: '246810',
    MOE_MOBILE_SESSION_SECRET: 's'.repeat(48),
    MOE_MOBILE_LIVE_CONTROL_ENABLED: 'false',
    APNS_ENABLED: 'false',
    APNS_BUNDLE_ID: 'com.moerand.moeai',
    ...overrides,
  };
}

async function login(env) {
  const response = await app.request(
    'https://worker.example/api/tradingview/session',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-moe-request-id': 'login-test' },
      body: JSON.stringify({ pin: '246810' }),
    },
    env,
  );
  assert.equal(response.status, 200);
  const cookie = response.headers.get('set-cookie');
  assert.ok(cookie);
  return cookie.split(';', 1)[0];
}



test('mobile status requires an authenticated cookie', async () => {
  const response = await app.request(
    'https://worker.example/api/tradingview/status',
    { method: 'GET' },
    createEnv(),
  );
  assert.equal(response.status, 401);
});

test('PIN login creates a secure session and status stays read-only without broker secrets', async () => {
  const env = createEnv();
  const cookie = await login(env);
  const response = await app.request(
    'https://worker.example/api/tradingview/status',
    { method: 'GET', headers: { cookie } },
    env,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get('cache-control') ?? '', /no-store/u);
  const payload = await response.json();
  assert.equal(payload.ok, true);
  assert.equal(payload.runtime.accountType, 'DEMO');
  assert.equal(payload.accounts.demo.connected, false);
  assert.equal(payload.accounts.live.connected, false);
});

test('Live reception remains blocked unless the dedicated server gate is enabled', async () => {
  const env = createEnv();
  const cookie = await login(env);
  const response = await app.request(
    'https://worker.example/api/tradingview/reception',
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: true, accountType: 'LIVE', confirmation: 'CONFIRM' }),
    },
    env,
  );
  assert.equal(response.status, 423);
  assert.match((await response.json()).error, /blocked by the server policy/u);
});

test('push registration accepts a valid iOS token while APNs sending remains disabled', async () => {
  const env = createEnv();
  const cookie = await login(env);
  const response = await app.request(
    'https://worker.example/api/mobile/push/register',
    {
      method: 'POST',
      headers: { cookie, 'content-type': 'application/json' },
      body: JSON.stringify({
        token: 'ab'.repeat(32),
        platform: 'ios',
        bundleIdentifier: 'com.moerand.moeai',
        environment: 'development',
      }),
    },
    env,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).registered, true);

  const testResponse = await app.request(
    'https://worker.example/api/mobile/push/test',
    { method: 'POST', headers: { cookie } },
    env,
  );
  assert.equal(testResponse.status, 503);
  assert.match((await testResponse.json()).error, /disabled/u);
});

test('disabled mobile reception blocks TradingView webhook execution before order logic', async () => {
  const env = createEnv();
  await env.CONFIG.put('mobile:tradingview-reception', JSON.stringify({
    enabled: false,
    accountType: 'DEMO',
    updatedAt: new Date().toISOString(),
  }));
  const response = await app.request(
    'https://worker.example/api/tradingview/webhook',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ symbol: 'AAPL', action: 'buy' }),
    },
    env,
  );
  assert.equal(response.status, 423);
  assert.equal((await response.json()).code, 'TRADINGVIEW_RECEPTION_DISABLED');
});
