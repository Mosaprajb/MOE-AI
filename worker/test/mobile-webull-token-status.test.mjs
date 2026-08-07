import test from 'node:test';
import assert from 'node:assert/strict';
import { checkLiveWebullToken } from '../src/lib/webull-token-status.ts';

const liveEnv = {
  WEBULL_LIVE_API_BASE_URL: 'https://api.webull.com',
  WEBULL_LIVE_APP_KEY: 'live-app-key',
  WEBULL_LIVE_APP_SECRET: 'live-app-secret',
  WEBULL_LIVE_ACCESS_TOKEN: '0123456789abcdef0123456789abcdef',
};

test('Check Token signs POST body without authenticating with the token being checked', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const headers = new Headers(init?.headers);
    assert.equal(url.pathname, '/openapi/auth/token/check');
    assert.equal(init?.method, 'POST');
    assert.equal(headers.get('x-app-key'), 'live-app-key');
    assert.ok(headers.get('x-signature'));
    assert.equal(headers.get('x-access-token'), null);
    assert.deepEqual(JSON.parse(String(init?.body)), {
      token: '0123456789abcdef0123456789abcdef',
    });
    return new Response(JSON.stringify({
      token: '0123456789abcdef0123456789abcdef',
      expires: Date.now() + 10000,
      status: 'NORMAL',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  try {
    assert.deepEqual(await checkLiveWebullToken(liveEnv), {
      ok: true,
      status: 'NORMAL',
      httpStatus: 200,
      errorCode: null,
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Check Token preserves INVALID and EXPIRED lifecycle states without exposing the token', async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const status of ['INVALID', 'EXPIRED']) {
      globalThis.fetch = async () => new Response(JSON.stringify({
        token: '0123456789abcdef0123456789abcdef',
        expires: 0,
        status,
      }), { status: 200 });
      const result = await checkLiveWebullToken(liveEnv);
      assert.deepEqual(result, {
        ok: false,
        status,
        httpStatus: 200,
        errorCode: null,
      });
      assert.doesNotMatch(JSON.stringify(result), /0123456789abcdef/u);
    }
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Check Token reduces unauthorized responses to HTTP status and error code', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error_code: 'UNAUTHORIZED',
    message: 'sensitive broker message',
  }), { status: 401 });

  try {
    const result = await checkLiveWebullToken(liveEnv);
    assert.deepEqual(result, {
      ok: false,
      status: 'UNKNOWN',
      httpStatus: 401,
      errorCode: 'UNAUTHORIZED',
    });
    assert.doesNotMatch(JSON.stringify(result), /sensitive broker message/u);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
