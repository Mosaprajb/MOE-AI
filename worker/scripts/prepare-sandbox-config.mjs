import { readFile, writeFile } from "node:fs/promises";

const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
const apiToken = process.env.CLOUDFLARE_API_TOKEN?.trim();

if (!accountId || !apiToken) {
  throw new Error("CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are required");
}

const apiBase = "https://api.cloudflare.com/client/v4";
const kvTitle = "moerand-alerts-sandbox-config";
const d1Name = "moe-ai-sandbox";
const sourceConfigPath = "wrangler.toml";
const generatedConfigPath = ".wrangler.sandbox.ci.toml";

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

async function findKvNamespace() {
  const namespaces = await listAll(`/accounts/${accountId}/storage/kv/namespaces`, 1000);
  return namespaces.find((namespace) => namespace.title === kvTitle) ?? null;
}

async function ensureKvNamespace() {
  const existing = await findKvNamespace();
  if (existing?.id) {
    console.log(`Using existing Sandbox KV namespace: ${kvTitle}`);
    return existing.id;
  }

  try {
    const created = await cloudflare(`/accounts/${accountId}/storage/kv/namespaces`, {
      method: "POST",
      body: JSON.stringify({ title: kvTitle }),
    });
    if (!created.result?.id) {
      throw new Error("Cloudflare did not return the created KV namespace ID");
    }
    console.log(`Created Sandbox KV namespace: ${kvTitle}`);
    return created.result.id;
  } catch (error) {
    // A previous or concurrent attempt may have created the namespace after our list call.
    const recovered = await findKvNamespace();
    if (recovered?.id) {
      console.log(`Recovered existing Sandbox KV namespace after create conflict: ${kvTitle}`);
      return recovered.id;
    }
    throw error;
  }
}

async function findD1Database() {
  const databases = await listAll(
    `/accounts/${accountId}/d1/database?name=${encodeURIComponent(d1Name)}`,
    100,
  );
  return databases.find((database) => database.name === d1Name) ?? null;
}

async function ensureD1Database() {
  const existing = await findD1Database();
  if (existing?.uuid) {
    console.log(`Using existing Sandbox D1 database: ${d1Name}`);
    return existing.uuid;
  }

  try {
    const created = await cloudflare(`/accounts/${accountId}/d1/database`, {
      method: "POST",
      body: JSON.stringify({ name: d1Name }),
    });
    if (!created.result?.uuid) {
      throw new Error("Cloudflare did not return the created D1 database UUID");
    }
    console.log(`Created Sandbox D1 database: ${d1Name}`);
    return created.result.uuid;
  } catch (error) {
    // A previous or concurrent attempt may have created the database after our list call.
    const recovered = await findD1Database();
    if (recovered?.uuid) {
      console.log(`Recovered existing Sandbox D1 database after create conflict: ${d1Name}`);
      return recovered.uuid;
    }
    throw error;
  }
}

function replaceExactlyOnce(content, target, replacement, label) {
  const occurrences = content.split(target).length - 1;
  if (occurrences !== 1) {
    throw new Error(`Expected exactly one ${label} block in ${sourceConfigPath}, found ${occurrences}`);
  }
  return content.replace(target, replacement);
}

function validateResourceIds(kvId, d1Id) {
  if (!/^[a-f0-9]{32}$/i.test(kvId)) {
    throw new Error("Cloudflare returned an invalid KV namespace ID");
  }
  if (!/^[a-f0-9-]{36}$/i.test(d1Id)) {
    throw new Error("Cloudflare returned an invalid D1 database UUID");
  }
}

async function writeResolvedConfig(kvId, d1Id) {
  validateResourceIds(kvId, d1Id);
  let config = await readFile(sourceConfigPath, "utf8");

  config = replaceExactlyOnce(
    config,
    '[[env.sandbox.kv_namespaces]]\nbinding = "CONFIG"',
    `[[env.sandbox.kv_namespaces]]\nbinding = "CONFIG"\nid = "${kvId}"`,
    "Sandbox KV",
  );

  config = replaceExactlyOnce(
    config,
    '[[env.sandbox.d1_databases]]\nbinding = "DB"\nmigrations_dir = "migrations"',
    `[[env.sandbox.d1_databases]]\nbinding = "DB"\ndatabase_name = "${d1Name}"\ndatabase_id = "${d1Id}"\nmigrations_dir = "migrations"`,
    "Sandbox D1",
  );

  await writeFile(generatedConfigPath, config, { mode: 0o600 });
  console.log(`Generated resolved Wrangler config at ${generatedConfigPath}`);
}

const kvId = await ensureKvNamespace();
const d1Id = await ensureD1Database();
await writeResolvedConfig(kvId, d1Id);
