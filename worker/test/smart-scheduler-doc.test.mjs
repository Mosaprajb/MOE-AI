import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('Smart Scheduler cadence documentation matches the configured phases', () => {
  const document = readFileSync(new URL('../src/scanner/smart-scheduler-readme.md', import.meta.url), 'utf8');
  assert.match(document, /Pre-Market: 04:00-09:30 ET, every 60 seconds/);
  assert.match(document, /Market Open: 09:30-11:30 ET, every 20 seconds/);
  assert.match(document, /Lunch: 11:30-15:00 ET, every 60 seconds/);
  assert.match(document, /Power Hour: 15:00-16:00 ET, every 20 seconds/);
  assert.match(document, /After-Hours: 16:00-20:00 ET, every 120 seconds/);
});
