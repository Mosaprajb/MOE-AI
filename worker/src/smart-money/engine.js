import { createLiquiditySweepConfig } from '../liquidity-sweep/config.js';
import { normalizeMarketData } from '../liquidity-sweep/normalization.js';
import { createSmartMoneyConfig } from './config.js';
import { smartMoneyNoTrade } from './contracts.js';
import { detectStructuralEvents } from './market-structure.js';
import { evaluateDisplacementSeries } from './displacement.js';
import { detectFairValueGaps } from './fair-value-gap.js';
import { buildActiveDealingRange } from './dealing-range.js';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
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
  const imbalances = await detectFairValueGaps({
    symbol: normalizedSymbol,
    snapshot,
    config,
    structureEvents: structure.events,
  });
  const dealingRange = await buildActiveDealingRange({
    symbol: normalizedSymbol,
    snapshot,
    config,
    swings: structure.swings,
  });

  const latestDisplacement = displacement.at(-1) || null;
  const activeGaps = imbalances.gaps.filter((gap) => ['NEW', 'ACTIVE', 'PARTIALLY_MITIGATED'].includes(gap.state));
  const failedConditions = [];
  if (!structure.events.length) failedConditions.push('NO_CONFIRMED_STRUCTURE');
  if (!latestDisplacement || ['NONE', 'WEAK', 'ABNORMAL_NEWS_DRIVEN'].includes(latestDisplacement.classification)) {
    failedConditions.push('NO_ACCEPTABLE_LATEST_DISPLACEMENT');
  }
  if (!dealingRange.range) failedConditions.push(dealingRange.reason || 'NO_CONFIRMED_DEALING_RANGE');
  if (!activeGaps.length) failedConditions.push('NO_ACTIVE_QUALITY_FVG');
  failedConditions.push('SMART_MONEY_FOUNDATION_OBSERVATION_ONLY');

  return smartMoneyNoTrade('SMART_MONEY_FOUNDATION_OBSERVATION_ONLY', {
    failedConditions,
    setupScore: 0,
    details: {
      symbol: normalizedSymbol,
      strategyVersion: config.strategy.version,
      executionTimeframe: snapshot.timeframe,
      contextTimeframe: config.timeframes[snapshot.timeframe],
      evaluatedAt: new Date(Number(now)).toISOString(),
      dataQuality: snapshot.quality,
      structure,
      displacement: {
        latest: latestDisplacement,
        recent: displacement.slice(-10),
      },
      fairValueGaps: {
        active: activeGaps.slice(-20),
        all: imbalances.gaps.slice(-50),
        rejected: imbalances.rejected.slice(-50),
      },
      dealingRange,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      observationOnly: true,
    },
  });
}
