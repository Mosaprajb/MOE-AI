import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

const requiredProductionModules = [
  '../src/smart-scheduler-entry.js',
  '../src/trading-mode-control-v2-entry.js',
  '../src/trading-dashboard-entry.js',
  '../src/trading-mode-entry.js',
];

test('every explicit production entry module exists before Cloudflare bundling', () => {
  for (const relativePath of requiredProductionModules) {
    assert.equal(existsSync(new URL(relativePath, import.meta.url)), true, `${relativePath} must exist`);
  }
});
