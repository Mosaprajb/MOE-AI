import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceConflictActivityDashboard } from '../src/trading-intelligence/conflict-activity-overlay.js';

test('injects conflict summary and activity feed dashboard once', async () => {
  const response = new Response('<!doctype html><html><head><title>MOE AI</title></head><body><main></main></body></html>', {
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '100' },
  });
  const enhanced = await enhanceConflictActivityDashboard(response);
  const html = await enhanced.text();
  assert.match(html, /conflictActivityStyles/);
  assert.match(html, /conflictActivityScript/);
  assert.match(html, /Trading Intelligence Command Center/);
  assert.match(html, /\/api\/trading-intelligence\/command-center/);
  assert.match(html, /DEDUPLICATED ACTIVITY FEED/);
  assert.equal(enhanced.headers.has('content-length'), false);

  const second = await enhanceConflictActivityDashboard(new Response(html, { headers: { 'content-type': 'text/html' } }));
  const repeated = await second.text();
  assert.equal((repeated.match(/id="conflictActivityScript"/g) || []).length, 1);
});

test('does not alter non-html responses', async () => {
  const response = new Response(JSON.stringify({ ok: true }), { headers: { 'content-type': 'application/json' } });
  const enhanced = await enhanceConflictActivityDashboard(response);
  assert.equal(await enhanced.text(), JSON.stringify({ ok: true }));
});

test('overlay includes responsive and escaped rendering safeguards', async () => {
  const response = new Response('<html><head></head><body></body></html>', { headers: { 'content-type': 'text/html' } });
  const html = await (await enhanceConflictActivityDashboard(response)).text();
  assert.match(html, /@media\(max-width:950px\)/);
  assert.match(html, /@media\(max-width:520px\)/);
  assert.match(html, /replace\(\/\[&<>/);
  assert.match(html, /encodeURIComponent/);
  assert.match(html, /cache:'no-store'/);
});
