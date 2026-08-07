#!/usr/bin/env node

const DEFAULT_URLS = Object.freeze({
  sandbox: 'https://moerand-alerts-sandbox.mosaprajb.workers.dev',
  staging: 'https://moerand-alerts-staging.mosaprajb.workers.dev',
  production: 'https://moerand-alerts.mosaprajb.workers.dev',
});

function assertion(condition, message, details = undefined) {
  if (condition) return;
  const error = new Error(message);
  error.details = details;
  throw error;
}

async function getJson(fetchImpl, url) {
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(15_000),
  });
  const text = await response.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error(`Expected JSON from ${url}; received HTTP ${response.status}: ${text.slice(0, 240)}`);
  }
  assertion(response.ok, `Safety endpoint failed: ${url}`, {
    status: response.status,
    payload,
  });
  return payload;
}

async function verifyDeploymentSafetyOnce({ environment, baseUrl, fetchImpl }) {
  const normalizedBaseUrl = baseUrl.replace(/\/$/u, '');
  const [health, liveStatus, mode] = await Promise.all([
    getJson(fetchImpl, `${normalizedBaseUrl}/api/health`),
    getJson(fetchImpl, `${normalizedBaseUrl}/api/trading/live/status`),
    getJson(fetchImpl, `${normalizedBaseUrl}/api/trading/mode`),
  ]);

  assertion(health.ok === true, 'Worker health check did not report ok=true.', health);
  assertion(
    health.deploymentEnvironment === environment,
    `Deployment environment mismatch: expected ${environment}, received ${String(health.deploymentEnvironment)}.`,
    health,
  );
  assertion(
    health.liveExecutionAllowed === false,
    'Deployment safety check requires Live execution to remain disabled.',
    health,
  );
  assertion(
    health.tradingMode === 'SANDBOX',
    'Health endpoint must expose SANDBOX as the effective mode during the read-only rollout.',
    health,
  );
  assertion(liveStatus.ok === true, 'Live status endpoint did not report ok=true.', liveStatus);
  assertion(
    liveStatus.deploymentEnvironment === environment,
    'Live status environment does not match the deployed environment.',
    liveStatus,
  );
  assertion(
    liveStatus.executionAllowed === false,
    'Live status unexpectedly allows execution.',
    liveStatus,
  );
  assertion(
    liveStatus.currentMode === 'SANDBOX',
    'Live status must fail closed to SANDBOX.',
    liveStatus,
  );
  assertion(
    Array.isArray(liveStatus.blockers) && liveStatus.blockers.length > 0,
    'Live status must expose at least one fail-closed blocker during this rollout.',
    liveStatus,
  );
  assertion(mode.mode === 'SANDBOX', 'Trading mode endpoint must report SANDBOX.', mode);
  assertion(mode.liveExecutionAllowed === false, 'Trading mode endpoint unexpectedly allows Live execution.', mode);

  return {
    ok: true,
    environment,
    baseUrl: normalizedBaseUrl,
    workerVersion: health.workerVersion ?? null,
    effectiveMode: mode.mode,
    storedMode: mode.storedMode ?? liveStatus.storedMode ?? null,
    liveExecutionAllowed: false,
    blockerCodes: liveStatus.blockers.map(blocker => blocker?.code).filter(Boolean),
    checkedAt: new Date().toISOString(),
  };
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function verifyDeploymentSafety({
  environment,
  baseUrl = DEFAULT_URLS[environment],
  fetchImpl = fetch,
  attempts = 8,
  retryDelayMs = 3_000,
} = {}) {
  assertion(Object.hasOwn(DEFAULT_URLS, environment), 'Environment must be sandbox, staging, or production.');
  assertion(typeof baseUrl === 'string' && baseUrl.length > 0, 'A deployment base URL is required.');
  assertion(Number.isInteger(attempts) && attempts >= 1, 'attempts must be a positive integer.');

  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await verifyDeploymentSafetyOnce({ environment, baseUrl, fetchImpl });
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      console.warn(`Safety verification attempt ${attempt}/${attempts} failed; retrying in ${retryDelayMs}ms.`);
      await sleep(retryDelayMs);
    }
  }
  throw lastError;
}

function parseArguments(argv) {
  const [environment, ...rest] = argv;
  let baseUrl;
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index] === '--base-url') {
      baseUrl = rest[index + 1];
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${rest[index]}`);
    }
  }
  return { environment, baseUrl };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArguments(process.argv.slice(2));
    const report = await verifyDeploymentSafety(options);
    console.log(JSON.stringify(report, null, 2));
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      details: error && typeof error === 'object' ? error.details : undefined,
    }, null, 2));
    process.exitCode = 1;
  }
}
