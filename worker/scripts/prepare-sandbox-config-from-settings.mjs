import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolveSandboxLifecycleConfig } from "./prepare-sandbox-config.mjs";

const apiBase = "https://api.cloudflare.com/client/v4";
const workerName = "moerand-alerts-sandbox";
const kvTitle = "moerand-alerts-sandbox-config";
const d1Name = "moe-ai-sandbox";
const sourceConfigPath = "wrangler.toml";
const sourceEntryPath = "src/index.ts";
const generatedConfigPath = ".wrangler.sandbox.ci.toml";

function requireCredentials() {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !apiToken) {
    throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
  }
  return { accountId, apiToken };
}

function createCloudflareClient(accountId, apiToken) {
  async function cloudflare(path, init = {}) {
    const response = await fetch(`${apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${apiToken}`,
        "Content-Type": "application/json",
        ...init.headers,
      },
    });

    let payload;
    try {
      payload = await response.json();
    } catch {
      throw new Error(`Cloudflare API returned non-JSON response (${response.status})`);
    }

    if (!response.ok || payload.success !== true) {
      const details = Array.isArray(payload.errors)
        ? payload.errors.map((item) => `${item.code ?? "unknown"}: ${item.message ?? "unknown error"}`).join("; ")
        : `HTTP ${response.status}`;
      throw new Error(`Cloudflare API request failed for ${path}: ${details}`);
    }
    return payload;
  }

  async function listAll(path, perPage) {
    const results = [];
    let page = 1;
    while (true) {
      const separator = path.includes("?") ? "&" : "?";
      const payload = await cloudflare(`${path}${separator}page=${page}&per_page=${perPage}`);
      if (Array.isArray(payload.result)) results.push(...payload.result);
      const totalPages = Number(payload.result_info?.total_pages ?? 1);
      if (page >= totalPages) return results;
      page += 1;
    }
  }

  return { cloudflare, listAll, accountId };
}

function hasExportsMap(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function mergeWorkerSettingsMetadata(listedWorker, settingsResult) {
  if (!listedWorker) return null;
  const runtimeExports = settingsResult?.script_runtime?.exports ?? settingsResult?.scriptRuntime?.exports;
  const directExports = settingsResult?.exports;
  const exportsMap = hasExportsMap(runtimeExports)
    ? runtimeExports
    : hasExportsMap(directExports)
      ? directExports
      : undefined;

  return {
    ...listedWorker,
    settings: settingsResult ?? null,
    exports: exportsMap ?? listedWorker.exports,
    script_runtime: settingsResult?.script_runtime ?? listedWorker.script_runtime,
  };
}

async function findDeployedWorkerMetadata(client) {
  const scripts = await client.listAll(`/accounts/${client.accountId}/workers/scripts`, 100);
  const listedWorker = scripts.find((script) => script.id === workerName || script.name === workerName) ?? null;
  if (!listedWorker) return null;

  const settingsPayload = await client.cloudflare(
    `/accounts/${client.accountId}/workers/scripts/${encodeURIComponent(workerName)}/settings`,
  );
  const merged = mergeWorkerSettingsMetadata(listedWorker, settingsPayload.result);
  const source = hasExportsMap(settingsPayload.result?.script_runtime?.exports)
    ? "worker-settings.script_runtime.exports"
    : hasExportsMap(settingsPayload.result?.exports)
      ? "worker-settings.exports"
      : "worker-settings-unavailable";
  console.log(`Fetched deployed Worker lifecycle metadata from: ${source}`);
  return merged;
}

async function findKvNamespace(client) {
  const namespaces = await client.listAll(`/accounts/${client.accountId}/storage/kv/namespaces`, 1000);
  return namespaces.find((namespace) => namespace.title === kvTitle) ?? null;
}

async function ensureKvNamespace(client) {
  const existing = await findKvNamespace(client);
  if (existing?.id) {
    console.log(`Using existing Sandbox KV namespace: ${kvTitle}`);
    return existing.id;
  }
  try {
    const created = await client.cloudflare(`/accounts/${client.accountId}/storage/kv/namespaces`, {
      method: "POST",
      body: JSON.stringify({ title: kvTitle }),
    });
    if (!created.result?.id) throw new Error("Cloudflare did not return the created KV namespace ID");
    console.log(`Created Sandbox KV namespace: ${kvTitle}`);
    return created.result.id;
  } catch (error) {
    const recovered = await findKvNamespace(client);
    if (recovered?.id) {
      console.log(`Recovered existing Sandbox KV namespace after create conflict: ${kvTitle}`);
      return recovered.id;
    }
    throw error;
  }
}

async function findD1Database(client) {
  const databases = await client.listAll(
    `/accounts/${client.accountId}/d1/database?name=${encodeURIComponent(d1Name)}`,
    100,
  );
  return databases.find((database) => database.name === d1Name) ?? null;
}

async function ensureD1Database(client) {
  const existing = await findD1Database(client);
  if (existing?.uuid) {
    console.log(`Using existing Sandbox D1 database: ${d1Name}`);
    return existing.uuid;
  }
  try {
    const created = await client.cloudflare(`/accounts/${client.accountId}/d1/database`, {
      method: "POST",
      body: JSON.stringify({ name: d1Name }),
    });
    if (!created.result?.uuid) throw new Error("Cloudflare did not return the created D1 database UUID");
    console.log(`Created Sandbox D1 database: ${d1Name}`);
    return created.result.uuid;
  } catch (error) {
    const recovered = await findD1Database(client);
    if (recovered?.uuid) {
      console.log(`Recovered existing Sandbox D1 database after create conflict: ${d1Name}`);
      return recovered.uuid;
    }
    throw error;
  }
}

function replaceExactlyOnce(content, target, replacement, label) {
  const occurrences = content.split(target).length - 1;
  if (occurrences !== 1) throw new Error(`Expected exactly one ${label} block, found ${occurrences}`);
  return content.replace(target, replacement);
}

function validateResourceIds(kvId, d1Id) {
  if (!/^[a-f0-9]{32}$/i.test(kvId)) throw new Error("Cloudflare returned an invalid KV namespace ID");
  if (!/^[a-f0-9-]{36}$/i.test(d1Id)) throw new Error("Cloudflare returned an invalid D1 database UUID");
}

async function writeResolvedConfig(config, kvId, d1Id) {
  validateResourceIds(kvId, d1Id);
  let resolved = replaceExactlyOnce(
    config,
    '[[env.sandbox.kv_namespaces]]\nbinding = "CONFIG"',
    `[[env.sandbox.kv_namespaces]]\nbinding = "CONFIG"\nid = "${kvId}"`,
    "Sandbox KV",
  );
  resolved = replaceExactlyOnce(
    resolved,
    '[[env.sandbox.d1_databases]]\nbinding = "DB"\nmigrations_dir = "migrations"',
    `[[env.sandbox.d1_databases]]\nbinding = "DB"\ndatabase_name = "${d1Name}"\ndatabase_id = "${d1Id}"\nmigrations_dir = "migrations"`,
    "Sandbox D1",
  );
  await writeFile(generatedConfigPath, resolved, { mode: 0o600 });
  console.log(`Generated resolved Wrangler config at ${generatedConfigPath}`);
}

async function main() {
  const { accountId, apiToken } = requireCredentials();
  const client = createCloudflareClient(accountId, apiToken);
  const [sourceConfig, sourceEntry, deployedWorker] = await Promise.all([
    readFile(sourceConfigPath, "utf8"),
    readFile(sourceEntryPath, "utf8"),
    findDeployedWorkerMetadata(client),
  ]);

  const lifecycle = resolveSandboxLifecycleConfig(sourceConfig, deployedWorker, sourceEntry);
  console.log(`Using deployed exports metadata from: ${lifecycle.exportsSource}`);
  if (lifecycle.preservedNames.length > 0) {
    console.log(`Preserving live Sandbox Durable Object exports: ${lifecycle.preservedNames.join(", ")}`);
  } else {
    console.log("No live Sandbox Durable Object exports detected; preserving declarative exports mode with an explicit empty map");
  }

  const kvId = await ensureKvNamespace(client);
  const d1Id = await ensureD1Database(client);
  await writeResolvedConfig(lifecycle.config, kvId, d1Id);
}

const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) await main();
