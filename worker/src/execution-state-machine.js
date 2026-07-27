export const ExecutionState = Object.freeze({
  CREATED: 'CREATED',
  VALIDATED: 'VALIDATED',
  BLOCKED: 'BLOCKED',
  SUBMITTING: 'SUBMITTING',
  SUBMITTED: 'SUBMITTED',
  PARTIALLY_FILLED: 'PARTIALLY_FILLED',
  FILLED: 'FILLED',
  EXIT_PENDING: 'EXIT_PENDING',
  TAKE_PROFIT_FILLED: 'TAKE_PROFIT_FILLED',
  STOP_LOSS_FILLED: 'STOP_LOSS_FILLED',
  CANCEL_PENDING: 'CANCEL_PENDING',
  CANCELLED: 'CANCELLED',
  REJECTED: 'REJECTED',
  CLOSED: 'CLOSED',
  ERROR: 'ERROR',
});

export const ExecutionEvent = Object.freeze({
  VALIDATION_PASSED: 'VALIDATION_PASSED',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
  SUBMISSION_STARTED: 'SUBMISSION_STARTED',
  SUBMISSION_ACCEPTED: 'SUBMISSION_ACCEPTED',
  PARTIAL_FILL_REPORTED: 'PARTIAL_FILL_REPORTED',
  ENTRY_FILLED: 'ENTRY_FILLED',
  EXIT_ARMED: 'EXIT_ARMED',
  TAKE_PROFIT_REPORTED: 'TAKE_PROFIT_REPORTED',
  STOP_LOSS_REPORTED: 'STOP_LOSS_REPORTED',
  CANCELLATION_REQUESTED: 'CANCELLATION_REQUESTED',
  CANCELLATION_CONFIRMED: 'CANCELLATION_CONFIRMED',
  REJECTION_REPORTED: 'REJECTION_REPORTED',
  POSITION_CLOSED: 'POSITION_CLOSED',
  FAILURE_REPORTED: 'FAILURE_REPORTED',
});

const TRANSITIONS = Object.freeze({
  [ExecutionState.CREATED]: {
    [ExecutionEvent.VALIDATION_PASSED]: ExecutionState.VALIDATED,
    [ExecutionEvent.VALIDATION_FAILED]: ExecutionState.BLOCKED,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.VALIDATED]: {
    [ExecutionEvent.SUBMISSION_STARTED]: ExecutionState.SUBMITTING,
    [ExecutionEvent.CANCELLATION_REQUESTED]: ExecutionState.CANCEL_PENDING,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.SUBMITTING]: {
    [ExecutionEvent.SUBMISSION_ACCEPTED]: ExecutionState.SUBMITTED,
    [ExecutionEvent.REJECTION_REPORTED]: ExecutionState.REJECTED,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.SUBMITTED]: {
    [ExecutionEvent.PARTIAL_FILL_REPORTED]: ExecutionState.PARTIALLY_FILLED,
    [ExecutionEvent.ENTRY_FILLED]: ExecutionState.FILLED,
    [ExecutionEvent.CANCELLATION_REQUESTED]: ExecutionState.CANCEL_PENDING,
    [ExecutionEvent.REJECTION_REPORTED]: ExecutionState.REJECTED,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.PARTIALLY_FILLED]: {
    [ExecutionEvent.PARTIAL_FILL_REPORTED]: ExecutionState.PARTIALLY_FILLED,
    [ExecutionEvent.ENTRY_FILLED]: ExecutionState.FILLED,
    [ExecutionEvent.CANCELLATION_REQUESTED]: ExecutionState.CANCEL_PENDING,
    [ExecutionEvent.REJECTION_REPORTED]: ExecutionState.REJECTED,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.FILLED]: {
    [ExecutionEvent.EXIT_ARMED]: ExecutionState.EXIT_PENDING,
    [ExecutionEvent.TAKE_PROFIT_REPORTED]: ExecutionState.TAKE_PROFIT_FILLED,
    [ExecutionEvent.STOP_LOSS_REPORTED]: ExecutionState.STOP_LOSS_FILLED,
    [ExecutionEvent.POSITION_CLOSED]: ExecutionState.CLOSED,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.EXIT_PENDING]: {
    [ExecutionEvent.TAKE_PROFIT_REPORTED]: ExecutionState.TAKE_PROFIT_FILLED,
    [ExecutionEvent.STOP_LOSS_REPORTED]: ExecutionState.STOP_LOSS_FILLED,
    [ExecutionEvent.CANCELLATION_REQUESTED]: ExecutionState.CANCEL_PENDING,
    [ExecutionEvent.POSITION_CLOSED]: ExecutionState.CLOSED,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.TAKE_PROFIT_FILLED]: {
    [ExecutionEvent.POSITION_CLOSED]: ExecutionState.CLOSED,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.STOP_LOSS_FILLED]: {
    [ExecutionEvent.POSITION_CLOSED]: ExecutionState.CLOSED,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.CANCEL_PENDING]: {
    [ExecutionEvent.CANCELLATION_CONFIRMED]: ExecutionState.CANCELLED,
    [ExecutionEvent.PARTIAL_FILL_REPORTED]: ExecutionState.PARTIALLY_FILLED,
    [ExecutionEvent.ENTRY_FILLED]: ExecutionState.FILLED,
    [ExecutionEvent.FAILURE_REPORTED]: ExecutionState.ERROR,
  },
  [ExecutionState.BLOCKED]: {},
  [ExecutionState.CANCELLED]: {},
  [ExecutionState.REJECTED]: {},
  [ExecutionState.CLOSED]: {},
  [ExecutionState.ERROR]: {},
});

const TERMINAL_STATES = new Set([
  ExecutionState.BLOCKED,
  ExecutionState.CANCELLED,
  ExecutionState.REJECTED,
  ExecutionState.CLOSED,
  ExecutionState.ERROR,
]);

function nowIso(now = new Date()) {
  const date = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(date.getTime())) throw new Error('Invalid transition timestamp');
  return date.toISOString();
}

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

export function isTerminalExecutionState(state) {
  return TERMINAL_STATES.has(state);
}

export function canTransitionExecution(state, event) {
  return Boolean(TRANSITIONS[state]?.[event]);
}

export function createExecutionRecord({
  executionId = crypto.randomUUID(),
  accountId,
  mode,
  order,
  metadata = {},
  now = new Date(),
} = {}) {
  if (!accountId) throw new Error('accountId is required');
  if (!mode) throw new Error('mode is required');
  if (!order?.symbol) throw new Error('order.symbol is required');
  const timestamp = nowIso(now);
  return {
    executionId,
    accountId: String(accountId),
    mode: String(mode).toUpperCase(),
    symbol: String(order.symbol).toUpperCase(),
    side: String(order.side || '').toUpperCase(),
    quantity: Number(order.quantity || 0),
    state: ExecutionState.CREATED,
    createdAt: timestamp,
    updatedAt: timestamp,
    terminal: false,
    order: clone(order),
    broker: {
      comboOrderId: null,
      clientOrderIds: null,
      brokerOrderIds: [],
    },
    fills: {
      requestedQuantity: Number(order.quantity || 0),
      filledQuantity: 0,
      averagePrice: null,
      lastFillAt: null,
    },
    exit: {
      reason: null,
      price: null,
      closedAt: null,
    },
    metadata: clone(metadata) || {},
    history: [{
      sequence: 1,
      event: 'EXECUTION_CREATED',
      from: null,
      to: ExecutionState.CREATED,
      at: timestamp,
      details: {},
    }],
  };
}

function mergeBroker(record, details) {
  const broker = details?.broker;
  if (!broker) return record.broker;
  return {
    ...record.broker,
    ...clone(broker),
    brokerOrderIds: Array.isArray(broker.brokerOrderIds)
      ? [...new Set([...(record.broker?.brokerOrderIds || []), ...broker.brokerOrderIds.map(String)])]
      : record.broker?.brokerOrderIds || [],
  };
}

function mergeFills(record, event, details, timestamp) {
  if (![ExecutionEvent.PARTIAL_FILL_REPORTED, ExecutionEvent.ENTRY_FILLED].includes(event)) return record.fills;
  const filledQuantity = Number(details?.filledQuantity);
  if (!Number.isFinite(filledQuantity) || filledQuantity <= 0) throw new Error('filledQuantity must be positive');
  if (filledQuantity < Number(record.fills?.filledQuantity || 0)) throw new Error('filledQuantity cannot decrease');
  if (filledQuantity > Number(record.fills?.requestedQuantity || 0)) throw new Error('filledQuantity cannot exceed requested quantity');
  if (event === ExecutionEvent.ENTRY_FILLED && filledQuantity !== Number(record.fills?.requestedQuantity || 0)) {
    throw new Error('ENTRY_FILLED requires the full requested quantity');
  }
  const averagePrice = details?.averagePrice == null ? record.fills?.averagePrice : Number(details.averagePrice);
  if (averagePrice != null && (!Number.isFinite(averagePrice) || averagePrice <= 0)) throw new Error('averagePrice must be positive');
  return {
    ...record.fills,
    filledQuantity,
    averagePrice,
    lastFillAt: timestamp,
  };
}

function mergeExit(record, event, details, timestamp) {
  if (![ExecutionEvent.TAKE_PROFIT_REPORTED, ExecutionEvent.STOP_LOSS_REPORTED, ExecutionEvent.POSITION_CLOSED].includes(event)) {
    return record.exit;
  }
  const reason = event === ExecutionEvent.TAKE_PROFIT_REPORTED
    ? 'TAKE_PROFIT'
    : event === ExecutionEvent.STOP_LOSS_REPORTED
      ? 'STOP_LOSS'
      : details?.reason || record.exit?.reason || 'MANUAL_OR_EXTERNAL';
  const price = details?.price == null ? record.exit?.price : Number(details.price);
  if (price != null && (!Number.isFinite(price) || price <= 0)) throw new Error('exit price must be positive');
  return {
    reason,
    price,
    closedAt: event === ExecutionEvent.POSITION_CLOSED ? timestamp : record.exit?.closedAt,
  };
}

export function transitionExecution(record, event, details = {}, now = new Date()) {
  if (!record?.state) throw new Error('Execution record with state is required');
  if (!Object.values(ExecutionEvent).includes(event)) throw new Error(`Unknown execution event: ${event}`);
  const nextState = TRANSITIONS[record.state]?.[event];
  if (!nextState) throw new Error(`Invalid execution transition: ${record.state} -> ${event}`);

  const timestamp = nowIso(now);
  const next = {
    ...clone(record),
    state: nextState,
    updatedAt: timestamp,
    terminal: isTerminalExecutionState(nextState),
    broker: mergeBroker(record, details),
    fills: mergeFills(record, event, details, timestamp),
    exit: mergeExit(record, event, details, timestamp),
  };
  next.history = [
    ...(record.history || []),
    {
      sequence: (record.history?.length || 0) + 1,
      event,
      from: record.state,
      to: nextState,
      at: timestamp,
      details: clone(details) || {},
    },
  ];
  return next;
}

export function summarizeExecution(record) {
  if (!record) return null;
  return {
    executionId: record.executionId,
    accountId: record.accountId,
    mode: record.mode,
    symbol: record.symbol,
    side: record.side,
    quantity: record.quantity,
    state: record.state,
    terminal: Boolean(record.terminal),
    filledQuantity: Number(record.fills?.filledQuantity || 0),
    averagePrice: record.fills?.averagePrice ?? null,
    exitReason: record.exit?.reason ?? null,
    exitPrice: record.exit?.price ?? null,
    updatedAt: record.updatedAt,
  };
}
