import test from 'node:test';
import assert from 'node:assert/strict';
import { runSmartMoneyObservation, smartMoneyObservationDue } from '../src/smart-money/observation-service.js';
import { evaluateInstitutionalFlowScannerBatch } from '../src/institutional-flow/scanner-adapter.js';

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

function pipelineResult(symbol, options = {}) {
  const passed = options.passed === true;
  const failedStage = passed ? null : (options.failedStage || 'ABSORPTION');
  const stages = {
    STOP_RUN: { passed: true, status: 'PASSED', score: 84, classification: 'STOP_RUN_REVERSAL', failedConditions: [] },
    ABSORPTION: failedStage === 'ABSORPTION'
      ? { passed: false, status: 'REJECTED', score: 62, classification: 'AMBIGUOUS', failedConditions: ['PROXY_ABSORPTION_SCORE_BELOW_MINIMUM'] }
      : { passed: true, status: 'PASSED', score: 82, classification: 'PROBABLE_ABSORPTION', failedConditions: [] },
    IMBALANCE: passed
      ? { passed: true, status: 'PASSED', score: 80, classification: 'PRICE_IMBALANCE', failedConditions: [] }
      : { passed: false, status: 'BLOCKED', score: 0, classification: 'INVALID', failedConditions: ['BLOCKED_BY_ABSORPTION_STAGE'] },
    STRUCTURE_CONFIRMATION: passed
      ? { passed: true, status: 'PASSED', score: 86, classification: 'MARKET_STRUCTURE_SHIFT', failedConditions: [] }
      : { passed: false, status: 'BLOCKED', score: 0, classification: 'INVALID', failedConditions: ['BLOCKED_BY_IMBALANCE_STAGE'] },
    RISK_ENGINE: passed
      ? { passed: true, status: 'PASSED', score: 75, classification: 'OBSERVATION_ACCEPTED', failedConditions: [] }
      : { passed: false, status: 'BLOCKED', score: 0, classification: 'INVALID', failedConditions: ['BLOCKED_BY_STRUCTURE_CONFIRMATION_STAGE'] },
  };
  return {
    symbol,
    pipelinePassed: passed,
    pipelineScore: options.score || (passed ? 86 : 68),
    failedStage,
    reason: passed ? 'INSTITUTIONAL_FLOW_OBSERVATION_ONLY' : `${failedStage}_STAGE_REJECTED`,
    direction: 'BULLISH',
    dataMode: options.dataMode || 'PROXY_ABSORPTION',
    stages,
    candidate: passed ? {
      status: 'OBSERVATION_CANDIDATE',
      imbalanceType: 'BULLISH_FVG',
      entry: 100,
      stopLoss: 98,
      takeProfit: 104,
      rewardRisk: 2,
    } : null,
  };
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

test('institutional scanner adapter ranks completed pipelines before rejected stages', async () => {
  const evaluator = async ({ symbol }) => symbol === 'AAPL'
    ? pipelineResult(symbol, { passed: true, score: 88 })
    : pipelineResult(symbol, { passed: false, score: 72, failedStage: 'ABSORPTION' });
  const result = await evaluateInstitutionalFlowScannerBatch({
    symbols: ['MSFT', 'AAPL'],
    marketDataBySymbol: {
      AAPL: { bars: [{ t: 1 }] },
      MSFT: { bars: [{ t: 1 }] },
    },
    evaluator,
  });
  assert.equal(result.observations[0].symbol, 'AAPL');
  assert.equal(result.observations[0].pipelinePassed, true);
  assert.equal(result.observations[1].failedStage, 'ABSORPTION');
  assert.equal(result.completedCandidates, 1);
  assert.equal(result.stageDistribution.ABSORPTION, 1);
  assert.equal(result.executionAllowed, false);
});

test('sidecar stores pipeline stage diagnostics and ranked observation candidates', async () => {
  let captured = null;
  const evaluator = async (input) => {
    captured = input;
    return {
      observations: [
        {
          ...pipelineResult('AAPL', { passed: true, score: 88 }),
          currentStage: 'RISK_ENGINE',
        },
        {
          ...pipelineResult('MSFT', { passed: false, score: 76, failedStage: 'ABSORPTION' }),
          currentStage: 'STOP_RUN',
        },
        {
          ...pipelineResult('NVDA', { passed: false, score: 0, failedStage: 'STOP_RUN' }),
          currentStage: 'STOP_RUN',
        },
      ],
      rejected: [{ symbol: 'NVDA', reason: 'SCANNER_MARKET_DATA_MISSING' }],
      completedCandidates: 1,
      stageDistribution: { STOP_RUN: 1, ABSORPTION: 1, IMBALANCE: 0, STRUCTURE_CONFIRMATION: 0, RISK_ENGINE: 0 },
      stageOrder: ['STOP_RUN', 'ABSORPTION', 'IMBALANCE', 'STRUCTURE_CONFIRMATION', 'RISK_ENGINE'],
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
  assert.equal(result.engine, 'INSTITUTIONAL_FLOW_PIPELINE');
  assert.equal(result.completedCandidates, 1);
  assert.equal(result.stageDistribution.ABSORPTION, 1);
  assert.equal(result.topOpportunities.length, 2);
  assert.equal(result.topOpportunities[0].symbol, 'AAPL');
  assert.equal(result.topOpportunities[0].pipelinePassed, true);
  assert.equal(result.topOpportunities[0].candidateState, 'OBSERVATION_CANDIDATE');
  assert.equal(result.topOpportunities[1].failedStage, 'ABSORPTION');
  assert.equal(result.topOpportunities[1].currentStage, 'STOP_RUN');
  assert.equal(result.topOpportunities[0].executionAllowed, false);
  assert.equal(result.observationOnly, true);
  assert.equal(result.mode, 'PAPER_TRADING');
  assert.equal(result.executionAllowed, false);
  assert.equal(result.automaticSubmissionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
});
