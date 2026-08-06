import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const apiBase = "https://api.cloudflare.com/client/v4";
const workerName = "moerand-alerts-sandbox";
const kvTitle = "moerand-alerts-sandbox-config";
const d1Name = "moe-ai-sandbox";
const sourceConfigPath = "wrangler.toml";
const sourceEntryPath = "src/index.ts";
const generatedConfigPath = ".wrangler.sandbox.ci.toml";

const legacyMigrationBlock = `# Deletes the legacy AlertCoordinator Durable Object namespace.
[[migrations]]
tag             = "v2-cleanup"
deleted_classes = ["AlertCoordinator"]
`;

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
      if (Array.isArray(payload.result)) {
        results.push(...payload.result);
      }

      const totalPages = Number(payload.result_info?.total_pages ?? 1);
      if (page >= totalPages) {
        return results;
      }
      page += 1;
    }
  }

  return { cloudflare, listAll, accountId };
}

export function collectSourceExportNames(source) {
  const names = new Set();

  for (const match of source.matchAll(/\bexport\s+(?:declare\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/g)) {
    names.add(match[1]);
  }

  for (const match of source.matchAll(/\bexport\s*\{([^}]+)\}/g)) {
    for (const rawItem of match[1].split(",")) {
      const item = rawItem.replace(/\/\*[\s\S]*?\*\//g, "").trim();
      if (!item) continue;
      const parts = item.split(/\s+as\s+/i).map((part) => part.trim());
      const exportedName = parts.at(-1);
      if (/^[A-Za-z_$][\w$]*$/.test(exportedName)) {
        names.add(exportedName);
      }
    }
  }

  return names;
}

function isExportsMap(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function resolveDeployedExportsMap(deployedScript) {
  const candidates = [
    ["exports", deployedScript?.exports],
    ["script_runtime.exports", deployedScript?.script_runtime?.exports],
    ["scriptRuntime.exports", deployedScript?.scriptRuntime?.exports],
    ["result.script_runtime.exports", deployedScript?.result?.script_runtime?.exports],
  ];

  for (const [source, value] of candidates) {
    if (isExportsMap(value) && Object.keys(value).length > 0) {
      return { source, exportsMap: value };
    }
  }

  for (const [source, value] of candidates) {
    if (isExportsMap(value)) {
      return { source, exportsMap: value };
    }
  }

  return { source: "unavailable", exportsMap: null };
}

export function getLiveDurableObjectExports(deployedScript) {
  const { exportsMap } = resolveDeployedExportsMap(deployedScript);
  if (!exportsMap) {
    return [];
  }

  return Object.entries(exportsMap)
    .filter(([, value]) => {
      if (!value || typeof value !== "object" || value.type !== "durable-object") return false;
      const state = value.state ?? "created";
      return state === "created" || state === "expecting-transfer";
    })
    .map(([name, value]) => ({
      name,
      state: value.state ?? "created",
      storage: value.storage,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function validateDurableObjectExport(item) {
  if (!/^[A-Za-z_$][\w$]*$/.test(item.name)) {
    throw new Error(`Cloudflare returned an invalid Durable Object class name: ${item.name}`);
  }
  if (item.state !== "created") {
    throw new Error(
      `Refusing to deploy ${workerName}: Durable Object ${item.name} is in lifecycle state ${item.state}. ` +
      "Transfer lifecycle entries require an explicit reviewed configuration.",
    );
  }
  if (item.storage !== "sqlite" && item.storage !== "legacy-kv") {
    throw new Error(`Cloudflare did not return a valid storage backend for ${item.name}`);
  }
}

export function buildSandboxExportsConfig(deployedScript, sourceEntry) {
  const { source: exportsSource, exportsMap } = resolveDeployedExportsMap(deployedScript);
  const liveDurableObjects = getLiveDurableObjectExports(deployedScript);

  if (deployedScript && !exportsMap) {
    throw new Error(
      `Refusing to deploy ${workerName}: Cloudflare returned deployed Worker metadata without an exports map. ` +
      "The existing Durable Object lifecycle cannot be reconciled safely.",
    );
  }

  if (liveDurableObjects.length === 0) {
    return {
      inline: "exports = {}",
      tables: "",
      preservedNames: [],
      exportsSource,
    };
  }

  const sourceExports = collectSourceExportNames(sourceEntry);
  const missingClasses = liveDurableObjects
    .filter((item) => !sourceExports.has(item.name))
    .map((item) => item.name);

  if (missingClasses.length > 0) {
    throw new Error(
      `Refusing to deploy ${workerName}: live Durable Object exports are absent from the current source (${missingClasses.join(", ")}). ` +
      "Deploying without those classes could retire namespaces or destroy data.",
    );
  }

  for (const item of liveDurableObjects) {
    validateDurableObjectExport(item);
  }

  const tables = liveDurableObjects.map((item) => (
    `[env.sandbox.exports.${item.name}]\ntype = "durable-object"\nstorage = "${item.storage}"`
  )).join("\n\n");

  return {
    inline: "",
    tables,
    preservedNames: liveDurableObjects.map((item) => item.name),
    exportsSource,
  };
}

function replaceExactlyOnce(content, target, replacement, label) {
  const occurrences = content.split(target).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one ${label} block in ${sourceConfigPath}, found ${occurrences}`);
  }
  return content.replace(target, replacement);
}

export function resolveSandboxLifecycleConfig(config, deployedScript, sourceEntry) {
  const exportsConfig = buildSandboxExportsConfig(deployedScript, sourceEntry);

  let resolved = replaceExactlyOnce(
    config,
    legacyMigrationBlock,
    "# Sandbox deployments continue Cloudflare's declarative exports lifecycle.\n",
    "legacy Durable Object migration",
  );

  const sandboxHeader = '[env.sandbox]\nname = "moerand-alerts-sandbox"';
  const headerReplacement = exportsConfig.inline
    ? `${sandboxHeader}\n${exportsConfig.inline}`
    : sandboxHeader;

  resolved = replaceExactlyOnce(
    resolved,
    sandboxHeader,
    headerReplacement,
    "Sandbox environment",
  );

  if (exportsConfig.tables) {
    resolved = replaceExactlyOnce(
      resolved,
      '[[env.sandbox.kv_namespaces]]\nbinding = "CONFIG"',
      `${exportsConfig.tables}\n\n[[env.sandbox.kv_namespaces]]\nbinding = "CONFIG"`,
      "Sandbox KV",
    );
  }

  if (/^\s*\[\[migrations\]\]/m.test(resolved)) {
    throw new Error("Generated Sandbox config still contains a legacy migrations block");
  }

  return {
    config: resolved,
    preservedNames: exportsConfig.preservedNames,
    exportsSource: exportsConfig.exportsSource,
  };
}

async function findDeployedWorkerScript(client) {
  const scripts = await client.listAll(`/accounts/${client.accountId}/workers/scripts`, 100);
  return scripts.find((script) => script.id === workerName || script.name === workerName) ?? null;
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
    if (!created.result?.id) {
      throw new Error("Cloudflare did not return the created KV namespace ID");
    }
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
    if (!created.result?.uuid) {
      throw new Error("Cloudflare did not return the created D1 database UUID");
    }
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

function validateResourceIds(kvId, d1Id) {
  if (!/^[a-f0-9]{32}$/i.test(kvId)) {
    throw new Error("Cloudflare returned an invalid KV namespace ID");
  }
  if (!/^[a-f0-9-]{36}$/i.test(d1Id)) {
    throw new Error("Cloudflare returned an invalid D1 database UUID");
  }
}

async function writeResolvedConfig(config, kvId, d1Id) {
  validateResourceIds(kvId, d1Id);
  let resolved = config;

  resolved = replaceExactlyOnce(
    resolved,
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

  const [sourceConfig, sourceEntry, deployedScript] = await Promise.all([
    readFile(sourceConfigPath, "utf8"),
    readFile(sourceEntryPath, "utf8"),
    findDeployedWorkerScript(client),
  ]);

  const lifecycle = resolveSandboxLifecycleConfig(sourceConfig, deployedScript, sourceEntry);
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
if (isMain) {
  await main();
}
