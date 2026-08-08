import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const manager = fs.readFileSync(
  new URL('../src/lib/position-manager.ts', import.meta.url),
  'utf8',
);

const scanner = fs.readFileSync(
  new URL('../src/routes/scanner.ts', import.meta.url),
  'utf8',
);

test('scanner MARKET exit remains EXIT_PENDING after submission', () => {
  const start = manager.indexOf(
    'export async function requestScannerPositionExit(',
  );
  const end = manager.indexOf(
    '/** Manage only FILLED/OPEN positions',
    start,
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const request = manager.slice(start, end);

  assert.match(request, /status = 'EXIT_PENDING'/);
  assert.match(request, /webull_order_id = \?/);
  assert.match(request, /await client\.placeOrder/);
  assert.doesNotMatch(request, /status = 'CLOSED'/);
});

test('scanner exit reconciliation verifies order and broker position before CLOSED', () => {
  const start = manager.indexOf(
    'export async function syncScannerOrders(',
  );
  const end = manager.indexOf(
    '/** Load all active scanner rows',
    start,
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const sync = manager.slice(start, end);

  assert.match(
    sync,
    /status IN \('PENDING', 'OPEN', 'EXIT_PENDING'\)/,
  );
  assert.match(sync, /status === 'EXIT_PENDING'/);
  assert.match(sync, /getWebullOrderDetail/);
  assert.match(sync, /finalizeScannerExit/);
  assert.match(sync, /cancelOrder\(clientOrderId\)/);
  assert.match(sync, /isWebullOrderTerminal/);
});

test('manual scanner close returns pending instead of writing CLOSED directly', () => {
  const start = scanner.indexOf(
    "scanner.post('/positions/:id/close'",
  );
  const end = scanner.indexOf(
    "scanner.get('/search'",
    start,
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const route = scanner.slice(start, end);

  assert.match(route, /requestScannerPositionExit/);
  assert.match(route, /pending: true/);
  assert.match(route, /}, 202\)/);
  assert.doesNotMatch(route, /status = 'CLOSED'/);
});

test('scanner exit requires atomic D1 claim before broker submission', () => {
  const start = manager.indexOf(
    'export async function requestScannerPositionExit(',
  );

  const end = manager.indexOf(
    '/** Manage only FILLED/OPEN positions',
    start,
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const request = manager.slice(start, end);

  const claimIndex = request.indexOf(
    'const claim = await env.DB.prepare',
  );

  const changesIndex = request.indexOf(
    'claim.meta.changes',
  );

  const submitIndex = request.indexOf(
    'await client.placeOrder',
  );

  assert.ok(claimIndex >= 0);
  assert.ok(changesIndex > claimIndex);
  assert.ok(submitIndex > changesIndex);

  assert.match(
    request,
    /status = 'EXIT_PENDING'/,
  );

  assert.match(
    request,
    /Number\(claim\.meta\.changes \?\? 0\) !== 1/,
  );
});

test('scanner exit accepts only exact client order ID detail', () => {
  const start = manager.indexOf(
    "if (status === 'EXIT_PENDING')",
  );

  const end = manager.indexOf(
    'if (brokerPosition && brokerPosition.quantity > 0)',
    start,
  );

  assert.ok(start >= 0);
  assert.ok(end > start);

  const reconcile = manager.slice(start, end);

  assert.match(
    reconcile,
    /candidate => candidate\.clientOrderId === clientOrderId/,
  );

  assert.doesNotMatch(
    reconcile,
    /\?\? details\[0\]/,
  );
});
