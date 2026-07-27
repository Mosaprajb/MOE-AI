export const Direction = Object.freeze({ LONG: 'LONG', SHORT: 'SHORT', NEUTRAL: 'NEUTRAL' });
export const EngineStatus = Object.freeze({ ACCEPTED: 'ACCEPTED', REJECTED: 'REJECTED', NEUTRAL: 'NEUTRAL', ERROR: 'ERROR' });
export const DecisionAction = Object.freeze({ ENTER: 'ENTER', HOLD: 'HOLD', REJECT: 'REJECT', EXIT: 'EXIT' });

const directions = Object.values(Direction);
const engineStatuses = Object.values(EngineStatus);
const decisionActions = Object.values(DecisionAction);

function requiredText(value, field) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new Error(`${field} is required`);
  return normalized;
}

function finite(value, field, minimum = -Infinity, maximum = Infinity) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${field} must be a finite number between ${minimum} and ${maximum}`);
  }
  return parsed;
}

function oneOf(value, allowed, field) {
  const normalized = requiredText(value, field).toUpperCase();
  if (!allowed.includes(normalized)) throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
  return normalized;
}

function iso(value, field) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) throw new Error(`${field} must be a valid timestamp`);
  return date.toISOString();
}

function stringList(value, field) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value.map((item) => String(item ?? '').trim()).filter(Boolean);
}

function cloneObject(value, field) {
  if (value == null) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new Error(`${field} must be an object`);
  return JSON.parse(JSON.stringify(value));
}

function freezeArray(items) {
  return Object.freeze([...items]);
}

export function clampScore(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('score must be a finite number');
  return Math.max(0, Math.min(100, parsed));
}

export function normalizeSymbol(value) {
  const normalized = requiredText(value, 'symbol').toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized)) throw new Error('symbol is invalid');
  return normalized;
}

export function validatePriceLevels({ direction, entry, stopLoss, takeProfit }) {
  const normalizedDirection = oneOf(direction, [Direction.LONG, Direction.SHORT], 'direction');
  const normalized = {
    entry: finite(entry, 'entry', Number.MIN_VALUE),
    stopLoss: finite(stopLoss, 'stopLoss', Number.MIN_VALUE),
    takeProfit: finite(takeProfit, 'takeProfit', Number.MIN_VALUE),
  };
  if (normalizedDirection === Direction.LONG) {
    if (normalized.stopLoss >= normalized.entry) throw new Error('LONG stopLoss must be below entry');
    if (normalized.takeProfit <= normalized.entry) throw new Error('LONG takeProfit must be above entry');
  } else {
    if (normalized.stopLoss <= normalized.entry) throw new Error('SHORT stopLoss must be above entry');
    if (normalized.takeProfit >= normalized.entry) throw new Error('SHORT takeProfit must be below entry');
  }
  return Object.freeze(normalized);
}

export function createConfidence(value, source = 'engine') {
  return Object.freeze({ value: clampScore(value), source: requiredText(source, 'confidence.source') });
}

export function createEngineSignal(input = {}) {
  const diagnostics = Object.freeze(cloneObject(input.diagnostics, 'signal.diagnostics'));
  const reasons = freezeArray(stringList(input.reasons, 'signal.reasons'));
  return Object.freeze({
    engine: requiredText(input.engine, 'signal.engine'),
    direction: oneOf(input.direction, directions, 'signal.direction'),
    score: clampScore(input.score ?? 0),
    confidence: createConfidence(input.confidence ?? input.score ?? 0, input.confidenceSource ?? input.engine ?? 'engine'),
    reasons,
    diagnostics,
    observedAt: iso(input.observedAt, 'signal.observedAt'),
  });
}

export function createEngineResult(input = {}) {
  const signal = input.signal == null ? null : createEngineSignal({ ...input.signal, engine: input.signal.engine ?? input.engine });
  return Object.freeze({
    engine: requiredText(input.engine, 'engineResult.engine'),
    status: oneOf(input.status, engineStatuses, 'engineResult.status'),
    signal,
    latencyMs: finite(input.latencyMs ?? 0, 'engineResult.latencyMs', 0),
    reasons: freezeArray(stringList(input.reasons, 'engineResult.reasons')),
    diagnostics: Object.freeze(cloneObject(input.diagnostics, 'engineResult.diagnostics')),
    completedAt: iso(input.completedAt, 'engineResult.completedAt'),
  });
}

export function createOpportunity(input = {}) {
  const direction = oneOf(input.direction, [Direction.LONG, Direction.SHORT], 'opportunity.direction');
  const levels = validatePriceLevels({ direction, entry: input.entry, stopLoss: input.stopLoss, takeProfit: input.takeProfit });
  const engineResults = input.engineResults == null ? [] : input.engineResults;
  if (!Array.isArray(engineResults)) throw new Error('opportunity.engineResults must be an array');
  return Object.freeze({
    id: requiredText(input.id, 'opportunity.id'),
    symbol: normalizeSymbol(input.symbol),
    direction,
    timeframe: requiredText(input.timeframe, 'opportunity.timeframe').toLowerCase(),
    ...levels,
    score: clampScore(input.score ?? 0),
    confidence: createConfidence(input.confidence ?? input.score ?? 0, 'fusion'),
    engineResults: freezeArray(engineResults),
    reasons: freezeArray(stringList(input.reasons, 'opportunity.reasons')),
    metadata: Object.freeze(cloneObject(input.metadata, 'opportunity.metadata')),
    createdAt: iso(input.createdAt, 'opportunity.createdAt'),
  });
}

export function createTradeDecision(input = {}) {
  const action = oneOf(input.action, decisionActions, 'decision.action');
  if (action === DecisionAction.ENTER && !input.opportunity) throw new Error('ENTER decisions require an opportunity');
  return Object.freeze({
    action,
    score: clampScore(input.score ?? input.opportunity?.score ?? 0),
    confidence: createConfidence(input.confidence ?? input.opportunity?.confidence?.value ?? 0, 'fusion'),
    opportunity: input.opportunity ?? null,
    reasons: freezeArray(stringList(input.reasons, 'decision.reasons')),
    diagnostics: Object.freeze(cloneObject(input.diagnostics, 'decision.diagnostics')),
    decidedAt: iso(input.decidedAt, 'decision.decidedAt'),
  });
}
