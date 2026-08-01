import assert from 'node:assert/strict';
import test from 'node:test';
import { createWebullAccessToken } from '../src/webull-client.js';

test('Webull token creation uses the Sandbox host, JSON content type, and no access token', async () => {
  const originalFetch = globalThis.fetch;
  let captured = null;

  globalThis.fetch = async (url, init = {}) => {
    captured = { url: String(url), init };
    return new Response(JSON.stringify({ access_token: 'sandbox-token' }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const result = await createWebullAccessToken({
      WEBULL_ENVIRONMENT: 'sandbox',
      WEBULL_API_BASE_URL: 'https://api.sandbox.webull.com',
      WEBULL_APP_KEY: 'sandbox-app-key',
      WEBULL_APP_SECRET: 'sandbox-app-secret',
    });

    assert.equal(result.access_token, 'sandbox-token');
    assert.equal(captured.url, 'https://api.sandbox.webull.com/openapi/auth/token/create');
    assert.equal(captured.init.method, 'POST');

    const headers = new Headers(captured.init.headers);
    assert.equal(headers.get('content-type'), 'application/json');
    assert.equal(headers.get('x-app-key'), 'sandbox-app-key');
    assert.equal(headers.get('x-access-token'), null);
    assert.equal(headers.get('x-version'), 'v2');
    assert.equal(typeof headers.get('x-signature'), 'string');
    assert.ok(headers.get('x-signature').length > 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
