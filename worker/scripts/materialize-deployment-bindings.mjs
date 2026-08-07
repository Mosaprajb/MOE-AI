import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  flattenEnvironment,
  loadCanonicalConfig,
  serializeToml,
  workerDirectory,
} from './generate-wrangler-config.mjs';

const NON_PRODUCTION_ENVIRONMENTS = new Set(['sandbox', 'staging']);

function assertion(condition, message) {
  if (!condition) throw new Error(message);
}

function requiredString(value, name) {
  const normalized = typeof value === 'string' ? value.trim() : '';
  if (!normalized) throw new Error(`${name} is required`);
  return normalized;
}

function findConfiguredBinding(rows, binding, resourceName) {
  const matches = (rows ?? []).filter(row => row?.binding === binding);
  assertion(matches.length === 1, `${resourceName} must define exactly one ${binding} binding`);
  return matches[0];
}

export function resolveBindingIds(bindings) {
  assertion(Array.isArray(bindings), 'Cloudflare Worker settings did not return a bindings array');

  const d1 = bindings.find(binding => binding?.name === 'DB' && binding?.type === 'd1');
  const kv = bindings.find(binding => binding?.name === 'CONFIG' && binding?.type === 'kv_namespace');

  const databaseId = d1?.database_id ?? d1?.id;
  const kvNamespaceId = kv?.namespace_id;

  return {
    databaseId: requiredString(databaseId, 'Resolved D1 database ID'),
    kvNamespaceId: requiredString(kvNamespaceId, 'Resolved KV namespace ID'),
  };
}

export function applyResolvedDeploymentBindings(
  environmentConfig,
  { databaseId, databaseName, kvNamespaceId },
  { productionDatabaseId, productionKvNamespaceId },
) {
  const next = structuredClone(environmentConfig);
  const resolvedDatabaseId = requiredString(databaseId, 'D1 database ID');
  const resolvedDatabaseName = requiredString(databaseName, 'D1 database name');
  const resolvedKvNamespaceId = requiredString(kvNamespaceId, 'KV namespace ID');

  if (productionDatabaseId && resolvedDatabaseId === productionDatabaseId) {
    throw new Error('Refusing to bind a non-production Worker to the production D1 database');
  }
  if (productionKvNamespaceId && resolvedKvNamespaceId === productionKvNamespaceId) {
    throw new Error('Refusing to bind a non-production Worker to the production KV namespace');
  }

  findConfiguredBinding(next.d1_databases, 'DB', 'wrangler.jsonc');
  findConfiguredBinding(next.kv_namespaces, 'CONFIG', 'wrangler.jsonc');

  next.d1_databases = next.d1_databases.map(row =>
    row.binding === 'DB'
      ? { ...row, database_name: resolvedDatabaseName, database_id: resolvedDatabaseId }
      : row,
  );
  next.kv_namespaces = next.kv_namespaces.map(row =>
    row.binding === 'CONFIG' ? { ...row, id: resolvedKvNamespaceId } : row,
  );

  return next;
}

async function cloudflareJson(fetchImpl, url, apiToken, init = {}) {
  const response = await fetchImpl(url, {
    ...init,
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${apiToken}`,
      ...(init.body ? { 'content-type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    },
    signal: AbortSignal.timeout(15_000),
  });

  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Cloudflare API returned non-JSON HTTP ${response.status}`);
  }

  if (!response.ok || payload?.success === false) {
    const message = payload?.errors?.map(error => error?.message).filter(Boolean).join('; ');
    throw new Error(`Cloudflare API request failed with HTTP ${response.status}${message ? `: ${message}` : ''}`);
  }

  return payload;
}

export async function materializeDeploymentBindings({
  environment,
  outputPath = null,
  accountId = process.env.CLOUDFLARE_ACCOUNT_ID,
  apiToken = process.env.CLOUDFLARE_API_TOKEN,
  fetchImpl = fetch,
} = {}) {
  assertion(
    NON_PRODUCTION_ENVIRONMENTS.has(environment),
    'Binding materialization is restricted to sandbox and staging',
  );

  const resolvedAccountId = requiredString(accountId, 'CLOUDFLARE_ACCOUNT_ID');
  const resolvedApiToken = requiredString(apiToken, 'CLOUDFLARE_API_TOKEN');
  const canonical = await loadCanonicalConfig();
  const flattened = flattenEnvironment(canonical, environment);
  const production = flattenEnvironment(canonical, 'production');
  const workerName = requiredString(flattened.name, 'Worker name');

  const productionD1 = findConfiguredBinding(production.d1_databases, 'DB', 'production wrangler.jsonc');
  const productionKv = findConfiguredBinding(production.kv_namespaces, 'CONFIG', 'production wrangler.jsonc');

  const apiBase = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(resolvedAccountId)}`;
  const workerSettings = await cloudflareJson(
    fetchImpl,
    `${apiBase}/workers/scripts/${encodeURIComponent(workerName)}/settings`,
    resolvedApiToken,
  );
  const { databaseId, kvNamespaceId } = resolveBindingIds(workerSettings?.result?.bindings);

  const database = await cloudflareJson(
    fetchImpl,
    `${apiBase}/d1/database/${encodeURIComponent(databaseId)}`,
    resolvedApiToken,
  );
  const databaseName = requiredString(database?.result?.name, 'Resolved D1 database name');

  const materialized = applyResolvedDeploymentBindings(
    flattened,
    { databaseId, databaseName, kvNamespaceId },
    {
      productionDatabaseId: productionD1.database_id,
      productionKvNamespaceId: productionKv.id,
    },
  );

  const destination = resolve(
    workerDirectory,
    outputPath ?? `.wrangler.${environment}.ci.toml`,
  );
  await writeFile(destination, serializeToml(materialized), 'utf8');

  return {
    environment,
    workerName,
    databaseName,
    databaseId,
    kvNamespaceId,
    destination,
  };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const environment = process.argv[2];
  const outputPath = process.argv[3] ?? null;
  try {
    const result = await materializeDeploymentBindings({ environment, outputPath });
    console.log(
      `Materialized ${result.environment} bindings for ${result.workerName}: DB=${result.databaseName}; CONFIG namespace resolved`,
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
