import test from 'node:test';
import assert from 'node:assert/strict';
import { enhanceSmartMoneyDashboard } from '../src/smart-money/dashboard-overlay.js';

test('dashboard overlay adds institutional flow UI without changing response status', async () => {
  const original = new Response('<!doctype html><html><head><title>MOE</title></head><body><section id="scanner"></section></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '100' },
  });
  const enhanced = await enhanceSmartMoneyDashboard(original);
  const html = await enhanced.text();
  assert.equal(enhanced.status, 200);
  assert.match(html, /smartMoneyObservationStyles/);
  assert.match(html, /smartMoneyObservationScript/);
  assert.match(html, /INSTITUTIONAL FLOW PIPELINE/);
  assert.match(html, /Stop Run → Absorption → Imbalance → Structure → Risk/);
  assert.match(html, /OBSERVATION ONLY/);
  assert.match(html, /stageDistribution/);
  assert.match(html, /FAILED STAGE/);
  assert.match(html, /\/api\/scanner\/status/);
  assert.equal(enhanced.headers.has('content-length'), false);
});

test('non-HTML responses pass through unchanged', async () => {
  const original = Response.json({ ok: true });
  const enhanced = await enhanceSmartMoneyDashboard(original);
  assert.equal(enhanced, original);
  assert.deepEqual(await enhanced.json(), { ok: true });
});

test('overlay is idempotent', async () => {
  const original = new Response('<html><head></head><body><div id="smartMoneyObservationScript"></div></body></html>', {
    headers: { 'content-type': 'text/html' },
  });
  const enhanced = await enhanceSmartMoneyDashboard(original);
  const html = await enhanced.text();
  assert.equal((html.match(/smartMoneyObservationScript/g) || []).length, 1);
});
