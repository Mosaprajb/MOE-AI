import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

import {
  LIVE_SCANNER_API_PATH,
  LIVE_SCANNER_SCHEMA,
  enhanceLiveScannerDashboard,
  mergeLiveScannerSelection,
  opportunityInputsFromBotRecord,
} from '../src/dashboard/live-scanner.js';

const NOW = Date.parse('2026-07-31T03:00:00.000Z');

function submission({ symbol, score, timeframe = '5m', accepted = true, signalId } = {}) {
  return {
    symbol,
    score,
    brainScore: score,
    timeframe,
    higherTimeframe: '1h',
    accepted,
    submitted: accepted,
    signalId: signalId || `${symbol}-${timeframe}-${score}`,
    message: accepted ? 'AUTO_SCANNER_ACCEPTED' : 'REJECTED',
  };
}

test('legacy auto-scanner observations become observation-only Opportunity Manager inputs', () => {
  const inputs = opportunityInputsFromBotRecord({
    completedAt: new Date(NOW).toISOString(),
    submissions: [submission({ symbol: 'NVDA', score: 94 }), submission({ symbol: 'TSLA', score: 70, accepted: false })],
  }, { ttlMs: 60_000 });

  assert.equal(inputs.length, 1);
  assert.equal(inputs[0].opportunity.symbol, 'NVDA');
  assert.equal(inputs[0].opportunity.direction, 'LONG');
  assert.equal(inputs[0].opportunity.metadata.grade, 'AAA');
  assert.equal(inputs[0].opportunity.metadata.validForMs, 60_000);
  assert.equal(inputs[0].opportunity.executionAllowed, undefined);
});

test('Dashboard Live Scanner hides duplicates, chooses the best N, and exposes requested columns', () => {
  const snapshot = mergeLiveScannerSelection(null, {
    completedAt: new Date(NOW).toISOString(),
    submissions: [
      submission({ symbol: 'AAPL', score: 72, signalId: 'aapl-weak' }),
      submission({ symbol: 'AAPL', score: 91, signalId: 'aapl-strong' }),
      submission({ symbol: 'MSFT', score: 87 }),
      submission({ symbol: 'NVDA', score: 95 }),
    ],
  }, { now: NOW, topN: 2, ttlMs: 60_000 });

  assert.equal(snapshot.schema, LIVE_SCANNER_SCHEMA);
  assert.equal(snapshot.rows.length, 2);
  assert.deepEqual(snapshot.rows.map((item) => item.symbol), ['NVDA', 'AAPL']);
  assert.deepEqual(snapshot.rows.map((item) => item.rank), [1, 2]);
  assert.equal(snapshot.summary.duplicatesHidden, 1);
  for (const row of snapshot.rows) {
    assert.equal(typeof row.symbol, 'string');
    assert.equal(typeof row.grade, 'string');
    assert.equal(typeof row.score, 'number');
    assert.equal(typeof row.confidence, 'number');
    assert.equal(row.status, 'ACTIVE');
    assert.equal(typeof row.expiry, 'string');
    assert.equal(row.executionEnabled, false);
    assert.equal(row.executionAllowed, false);
  }
  assert.equal(snapshot.observationOnly, true);
});

test('expired opportunities disappear automatically on the next live snapshot read', () => {
  const active = mergeLiveScannerSelection(null, {
    completedAt: new Date(NOW).toISOString(),
    submissions: [submission({ symbol: 'AMD', score: 84 })],
  }, { now: NOW, topN: 5, ttlMs: 30_000 });

  assert.equal(active.rows.length, 1);
  const expired = mergeLiveScannerSelection(active, null, { now: NOW + 30_000, topN: 5, ttlMs: 30_000 });
  assert.equal(expired.rows.length, 0);
  assert.equal(expired.summary.expiredHidden, 1);
});

test('execution-enabled opportunities fail closed before reaching the dashboard', () => {
  assert.throws(() => mergeLiveScannerSelection(null, {
    selected: [{
      opportunity: {
        id: 'unsafe', symbol: 'AAPL', direction: 'LONG', timeframe: '5m', score: 90,
        confidence: 90, createdAt: new Date(NOW).toISOString(), executionAllowed: true,
        metadata: { setupFamily: 'BREAKOUT', validForMs: 60_000 },
      },
      status: 'ACTIVE',
      expiresAt: new Date(NOW + 60_000).toISOString(),
    }],
  }, { now: NOW }), /rejects execution-enabled input/);
});

test('dashboard HTML receives an idempotent live scanner with automatic refresh and no execution controls', async () => {
  const source = '<!doctype html><html><head></head><body><main></main></body></html>';
  const response = await enhanceLiveScannerDashboard(new Response(source, { headers: { 'content-type': 'text/html; charset=utf-8' } }));
  const html = await response.text();

  assert.match(html, /Dashboard Live Scanner/);
  assert.match(html, /SYMBOL/);
  assert.match(html, /GRADE/);
  assert.match(html, /SCORE/);
  assert.match(html, /CONFIDENCE/);
  assert.match(html, /STATUS/);
  assert.match(html, /EXPIRY/);
  assert.match(html, new RegExp(LIVE_SCANNER_API_PATH.replaceAll('/', '\\/')));
  assert.match(html, /setInterval\(refresh,5000\)/);
  assert.match(html, /OBSERVATION ONLY/);
  assert.doesNotMatch(html, /submitOrder|execution button/i);

  const second = await enhanceLiveScannerDashboard(new Response(html, { headers: { 'content-type': 'text/html' } }));
  const secondHtml = await second.text();
  assert.equal((secondHtml.match(/dashboardLiveScannerScript/g) || []).length, 1);
});

test('production dashboard entry exposes Durable Object persistence and the read-only live endpoint', async () => {
  const source = await fs.readFile(new URL('../src/trading-dashboard-entry.js', import.meta.url), 'utf8');
  assert.match(source, /class AlertCoordinator extends TradingAlertCoordinator/);
  assert.match(source, /recordOpportunitySelection/);
  assert.match(source, /liveScannerSnapshot/);
  assert.match(source, /recordBotStatus/);
  assert.match(source, /LIVE_SCANNER_API_PATH/);
  assert.match(source, /executionEnabled: false/);
  assert.match(source, /executionAllowed: false/);
  assert.match(source, /enhanceLiveScannerDashboard/);
});
