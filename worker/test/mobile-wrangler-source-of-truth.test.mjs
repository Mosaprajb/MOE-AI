import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  canonicalConfigPath,
  collectModuleExports,
  flattenEnvironment,
  generateWranglerConfig,
  parseJsonc,
  serializeToml,
  supportedEnvironments,
  validateCanonicalConfig,
  validateExports,
  workerDirectory,
} from '../scripts/generate-wrangler-config.mjs';

const requiredDurableObjects = [
  'AlertCoordinator',
  'SimulationDriver',
  'TradingViewPositionCoordinator',
  'StepTrailingCoordinator',
];

async function loadConfig() {
  return parseJsonc(await readFile(canonicalConfigPath, 'utf8'));
}

test('wrangler.jsonc is the only Durable Object lifecycle source', async () => {
  const config = await loadConfig();
  const entry = await readFile(resolve(workerDirectory, 'src/index.ts'), 'utf8');
  validateCanonicalConfig(config, collectModuleExports(entry));

  assert.deepEqual(Object.keys(config.env).sort(), [...supportedEnvironments].sort());
  assert.equal('migrations' in config, false);

  for (const className of requiredDurableObjects) {
    assert.deepEqual(config.exports[className], {
      type: 'durable-object',
      storage: 'sqlite',
    });
  }

  assert.deepEqual(config.durable_objects.bindings, [{
    name: 'STEP_TRAILING_COORDINATOR',
    class_name: 'StepTrailingCoordinator',
  }]);
});

test('all environments generate standalone Wrangler 4 configs locally', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'moe-wrangler-'));
  try {
    for (const environment of supportedEnvironments) {
      const output = join(directory, `${environment}.toml`);
      await generateWranglerConfig(environment, output);
      const generated = await readFile(output, 'utf8');

      assert.match(generated, new RegExp(`name = "moerand-alerts${environment === 'production' ? '' : `-${environment}`}"`));
      assert.doesNotMatch(generated, /\[env\./);
      assert.doesNotMatch(generated, /\[\[migrations\]\]/);
      for (const className of requiredDurableObjects) {
        assert.match(generated, new RegExp(`\\[exports\\.${className}\\]`));
      }
      assert.match(generated, /\[\[durable_objects\.bindings\]\]/);
      assert.match(generated, /name = "STEP_TRAILING_COORDINATOR"/);
      assert.match(generated, /class_name = "StepTrailingCoordinator"/);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('future Durable Object removals require explicit storage-free tombstones', async () => {
  const config = await loadConfig();
  const tombstoneConfig = structuredClone(config);
  tombstoneConfig.exports.AlertCoordinator = {
    type: 'durable-object',
    state: 'deleted',
  };
  validateCanonicalConfig(tombstoneConfig);
  assert.match(serializeToml(flattenEnvironment(tombstoneConfig, 'sandbox')), /state = "deleted"/);

  assert.throws(
    () => validateExports({
      AlertCoordinator: {
        type: 'durable-object',
        state: 'deleted',
        storage: 'sqlite',
      },
    }),
    /must not declare storage/,
  );
});

test('step trailing binding must target a live Durable Object export', async () => {
  const config = await loadConfig();
  const invalid = structuredClone(config);
  invalid.exports.StepTrailingCoordinator = {
    type: 'durable-object',
    state: 'deleted',
  };
  assert.throws(
    () => validateCanonicalConfig(invalid),
    /must target a live class in exports/,
  );
});

test('remote Worker metadata discovery paths are absent', async () => {
  const files = [
    resolve(workerDirectory, 'scripts/generate-wrangler-config.mjs'),
    resolve(workerDirectory, '..', '.github/workflows/deploy-cloudflare-sandbox.yml'),
    resolve(workerDirectory, '..', '.github/workflows/deploy-cloudflare-worker.yml'),
    resolve(workerDirectory, '..', '.github/workflows/mobile-worker.yml'),
  ];
  const forbidden = [
    ['workers', 'scripts'].join('/'),
    ['script_runtime', 'exports'].join('.'),
    ['settings', 'exports'].join('.'),
    'worker-settings-unavailable',
    'prepare-sandbox-config',
  ];

  for (const file of files) {
    const source = await readFile(file, 'utf8');
    for (const pattern of forbidden) assert.equal(source.includes(pattern), false, `${file} contains ${pattern}`);
  }

  for (const deletedPath of [
    'scripts/prepare-sandbox-config.mjs',
    'scripts/prepare-sandbox-config-from-settings.mjs',
    'config/sandbox-durable-object-exports.json',
    'wrangler.toml',
  ]) {
    await assert.rejects(access(resolve(workerDirectory, deletedPath)));
  }
});
