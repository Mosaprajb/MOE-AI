import { getLiveTradingReadiness, handleWebullLiveOrder } from './webull-live.js';

function secureJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function authorized(request, env) {
  const supplied = request.headers.get('x-moe-webhook-secret') || '';
  return Boolean(env.MOE_WEBHOOK_SECRET) && supplied === env.MOE_WEBHOOK_SECRET;
}

export async function handleLiveCertification(request, env = {}) {
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
  if (!authorized(request, env)) return secureJson({ ok: false, error: 'Unauthorized' }, 401);

  let payload;
  try {
    payload = await request.json();
  } catch {
    return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400);
  }

  if (String(payload.certificationConfirmation || '') !== 'RUN_LIVE_PREVIEW_ONLY') {
    return secureJson({ ok: false, blocked: true, submitted: false, error: 'Certification requires RUN_LIVE_PREVIEW_ONLY.' }, 423);
  }

  const actualEnvironment = { ...env, WEBULL_ENVIRONMENT: 'production' };
  const actualReadiness = getLiveTradingReadiness(actualEnvironment);
  const missingSecrets = actualReadiness.missingSecrets || [];
  if (missingSecrets.length) {
    return secureJson({
      ok: false,
      blocked: true,
      submitted: false,
      certificationMode: 'LIVE_BROKER_PREVIEW_ONLY',
      actualReadiness,
      error: 'Live broker credentials are incomplete.',
    }, 423);
  }

  const certificationEnv = {
    ...actualEnvironment,
    WEBULL_LIVE_TRADING: 'true',
    WEBULL_LIVE_ORDER_SUBMISSION: 'true',
    MOE_LIVE_MODE_UNLOCKED: 'true',
    MOE_LIVE_EXECUTION_IMPLEMENTED: 'true',
    WEBULL_PROTECTED_ORDERS: 'true',
    WEBULL_LIVE_KILL_SWITCH: 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: 'false',
  };

  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  const certificationPayload = {
    ...payload,
    source: 'MOERAND_LIVE_CERTIFICATION',
    submitLive: false,
    liveConfirmation: '',
  };
  delete certificationPayload.certificationConfirmation;

  const previewRequest = new Request(request.url, {
    method: 'POST',
    headers,
    body: JSON.stringify(certificationPayload),
  });
  const response = await handleWebullLiveOrder(previewRequest, certificationEnv);
  const result = await response.clone().json().catch(() => ({ ok: false, error: 'Non-JSON certification response' }));

  return secureJson({
    ...result,
    submitted: false,
    certificationMode: 'LIVE_BROKER_PREVIEW_ONLY',
    productionAccountContacted: response.ok || response.status === 422,
    actualReadiness,
    actualSubmissionSwitchesChanged: false,
    message: result.message || 'Live certification completed without submitting an order.',
  }, response.status);
}
