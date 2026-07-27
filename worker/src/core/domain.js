const DIRECTIONS = ['long', 'short', 'neutral'];
const ENGINE_STATUSES = ['accepted', 'rejected', 'neutral', 'error'];
const DECISION_ACTIONS = ['enter', 'hold', 'reject', 'exit'];

export const Direction = Object.freeze({
  LONG: 'long',
  SHORT: 'short',
  NEUTRAL: 'neutral',
});

export const EngineStatus = Object.freeze({
  ACCEPTED: 'accepted',
  REJECTED: 'rejected',
  NEUTRAL: 'neutral',
  ERROR: 'error',
});

export const DecisionAction = Object.freeze({
  ENTER: 'enter',
  HOLD: 'hold',
  REJECT: 'reject',
  EXIT: 'exit',
});

function invariant(condition, message) {
  if (!condition) throw new TypeError(message);
}

function finiteNumber(value, name) {
  invariant(Number.isFinite(value), `${name} must be a finite number`);
  return value;
}

function nonEmptyString(value, name) {
  invariant(typeof value === 'string' && value.trim().length > 0, `${name} must be a non-empty string`);
  return value.trim();
}

function stringList(value, name) {
  invariant(Array.isArray(value), `${name} must be an array`);
  return Object.freeze(value.map((item, index) => nonEmptyString(item, `${name}[${index}]`)));
}

export function clampScore(value) {
  finiteNumber(value, 'score');
  return Math.min(100, Math.max(0, value));
}

export function createConfidenceScore({ value, sampleSize = 0, source = 'engine' }) {
  invariant(Number.isInteger(sampleSize) && sampleSize >= 0, 'sampleSize must be a non-negative integer');
  return Object.freeze({
    value: clampScore(value),
    sampleSize,
    source: nonEmptyString(source, 'source'),
  });
}

export function createEngineSignal({
  engine,
  direction = Direction.NEUTRAL,
  score,
  confidence = score,
  reasons = [],
  diagnostics = {},
  observedAt = new Date().toISOString(),
}) {
  invariant(DIRECTIONS.includes(direction), `direction must be one of: ${DIRECTIONS.join(', ')}`);
  invariant(diagnostics && typeof diagnostics === 'object' && !Array.isArray(diagnostics), 'diagnostics must be an object');

  return Object.freeze({
    engine: nonEmptyString(engine, 'engine'),
    direction,
    score: clampScore(score),
    confidence: createConfidenceScore({ value: confidence, source: engine }),
    reasons: stringList(reasons, 'reasons'),
    diagnostics: Object.freeze({ ...diagnostics }),
    observedAt: nonEmptyString(observedAt, 'observedAt'),
  });
}

export function createEngineResult({
  engine,
  status,
  signal = null,
  reasons = [],
  errors = [],
  latencyMs = 0,
}) {
  invariant(ENGINE_STATUSES.includes(status), `status must be one of: ${ENGINE_STATUSES.join(', ')}`);
  finiteNumber(latencyMs, 'latencyMs');
  invariant(latencyMs >= 0, 'latencyMs must be non-negative');
  invariant(signal === null || (signal && typeof signal === 'object'), 'signal must be null or an object');

  return Object.freeze({
    engine: nonEmptyString(engine, 'engine'),
    status,
    signal,
    reasons: stringList(reasons, 'reasons'),
    errors: stringList(errors, 'errors'),
    latencyMs,
  });
}

export function validatePriceLevels({ direction, entry, stopLoss, takeProfit }) {
  invariant(DIRECTIONS.includes(direction) && direction !== Direction.NEUTRAL, 'direction must be long or short');
  finiteNumber(entry, 'entry');
  finiteNumber(stopLoss, 'stopLoss');
  finiteNumber(takeProfit, 'takeProfit');
  invariant(entry > 0 && stopLoss > 0 && takeProfit > 0, 'price levels must be positive');

  if (direction === Direction.LONG) {
    invariant(stopLoss < entry, 'long stopLoss must be below entry');
    invariant(takeProfit > entry, 'long takeProfit must be above entry');
  } else {
    invariant(stopLoss > entry, 'short stopLoss must be above entry');
    invariant(takeProfit < entry, 'short takeProfit must be below entry');
  }

  return Object.freeze({ entry, stopLoss, takeProfit });
}

export function createOpportunity({
  id,
  symbol,
  direction,
  entry,
  stopLoss,
  takeProfit,
  score,
  confidence = score,
  timeframe,
  engineResults = [],
  reasons = [],
  createdAt = new Date().toISOString(),
  expiresAt = null,
  metadata = {},
}) {
  const levels = validatePriceLevels({ direction, entry, stopLoss, takeProfit });
  invariant(Array.isArray(engineResults), 'engineResults must be an array');
  invariant(metadata && typeof metadata === 'object' && !Array.isArray(metadata), 'metadata must be an object');

  return Object.freeze({
    id: nonEmptyString(id, 'id'),
    symbol: nonEmptyString(symbol, 'symbol').toUpperCase(),
    direction,
    ...levels,
    score: clampScore(score),
    confidence: createConfidenceScore({ value: confidence, source: 'fusion' }),
    timeframe: nonEmptyString(timeframe, 'timeframe'),
    engineResults: Object.freeze([...engineResults]),
    reasons: stringList(reasons, 'reasons'),
    createdAt: nonEmptyString(createdAt, 'createdAt'),
    expiresAt,
    metadata: Object.freeze({ ...metadata }),
  });
}

export function createTradeDecision({
  action,
  opportunity = null,
  score,
  reasons = [],
  vetoes = [],
  decidedAt = new Date().toISOString(),
}) {
  invariant(DECISION_ACTIONS.includes(action), `action must be one of: ${DECISION_ACTIONS.join(', ')}`);
  invariant(opportunity === null || (opportunity && typeof opportunity === 'object'), 'opportunity must be null or an object');
  invariant(action !== DecisionAction.ENTER || opportunity, 'enter decisions require an opportunity');

  return Object.freeze({
    action,
    opportunity,
    score: clampScore(score),
    reasons: stringList(reasons, 'reasons'),
    vetoes: stringList(vetoes, 'vetoes'),
    decidedAt: nonEmptyString(decidedAt, 'decidedAt'),
  });
}
