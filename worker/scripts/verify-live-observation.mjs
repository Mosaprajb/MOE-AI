const DEFAULT_BASE_URL = String(
  process.env.MOE_PRODUCTION_BASE_URL
    ?? 'https://moerand-alerts.mosaprajb.workers.dev',
).replace(/\/$/u, '');

const DEFAULT_ATTEMPTS = 30;
const DEFAULT_RETRY_DELAY_MS = 3_000;

function sanitized(payload) {
  return {
    ok: payload?.ok === true,
    deploymentEnvironment: payload?.deploymentEnvironment ?? null,
    executionPolicy: payload?.executionPolicy ?? null,
    observationAllowed: payload?.observationAllowed === true,
    liveReadOnly: payload?.liveReadOnly === true,
    liveExecutionAllowed: payload?.liveExecutionAllowed === true,
    storedMode: payload?.storedMode ?? null,
    effectiveMode: payload?.effectiveMode ?? null,
    observation: payload?.observation ?? null,
    diagnostics: payload?.diagnostics ?? null,
    blockerCodes: Array.isArray(payload?.blockerCodes) ? payload.blockerCodes : [],
    checkedAt: payload?.checkedAt ?? null,
  };
}

function validate(payload) {
  const view = sanitized(payload);
  const failures = [];

  if (!view.ok) failures.push('observation endpoint did not report ok=true');
  if (view.deploymentEnvironment !== 'production') failures.push('deployment environment is not production');
  if (view.executionPolicy !== 'live-read-only') failures.push('execution policy is not live-read-only');
  if (!view.observationAllowed) failures.push('Live broker observation is not allowed by policy');
  if (!view.liveReadOnly) failures.push('Live read-only policy is not active');
  if (view.liveExecutionAllowed) failures.push('Live execution must remain disabled');
  if (view.storedMode !== 'SANDBOX') failures.push('stored mode must remain SANDBOX');
  if (view.effectiveMode !== 'SANDBOX') failures.push('effective mode must remain SANDBOX');
  if (view.observation?.brokerConfigured !== true) failures.push('Live broker credentials are not configured');
  if (view.observation?.accountReadable !== true) failures.push('Live account balance is not readable');
  if (view.observation?.positionsReadable !== true) failures.push('Live positions are not readable');
  if (view.observation?.openOrdersReadable !== true) failures.push('Live open orders are not readable');

  if (failures.length > 0) {
    throw new Error(`${failures.join('; ')}\n${JSON.stringify(view, null, 2)}`);
  }
  return view;
}

export function liveObservationProbeUrl(url, attempt, timestamp = Date.now()) {
  const probe = new URL(url);
  probe.searchParams.set('_moe_probe', `${timestamp}-${attempt}`);
  return probe.toString();
}

async function fetchObservation(fetchImpl, endpoint, attempt) {
  const response = await fetchImpl(liveObservationProbeUrl(endpoint, attempt), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'cache-control': 'no-cache, no-store, max-age=0',
      pragma: 'no-cache',
    },
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}\n${JSON.stringify(sanitized(payload), null, 2)}`);
  }
  return payload;
}

function sleep(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function verifyLiveObservation({
  baseUrl = DEFAULT_BASE_URL,
  fetchImpl = fetch,
  attempts = DEFAULT_ATTEMPTS,
  retryDelayMs = DEFAULT_RETRY_DELAY_MS,
} = {}) {
  if (typeof baseUrl !== 'string' || baseUrl.length === 0) {
    throw new Error('A production base URL is required.');
  }
  if (!Number.isInteger(attempts) || attempts < 1) {
    throw new Error('attempts must be a positive integer.');
  }

  const endpoint = `${baseUrl.replace(/\/$/u, '')}/api/trading/live/observation`;
  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return validate(await fetchObservation(fetchImpl, endpoint, attempt));
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        console.warn(`Live observation verification attempt ${attempt}/${attempts} failed; retrying in ${retryDelayMs}ms.`);
        await sleep(retryDelayMs);
      }
    }
  }
  throw lastError;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const result = await verifyLiveObservation();
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
