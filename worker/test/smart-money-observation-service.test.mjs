import test from 'node:test';
import assert from 'node:assert/strict';
import { runSmartMoneyObservation, smartMoneyObservationDue } from '../src/smart-money/observation-service.js';

const dueTime = 101 * 60_000;
const window = { open: true, label: 'CORE', session: 'CORE', dataFeed: 'iex' };

function baseEnv(overrides = {}) {
  return {
    SMART_MONEY_OBSERVATION_ENABLED: 'true',
    SMART_MONEY_OBSERVATION_TIMEFRAME: '5m',
    SMART_MONEY_OBSERVATION_LIMIT: '5',
    SMART_MONEY_OBSERVATION_TOP_RESULTS: '2',
    WEBULL_LIVE_TRADING: 'false',
    ALPACA_KEY_ID: 'test-key',
    ALPACA_SECRET_KEY: 'test-secret',
    ...overrides,
  };
}

function fakeFetch() {
  return Promise.resolve({
    ok: true,
    status: 200,
    async json() {
      return {
        bars: {
          AAPL: [{ t: '2026-07-24T14:30:00.000Z', o: 100, h: 101, l: 99, c: 100.5, v: 1000 }],
          MSFT: [{ t: '2026-07-24T14:30:00.000Z', o: 200, h: 202, l: 199, c: 201, v: 1200 }],
        },
        next_page_token: null,
      };
    },
  });
}

test('observation cadence waits for a completed configured candle', () => {
  assert.equal(smartMoneyObservationDue(dueTime, '5m'), true);
  assert.equal(smartMoneyObservationDue(dueTime + 60_000, '5m'), false);
});

test('disabled observation remains execution locked', async () => {
  const result = await runSmartMoneyObservation({
    env: baseEnv({ SMART_MONEY_OBSERVATION_ENABLED: 'false' }),
    scheduledTime: dueTime,
    window,
    universe: ['AAPL'],
  });
  assert.equal(result.skipped, 'SMART_MONEY_OBSERVATION_DISABLED');
  assert.equal(result.observationOnly, true);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.automaticSubmissionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
});

test('live trading activates a hard observation safety lock', async () => {
  const result = await runSmartMoneyObservation({
    env: baseEnv({ WEBULL_LIVE_TRADING: 'true' }),
    scheduledTime: dueTime,
    window,
    universe: ['AAPL'],
  });
  assert.equal(result.ok, false);
  assert.equal(result.skipped, 'LIVE_TRADING_SAFETY_LOCK');
  assert.deepEqual(result.topOpportunities, []);
  assert.equal(result.executionAllowed, false);
});

test('sidecar fetches market data and stores only ranked observations', async () => {
  let captured = null;
  const evaluator = async (input) => {
    captured = input;
    return {
      observations: [
        {
          symbol: 'AAPL', setupScore: 88, setupFamily: 'BREAKER_RETEST', direction: 'BULLISH',
          candidate: { timeframe: '5m', state: 'OBSERVATION_CANDIDATE', entry: 100, stopLoss: 98, takeProfit: 104, rewardRisk: 2 },
          failedConditions: [],
        },
        {
          symbol: 'MSFT', setupScore: 76, setupFamily: 'FVG_REPRICING', direction: 'BULLISH',
          candidate: { timeframe: '5m', state: 'OBSERVATION_CANDIDATE', entry: 200, stopLoss: 196, takeProfit: 208, rewardRisk: 2 },
          failedConditions: ['SMART_MONEY_FOUNDATION_OBSERVATION_ONLY'],
        },
        { symbol: 'NVDA', setupScore: 0, setupFamily: 'UNCLASSIFIED', direction: null, candidate: null, failedConditions: ['NO_SETUP'] },
      ],
      rejected: [{ symbol: 'NVDA', reason: 'SCANNER_MARKET_DATA_MISSING' }],
    };
  };

  const result = await runSmartMoneyObservation({
    env: baseEnv(),
    scheduledTime: dueTime,
    window,
    universe: ['AAPL', 'MSFT', 'NVDA'],
    fetchImpl: fakeFetch,
    evaluator,
  });

  assert.ok(captured);
  assert.equal(captured.timeframe, '5m');
  assert.deepEqual(captured.symbols, ['AAPL', 'MSFT', 'NVDA']);
  assert.equal(result.ok, true);
  assert.equal(result.topOpportunities.length, 2);
  assert.equal(result.topOpportunities[0].symbol, 'AAPL');
  assert.equal(result.topOpportunities[0].setupScore, 88);
  assert.equal(result.topOpportunities[0].executionAllowed, false);
  assert.equal(result.observationOnly, true);
  assert.equal(result.mode, 'PAPER_TRADING');
  assert.equal(result.executionAllowed, false);
  assert.equal(result.automaticSubmissionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
});
