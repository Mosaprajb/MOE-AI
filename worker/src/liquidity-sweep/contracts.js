import { LIQUIDITY_SWEEP_STRATEGY_NAME, LIQUIDITY_SWEEP_STRATEGY_VERSION } from './config.js';

export const MARKET_SESSIONS = Object.freeze(['PREMARKET', 'REGULAR', 'AFTER_HOURS', 'OVERNIGHT', 'CLOSED']);
export const LIQUIDITY_SIDES = Object.freeze(['BUY_SIDE', 'SELL_SIDE']);
export const TRADE_DIRECTIONS = Object.freeze(['LONG', 'SHORT']);
export const LIQUIDITY_POOL_STATUSES = Object.freeze(['UNSWEPT', 'PARTIALLY_SWEPT', 'FULLY_SWEPT', 'RECLAIMED', 'INVALIDATED', 'EXPIRED']);
export const SWEEP_CLASSIFICATIONS = Object.freeze([
  'UNCONFIRMED_PENETRATION',
  'PROBABLE_LIQUIDITY_SWEEP',
  'CONFIRMED_LIQUIDITY_SWEEP',
  'FAILED_SWEEP',
  'PROBABLE_BREAKOUT',
  'CONFIRMED_BREAKOUT',
  'AMBIGUOUS_EVENT',
  'INVALID_EVENT',
]);
export const SETUP_STATES = Object.freeze([
  'DETECTED', 'VALIDATING', 'CONFIRMED', 'ARMED', 'WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED',
  'ORDER_SUBMITTED', 'PARTIALLY_FILLED', 'FILLED', 'MANAGING_POSITION', 'TARGET_PARTIALLY_REACHED',
  'COMPLETED', 'STOPPED', 'CANCELLED', 'INVALIDATED', 'EXPIRED', 'EXECUTION_ERROR',
]);
export const MARKET_REGIMES = Object.freeze([
  'TRENDING_BULLISH', 'TRENDING_BEARISH', 'BALANCED_RANGE', 'VOLATILE_RANGE',
  'LOW_VOLATILITY_COMPRESSION', 'BREAKOUT_EXPANSION', 'NEWS_DRIVEN_VOLATILITY',
  'RANDOM_TWO_SIDED_SWEEPING', 'ILLIQUID_OR_UNSAFE', 'UNKNOWN',
]);

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, field, { minimum = -Infinity, maximum = Infinity, nullable = false } = {}) {
  if (nullable && (value == null || value === '')) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be a finite number between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function integer(value, field, options = {}) {
  const parsed = finite(value, field, options);
  if (parsed != null && !Number.isInteger(parsed)) throw new Error(`${field} must be an integer`);
  return parsed;
}

function oneOf(value, allowed, field) {
  const normalized = text(value).toUpperCase();
  if (!allowed.includes(normalized)) throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
  return normalized;
}

function isoTimestamp(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === '')) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid timestamp`);
  return date.toISOString();
}

function epochMs(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === '')) return null;
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error(`${field} must be a positive epoch-millisecond timestamp`);
  return Math.floor(timestamp);
}

function stringArray(value, field, maximum = 100) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((item) => text(item)).filter(Boolean).slice(0, maximum);
}

function plainObject(value, field, { nullable = false } = {}) {
  if (nullable && value == null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return JSON.parse(JSON.stringify(value));
}

function symbol(value) {
  const normalized = text(value).toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) throw new Error('symbol is invalid');
  return normalized;
}

function timeframe(value, field) {
  const normalized = text(value).toLowerCase();
  if (!/^(1m|5m|15m|1h|4h|1d|1w)$/.test(normalized)) throw new Error(`${field} is unsupported`);
  return normalized;
}

function price(value, field, nullable = false) {
  return finite(value, field, { minimum: Number.MIN_VALUE, nullable });
}

function safeClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function roundedPrice(value) {
  return Number(Number(value).toFixed(6));
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function deterministicId(prefix, parts, length = 32) {
  if (!Array.isArray(parts) || parts.length === 0) throw new Error('deterministicId parts are required');
  const hash = await sha256Hex(parts.map((part) => text(part)).join('|'));
  return `${text(prefix, 'id')}_${hash.slice(0, Math.max(12, Math.min(64, length)))}`;
}

export function normalizeCandle(input = {}) {
  const normalized = {
    timestamp: epochMs(input.timestamp ?? input.t, 'candle.timestamp'),
    open: price(input.open ?? input.o, 'candle.open'),
    high: price(input.high ?? input.h, 'candle.high'),
    low: price(input.low ?? input.l, 'candle.low'),
    close: price(input.close ?? input.c, 'candle.close'),
    volume: finite(input.volume ?? input.v ?? 0, 'candle.volume', { minimum: 0 }),
    session: oneOf(input.session ?? 'REGULAR', MARKET_SESSIONS, 'candle.session'),
    complete: input.complete !== false,
    source: text(input.source, 'UNKNOWN').slice(0, 64),
  };
  if (normalized.high < normalized.low) throw new Error('candle.high must be at or above candle.low');
  if (normalized.high < Math.max(normalized.open, normalized.close)) throw new Error('candle.high must contain candle open and close');
  if (normalized.low > Math.min(normalized.open, normalized.close)) throw new Error('candle.low must contain candle open and close');
  if (!normalized.complete) throw new Error('Incomplete candle data cannot enter the liquidity sweep engine');
  return Object.freeze(normalized);
}

export function normalizeCandleSeries(items = []) {
  if (!Array.isArray(items) || items.length === 0) throw new Error('A non-empty candle series is required');
  const candles = items.map(normalizeCandle);
  for (let index = 1; index < candles.length; index += 1) {
    if (candles[index].timestamp <= candles[index - 1].timestamp) throw new Error('Candle timestamps must be strictly increasing');
  }
  return Object.freeze(candles);
}

export async function createLiquidityPool(input = {}) {
  const side = oneOf(input.side, LIQUIDITY_SIDES, 'liquidityPool.side');
  const zoneLower = price(input.zoneLower, 'liquidityPool.zoneLower');
  const zoneUpper = price(input.zoneUpper, 'liquidityPool.zoneUpper');
  if (zoneLower > zoneUpper) throw new Error('liquidityPool.zoneLower must not exceed zoneUpper');
  const referencePrice = price(input.referencePrice ?? (zoneLower + zoneUpper) / 2, 'liquidityPool.referencePrice');
  if (referencePrice < zoneLower || referencePrice > zoneUpper) throw new Error('liquidityPool.referencePrice must be inside the zone');
  const createdAt = epochMs(input.createdAt, 'liquidityPool.createdAt');
  const originTimeframe = timeframe(input.originTimeframe, 'liquidityPool.originTimeframe');
  const type = text(input.type).toUpperCase();
  if (!type) throw new Error('liquidityPool.type is required');
  const poolId = input.poolId || await deterministicId('pool', [
    LIQUIDITY_SWEEP_STRATEGY_VERSION,
    type,
    side,
    originTimeframe,
    createdAt,
    roundedPrice(zoneLower),
    roundedPrice(zoneUpper),
  ]);
  const normalized = {
    poolId: text(poolId),
    type,
    side,
    zoneLower,
    zoneUpper,
    referencePrice,
    createdAt,
    lastTouchedAt: epochMs(input.lastTouchedAt ?? createdAt, 'liquidityPool.lastTouchedAt'),
    touchCount: integer(input.touchCount ?? 1, 'liquidityPool.touchCount', { minimum: 0, maximum: 1000 }),
    originTimeframe,
    originSession: oneOf(input.originSession ?? 'REGULAR', MARKET_SESSIONS, 'liquidityPool.originSession'),
    relativeVolume: finite(input.relativeVolume ?? 0, 'liquidityPool.relativeVolume', { minimum: 0 }),
    status: oneOf(input.status ?? 'UNSWEPT', LIQUIDITY_POOL_STATUSES, 'liquidityPool.status'),
    importanceScore: finite(input.importanceScore ?? 0, 'liquidityPool.importanceScore', { minimum: 0, maximum: 100 }),
    swept: input.swept === true,
    reclaimed: input.reclaimed === true,
    expiresAt: epochMs(input.expiresAt, 'liquidityPool.expiresAt', { nullable: true }),
    evidence: stringArray(input.evidence, 'liquidityPool.evidence'),
    penalties: stringArray(input.penalties, 'liquidityPool.penalties'),
  };
  if (normalized.lastTouchedAt < normalized.createdAt) throw new Error('liquidityPool.lastTouchedAt cannot precede createdAt');
  if (normalized.expiresAt != null && normalized.expiresAt <= normalized.createdAt) throw new Error('liquidityPool.expiresAt must be after createdAt');
  if (normalized.reclaimed && !normalized.swept) throw new Error('A reclaimed liquidity pool must have been swept');
  return Object.freeze(normalized);
}

export async function createSweepEvent(input = {}) {
  const direction = oneOf(input.direction, TRADE_DIRECTIONS, 'sweep.direction');
  const detectedAt = epochMs(input.detectedAt, 'sweep.detectedAt');
  const poolId = text(input.poolId);
  if (!poolId) throw new Error('sweep.poolId is required');
  const extremePrice = price(input.extremePrice, 'sweep.extremePrice');
  const sweepId = input.sweepId || await deterministicId('sweep', [
    LIQUIDITY_SWEEP_STRATEGY_VERSION,
    poolId,
    symbol(input.symbol),
    direction,
    detectedAt,
    roundedPrice(extremePrice),
  ]);
  const normalized = {
    sweepId: text(sweepId),
    poolId,
    symbol: symbol(input.symbol),
    direction,
    detectedAt,
    extremePrice,
    penetrationDistance: finite(input.penetrationDistance ?? 0, 'sweep.penetrationDistance', { minimum: 0 }),
    penetrationAtr: finite(input.penetrationAtr ?? 0, 'sweep.penetrationAtr', { minimum: 0 }),
    candlesOutside: integer(input.candlesOutside ?? 0, 'sweep.candlesOutside', { minimum: 0, maximum: 1000 }),
    reclaimed: input.reclaimed === true,
    reclaimedAt: epochMs(input.reclaimedAt, 'sweep.reclaimedAt', { nullable: true }),
    reclaimCandles: integer(input.reclaimCandles, 'sweep.reclaimCandles', { minimum: 0, maximum: 1000, nullable: true }),
    wickToBodyRatio: finite(input.wickToBodyRatio ?? 0, 'sweep.wickToBodyRatio', { minimum: 0 }),
    closeLocation: finite(input.closeLocation ?? 0, 'sweep.closeLocation', { minimum: 0, maximum: 1 }),
    acceptanceScore: finite(input.acceptanceScore ?? 0, 'sweep.acceptanceScore', { minimum: 0, maximum: 100 }),
    rejectionScore: finite(input.rejectionScore ?? 0, 'sweep.rejectionScore', { minimum: 0, maximum: 100 }),
    classification: oneOf(input.classification ?? 'UNCONFIRMED_PENETRATION', SWEEP_CLASSIFICATIONS, 'sweep.classification'),
    confidence: finite(input.confidence ?? 0, 'sweep.confidence', { minimum: 0, maximum: 100 }),
    evidence: stringArray(input.evidence, 'sweep.evidence'),
    rejectionReasons: stringArray(input.rejectionReasons, 'sweep.rejectionReasons'),
  };
  if (normalized.reclaimed && normalized.reclaimedAt == null) throw new Error('Reclaimed sweep requires reclaimedAt');
  if (!normalized.reclaimed && normalized.reclaimedAt != null) throw new Error('Non-reclaimed sweep cannot have reclaimedAt');
  if (normalized.reclaimedAt != null && normalized.reclaimedAt < normalized.detectedAt) throw new Error('sweep.reclaimedAt cannot precede detectedAt');
  if (normalized.reclaimed && normalized.reclaimCandles == null) throw new Error('Reclaimed sweep requires reclaimCandles');
  return Object.freeze(normalized);
}

export async function createTradeSetup(input = {}) {
  const direction = oneOf(input.direction, TRADE_DIRECTIONS, 'setup.direction');
  const liquidityPool = plainObject(input.liquidityPool, 'setup.liquidityPool');
  const sweep = plainObject(input.sweep, 'setup.sweep');
  const createdAt = epochMs(input.createdAt ?? Date.now(), 'setup.createdAt');
  const executionTimeframe = timeframe(input.executionTimeframe, 'setup.executionTimeframe');
  const contextTimeframe = timeframe(input.contextTimeframe, 'setup.contextTimeframe');
  const expectedContext = { '1m': '15m', '5m': '1h', '15m': '4h', '4h': '1d', '1d': '1w' }[executionTimeframe];
  if (expectedContext !== contextTimeframe) throw new Error(`setup.contextTimeframe must be ${expectedContext} for ${executionTimeframe}`);
  const setupId = input.setupId || await deterministicId('setup', [
    LIQUIDITY_SWEEP_STRATEGY_VERSION,
    symbol(input.symbol),
    executionTimeframe,
    direction,
    liquidityPool.poolId,
    sweep.detectedAt,
    roundedPrice(sweep.extremePrice),
  ]);
  const mode = text(input.mode, 'PAPER_TRADING').toUpperCase();
  if (mode !== 'PAPER_TRADING') throw new Error('Liquidity sweep setups must remain PAPER_TRADING during this milestone');
  if (input.executionAllowed === true) throw new Error('Liquidity sweep executionAllowed must remain false during this milestone');
  const normalized = {
    setupId: text(setupId),
    strategyName: LIQUIDITY_SWEEP_STRATEGY_NAME,
    strategyVersion: LIQUIDITY_SWEEP_STRATEGY_VERSION,
    symbol: symbol(input.symbol),
    executionTimeframe,
    contextTimeframe,
    direction,
    state: oneOf(input.state ?? 'DETECTED', SETUP_STATES, 'setup.state'),
    marketSession: oneOf(input.marketSession ?? 'REGULAR', MARKET_SESSIONS, 'setup.marketSession'),
    marketRegime: oneOf(input.marketRegime ?? 'UNKNOWN', MARKET_REGIMES, 'setup.marketRegime'),
    liquidityPool,
    sweep,
    confirmation: plainObject(input.confirmation ?? {}, 'setup.confirmation'),
    tradePlan: plainObject(input.tradePlan ?? {}, 'setup.tradePlan'),
    quality: plainObject(input.quality ?? {}, 'setup.quality'),
    invalidationConditions: stringArray(input.invalidationConditions, 'setup.invalidationConditions'),
    createdAt,
    updatedAt: epochMs(input.updatedAt ?? createdAt, 'setup.updatedAt'),
    expiresAt: epochMs(input.expiresAt, 'setup.expiresAt'),
    executionAllowed: false,
    mode,
    auditTrail: Array.isArray(input.auditTrail) ? safeClone(input.auditTrail).slice(0, 500) : [],
  };
  if (normalized.updatedAt < normalized.createdAt) throw new Error('setup.updatedAt cannot precede createdAt');
  if (normalized.expiresAt <= normalized.createdAt) throw new Error('setup.expiresAt must be after createdAt');
  if (normalized.sweep.poolId !== normalized.liquidityPool.poolId) throw new Error('setup sweep and liquidity pool IDs must match');
  return Object.freeze(normalized);
}

export function noTradeDecision(reason, details = {}) {
  const normalizedReason = text(reason).toUpperCase();
  if (!normalizedReason) throw new Error('NO_TRADE reason is required');
  return Object.freeze({
    tradeDecision: 'NO_TRADE',
    reason: normalizedReason,
    details: safeClone(details) || {},
    executionAllowed: false,
    mode: 'PAPER_TRADING',
    createdAt: new Date().toISOString(),
  });
}

export function assertExecutionPayloadSafe(value, path = 'payload') {
  if (value == null) throw new Error(`${path} cannot be null or undefined`);
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error(`${path} cannot contain NaN or Infinity`);
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertExecutionPayloadSafe(item, `${path}[${index}]`));
    return true;
  }
  if (typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) assertExecutionPayloadSafe(item, `${path}.${key}`);
  }
  return true;
}
