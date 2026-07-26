export const SMART_MONEY_SETUP_STATES = Object.freeze([
  'CONTEXT_DETECTED',
  'LIQUIDITY_IDENTIFIED',
  'LIQUIDITY_EVENT_DETECTED',
  'STRUCTURE_CONFIRMING',
  'DISPLACEMENT_CONFIRMED',
  'ENTRY_ZONE_CREATED',
  'VALIDATING',
  'CONFIRMED',
  'ARMED',
  'WAITING_FOR_ENTRY',
  'ENTRY_TRIGGERED',
  'ORDER_SUBMITTED',
  'PARTIALLY_FILLED',
  'FILLED',
  'MANAGING_POSITION',
  'PARTIAL_TARGET_REACHED',
  'COMPLETED',
  'STOPPED',
  'CANCELLED',
  'INVALIDATED',
  'EXPIRED',
  'EXECUTION_ERROR',
]);

const TERMINAL_STATES = new Set(['COMPLETED', 'STOPPED', 'CANCELLED', 'INVALIDATED', 'EXPIRED', 'EXECUTION_ERROR']);
const TRANSITIONS = Object.freeze({
  CONTEXT_DETECTED: ['LIQUIDITY_IDENTIFIED', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  LIQUIDITY_IDENTIFIED: ['LIQUIDITY_EVENT_DETECTED', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  LIQUIDITY_EVENT_DETECTED: ['STRUCTURE_CONFIRMING', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  STRUCTURE_CONFIRMING: ['DISPLACEMENT_CONFIRMED', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  DISPLACEMENT_CONFIRMED: ['ENTRY_ZONE_CREATED', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  ENTRY_ZONE_CREATED: ['VALIDATING', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  VALIDATING: ['CONFIRMED', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  CONFIRMED: ['ARMED', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  ARMED: ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  WAITING_FOR_ENTRY: ['ENTRY_TRIGGERED', 'CANCELLED', 'INVALIDATED', 'EXPIRED'],
  ENTRY_TRIGGERED: ['ORDER_SUBMITTED', 'CANCELLED', 'INVALIDATED', 'EXECUTION_ERROR'],
  ORDER_SUBMITTED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXECUTION_ERROR'],
  PARTIALLY_FILLED: ['FILLED', 'CANCELLED', 'EXECUTION_ERROR'],
  FILLED: ['MANAGING_POSITION', 'STOPPED', 'COMPLETED', 'EXECUTION_ERROR'],
  MANAGING_POSITION: ['PARTIAL_TARGET_REACHED', 'STOPPED', 'COMPLETED', 'EXECUTION_ERROR'],
  PARTIAL_TARGET_REACHED: ['MANAGING_POSITION', 'STOPPED', 'COMPLETED', 'EXECUTION_ERROR'],
});

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function transitionSmartMoneySetup(setup, nextState, details = {}) {
  if (!setup || typeof setup !== 'object') throw new Error('setup is required');
  const currentState = String(setup.state || '').toUpperCase();
  const normalizedNext = String(nextState || '').toUpperCase();
  if (!SMART_MONEY_SETUP_STATES.includes(currentState)) throw new Error(`Unknown setup state: ${currentState}`);
  if (!SMART_MONEY_SETUP_STATES.includes(normalizedNext)) throw new Error(`Unknown next setup state: ${normalizedNext}`);
  if (TERMINAL_STATES.has(currentState)) throw new Error(`Terminal setup ${setup.setupId || ''} cannot leave ${currentState}`);
  if (!(TRANSITIONS[currentState] || []).includes(normalizedNext)) {
    throw new Error(`Invalid Smart Money transition ${currentState} -> ${normalizedNext}`);
  }
  const at = Number(details.at ?? Date.now());
  if (!Number.isFinite(at) || at <= 0) throw new Error('transition timestamp is invalid');
  const audit = {
    at: new Date(at).toISOString(),
    module: String(details.module || 'SMART_MONEY_ENGINE'),
    eventType: 'SETUP_STATE_TRANSITION',
    from: currentState,
    to: normalizedNext,
    reason: String(details.reason || 'UNSPECIFIED'),
    metadata: details.metadata && typeof details.metadata === 'object' ? clone(details.metadata) : {},
  };
  return Object.freeze({
    ...clone(setup),
    state: normalizedNext,
    updatedAt: at,
    auditTrail: Object.freeze([...(setup.auditTrail || []).map(clone), Object.freeze(audit)]),
  });
}

export function isSmartMoneyTerminalState(state) {
  return TERMINAL_STATES.has(String(state || '').toUpperCase());
}
