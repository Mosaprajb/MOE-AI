import test from 'node:test';
import assert from 'node:assert/strict';
import {
  directionPolicySnapshot,
  enforceOpeningDirection,
  evaluateOpeningDirection,
  getTradingDirectionPolicy,
  observationDirectionAllowed,
} from '../src/trading-direction-policy.js';

const longOnly = { MOE_DIRECTION_POLICY: 'LONG_ONLY', MOE_ALLOW_SHORT_ENTRIES: 'false' };

test('long-only is the fail-safe default', () => {
  assert.equal(getTradingDirectionPolicy({}), 'LONG_ONLY');
  assert.equal(directionPolicySnapshot({}).shortEntriesAllowed, false);
  assert.equal(directionPolicySnapshot({}).protectiveLongExitsAllowed, true);
});

test('BUY and LONG opening signals remain allowed', () => {
  assert.equal(evaluateOpeningDirection({ side: 'BUY' }, longOnly).accepted, true);
  assert.equal(evaluateOpeningDirection({ direction: 'LONG' }, longOnly).accepted, true);
  assert.doesNotThrow(() => enforceOpeningDirection({ side: 'BUY' }, longOnly));
});

test('SELL, SHORT, and bearish opening signals are blocked', () => {
  for (const payload of [{ side: 'SELL' }, { side: 'SELL_SHORT' }, { direction: 'SHORT' }, { direction: 'BEARISH' }]) {
    const result = evaluateOpeningDirection(payload, longOnly);
    assert.equal(result.accepted, false);
    assert.equal(result.reason, 'LONG_ONLY_SHORT_ENTRY_BLOCKED');
    assert.throws(() => enforceOpeningDirection(payload, longOnly), /Short entries are disabled/);
  }
});

test('institutional observations can be restricted to bullish direction', () => {
  assert.equal(observationDirectionAllowed('LONG', longOnly), true);
  assert.equal(observationDirectionAllowed('BULLISH', longOnly), true);
  assert.equal(observationDirectionAllowed('SHORT', longOnly), false);
  assert.equal(observationDirectionAllowed('BEARISH', longOnly), false);
});

test('short entries require two explicit configuration changes', () => {
  assert.equal(getTradingDirectionPolicy({ MOE_DIRECTION_POLICY: 'LONG_AND_SHORT' }), 'LONG_ONLY');
  assert.equal(getTradingDirectionPolicy({ MOE_DIRECTION_POLICY: 'LONG_AND_SHORT', MOE_ALLOW_SHORT_ENTRIES: 'true' }), 'LONG_AND_SHORT');
});
