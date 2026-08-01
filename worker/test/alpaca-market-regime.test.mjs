import assert from 'node:assert/strict';
import test from 'node:test';
import { hourlyTrend, probeAlpacaHourlyRegime } from '../src/alpaca-market-regime.js';

function bars(count, start = 100, step = 1) {
  return Array.from({ length: count }, (_, index) => ({ c: start + index * step }));
}

test('hourly trend requires enough bars for EMA50 and reports a bullish regime', () => {
  const incomplete = hourlyTrend(bars(49));
  assert.equal(incomplete.ready, false);
  assert.equal(incomplete.barCount, 49);

  const bullish = hourlyTrend(bars(60));
  assert.equal(bullish.ready, true);
  assert.equal(bullish.trend, 'BULLISH');
  assert.equal(bullish.barCount, 60);
  assert.ok(bullish.latest > bullish.ema20);
  assert.ok(bullish.ema20 > bullish.ema50);
});

test('Alpaca regime probe fetches SPY and QQQ independently to avoid multi-symbol truncation', async () => {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    const parsed = new URL(url);
    calls.push({ parsed, headers: new Headers(init.headers) });
    const symbol = parsed.pathname.split('/').at(-2);
    return Response.json({ bars: symbol === 'SPY' ? bars(60, 100, 1) : bars(60, 200, 1) });
  };

  const result = await probeAlpacaHourlyRegime({
    ALPACA_KEY_ID: 'sandbox-key',
    ALPACA_SECRET_KEY: 'sandbox-secret',
  }, {
    fetchImpl,
    cache: false,
    now: new Date('2026-08-01T07:00:00.000Z'),
  });

  assert.equal(result.status, 'CONNECTED');
  assert.equal(result.regime, 'BULLISH');
  assert.equal(result.indexes.SPY.barCount, 60);
  assert.equal(result.indexes.QQQ.barCount, 60);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map(({ parsed }) => parsed.pathname).sort(), [
    '/v2/stocks/QQQ/bars',
    '/v2/stocks/SPY/bars',
  ]);
  for (const call of calls) {
    assert.equal(call.parsed.searchParams.has('symbols'), false);
    assert.equal(call.parsed.searchParams.get('timeframe'), '1Hour');
    assert.equal(call.headers.get('APCA-API-KEY-ID'), 'sandbox-key');
    assert.equal(call.headers.get('APCA-API-SECRET-KEY'), 'sandbox-secret');
  }
});

test('Alpaca regime probe reports missing credentials without making a request', async () => {
  let called = false;
  const result = await probeAlpacaHourlyRegime({}, {
    fetchImpl: async () => {
      called = true;
      throw new Error('should not run');
    },
    cache: false,
  });

  assert.equal(called, false);
  assert.equal(result.status, 'ERROR');
  assert.equal(result.reason, 'CREDENTIALS_MISSING');
});
