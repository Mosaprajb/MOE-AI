import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveSmartScannerPhase } from '../src/scanner/smart-scheduler.js';

test('Smart Scheduler stops at 8 PM New York and remains closed on weekends', () => {
  assert.equal(resolveSmartScannerPhase(Date.parse('2026-07-31T00:00:00.000Z')).key, 'CLOSED');
  assert.equal(resolveSmartScannerPhase(Date.parse('2026-08-01T14:00:00.000Z')).key, 'CLOSED');
});
