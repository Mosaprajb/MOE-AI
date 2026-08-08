import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const transport = fs.readFileSync(
  new URL(
    '../src/lib/webull-transport.ts',
    import.meta.url,
  ),
  'utf8',
);

const consumers = [
  '../src/lib/webull.ts',
  '../src/lib/webull-order-detail.ts',
  '../src/lib/webull-token-status.ts',
].map(path =>
  fs.readFileSync(
    new URL(path, import.meta.url),
    'utf8',
  ),
);

test('Webull signing is centralized in one transport module', () => {
  assert.match(
    transport,
    /crypto\.subtle\.importKey/,
  );

  assert.match(
    transport,
    /x-signature-algorithm': 'HMAC-SHA1'/,
  );

  assert.match(
    transport,
    /function md5\(/,
  );

  for (const source of consumers) {
    assert.match(
      source,
      /webullSignedRequest/,
    );

    assert.doesNotMatch(
      source,
      /crypto\.subtle\.importKey/,
    );

    assert.doesNotMatch(
      source,
      /function md5\(/,
    );

    assert.doesNotMatch(
      source,
      /function toBase64\(/,
    );
  }
});

test('shared Webull transport keeps access-token authentication optional', async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];

  globalThis.fetch = async (input, init) => {
    requests.push({
      url: new URL(String(input)),
      method: init?.method,
      headers: new Headers(init?.headers),
      body: init?.body == null ? null : String(init.body),
    });

    return new Response(
      JSON.stringify({ ok: true }),
      {
        status: 200,
        headers: { 'content-type': 'application/json' },
      },
    );
  };

  try {
    const { webullSignedRequest } = await import(
      '../src/lib/webull-transport.ts'
    );

    await webullSignedRequest({
      baseUrl: 'https://api.sandbox.webull.com',
      appKey: 'sandbox-app-key',
      appSecret: 'sandbox-app-secret',
      accessToken: 'sandbox-access-token',
      method: 'GET',
      path: '/openapi/trade/order/detail',
      query: {
        account_id: 'account-123',
        client_order_id: 'order-123',
      },
    });

    await webullSignedRequest({
      baseUrl: 'https://api.webull.com',
      appKey: 'live-app-key',
      appSecret: 'live-app-secret',
      method: 'POST',
      path: '/openapi/auth/token/check',
      body: {
        token: 'candidate-token',
      },
    });

    assert.equal(requests.length, 2);

    const authenticated = requests[0];

    assert.equal(
      authenticated.headers.get('x-access-token'),
      'sandbox-access-token',
    );

    assert.ok(
      authenticated.headers.get('x-signature'),
    );

    assert.equal(
      authenticated.url.searchParams.get('account_id'),
      'account-123',
    );

    assert.equal(
      authenticated.url.searchParams.get('client_order_id'),
      'order-123',
    );

    const tokenCheck = requests[1];

    assert.equal(
      tokenCheck.headers.get('x-access-token'),
      null,
    );

    assert.ok(
      tokenCheck.headers.get('x-signature'),
    );

    assert.equal(
      tokenCheck.headers.get('content-type'),
      'application/json',
    );

    assert.deepEqual(
      JSON.parse(tokenCheck.body),
      {
        token: 'candidate-token',
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
