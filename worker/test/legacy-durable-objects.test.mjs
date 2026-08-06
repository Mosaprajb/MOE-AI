import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const indexSource = await readFile(new URL('../src/index.ts', import.meta.url), 'utf8');
const compatibilitySource = await readFile(new URL('../src/lib/legacy-durable-objects.ts', import.meta.url), 'utf8');

const legacyNames = [
  'AlertCoordinator',
  'SimulationDriver',
  'TradingViewPositionCoordinator',
];

test('worker entrypoint exports all live legacy Durable Object class names', () => {
  for (const name of legacyNames) {
    assert.match(indexSource, new RegExp(`\\b${name}\\b`));
    assert.match(compatibilitySource, new RegExp(`export class ${name}\\b`));
  }
});

test('compatibility Durable Objects fail closed without storage access', () => {
  assert.match(compatibilitySource, /LEGACY_DURABLE_OBJECT_QUARANTINED/);
  assert.match(compatibilitySource, /status:\s*503/);
  assert.doesNotMatch(compatibilitySource, /storage\.(?:delete|put|set|transaction)/);
});
