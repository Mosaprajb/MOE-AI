import { createLiquiditySweepConfig } from '../liquidity-sweep/config.js';
import { normalizeMarketData } from '../liquidity-sweep/normalization.js';
import { createSmartMoneyConfig } from './config.js';
import { smartMoneyNoTrade } from './contracts.js';
import { detectStructuralEvents } from './market-structure.js';
import { evaluateDisplacementSeries } from './displacement.js';
import { detectFairValueGaps } from './fair-value-gap.js';
import { buildActiveDealingRange } from './dealing-range.js';
import { detectOrderBlocks } from './order-block.js';
import { detectBreakerBlocks } from './breaker-block.js';
import { evaluateSmartMoneyConfluence } from './confluence.js';
import { classifySmartMoneySetupFamily } from './setup-families.js';
import { selectSmartMoneyEntryZone } from './entry-zone.js';
import { evaluateSmartMoneyRisk } from './risk-evaluation.js';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function opposingTarget(direction, swings, currentPrice) {
  const type = direction === 'BULLISH' ? 'SWING_HIGH' : 'SWING_LOW';
  const eligible = swings.filter((swing) => swing.scope === 'EXTERNAL' && swing.type === type
    && (direction === 'BULLISH' ? swing.price > currentPrice : swing.price < currentPrice));
  if (!eligible.length) return null;
  eligible.sort((left, right) => Math.abs(left.price - currentPrice) - Math.abs(right.price - currentPrice));
  return eligible[0].price;
}

export async function evaluateSmartMoneyFoundation({
  symbol,
  bars,
  timeframe = '5m',
  now = Date.now(),
  source = 'ALPACA_IEX',
  bid = null,
  ask = null,
  tickSize = null,
  smartMoneyConfig = null,
  marketDataConfig = null,
} = {}) {
  const normalizedSymbol = text(symbol).toUpperCase();
  if (!normalizedSymbol) throw new Error('symbol is required');
  const config = smartMoneyConfig || createSmartMoneyConfig();
  const liquidityConfig = marketDataConfig || createLiquiditySweepConfig();
  let snapshot;
  try {
    snapshot = normalizeMarketData({ bars, timeframe, now, source, bid, ask, tickSize, config: liquidityConfig });
  } catch (error) {
    return smartMoneyNoTrade('MARKET_DATA_REJECTED', {
      failedConditions: ['VALID_MARKET_DATA'],
      details: { symbol: normalizedSymbol, error: error instanceof Error ? error.message : 'Unknown market-data error' },
    });
  }

  const structure = await detectStructuralEvents({ symbol: normalizedSymbol, snapshot, config });
  const displacement = await evaluateDisplacementSeries({ symbol: normalizedSymbol, snapshot, config, lookback: 40 });
  const imbalances = await detectFairValueGaps({ symbol: normalizedSymbol, snapshot, config, structureEvents: structure.events });
  const dealingRange = await buildActiveDealingRange({ symbol: normalizedSymbol, snapshot, config, swings: structure.swings });
  const orderBlockResult = await detectOrderBlocks({
    symbol: normalizedSymbol,
    snapshot,
    config,
    structureEvents: structure.events,
    displacements: displacement,
    fairValueGaps: imbalances.gaps,
  });
  const breakerResult = await detectBreakerBlocks({
    symbol: normalizedSymbol,
    snapshot,
    config,
    orderBlocks: orderBlockResult.blocks,
    structureEvents: structure.events,
  });
  const confluence = evaluateSmartMoneyConfluence({
    structure,
    displacement,
    fairValueGaps: imbalances.gaps,
    orderBlocks: orderBlockResult.blocks,
    breakers: breakerResult.breakers,
    dealingRange,
    config,
  });

  const entryZoneSelection = selectSmartMoneyEntryZone({
    direction: confluence.direction,
    currentPrice: snapshot.latest.close,
    orderBlocks: orderBlockResult.blocks,
    breakers: breakerResult.breakers,
    fairValueGaps: imbalances.gaps,
  });
  const setupFamily = classifySmartMoneySetupFamily({ confluence, structure });
  const target = opposingTarget(confluence.direction, structure.swings, snapshot.latest.close);
  const riskEvaluation = evaluateSmartMoneyRisk({
    direction: confluence.direction,
    entryZone: entryZoneSelection.selected,
    currentPrice: snapshot.latest.close,
    confluence,
    setupFamily,
    minimumRewardRisk: 2,
    maximumStopAtr: 2.5,
    atr: snapshot.atr,
    opposingLiquidityTarget: target,
  });

  const latestDisplacement = displacement.at(-1) || null;
  const activeGaps = imbalances.gaps.filter((gap) => ['NEW', 'ACTIVE', 'PARTIALLY_MITIGATED'].includes(gap.state));
  const activeBlocks = orderBlockResult.blocks.filter((block) => ['ACTIVE', 'PARTIALLY_MITIGATED'].includes(block.state));
  const failedConditions = [...confluence.failedConditions, ...riskEvaluation.failedConditions];
  if (!structure.events.length) failedConditions.push('NO_CONFIRMED_STRUCTURE');
  if (!latestDisplacement || ['NONE', 'WEAK', 'ABNORMAL_NEWS_DRIVEN'].includes(latestDisplacement.classification)) {
    failedConditions.push('NO_ACCEPTABLE_LATEST_DISPLACEMENT');
  }
  if (!dealingRange.range) failedConditions.push(dealingRange.reason || 'NO_CONFIRMED_DEALING_RANGE');
  if (!activeGaps.length) failedConditions.push('NO_ACTIVE_QUALITY_FVG');
  if (!activeBlocks.length && !breakerResult.breakers.length) failedConditions.push('NO_ACTIVE_ORDER_BLOCK_OR_BREAKER');
  if (!setupFamily.classified) failedConditions.push('NO_CLASSIFIED_SETUP_FAMILY');
  if (!entryZoneSelection.selected) failedConditions.push('NO_SELECTED_ENTRY_ZONE');
  failedConditions.push('SMART_MONEY_FOUNDATION_OBSERVATION_ONLY');

  return smartMoneyNoTrade('SMART_MONEY_FOUNDATION_OBSERVATION_ONLY', {
    failedConditions: [...new Set(failedConditions)],
    setupScore: confluence.totalScore,
    details: {
      symbol: normalizedSymbol,
      strategyVersion: config.strategy.version,
      executionTimeframe: snapshot.timeframe,
      contextTimeframe: config.timeframes[snapshot.timeframe],
      evaluatedAt: new Date(Number(now)).toISOString(),
      dataQuality: snapshot.quality,
      structure,
      displacement: { latest: latestDisplacement, recent: displacement.slice(-10) },
      fairValueGaps: { active: activeGaps.slice(-20), all: imbalances.gaps.slice(-50), rejected: imbalances.rejected.slice(-50) },
      orderBlocks: { active: activeBlocks.slice(-20), all: orderBlockResult.blocks.slice(-50), rejected: orderBlockResult.rejected.slice(-50) },
      breakerBlocks: { active: breakerResult.breakers.slice(-20), rejected: breakerResult.rejected.slice(-50) },
      dealingRange,
      confluence,
      setupFamily,
      entryZoneSelection,
      riskEvaluation,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      observationOnly: true,
    },
  });
}
