import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const workerDirectory = resolve(scriptDirectory, '..');
export const canonicalConfigPath = resolve(workerDirectory, 'wrangler.jsonc');
export const workerEntryPath = resolve(workerDirectory, 'src/index.ts');
export const supportedEnvironments = Object.freeze(['sandbox', 'staging', 'production']);

const liveStorageBackends = new Set(['sqlite', 'legacy-kv']);
const tombstoneStates = new Set(['deleted', 'renamed', 'transferred', 'expecting-transfer']);

export function parseJsonc(source) {
  let output = '';
  let inString = false;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const current = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (current === '\n') {
        lineComment = false;
        output += current;
      }
      continue;
    }

    if (blockComment) {
      if (current === '*' && next === '/') {
        blockComment = false;
        index += 1;
      } else if (current === '\n') {
        output += current;
      }
      continue;
    }

    if (inString) {
      output += current;
      if (escaped) {
        escaped = false;
      } else if (current === '\\') {
        escaped = true;
      } else if (current === '"') {
        inString = false;
      }
      continue;
    }

    if (current === '"') {
      inString = true;
      output += current;
      continue;
    }

    if (current === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }

    if (current === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }

    output += current;
  }

  if (inString || blockComment) {
    throw new Error('Invalid JSONC: unterminated string or block comment');
  }

  return JSON.parse(output.replace(/,\s*([}\]])/g, '$1'));
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function findForbiddenMigrations(value, path = 'config') {
  if (!isObject(value) && !Array.isArray(value)) return null;
  if (isObject(value) && Object.hasOwn(value, 'migrations')) return `${path}.migrations`;

  for (const [key, child] of Object.entries(value)) {
    const found = findForbiddenMigrations(child, `${path}.${key}`);
    if (found) return found;
  }
  return null;
}

export function collectModuleExports(source) {
  const names = new Set();
  const declarationPattern = /export\s+(?:default\s+)?(?:abstract\s+)?(?:class|function|const|let|var)\s+([A-Za-z_$][\w$]*)/g;
  for (const match of source.matchAll(declarationPattern)) names.add(match[1]);

  const listPattern = /export\s*\{([\s\S]*?)\}\s*(?:from\s*['"][^'"]+['"])?\s*;?/g;
  for (const match of source.matchAll(listPattern)) {
    for (const rawPart of match[1].split(',')) {
      const part = rawPart.trim();
      if (!part) continue;
      const aliasMatch = part.match(/^(?:type\s+)?([A-Za-z_$][\w$]*)(?:\s+as\s+([A-Za-z_$][\w$]*))?$/);
      if (aliasMatch) names.add(aliasMatch[2] ?? aliasMatch[1]);
    }
  }
  return names;
}

export function validateExports(exportsMap, moduleExports = null) {
  if (!isObject(exportsMap) || Object.keys(exportsMap).length === 0) {
    throw new Error('wrangler.jsonc must define a non-empty exports map');
  }

  for (const [className, declaration] of Object.entries(exportsMap)) {
    if (!isObject(declaration) || declaration.type !== 'durable-object') {
      throw new Error(`exports.${className} must be a durable-object declaration`);
    }

    const state = declaration.state;
    if (state === undefined) {
      if (!liveStorageBackends.has(declaration.storage)) {
        throw new Error(`Live Durable Object ${className} must declare storage as sqlite or legacy-kv`);
      }
      if (moduleExports && !moduleExports.has(className)) {
        throw new Error(`Live Durable Object ${className} is not exported by src/index.ts`);
      }
      continue;
    }

    if (!tombstoneStates.has(state)) {
      throw new Error(`exports.${className}.state is not a supported tombstone state`);
    }
    if (Object.hasOwn(declaration, 'storage')) {
      throw new Error(`Tombstone ${className} must not declare storage`);
    }
  }
}

export function validateCanonicalConfig(config, moduleExports = null) {
  if (!isObject(config)) throw new Error('wrangler.jsonc must contain an object');

  const forbidden = findForbiddenMigrations(config);
  if (forbidden) {
    throw new Error(`${forbidden} is forbidden; use an explicit Durable Object exports tombstone instead`);
  }

  validateExports(config.exports, moduleExports);

  if (!isObject(config.env)) throw new Error('wrangler.jsonc must define env');
  for (const environment of supportedEnvironments) {
    if (!isObject(config.env[environment])) {
      throw new Error(`wrangler.jsonc is missing env.${environment}`);
    }
  }
  return config;
}

export function flattenEnvironment(config, environment) {
  if (!supportedEnvironments.includes(environment)) {
    throw new Error(`Unsupported environment ${environment}. Expected one of: ${supportedEnvironments.join(', ')}`);
  }
  const environmentConfig = config.env?.[environment];
  if (!isObject(environmentConfig)) throw new Error(`Missing env.${environment}`);

  const flattened = {};
  for (const [key, value] of Object.entries(config)) {
    if (key === '$schema' || key === 'env') continue;
    flattened[key] = value;
  }
  for (const [key, value] of Object.entries(environmentConfig)) flattened[key] = value;
  return flattened;
}

function quote(value) {
  return JSON.stringify(String(value));
}

function tomlKey(key) {
  return /^[A-Za-z0-9_-]+$/.test(key) ? key : quote(key);
}

function scalarLine(key, value) {
  if (typeof value === 'boolean' || typeof value === 'number') return `${tomlKey(key)} = ${value}`;
  if (Array.isArray(value)) return `${tomlKey(key)} = [${value.map((item) => quote(item)).join(', ')}]`;
  return `${tomlKey(key)} = ${quote(value)}`;
}

function appendArrayTables(lines, tableName, rows) {
  for (const row of rows ?? []) {
    lines.push('', `[[${tableName}]]`);
    for (const [key, value] of Object.entries(row)) {
      if (value !== undefined && value !== null) lines.push(scalarLine(key, value));
    }
  }
}

export function serializeToml(config) {
  const lines = [
    '# Generated from wrangler.jsonc. Do not edit.',
    '# Regenerate with: node scripts/generate-wrangler-config.mjs <environment>',
  ];

  const reserved = new Set(['exports', 'kv_namespaces', 'd1_databases', 'vars']);
  for (const [key, value] of Object.entries(config)) {
    if (reserved.has(key) || value === undefined || value === null) continue;
    if (isObject(value)) throw new Error(`Unsupported top-level object ${key} in generated Wrangler TOML`);
    lines.push(scalarLine(key, value));
  }

  for (const [className, declaration] of Object.entries(config.exports ?? {})) {
    lines.push('', `[exports.${tomlKey(className)}]`);
    for (const [key, value] of Object.entries(declaration)) {
      if (value !== undefined && value !== null) lines.push(scalarLine(key, value));
    }
  }

  appendArrayTables(lines, 'kv_namespaces', config.kv_namespaces);
  appendArrayTables(lines, 'd1_databases', config.d1_databases);

  if (isObject(config.vars)) {
    lines.push('', '[vars]');
    for (const [key, value] of Object.entries(config.vars)) lines.push(scalarLine(key, value));
  }

  return `${lines.join('\n')}\n`;
}

export async function loadCanonicalConfig() {
  const [rawConfig, workerEntry] = await Promise.all([
    readFile(canonicalConfigPath, 'utf8'),
    readFile(workerEntryPath, 'utf8'),
  ]);
  const config = parseJsonc(rawConfig);
  return validateCanonicalConfig(config, collectModuleExports(workerEntry));
}

export async function generateWranglerConfig(environment, outputPath = null) {
  const config = await loadCanonicalConfig();
  const flattened = flattenEnvironment(config, environment);
  validateExports(flattened.exports, collectModuleExports(await readFile(workerEntryPath, 'utf8')));

  const destination = resolve(workerDirectory, outputPath ?? `.wrangler.${environment}.ci.toml`);
  await writeFile(destination, serializeToml(flattened), 'utf8');
  return destination;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  const environment = process.argv[2];
  if (!environment) {
    console.error(`Usage: node scripts/generate-wrangler-config.mjs <${supportedEnvironments.join('|')}> [output-path]`);
    process.exitCode = 2;
  } else {
    try {
      const destination = await generateWranglerConfig(environment, process.argv[3] ?? null);
      console.log(`Generated ${destination} from wrangler.jsonc (${environment})`);
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    }
  }
}
