import { createLiquidityPool } from './contracts.js';

const SIDE_BY_TYPE = Object.freeze({
  SWING_HIGH: 'BUY_SIDE',
  SWING_LOW: 'SELL_SIDE',
  EQUAL_HIGHS: 'BUY_SIDE',
  EQUAL_LOWS: 'SELL_SIDE',
  PREVIOUS_DAY_HIGH: 'BUY_SIDE',
  PREVIOUS_DAY_LOW: 'SELL_SIDE',
  PREMARKET_HIGH: 'BUY_SIDE',
  PREMARKET_LOW: 'SELL_SIDE',
  SESSION_HIGH: 'BUY_SIDE',
  SESSION_LOW: 'SELL_SIDE',
});

const BASE_IMPORTANCE = Object.freeze({
  PREVIOUS_DAY_HIGH: 82,
  PREVIOUS_DAY_LOW: 82,
  PREMARKET_HIGH: 76,
  PREMARKET_LOW: 76,
  EQUAL_HIGHS: 72,
  EQUAL_LOWS: 72,
  SESSION_HIGH: 68,
  SESSION_LOW: 68,
  SWING_HIGH: 60,
  SWING_LOW: 60,
});

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function exchangeDateKey(timestamp) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function adaptiveTolerance(snapshot, config, price) {
  const atrTolerance = snapshot.atr * config.liquidityPools.zoneToleranceAtr;
  const tickTolerance = snapshot.tickSize * config.liquidityPools.zoneToleranceTicks;
  const priceTolerance = price * 0.00025;
  return Math.max(tickTolerance, Math.min(atrTolerance, Math.max(tickTolerance, priceTolerance)));
}

function touching(candles, price, tolerance) {
  return candles.filter((candle) => candle.low <= price + tolerance && candle.high >= price - tolerance);
}

function swingPoints(candles, left = 2, right = 2) {
  const highs = [];
  const lows = [];
  for (let index = left; index < candles.length - right; index += 1) {
    const candle = candles[index];
    const before = candles.slice(index - left, index);
    const after = candles.slice(index + 1, index + 1 + right);
    if (before.every((item) => candle.high > item.high) && after.every((item) => candle.high >= item.high)) highs.push({ index, candle, price: candle.high });
    if (before.every((item) => candle.low < item.low) && after.every((item) => candle.low <= item.low)) lows.push({ index, candle, price: candle.low });
  }
  return { highs, lows };
}

function equalClusters(points, toleranceFactory, minimumTouches) {
  const clusters = [];
  for (const point of points) {
    const tolerance = toleranceFactory(point.price);
    const existing = clusters.find((cluster) => Math.abs(cluster.referencePrice - point.price) <= Math.max(cluster.tolerance, tolerance));
    if (existing) {
      existing.points.push(point);
      existing.referencePrice = existing.points.reduce((sum, item) => sum + item.price, 0) / existing.points.length;
      existing.tolerance = Math.max(existing.tolerance, tolerance);
    } else {
      clusters.push({ referencePrice: point.price, tolerance, points: [point] });
    }
  }
  return clusters.filter((cluster) => cluster.points.length >= minimumTouches);
}

function sessionExtremes(candles, session) {
  const matching = candles.filter((candle) => candle.session === session);
  if (!matching.length) return null;
  return {
    high: Math.max(...matching.map((candle) => candle.high)),
    low: Math.min(...matching.map((candle) => candle.low)),
    createdAt: matching[0].timestamp,
    lastTouchedAt: matching.at(-1).timestamp,
    relativeVolume: matching.at(-1).volume,
  };
}

function previousDayExtremes(candles) {
  const byDate = new Map();
  for (const candle of candles) {
    const key = exchangeDateKey(candle.timestamp);
    if (!byDate.has(key)) byDate.set(key, []);
    byDate.get(key).push(candle);
  }
  const keys = [...byDate.keys()].sort();
  if (keys.length < 2) return null;
  const currentKey = exchangeDateKey(candles.at(-1).timestamp);
  const priorKey = [...keys].reverse().find((key) => key < currentKey);
  if (!priorKey) return null;
  const regular = byDate.get(priorKey).filter((candle) => candle.session === 'REGULAR');
  if (!regular.length) return null;
  return {
    high: Math.max(...regular.map((candle) => candle.high)),
    low: Math.min(...regular.map((candle) => candle.low)),
    createdAt: regular[0].timestamp,
    lastTouchedAt: regular.at(-1).timestamp,
    relativeVolume: regular.at(-1).volume,
  };
}

function rawCandidate(type, price, timestamp, extra = {}) {
  return {
    type,
    side: SIDE_BY_TYPE[type],
    price,
    createdAt: timestamp,
    lastTouchedAt: timestamp,
    touchCount: 1,
    relativeVolume: 0,
    evidence: [],
    penalties: [],
    ...extra,
  };
}

function importance(candidate, snapshot, candles, config) {
  const tolerance = adaptiveTolerance(snapshot, config, candidate.price);
  const touches = touching(candles, candidate.price, tolerance);
  let score = BASE_IMPORTANCE[candidate.type] ?? 50;
  const evidence = [...candidate.evidence];
  const penalties = [...candidate.penalties];

  if (candidate.originTimeframe === '1h') { score += 8; evidence.push('HIGHER_TIMEFRAME_ORIGIN'); }
  if (candidate.originTimeframe === '4h' || candidate.originTimeframe === '1d') { score += 12; evidence.push('MAJOR_HIGHER_TIMEFRAME_ORIGIN'); }
  if (touches.length >= 3) { score += Math.min(10, (touches.length - 2) * 3); evidence.push('MULTIPLE_CLEAN_TOUCHES'); }
  if (candidate.type.startsWith('PREVIOUS_DAY_')) evidence.push('PREVIOUS_DAY_LEVEL');
  if (candidate.type.startsWith('PREMARKET_')) evidence.push('PREMARKET_BOUNDARY');
  if (candidate.type.startsWith('EQUAL_')) evidence.push('VISIBLE_EQUAL_LIQUIDITY');

  const ageBars = candles.length - 1 - Math.max(0, candidate.index ?? candles.length - 1);
  if (ageBars > config.liquidityPools.maximumAgeBars * 0.75) { score -= 8; penalties.push('STALE_LEVEL'); }
  if (touches.length > config.liquidityPools.maximumTouchesBeforeConsumption) { score -= 12; penalties.push('LIQUIDITY_PARTIALLY_CONSUMED'); }
  if (candidate.relativeVolume != null && finite(candidate.relativeVolume, 0) === 0) { score -= 5; penalties.push('LOW_VOLUME_ORIGIN'); }

  return {
    score: clamp(Math.round(score), 0, 100),
    evidence: [...new Set(evidence)],
    penalties: [...new Set(penalties)],
    touches,
    tolerance,
  };
}

function mergeCandidates(candidates, snapshot, config) {
  const ordered = [...candidates].sort((a, b) => a.price - b.price || a.createdAt - b.createdAt);
  const merged = [];
  for (const candidate of ordered) {
    const tolerance = adaptiveTolerance(snapshot, config, candidate.price);
    const existing = merged.find((item) => item.side === candidate.side && Math.abs(item.referencePrice - candidate.price) <= Math.max(item.tolerance, tolerance));
    if (!existing) {
      merged.push({
        side: candidate.side,
        referencePrice: candidate.price,
        zoneLower: candidate.price - tolerance,
        zoneUpper: candidate.price + tolerance,
        tolerance,
        candidates: [candidate],
      });
      continue;
    }
    existing.candidates.push(candidate);
    existing.referencePrice = existing.candidates.reduce((sum, item) => sum + item.price, 0) / existing.candidates.length;
    existing.zoneLower = Math.min(existing.zoneLower, candidate.price - tolerance);
    existing.zoneUpper = Math.max(existing.zoneUpper, candidate.price + tolerance);
    existing.tolerance = Math.max(existing.tolerance, tolerance);
  }
  return merged;
}

function strongestType(candidates) {
  return [...candidates].sort((a, b) => (BASE_IMPORTANCE[b.type] ?? 0) - (BASE_IMPORTANCE[a.type] ?? 0))[0]?.type || 'SWING_HIGH';
}

export async function mapLiquidityPools(snapshot, { originTimeframe = '5m', config } = {}) {
  if (!snapshot?.candles?.length) throw new Error('Normalized market-data snapshot is required');
  if (!config?.liquidityPools) throw new Error('Validated liquidity-sweep configuration is required');
  const candles = snapshot.candles;
  const candidates = [];
  const swings = swingPoints(candles);

  for (const point of swings.highs) candidates.push(rawCandidate('SWING_HIGH', point.price, point.candle.timestamp, { index: point.index, originTimeframe }));
  for (const point of swings.lows) candidates.push(rawCandidate('SWING_LOW', point.price, point.candle.timestamp, { index: point.index, originTimeframe }));

  for (const cluster of equalClusters(swings.highs, (price) => adaptiveTolerance(snapshot, config, price), config.liquidityPools.minimumTouches)) {
    candidates.push(rawCandidate('EQUAL_HIGHS', cluster.referencePrice, cluster.points[0].candle.timestamp, {
      index: cluster.points.at(-1).index,
      lastTouchedAt: cluster.points.at(-1).candle.timestamp,
      touchCount: cluster.points.length,
      originTimeframe,
      evidence: ['VISIBLE_EQUAL_LIQUIDITY'],
    }));
  }
  for (const cluster of equalClusters(swings.lows, (price) => adaptiveTolerance(snapshot, config, price), config.liquidityPools.minimumTouches)) {
    candidates.push(rawCandidate('EQUAL_LOWS', cluster.referencePrice, cluster.points[0].candle.timestamp, {
      index: cluster.points.at(-1).index,
      lastTouchedAt: cluster.points.at(-1).candle.timestamp,
      touchCount: cluster.points.length,
      originTimeframe,
      evidence: ['VISIBLE_EQUAL_LIQUIDITY'],
    }));
  }

  const previousDay = previousDayExtremes(candles);
  if (previousDay) {
    candidates.push(rawCandidate('PREVIOUS_DAY_HIGH', previousDay.high, previousDay.createdAt, { ...previousDay, originTimeframe: '1d' }));
    candidates.push(rawCandidate('PREVIOUS_DAY_LOW', previousDay.low, previousDay.createdAt, { ...previousDay, originTimeframe: '1d' }));
  }

  const premarket = sessionExtremes(candles.filter((candle) => exchangeDateKey(candle.timestamp) === exchangeDateKey(candles.at(-1).timestamp)), 'PREMARKET');
  if (premarket) {
    candidates.push(rawCandidate('PREMARKET_HIGH', premarket.high, premarket.createdAt, { ...premarket, originTimeframe }));
    candidates.push(rawCandidate('PREMARKET_LOW', premarket.low, premarket.createdAt, { ...premarket, originTimeframe }));
  }

  const regular = sessionExtremes(candles.filter((candle) => exchangeDateKey(candle.timestamp) === exchangeDateKey(candles.at(-1).timestamp)), 'REGULAR');
  if (regular) {
    candidates.push(rawCandidate('SESSION_HIGH', regular.high, regular.createdAt, { ...regular, originTimeframe }));
    candidates.push(rawCandidate('SESSION_LOW', regular.low, regular.createdAt, { ...regular, originTimeframe }));
  }

  const supported = new Set(config.liquidityPools.supportedTypes);
  const merged = mergeCandidates(candidates.filter((candidate) => supported.has(candidate.type)), snapshot, config);
  const pools = [];
  for (const zone of merged) {
    const type = strongestType(zone.candidates);
    const combined = {
      type,
      side: zone.side,
      price: zone.referencePrice,
      createdAt: Math.min(...zone.candidates.map((candidate) => candidate.createdAt)),
      lastTouchedAt: Math.max(...zone.candidates.map((candidate) => candidate.lastTouchedAt || candidate.createdAt)),
      touchCount: Math.max(...zone.candidates.map((candidate) => candidate.touchCount || 1)),
      relativeVolume: Math.max(...zone.candidates.map((candidate) => finite(candidate.relativeVolume, 0))),
      originTimeframe: zone.candidates.some((candidate) => candidate.originTimeframe === '1d') ? '1d' : originTimeframe,
      evidence: zone.candidates.flatMap((candidate) => candidate.evidence || []),
      penalties: zone.candidates.flatMap((candidate) => candidate.penalties || []),
      index: Math.max(...zone.candidates.map((candidate) => candidate.index ?? 0)),
    };
    const ranked = importance(combined, snapshot, candles, config);
    if (ranked.score < config.liquidityPools.minimumImportanceScore) continue;
    pools.push(await createLiquidityPool({
      type,
      side: zone.side,
      zoneLower: Number(zone.zoneLower.toFixed(8)),
      zoneUpper: Number(zone.zoneUpper.toFixed(8)),
      referencePrice: Number(zone.referencePrice.toFixed(8)),
      createdAt: combined.createdAt,
      lastTouchedAt: combined.lastTouchedAt,
      touchCount: Math.max(combined.touchCount, ranked.touches.length),
      originTimeframe: combined.originTimeframe,
      originSession: snapshot.session,
      relativeVolume: combined.relativeVolume,
      status: 'UNSWEPT',
      importanceScore: ranked.score,
      swept: false,
      reclaimed: false,
      expiresAt: candles.at(-1).timestamp + snapshot.timeframeMs * config.liquidityPools.maximumAgeBars,
      evidence: ranked.evidence,
      penalties: ranked.penalties,
    }));
  }

  pools.sort((left, right) => right.importanceScore - left.importanceScore || Math.abs(snapshot.latest.close - left.referencePrice) - Math.abs(snapshot.latest.close - right.referencePrice));
  return Object.freeze({
    generatedAt: new Date().toISOString(),
    symbol: null,
    timeframe: snapshot.timeframe,
    poolCount: pools.length,
    buySide: Object.freeze(pools.filter((pool) => pool.side === 'BUY_SIDE')),
    sellSide: Object.freeze(pools.filter((pool) => pool.side === 'SELL_SIDE')),
    pools: Object.freeze(pools),
  });
}
