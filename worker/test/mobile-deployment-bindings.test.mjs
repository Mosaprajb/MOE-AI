import test from 'node:test';
import assert from 'node:assert/strict';
import {
  applyResolvedDeploymentBindings,
  resolveBindingIds,
} from '../scripts/materialize-deployment-bindings.mjs';

const sandboxConfig = {
  name: 'moerand-alerts-sandbox',
  kv_namespaces: [{ binding: 'CONFIG' }],
  d1_databases: [{ binding: 'DB', migrations_dir: 'migrations' }],
};

test('deployed Cloudflare bindings resolve D1 and KV resource IDs', () => {
  assert.deepEqual(
    resolveBindingIds([
      { name: 'CONFIG', type: 'kv_namespace', namespace_id: 'sandbox-kv-id' },
      { name: 'DB', type: 'd1', database_id: 'sandbox-db-id' },
    ]),
    {
      databaseId: 'sandbox-db-id',
      kvNamespaceId: 'sandbox-kv-id',
    },
  );
});

test('materialized config pins the exact deployed non-production resources', () => {
  const materialized = applyResolvedDeploymentBindings(
    sandboxConfig,
    {
      databaseId: 'sandbox-db-id',
      databaseName: 'moerand-alerts-sandbox-db',
      kvNamespaceId: 'sandbox-kv-id',
    },
    {
      productionDatabaseId: 'production-db-id',
      productionKvNamespaceId: 'production-kv-id',
    },
  );

  assert.deepEqual(materialized.d1_databases, [
    {
      binding: 'DB',
      migrations_dir: 'migrations',
      database_name: 'moerand-alerts-sandbox-db',
      database_id: 'sandbox-db-id',
    },
  ]);
  assert.deepEqual(materialized.kv_namespaces, [
    { binding: 'CONFIG', id: 'sandbox-kv-id' },
  ]);
  assert.deepEqual(sandboxConfig.d1_databases, [{ binding: 'DB', migrations_dir: 'migrations' }]);
});

test('non-production resource materialization fails closed on production IDs', () => {
  assert.throws(
    () => applyResolvedDeploymentBindings(
      sandboxConfig,
      {
        databaseId: 'production-db-id',
        databaseName: 'moe-ai',
        kvNamespaceId: 'sandbox-kv-id',
      },
      {
        productionDatabaseId: 'production-db-id',
        productionKvNamespaceId: 'production-kv-id',
      },
    ),
    /production D1 database/u,
  );

  assert.throws(
    () => applyResolvedDeploymentBindings(
      sandboxConfig,
      {
        databaseId: 'sandbox-db-id',
        databaseName: 'moerand-alerts-sandbox-db',
        kvNamespaceId: 'production-kv-id',
      },
      {
        productionDatabaseId: 'production-db-id',
        productionKvNamespaceId: 'production-kv-id',
      },
    ),
    /production KV namespace/u,
  );
});
