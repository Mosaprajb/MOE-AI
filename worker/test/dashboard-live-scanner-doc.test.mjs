import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

test('Dashboard Live Scanner documentation locks the read-only live contract', async () => {
  const documentation = await fs.readFile(new URL('../src/dashboard/README.md', import.meta.url), 'utf8');
  assert.match(documentation, /Opportunity Manager/);
  assert.match(documentation, /active, non-expired, non-duplicate/);
  assert.match(documentation, /Symbol, Grade, Score, Confidence, Status, Expiry, and Rank/);
  assert.match(documentation, /Never exposes order submission or execution controls/);
  assert.match(documentation, /GET \/api\/scanner\/opportunities\/live/);
});
