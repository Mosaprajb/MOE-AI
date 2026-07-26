import { createLiquiditySweepConfig } from './config.js';
import { createTradeSetup, noTradeDecision } from './contracts.js';
import { transitionSetup } from './state-machine.js';
import { normalizeMarketData } from './normalization.js';
import { analyzeHigherTimeframe } from './higher-timeframe.js';
import { mapLiquidityPools } from './liquidity-map.js';
import { detectLiquiditySweep } from './sweep-detector.js';
import { evaluatePostSweepConfirmation } from './confirmation.js';
import { classifySweepEvent, reversalTradeAllowed } from './classifier.js';
import { buildLiquidityTradePlan } from './trade-plan.js';
import { scoreLiquiditySweepOpportunity } from './scoring.js';
import { explainLiquiditySweepDecision } from './explainability.js';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function contextForClassifier(confirmation, higherTimeframe) {
  return {
    ...(confirmation?.context || {}),
    confirmationPassed: confirmation?.passed === true,
    higherTimeframeAligned: higherTimeframe?.aligned === true,
  };
}

function sortCandidates(left, right) {
  return (right.quality.total - left.quality.total)
    || (right.sweep.rejectionScore - left.sweep.rejectionScore)
    || (right.liquidityPool.importanceScore - left.liquidityPool.importanceScore);
}

async function buildSetup({ symbol, executionTimeframe, contextTimeframe, snapshot, higherTimeframe, pool, sweep, confirmation, tradePlan, quality }) {
  const createdAt = sweep.detectedAt;
  const expiresAt = Math.max(
    createdAt + snapshot.timeframeMs,
    snapshot.latest.timestamp + snapshot.timeframeMs * 12,
  );
  let setup = await createTradeSetup({
    symbol,
    executionTimeframe,
    contextTimeframe,
    direction: sweep.direction,
    state: 'DETECTED',
    marketSession: snapshot.session,
    marketRegime: higherTimeframe.marketRegime,
    liquidityPool: pool,
    sweep,
    confirmation,
    tradePlan,
    quality,
    invalidationConditions: [
      'SWEEP_EXTREME_BROKEN',
      'CONFIRMATION_STRUCTURE_FAILED',
      'MARKET_DATA_BECOMES_DELAYED',
      'SPREAD_EXCEEDS_CONFIGURED_MAXIMUM',
      'EVENT_RISK_BLOCK_BECOMES_ACTIVE',
      'SETUP_EXPIRES_BEFORE_ENTRY',
    ],
    createdAt,
    updatedAt: createdAt,
    expiresAt,
    executionAllowed: false,
    mode: 'PAPER_TRADING',
    auditTrail: [],
  });
  setup = transitionSetup(setup, 'VALIDATING', {
    at: createdAt,
    reason: 'LIQUIDITY_SWEEP_DETECTED',
    module: 'LIQUIDITY_SWEEP_ENGINE',
  });
  setup = transitionSetup(setup, 'CONFIRMED', {
    at: Math.max(createdAt, sweep.reclaimedAt || createdAt),
    reason: 'SWEEP_CLASSIFICATION_AND_CONFIRMATION_PASSED',
    module: 'LIQUIDITY_SWEEP_ENGINE',
    metadata: { score: quality.total },
  });
  setup = transitionSetup(setup, 'ARMED', {
    at: Math.max(createdAt, sweep.reclaimedAt || createdAt),
    reason: 'PAPER_SETUP_READY_FOR_OBSERVATION',
    module: 'LIQUIDITY_SWEEP_ENGINE',
    metadata: { executionAllowed: false },
  });
  return setup;
}

export async function evaluateLiquiditySweepEngine({
  symbol,
  bars,
  timeframe = '5m',
  contextSnapshot = null,
  now = Date.now(),
  source = 'ALPACA_IEX',
  bid = null,
  ask = null,
  tickSize = null,
  config = null,
  eventRisk = {},
} = {}) {
  const normalizedSymbol = text(symbol).toUpperCase();
  if (!normalizedSymbol) throw new Error('symbol is required');
  const validatedConfig = config || createLiquiditySweepConfig();
  const executionTimeframe = text(timeframe).toLowerCase();
  const contextTimeframe = validatedConfig.timeframes[executionTimeframe];
  if (!contextTimeframe) throw new Error(`Unsupported execution timeframe: ${timeframe}`);

  let snapshot;
  try {
    snapshot = normalizeMarketData({ bars, timeframe: executionTimeframe, now, source, bid, ask, tickSize, config: validatedConfig });
  } catch (error) {
    return noTradeDecision('MARKET_DATA_REJECTED', {
      symbol: normalizedSymbol,
      error: error instanceof Error ? error.message : 'Unknown market-data error',
    });
  }

  const context = contextSnapshot || snapshot;
  const mapped = await mapLiquidityPools(snapshot, { originTimeframe: executionTimeframe, config: validatedConfig });
  if (!mapped.poolCount) {
    return noTradeDecision('NO_MEANINGFUL_LIQUIDITY_POOL', {
      symbol: normalizedSymbol,
      timeframe: executionTimeframe,
    });
  }

  const candidates = [];
  const diagnostics = [];
  for (const pool of mapped.pools) {
    const detection = await detectLiquiditySweep({ symbol: normalizedSymbol, snapshot, pool, config: validatedConfig });
    for (const event of detection.events) {
      const higherTimeframe = analyzeHigherTimeframe(context, { direction: event.direction });
      const confirmation = evaluatePostSweepConfirmation({ snapshot, pool, sweep: event, config: validatedConfig });
      const classified = await classifySweepEvent(event, {
        config: validatedConfig,
        context: contextForClassifier(confirmation, higherTimeframe),
      });

      if (!reversalTradeAllowed(classified)) {
        diagnostics.push({
          poolId: pool.poolId,
          sweepId: classified.sweepId,
          classification: classified.classification,
          confirmationPassed: confirmation.passed,
          rejectionReasons: [...classified.rejectionReasons, ...confirmation.rejectionReasons],
        });
        continue;
      }

      let tradePlan;
      try {
        tradePlan = buildLiquidityTradePlan({
          snapshot,
          pool,
          sweep: classified,
          confirmation,
          liquidityPools: mapped.pools,
          config: validatedConfig,
        });
      } catch (error) {
        diagnostics.push({
          poolId: pool.poolId,
          sweepId: classified.sweepId,
          classification: classified.classification,
          rejectionReasons: [error instanceof Error ? error.message : 'TRADE_PLAN_BUILD_FAILED'],
        });
        continue;
      }

      const quality = scoreLiquiditySweepOpportunity({
        pool,
        sweep: classified,
        confirmation,
        higherTimeframe,
        tradePlan,
        snapshot,
        config: validatedConfig,
        eventRisk,
      });
      const explanation = explainLiquiditySweepDecision({
        symbol: normalizedSymbol,
        pool,
        sweep: classified,
        confirmation,
        higherTimeframe,
        tradePlan,
        quality,
      });

      if (!quality.approved) {
        diagnostics.push({
          poolId: pool.poolId,
          sweepId: classified.sweepId,
          classification: classified.classification,
          score: quality.total,
          action: quality.action,
          rejectionReasons: explanation.rejectionReasons,
        });
        continue;
      }

      const setup = await buildSetup({
        symbol: normalizedSymbol,
        executionTimeframe,
        contextTimeframe,
        snapshot,
        higherTimeframe,
        pool,
        sweep: classified,
        confirmation,
        tradePlan,
        quality,
      });
      candidates.push(Object.freeze({
        setup,
        liquidityPool: pool,
        sweep: classified,
        confirmation,
        higherTimeframe,
        tradePlan,
        quality,
        explanation,
        executionAllowed: false,
        mode: 'PAPER_TRADING',
      }));
    }
  }

  candidates.sort(sortCandidates);
  if (!candidates.length) {
    return noTradeDecision('NO_CONFIRMED_LIQUIDITY_SWEEP_SETUP', {
      symbol: normalizedSymbol,
      timeframe: executionTimeframe,
      poolsEvaluated: mapped.poolCount,
      diagnostics: diagnostics.slice(0, 50),
    });
  }

  const best = candidates[0];
  return Object.freeze({
    tradeDecision: 'PAPER_CANDIDATE',
    symbol: normalizedSymbol,
    strategyVersion: validatedConfig.strategy.version,
    executionTimeframe,
    contextTimeframe,
    evaluatedAt: new Date(Number(now)).toISOString(),
    setup: best.setup,
    liquiditySweep: best.sweep,
    liquidityPool: best.liquidityPool,
    sweepClassification: best.sweep.classification,
    acceptanceScore: best.sweep.acceptanceScore,
    rejectionScore: best.sweep.rejectionScore,
    confirmation: best.confirmation,
    higherTimeframe: best.higherTimeframe,
    tradePlan: best.tradePlan,
    liquiditySweepScore: best.quality.total,
    quality: best.quality,
    explanation: best.explanation,
    alternatives: Object.freeze(candidates.slice(1, 5)),
    diagnostics: Object.freeze(diagnostics.slice(0, 50)),
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
