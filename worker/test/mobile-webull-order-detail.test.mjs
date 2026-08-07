import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getWebullOrderDetail,
  isWebullOrderFullyFilled,
  isWebullOrderTerminal,
} from '../src/lib/webull-order-detail.ts';

const sandboxEnv = {
  WEBULL_SANDBOX_API_BASE_URL: 'https://api.sandbox.webull.com',
  WEBULL_SANDBOX_APP_KEY: 'test-app-key',
  WEBULL_SANDBOX_APP_SECRET: 'test-app-secret',
  WEBULL_SANDBOX_ACCESS_TOKEN: 'test-access-token',
  WEBULL_SANDBOX_ACCOUNT_ID: 'test-account-id',
};

test('Order Detail queries by client_order_id and parses both OCO legs', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.pathname, '/openapi/trade/order/detail');
    assert.equal(url.searchParams.get('account_id'), 'test-account-id');
    assert.equal(url.searchParams.get('client_order_id'), 'moetp123');
    assert.equal(init?.method, 'GET');
    assert.ok(new Headers(init?.headers).get('x-signature'));

    return new Response(JSON.stringify({
      client_order_id: 'moeoc123',
      combo_type: 'OCO',
      orders: [
        {
          client_order_id: 'moetp123',
          order_id: 'tp-order',
          symbol: 'AAPL',
          status: 'CANCELLED',
          filled_quantity: '0',
          total_quantity: '10',
        },
        {
          client_order_id: 'moesl123',
          order_id: 'sl-order',
          symbol: 'AAPL',
          status: 'CANCELLED',
          filled_quantity: '0',
          total_quantity: '10',
        },
      ],
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  };

  try {
    const details = await getWebullOrderDetail(sandboxEnv, 'SANDBOX', 'moetp123');
    assert.equal(details.length, 2);
    assert.deepEqual(details.map(detail => detail.status), ['CANCELLED', 'CANCELLED']);
    assert.equal(details[0].filledQuantity, 0);
    assert.equal(details[0].totalQuantity, 10);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('Order Detail accepts a nested data object response', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    data: {
      client_order_id: 'moesl456',
      order_id: 'sl-order',
      symbol: 'MSFT',
      status: 'PARTIAL_FILLED',
      filled_quantity: '2',
      total_quantity: '5',
    },
  }), { status: 200 });

  try {
    const [detail] = await getWebullOrderDetail(sandboxEnv, 'SANDBOX', 'moesl456');
    assert.equal(detail.clientOrderId, 'moesl456');
    assert.equal(detail.status, 'PARTIAL_FILLED');
    assert.equal(detail.filledQuantity, 2);
    assert.equal(detail.totalQuantity, 5);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('only cancelled, filled, and failed statuses are terminal', () => {
  for (const status of ['CANCELLED', 'FILLED', 'FAILED']) {
    assert.equal(isWebullOrderTerminal(status), true);
  }
  for (const status of ['PENDING', 'SUBMITTED', 'PARTIAL_FILLED', 'UNKNOWN']) {
    assert.equal(isWebullOrderTerminal(status), false);
  }

  assert.equal(isWebullOrderFullyFilled({
    clientOrderId: 'filled',
    orderId: 'filled',
    symbol: 'AAPL',
    status: 'FILLED',
    filledQuantity: 10,
    totalQuantity: 10,
  }), true);
  assert.equal(isWebullOrderFullyFilled({
    clientOrderId: 'cancelled',
    orderId: 'cancelled',
    symbol: 'AAPL',
    status: 'CANCELLED',
    filledQuantity: 2,
    totalQuantity: 10,
  }), false);
});
