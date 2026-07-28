import { SETUP_STATES } from './contracts.js';

export const TERMINAL_SETUP_STATES = Object.freeze([
  'COMPLETED', 'STOPPED', 'CANCELLED', 'INVALIDATED', 'EXPIRED', 'EXECUTION_ERROR',
]);

const TRANSITIONS = Object.freeze({
  DETECTED: ['VALIDATING', 'INVALIDATED', 'EXPIRED', 'EXECUTION_ERROR'],
  VALIDATING: ['CONFIRMED', 'INVALIDATED', 'EXPIRED', 'EXECUTION_ERROR'],
  CONFIRMED: ['ARMED', 'INVALIDATED', 'EXPIRED', 'EXECUTION_ERROR'],
  ARMED: ['WAITING_FOR_ENTRY', 'ENTRY_TRIGGERED', 'CANCELLED', 'INVALIDATED', 'EXPIRED', 'EXECUTION_ERROR'],
  WAITING_FOR_ENTRY: ['ENTRY_TRIGGERED', 'CANCELLED', 'INVALIDATED', 'EXPIRED', 'EXECUTION_ERROR'],
  ENTRY_TRIGGERED: ['ORDER_SUBMITTED', 'CANCELLED', 'INVALIDATED', 'EXECUTION_ERROR'],
  ORDER_SUBMITTED: ['PARTIALLY_FILLED', 'FILLED', 'CANCELLED', 'EXECUTION_ERROR'],
  PARTIALLY_FILLED: ['FILLED', 'CANCELLED', 'EXECUTION_ERROR'],
  FILLED: ['MANAGING_POSITION', 'STOPPED', 'COMPLETED', 'EXECUTION_ERROR'],
  MANAGING_POSITION: ['TARGET_PARTIALLY_REACHED', 'COMPLETED', 'STOPPED', 'EXECUTION_ERROR'],
  TARGET_PARTIALLY_REACHED: ['MANAGING_POSITION', 'COMPLETED', 'STOPPED', 'EXECUTION_ERROR'],
  COMPLETED: [],
  STOPPED: [],
  CANCELLED: [],
  INVALIDATED: [],
  EXPIRED: [],
  EXECUTION_ERROR: [],
});

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function normalizeState(value, field) {
  const normalized = text(value).toUpperCase();
  if (!SETUP_STATES.includes(normalized)) throw new Error(`${field} is not a valid setup state`);
  return normalized;
}

function timestamp(value) {
  const date = value == null ? new Date() : value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error('Transition timestamp is invalid');
  return date.toISOString();
}

function auditEntry({ from, to, reason, moduleName, at, metadata }) {
  return {
    at,
    module: text(moduleName, 'LIQUIDITY_SWEEP_STATE_MACHINE').slice(0, 80),
    eventType: 'SETUP_STATE_TRANSITION',
    from,
    to,
    reason: text(reason).slice(0, 240),
    metadata: metadata && typeof metadata === 'object' && !Array.isArray(metadata)
      ? JSON.parse(JSON.stringify(metadata))
      : {},
  };
}

export function allowedSetupTransitions(state) {
  const normalized = normalizeState(state, 'state');
  return [...TRANSITIONS[normalized]];
}

export function canTransitionSetup(from, to) {
  const current = normalizeState(from, 'from');
  const next = normalizeState(to, 'to');
  return TRANSITIONS[current].includes(next);
}

export function transitionSetup(setup, to, options = {}) {
  if (!setup || typeof setup !== 'object' || Array.isArray(setup)) throw new Error('A setup object is required');
  const from = normalizeState(setup.state, 'setup.state');
  const next = normalizeState(to, 'to');
  const reason = text(options.reason);
  if (!reason) throw new Error('Every setup transition requires a reason');
  if (TERMINAL_SETUP_STATES.includes(from)) throw new Error(`Terminal setup state ${from} cannot transition to ${next}`);
  if (!TRANSITIONS[from].includes(next)) throw new Error(`Invalid setup transition: ${from} -> ${next}`);

  const at = timestamp(options.at);
  const updatedAt = new Date(at).getTime();
  if (Number.isFinite(Number(setup.updatedAt)) && updatedAt < Number(setup.updatedAt)) {
    throw new Error('Transition timestamp cannot precede setup.updatedAt');
  }

  const existingAudit = Array.isArray(setup.auditTrail) ? setup.auditTrail : [];
  const auditTrail = [...existingAudit, auditEntry({
    from,
    to: next,
    reason,
    moduleName: options.module,
    at,
    metadata: options.metadata,
  })].slice(-500);

  return Object.freeze({
    ...JSON.parse(JSON.stringify(setup)),
    state: next,
    updatedAt,
    auditTrail,
    stateReason: reason,
  });
}

export function invalidateSetup(setup, reason, options = {}) {
  return transitionSetup(setup, 'INVALIDATED', { ...options, reason });
}

export function expireSetup(setup, reason = 'SETUP_EXPIRED', options = {}) {
  return transitionSetup(setup, 'EXPIRED', { ...options, reason });
}

export function cancelSetup(setup, reason, options = {}) {
  return transitionSetup(setup, 'CANCELLED', { ...options, reason });
}

export function setupRequiresNewId(previousState) {
  return TERMINAL_SETUP_STATES.includes(normalizeState(previousState, 'previousState'));
}

export function validateSetupStateHistory(setup) {
  if (!setup || typeof setup !== 'object') throw new Error('A setup object is required');
  const audit = Array.isArray(setup.auditTrail) ? setup.auditTrail : [];
  let previous = 'DETECTED';
  for (const [index, entry] of audit.entries()) {
    const from = normalizeState(entry.from, `auditTrail[${index}].from`);
    const to = normalizeState(entry.to, `auditTrail[${index}].to`);
    if (from !== previous) throw new Error(`auditTrail[${index}] expected from ${previous}, received ${from}`);
    if (!canTransitionSetup(from, to)) throw new Error(`auditTrail[${index}] contains invalid transition ${from} -> ${to}`);
    if (!text(entry.reason)) throw new Error(`auditTrail[${index}] is missing a transition reason`);
    previous = to;
  }
  if (normalizeState(setup.state, 'setup.state') !== previous && audit.length > 0) {
    throw new Error(`setup.state ${setup.state} does not match audit trail terminal state ${previous}`);
  }
  return true;
}
