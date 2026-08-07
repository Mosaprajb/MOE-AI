const baseUrl = String(
  process.env.MOE_PRODUCTION_BASE_URL
    ?? 'https://moerand-alerts.mosaprajb.workers.dev',
).replace(/\/$/u, '');

const endpoint = `${baseUrl}/api/trading/live/observation`;
const attempts = 8;
const delayMs = 3000;

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

let lastError = null;
for (let attempt = 1; attempt <= attempts; attempt += 1) {
  try {
    const response = await fetch(endpoint, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(10000),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}\n${JSON.stringify(sanitized(payload), null, 2)}`);
    }
    const result = validate(payload);
    console.log(JSON.stringify(result, null, 2));
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < attempts) {
      console.warn(`Live observation verification attempt ${attempt}/${attempts} failed; retrying in ${delayMs}ms.`);
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}

console.error(lastError instanceof Error ? lastError.message : String(lastError));
process.exit(1);
