import test from 'node:test';
import assert from 'node:assert/strict';
import { enhancePortfolioRiskDashboard } from '../src/trading-intelligence/portfolio-risk-overlay.js';

test('portfolio risk overlay adds responsive production-aware risk panel', async () => {
  const original = new Response('<!doctype html><html><head><title>MOE</title></head><body><main></main></body></html>', {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8', 'content-length': '100' },
  });
  const enhanced = await enhancePortfolioRiskDashboard(original);
  const html = await enhanced.text();
  assert.equal(enhanced.status, 200);
  assert.match(html, /portfolioRiskStyles/);
  assert.match(html, /portfolioRiskScript/);
  assert.match(html, /PORTFOLIO & CAPITAL RISK/);
  assert.match(html, /Portfolio Risk Command Panel/);
  assert.match(html, /Execution Permission/);
  assert.match(html, /PRODUCTION ACCOUNT/);
  assert.match(html, /SANDBOX ACCOUNT/);
  assert.match(html, /PIN required to display Production portfolio risk/);
  assert.match(html, /\/api\/trading-intelligence\/portfolio-risk/);
  assert.match(html, /options\.method='POST'/);
  assert.match(html, /JSON\.stringify\(\{pin\}\)/);
  assert.match(html, /setInterval\(refresh,60000\)/);
  assert.match(html, /node\.id='portfolio-risk'/);
  assert.match(html, /getElementById\('portfolio-risk'\)/);
  assert.match(html, /scroll-margin-top:90px/);
  assert.equal(enhanced.headers.has('content-length'), false);
});

test('portfolio risk overlay passes through non-html responses', async () => {
  const original = Response.json({ ok: true });
  const enhanced = await enhancePortfolioRiskDashboard(original);
  assert.equal(enhanced, original);
  assert.deepEqual(await enhanced.json(), { ok: true });
});

test('portfolio risk overlay is idempotent', async () => {
  const original = new Response('<html><head></head><body><script id="portfolioRiskScript"></script></body></html>', {
    headers: { 'content-type': 'text/html' },
  });
  const enhanced = await enhancePortfolioRiskDashboard(original);
  const html = await enhanced.text();
  assert.equal((html.match(/portfolioRiskScript/g) || []).length, 1);
});