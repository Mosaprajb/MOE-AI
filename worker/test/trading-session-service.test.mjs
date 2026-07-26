import test from 'node:test';
import assert from 'node:assert/strict';
import {
  authoritativeSignalPayload,
  currentTradingSession,
  sessionAllowed,
  sessionTransitionEvents,
  validateDeclaredSignalSession,
} from '../src/trading-session-service.js';

function at(value) {
  return new Date(value);
}

test('maps New York session boundaries correctly', () => {
  assert.equal(currentTradingSession(at('2026-07-27T00:00:00Z')).key, 'OVERNIGHT');
  assert.equal(currentTradingSession(at('2026-07-27T08:00:00Z')).key, 'PREMARKET');
  assert.equal(currentTradingSession(at('2026-07-27T13:30:00Z')).key, 'CORE');
  assert.equal(currentTradingSession(at('2026-07-27T20:00:00Z')).key, 'AFTER_HOURS');
  assert.equal(currentTradingSession(at('2026-07-28T00:00:00Z')).key, 'OVERNIGHT');
});

test('respects owner session policy', () => {
  const core = currentTradingSession(at('2026-07-27T13:30:00Z'));
  assert.equal(sessionAllowed({ allowedSessions: ['CORE'] }, core), true);
  assert.equal(sessionAllowed({ allowedSessions: ['OVERNIGHT'] }, core), false);
  assert.equal(sessionAllowed(null, core), false);
});

test('rejects a declared session that conflicts with server time', () => {
  const core = currentTradingSession(at('2026-07-27T13:30:00Z'));
  const result = validateDeclaredSignalSession({ session: 'NIGHT' }, core);
  assert.equal(result.matches, false);
  assert.equal(result.reason, 'DECLARED_SESSION_MISMATCH');
});

test('server overwrites session fields authoritatively', () => {
  const core = currentTradingSession(at('2026-07-27T13:30:00Z'));
  const result = authoritativeSignalPayload({ symbol: 'AAPL', session: 'CORE' }, core, at('2026-07-27T13:30:00Z'));
  assert.equal(result.marketSession, 'CORE');
  assert.equal(result.webullSession, 'CORE');
  assert.equal(result.serverSession.source, 'MOERAND_SERVER');
});

test('emits close then open alerts when session changes', () => {
  const premarket = currentTradingSession(at('2026-07-27T13:29:00Z'));
  const core = currentTradingSession(at('2026-07-27T13:30:00Z'));
  const events = sessionTransitionEvents(premarket, core, at('2026-07-27T13:30:00Z'));
  assert.deepEqual(events.map((event) => `${event.sessionKey}:${event.kind}`), [
    'PREMARKET:CLOSE',
    'CORE:OPEN',
  ]);
});
