import { SMART_MONEY_STRATEGY_VERSION } from './config.js';

export const SWING_TYPES = Object.freeze(['SWING_HIGH', 'SWING_LOW']);
export const STRUCTURE_SCOPES = Object.freeze(['INTERNAL', 'EXTERNAL']);
export const STRUCTURE_EVENT_TYPES = Object.freeze(['BREAK_OF_STRUCTURE', 'CHANGE_OF_CHARACTER', 'MARKET_STRUCTURE_SHIFT']);
export const STRUCTURE_DIRECTIONS = Object.freeze(['BULLISH', 'BEARISH']);
export const DISPLACEMENT_CLASSES = Object.freeze(['NONE', 'WEAK', 'MODERATE', 'STRONG', 'EXCEPTIONAL', 'ABNORMAL_NEWS_DRIVEN']);
export const FVG_DIRECTIONS = Object.freeze(['BULLISH', 'BEARISH']);
export const FVG_STATES = Object.freeze(['NEW', 'ACTIVE', 'PARTIALLY_MITIGATED', 'FULLY_MITIGATED', 'INVERTED', 'INVALIDATED', 'EXPIRED']);
export const RANGE_POSITIONS = Object.freeze(['EXTREME_DISCOUNT', 'DISCOUNT', 'EQUILIBRIUM', 'PREMIUM', 'EXTREME_PREMIUM', 'OUTSIDE_RANGE']);

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

function epoch(value, field, { nullable = false } = {}) {
  if (nullable && (value == null || value === '')) return null;
  const timestamp = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error(`${field} must be a positive epoch-millisecond timestamp`);
  return Math.floor(timestamp);
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

function strings(value, maximum = 100) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error('Expected an array of strings');
  return value.map((item) => text(item)).filter(Boolean).slice(0, maximum);
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function rounded(value) {
  return Number(Number(value).toFixed(8));
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export async function deterministicSmartMoneyId(prefix, parts, length = 32) {
  if (!Array.isArray(parts) || !parts.length) throw new Error('deterministic ID parts are required');
  const hash = await sha256(parts.map((part) => text(part)).join('|'));
  return `${text(prefix, 'sm')}_${hash.slice(0, Math.max(12, Math.min(64, length)))}`;
}

export async function createSwingPoint(input = {}) {
  const normalizedSymbol = symbol(input.symbol);
  const normalizedTimeframe = timeframe(input.timeframe, 'swing.timeframe');
  const type = oneOf(input.type, SWING_TYPES, 'swing.type');
  const scope = oneOf(input.scope, STRUCTURE_SCOPES, 'swing.scope');
  const index = integer(input.index, 'swing.index', { minimum: 0 });
  const confirmationIndex = integer(input.confirmationIndex, 'swing.confirmationIndex', { minimum: index });
  const timestamp = epoch(input.timestamp, 'swing.timestamp');
  const confirmedAt = epoch(input.confirmedAt, 'swing.confirmedAt');
  if (confirmedAt < timestamp) throw new Error('swing.confirmedAt cannot precede swing.timestamp');
  const price = finite(input.price, 'swing.price', { minimum: Number.MIN_VALUE });
  const swingId = input.swingId || await deterministicSmartMoneyId('swing', [
    SMART_MONEY_STRATEGY_VERSION, normalizedSymbol, normalizedTimeframe, type, scope, timestamp, rounded(price),
  ]);
  return Object.freeze({
    swingId: text(swingId),
    symbol: normalizedSymbol,
    timeframe: normalizedTimeframe,
    type,
    scope,
    index,
    confirmationIndex,
    timestamp,
    confirmedAt,
    price,
    prominenceAtr: finite(input.prominenceAtr ?? 0, 'swing.prominenceAtr', { minimum: 0 }),
    strength: finite(input.strength ?? 0, 'swing.strength', { minimum: 0, maximum: 100 }),
    reactions: integer(input.reactions ?? 0, 'swing.reactions', { minimum: 0, maximum: 1000 }),
    protected: input.protected === true,
    liquidityUnswept: input.liquidityUnswept !== false,
    invalidated: input.invalidated === true,
    evidence: Object.freeze(strings(input.evidence)),
  });
}

export async function createStructuralEvent(input = {}) {
  const normalizedSymbol = symbol(input.symbol);
  const normalizedTimeframe = timeframe(input.timeframe, 'structure.timeframe');
  const eventType = oneOf(input.eventType, STRUCTURE_EVENT_TYPES, 'structure.eventType');
  const direction = oneOf(input.direction, STRUCTURE_DIRECTIONS, 'structure.direction');
  const confirmedAt = epoch(input.confirmedAt, 'structure.confirmedAt');
  const level = finite(input.level, 'structure.level', { minimum: Number.MIN_VALUE });
  const close = finite(input.close, 'structure.close', { minimum: Number.MIN_VALUE });
  const sourceSwingId = text(input.sourceSwingId);
  if (!sourceSwingId) throw new Error('structure.sourceSwingId is required');
  const eventId = input.eventId || await deterministicSmartMoneyId('structure', [
    SMART_MONEY_STRATEGY_VERSION, normalizedSymbol, normalizedTimeframe, eventType, direction, sourceSwingId, confirmedAt, rounded(level),
  ]);
  return Object.freeze({
    eventId: text(eventId),
    symbol: normalizedSymbol,
    timeframe: normalizedTimeframe,
    eventType,
    direction,
    scope: oneOf(input.scope, STRUCTURE_SCOPES, 'structure.scope'),
    sourceSwingId,
    index: integer(input.index, 'structure.index', { minimum: 0 }),
    confirmedAt,
    level,
    close,
    penetration: finite(input.penetration ?? 0, 'structure.penetration', { minimum: 0 }),
    penetrationAtr: finite(input.penetrationAtr ?? 0, 'structure.penetrationAtr', { minimum: 0 }),
    bodyAtr: finite(input.bodyAtr ?? 0, 'structure.bodyAtr', { minimum: 0 }),
    closeLocation: finite(input.closeLocation ?? 0, 'structure.closeLocation', { minimum: 0, maximum: 1 }),
    relativeVolume: finite(input.relativeVolume, 'structure.relativeVolume', { minimum: 0, nullable: true }),
    qualityScore: finite(input.qualityScore ?? 0, 'structure.qualityScore', { minimum: 0, maximum: 100 }),
    evidence: Object.freeze(strings(input.evidence)),
    rejectionReasons: Object.freeze(strings(input.rejectionReasons)),
  });
}

export async function createDisplacementEvent(input = {}) {
  const normalizedSymbol = symbol(input.symbol);
  const normalizedTimeframe = timeframe(input.timeframe, 'displacement.timeframe');
  const direction = oneOf(input.direction, STRUCTURE_DIRECTIONS, 'displacement.direction');
  const classification = oneOf(input.classification, DISPLACEMENT_CLASSES, 'displacement.classification');
  const index = integer(input.index, 'displacement.index', { minimum: 0 });
  const timestamp = epoch(input.timestamp, 'displacement.timestamp');
  const score = finite(input.score ?? 0, 'displacement.score', { minimum: 0, maximum: 100 });
  const displacementId = input.displacementId || await deterministicSmartMoneyId('displacement', [
    SMART_MONEY_STRATEGY_VERSION, normalizedSymbol, normalizedTimeframe, direction, classification, index, timestamp, rounded(score),
  ]);
  return Object.freeze({
    displacementId: text(displacementId),
    symbol: normalizedSymbol,
    timeframe: normalizedTimeframe,
    direction,
    classification,
    index,
    timestamp,
    score,
    metrics: Object.freeze(clone(input.metrics || {})),
    evidence: Object.freeze(strings(input.evidence)),
    rejectionReasons: Object.freeze(strings(input.rejectionReasons)),
  });
}

export async function createFairValueGap(input = {}) {
  const normalizedSymbol = symbol(input.symbol);
  const normalizedTimeframe = timeframe(input.timeframe, 'fvg.timeframe');
  const direction = oneOf(input.direction, FVG_DIRECTIONS, 'fvg.direction');
  const lower = finite(input.lower, 'fvg.lower', { minimum: Number.MIN_VALUE });
  const upper = finite(input.upper, 'fvg.upper', { minimum: Number.MIN_VALUE });
  if (lower >= upper) throw new Error('fvg.lower must be below fvg.upper');
  const creationIndex = integer(input.creationIndex, 'fvg.creationIndex', { minimum: 2 });
  const createdAt = epoch(input.createdAt, 'fvg.createdAt');
  const state = oneOf(input.state, FVG_STATES, 'fvg.state');
  const fvgId = input.fvgId || await deterministicSmartMoneyId('fvg', [
    SMART_MONEY_STRATEGY_VERSION, normalizedSymbol, normalizedTimeframe, direction, createdAt, rounded(lower), rounded(upper),
  ]);
  return Object.freeze({
    fvgId: text(fvgId),
    symbol: normalizedSymbol,
    timeframe: normalizedTimeframe,
    direction,
    lower,
    upper,
    midpoint: rounded((lower + upper) / 2),
    size: rounded(upper - lower),
    sizeAtr: finite(input.sizeAtr ?? 0, 'fvg.sizeAtr', { minimum: 0 }),
    creationIndex,
    createdAt,
    displacementId: text(input.displacementId),
    displacementScore: finite(input.displacementScore ?? 0, 'fvg.displacementScore', { minimum: 0, maximum: 100 }),
    structuralOriginId: text(input.structuralOriginId),
    fillPercent: finite(input.fillPercent ?? 0, 'fvg.fillPercent', { minimum: 0, maximum: 1 }),
    firstTouchAt: epoch(input.firstTouchAt, 'fvg.firstTouchAt', { nullable: true }),
    mitigationCount: integer(input.mitigationCount ?? 0, 'fvg.mitigationCount', { minimum: 0, maximum: 1000 }),
    state,
    invalidationLevel: finite(input.invalidationLevel, 'fvg.invalidationLevel', { minimum: Number.MIN_VALUE }),
    expiresAt: epoch(input.expiresAt, 'fvg.expiresAt', { nullable: true }),
    evidence: Object.freeze(strings(input.evidence)),
    rejectionReasons: Object.freeze(strings(input.rejectionReasons)),
  });
}

export async function createDealingRange(input = {}) {
  const normalizedSymbol = symbol(input.symbol);
  const normalizedTimeframe = timeframe(input.timeframe, 'range.timeframe');
  const low = finite(input.low, 'range.low', { minimum: Number.MIN_VALUE });
  const high = finite(input.high, 'range.high', { minimum: Number.MIN_VALUE });
  if (low >= high) throw new Error('range.low must be below range.high');
  const createdAt = epoch(input.createdAt, 'range.createdAt');
  const rangeId = input.rangeId || await deterministicSmartMoneyId('range', [
    SMART_MONEY_STRATEGY_VERSION, normalizedSymbol, normalizedTimeframe, input.lowSwingId, input.highSwingId, createdAt, rounded(low), rounded(high),
  ]);
  return Object.freeze({
    rangeId: text(rangeId),
    symbol: normalizedSymbol,
    timeframe: normalizedTimeframe,
    low,
    high,
    midpoint: rounded((low + high) / 2),
    width: rounded(high - low),
    widthAtr: finite(input.widthAtr ?? 0, 'range.widthAtr', { minimum: 0 }),
    lowSwingId: text(input.lowSwingId),
    highSwingId: text(input.highSwingId),
    createdAt,
    currentPrice: finite(input.currentPrice, 'range.currentPrice', { minimum: Number.MIN_VALUE }),
    position: oneOf(input.position, RANGE_POSITIONS, 'range.position'),
    valid: input.valid !== false,
    evidence: Object.freeze(strings(input.evidence)),
  });
}

export function smartMoneyNoTrade(reason, details = {}) {
  const normalizedReason = text(reason, 'NO_HIGH_QUALITY_SMART_MONEY_SETUP').toUpperCase();
  return Object.freeze({
    tradeDecision: 'NO_TRADE',
    reason: normalizedReason,
    failedConditions: Object.freeze(strings(details.failedConditions)),
    setupScore: finite(details.setupScore ?? 0, 'noTrade.setupScore', { minimum: 0, maximum: 100 }),
    details: Object.freeze(clone(details.details || {})),
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
