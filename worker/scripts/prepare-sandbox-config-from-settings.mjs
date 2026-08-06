import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolveSandboxLifecycleConfig } from "./prepare-sandbox-config.mjs";

const apiBase = "https://api.cloudflare.com/client/v4";
const workerName = "moerand-alerts-sandbox";
const kvTitle = "moerand-alerts-sandbox-config";
const d1Name = "moe-ai-sandbox";
const sourceConfigPath = "wrangler.toml";
const sourceEntryPath = "src/index.ts";
const canonicalExportsPath = "config/sandbox-durable-object-exports.json";
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
  async function request(path, init = {}, optional = false) {
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
      if (optional) return null;
      throw new Error(`Cloudflare API returned non-JSON response (${response.status})`);
    }

    if (!response.ok || payload.success !== true) {
      if (optional) return null;
      const details = Array.isArray(payload.errors)
        ? payload.errors.map((item) => `${item.code ?? "unknown"}: ${item.message ?? "unknown error"}`).join("; ")
        : `HTTP ${response.status}`;
      throw new Error(`Cloudflare API request failed for ${path}: ${details}`);
    }
    return payload;
  }

  async function cloudflare(path, init = {}) {
    return request(path, init, false);
  }

  async function cloudflareOptional(path, init = {}) {
    return request(path, init, true);
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

  return { cloudflare, cloudflareOptional, listAll, accountId };
}

function hasExportsMap(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0;
}

function findExportsCandidate(value, source = "unknown", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return null;
  seen.add(value);

  const candidates = [
    [source, value.exports],
    [`${source}.script_runtime.exports`, value.script_runtime?.exports],
    [`${source}.scriptRuntime.exports`, value.scriptRuntime?.exports],
    [`${source}.result.exports`, value.result?.exports],
    [`${source}.result.script_runtime.exports`, value.result?.script_runtime?.exports],
  ];
  for (const [candidateSource, candidate] of candidates) {
    if (hasExportsMap(candidate)) return { source: candidateSource, exportsMap: candidate };
  }

  for (const [key, child] of Object.entries(value)) {
    if (child && typeof child === "object") {
      const nested = findExportsCandidate(child, `${source}.${key}`, seen);
      if (nested) return nested;
    }
  }
  return null;
}

function collectVersionIds(value, ids = new Set(), seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return ids;
  seen.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === "string" && /version/i.test(key) && /^[a-f0-9-]{16,}$/i.test(child)) {
      ids.add(child);
    } else if (child && typeof child === "object") {
      collectVersionIds(child, ids, seen);
    }
  }
  return ids;
}

function validateCanonicalExports(exportsMap) {
  const required = ["AlertCoordinator", "SimulationDriver", "TradingViewPositionCoordinator"];
  for (const name of required) {
    const entry = exportsMap?.[name];
    if (!entry || entry.type !== "durable-object") {
      throw new Error(`Canonical Sandbox exports manifest is missing Durable Object ${name}`);
    }
    if (entry.storage !== "sqlite" && entry.storage !== "legacy-kv") {
      throw new Error(`Canonical Sandbox exports manifest has invalid storage for ${name}`);
    }
  }
  return exportsMap;
}

async function readCanonicalExports() {
  const parsed = JSON.parse(await readFile(canonicalExportsPath, "utf8"));
  return validateCanonicalExports(parsed);
}

async function findDeployedWorkerMetadata(client, canonicalExports) {
  const scripts = await client.listAll(`/accounts/${client.accountId}/workers/scripts`, 100);
  const listedWorker = scripts.find((script) => script.id === workerName || script.name === workerName) ?? null;
  if (!listedWorker) return null;

  const direct = findExportsCandidate(listedWorker, "workers-list");
  if (direct) {
    console.log(`Resolved deployed Durable Object exports from: ${direct.source}`);
    return { ...listedWorker, exports: direct.exportsMap };
  }

  const settings = await client.cloudflareOptional(
    `/accounts/${client.accountId}/workers/scripts/${encodeURIComponent(workerName)}/settings`,
  );
  const settingsCandidate = findExportsCandidate(settings, "worker-settings");
  if (settingsCandidate) {
    console.log(`Resolved deployed Durable Object exports from: ${settingsCandidate.source}`);
    return { ...listedWorker, exports: settingsCandidate.exportsMap };
  }

  const deployments = await client.cloudflareOptional(
    `/accounts/${client.accountId}/workers/scripts/${encodeURIComponent(workerName)}/deployments`,
  );
  const deploymentsCandidate = findExportsCandidate(deployments, "worker-deployments");
  if (deploymentsCandidate) {
    console.log(`Resolved deployed Durable Object exports from: ${deploymentsCandidate.source}`);
    return { ...listedWorker, exports: deploymentsCandidate.exportsMap };
  }

  const versions = await client.cloudflareOptional(
    `/accounts/${client.accountId}/workers/scripts/${encodeURIComponent(workerName)}/versions`,
  );
  const versionsCandidate = findExportsCandidate(versions, "worker-versions");
  if (versionsCandidate) {
    console.log(`Resolved deployed Durable Object exports from: ${versionsCandidate.source}`);
    return { ...listedWorker, exports: versionsCandidate.exportsMap };
  }

  const versionIds = new Set([
    ...collectVersionIds(deployments),
    ...collectVersionIds(versions),
  ]);
  for (const versionId of versionIds) {
    const version = await client.cloudflareOptional(
      `/accounts/${client.accountId}/workers/scripts/${encodeURIComponent(workerName)}/versions/${encodeURIComponent(versionId)}`,
    );
    const versionCandidate = findExportsCandidate(version, `worker-version:${versionId}`);
    if (versionCandidate) {
      console.log(`Resolved deployed Durable Object exports from: ${versionCandidate.source}`);
      return { ...listedWorker, exports: versionCandidate.exportsMap };
    }
  }

  // Deterministic final fallback. Cloudflare still performs authoritative reconciliation
  // and rejects any storage-backend mismatch before mutating a namespace.
  console.log("Cloudflare metadata omitted exports; using reviewed canonical Sandbox export manifest");
  return { ...listedWorker, exports: canonicalExports, exports_source: "canonical-manifest" };
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
  const [sourceConfig, sourceEntry, canonicalExports] = await Promise.all([
    readFile(sourceConfigPath, "utf8"),
    readFile(sourceEntryPath, "utf8"),
    readCanonicalExports(),
  ]);
  const deployedWorker = await findDeployedWorkerMetadata(client, canonicalExports);

  const lifecycle = resolveSandboxLifecycleConfig(sourceConfig, deployedWorker, sourceEntry);
  console.log(`Using deployed exports metadata from: ${deployedWorker?.exports_source ?? lifecycle.exportsSource}`);
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
