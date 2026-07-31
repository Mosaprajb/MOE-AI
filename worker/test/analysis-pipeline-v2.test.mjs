import test from 'node:test';
import assert from 'node:assert/strict';
import {
  Direction,
  EngineStatus,
  createEngineResult,
  createEngineSignal,
} from '../src/core/domain.js';
import { fuseEngineResults } from '../src/core/fusion-engine.js';
import { createMarketSnapshot } from '../src/market-data/market-snapshot.js';
import {
  ANALYSIS_PIPELINE_SCHEMA,
  ANALYSIS_PIPELINE_VERSION,
  createAnalysisPipelineV2,
} from '../src/scanner/analysis-pipeline-v2.js';
import { createScannerEngine } from '../src/scanner/scanner-engine.js';

const NOW = 1_800_000_000_000;

function bars(count = 24) {
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index * 0.2;
    const close = open + (index % 2 ? 0.4 : -0.1);
    return {
      timestamp: NOW - (count - 1 - index) * 300_000,
      open,
      high: Math.max(open, close) + 0.5,
      low: Math.min(open, close) - 0.4,
      close,
      volume: 1_000 + index * 100,
    };
  });
}

function snapshot(symbol = 'AAPL') {
  return createMarketSnapshot({
    symbol,
    timeframe: '5m',
    bars: bars(),
    quote: { bid: 104.49, ask: 104.51, last: 104.5, timestamp: NOW, volume: 80_000 },
    dataTimestamp: NOW,
    session: 'CORE',
    profile: { float: 1_200_000_000, sector: 'Technology', industry: 'Semiconductors' },
    news: [{ headline: 'Pipeline fixture', publishedAt: NOW - 60_000 }],
    options: { callVolume: 20_000, putVolume: 10_000, gammaExposure: 1_500_000 },
  }, { now: NOW });
}

function legacyResult(score, direction = 'LONG', reason = 'confirmed') {
  return {
    available: true,
    score,
    confidence: score,
    direction,
    reasons: [reason],
    observationOnly: true,
    executionAllowed: false,
  };
}

test('Analysis Pipeline V2 runs every analyzer on one MarketSnapshot and emits Fusion-ready results', async () => {
  const marketSnapshot = snapshot('NVDA');
  const marketState = Object.freeze({ regime: 'RISK_ON', score: 81 });
  const received = [];
  const analyzers = {
    smartMoney: async (value, context) => {
      received.push(value);
      assert.equal(context.marketState, marketState);
      return legacyResult(88, 'LONG', 'smart money aligned');
    },
    liquiditySweep: async (value) => {
      received.push(value);
      return { score: 84, direction: 'LONG' };
    },
    orderFlow: async (value) => {
      received.push(value);
      return legacyResult(78, 'LONG', 'positive delta');
    },
  };
  const adapters = {
    liquiditySweep: (raw, { latencyMs }) => ({
      engineResult: createEngineResult({
        engine: 'LIQUIDITY_SWEEP',
        status: EngineStatus.ACCEPTED,
        signal: createEngineSignal({
          engine: 'LIQUIDITY_SWEEP',
          direction: Direction.LONG,
          score: raw.score,
          confidence: 86,
          reasons: ['sweep reclaimed'],
          observedAt: NOW,
        }),
        latencyMs,
        reasons: ['sweep reclaimed'],
        diagnostics: { observationOnly: true, executionAllowed: false },
        completedAt: NOW,
      }),
      opportunity: { id: 'preview-only', observationOnly: true },
    }),
  };
  const pipeline = createAnalysisPipelineV2({ analyzers, adapters, now: () => NOW });
  const result = await pipeline.analyze(marketSnapshot, { marketState });

  assert.equal(result.schema, ANALYSIS_PIPELINE_SCHEMA);
  assert.equal(result.schemaVersion, ANALYSIS_PIPELINE_VERSION);
  assert.equal(result.accepted, true);
  assert.equal(result.direction, Direction.LONG);
  assert.equal(result.engineResults.length, 3);
  assert.deepEqual(result.engineResults.map((item) => item.engine), ['SMART_MONEY', 'LIQUIDITY_SWEEP', 'ORDER_FLOW']);
  assert.equal(result.opportunities.length, 1);
  assert.equal(received.length, 3);
  assert.equal(received.every((value) => value === marketSnapshot), true);
  assert.equal(result.observationOnly, true);
  assert.equal(result.executionEnabled, false);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.engineResults), true);

  const fusion = fuseEngineResults(result.engineResults, {
    requiredEngines: ['SMART_MONEY', 'LIQUIDITY_SWEEP'],
    decidedAt: NOW,
  });
  assert.equal(fusion.direction, Direction.LONG);
  assert.equal(fusion.executionAllowed, false);
  assert.equal(fusion.missingRequiredEngines.length, 0);
});

test('Analysis Pipeline V2 isolates analyzer exceptions and timeouts without losing successful results', async () => {
  const pipeline = createAnalysisPipelineV2({
    analyzers: {
      smartMoney: async () => legacyResult(90, 'LONG'),
      liquiditySweep: async () => { throw new Error('liquidity feed offline'); },
      orderFlow: async () => new Promise(() => {}),
      gammaGex: async () => legacyResult(82, 'LONG'),
    },
    definitions: {
      smartMoney: { required: true },
      liquiditySweep: { required: false },
      orderFlow: { required: false, timeoutMs: 20 },
      gammaGex: { required: false },
    },
    minimumCoverage: 0.5,
    now: () => NOW,
  });
  const result = await pipeline.analyze(snapshot('AAPL'));

  assert.equal(result.engineResults.length, 4);
  assert.equal(result.summary.errors, 2);
  assert.equal(result.analyses.smartMoney.status, EngineStatus.ACCEPTED);
  assert.equal(result.analyses.liquiditySweep.status, EngineStatus.ERROR);
  assert.equal(result.analyses.orderFlow.status, EngineStatus.ERROR);
  assert.equal(result.analyses.orderFlow.reasons.includes('ANALYZER_TIMEOUT'), true);
  assert.equal(result.accepted, true);
  assert.equal(result.direction, Direction.LONG);
  assert.equal(result.executionAllowed, false);
});

test('required analyzer failures and execution-authority attempts fail closed at pipeline level', async () => {
  const pipeline = createAnalysisPipelineV2({
    analyzers: {
      smartMoney: async () => legacyResult(91, 'LONG'),
      portfolioConstraints: async () => ({
        score: 95,
        direction: 'LONG',
        executionAllowed: true,
      }),
    },
    now: () => NOW,
  });
  const result = await pipeline.analyze(snapshot('MSFT'));

  assert.equal(result.accepted, false);
  assert.equal(result.analyses.portfolioConstraints.status, EngineStatus.ERROR);
  assert.equal(result.blockers.includes('required:portfolioConstraints:ERROR'), true);
  assert.equal(result.executionEnabled, false);
  assert.equal(result.automaticSubmissionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
});

test('Analysis Pipeline V2 rejects legacy or malformed snapshots before analyzers run', async () => {
  let called = false;
  const pipeline = createAnalysisPipelineV2({
    analyzers: { smartMoney: async () => { called = true; return legacyResult(90); } },
    now: () => NOW,
  });

  await assert.rejects(
    () => pipeline.analyze({ symbol: 'TSLA', bars: [] }),
    /requires MOE\.MarketSnapshot 2\.0\.0/,
  );
  assert.equal(called, false);
});

test('scanner preserves the complete Analysis Pipeline V2 envelope and remains observation-only', async () => {
  const marketSnapshot = snapshot('TSLA');
  const pipeline = createAnalysisPipelineV2({
    analyzers: {
      smartMoney: async () => legacyResult(86, 'LONG'),
      liquiditySweep: async () => legacyResult(82, 'LONG'),
    },
    now: () => NOW,
  });
  const scanner = createScannerEngine({
    marketData: { getSnapshot: async () => marketSnapshot },
    pipeline,
  });
  const result = await scanner.scan(['TSLA']);
  const candidate = result.candidates[0];

  assert.equal(result.accepted, 1);
  assert.equal(candidate.schema, ANALYSIS_PIPELINE_SCHEMA);
  assert.equal(candidate.engineResults.length, 2);
  assert.equal(candidate.observationOnly, true);
  assert.equal(candidate.executionEnabled, false);
});
