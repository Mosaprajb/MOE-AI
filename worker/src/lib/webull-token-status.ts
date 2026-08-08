import type { Env } from './types';
import {
  webullBaseUrl,
  webullSignedRequest,
} from './webull-transport';

export type WebullTokenStatus =
  | 'PENDING'
  | 'NORMAL'
  | 'INVALID'
  | 'EXPIRED'
  | 'UNKNOWN';

export interface WebullTokenCheckResult {
  ok: boolean;
  status: WebullTokenStatus;
  httpStatus: number | null;
  errorCode: string | null;
}

function normalizeStatus(
  value: unknown,
): WebullTokenStatus {
  const status =
    String(value ?? '').trim().toUpperCase();

  return (
    status === 'PENDING'
    || status === 'NORMAL'
    || status === 'INVALID'
    || status === 'EXPIRED'
  )
    ? status
    : 'UNKNOWN';
}

export async function checkLiveWebullToken(
  env: Env,
): Promise<WebullTokenCheckResult> {
  const appKey =
    String(env.WEBULL_LIVE_APP_KEY ?? '').trim();

  const appSecret =
    String(
      env.WEBULL_LIVE_APP_SECRET ?? '',
    ).trim();

  const token =
    String(
      env.WEBULL_LIVE_ACCESS_TOKEN ?? '',
    ).trim();

  if (!appKey || !appSecret || !token) {
    return {
      ok: false,
      status: 'UNKNOWN',
      httpStatus: null,
      errorCode: 'NOT_CONFIGURED',
    };
  }

  try {
    const result = await webullSignedRequest({
      baseUrl: webullBaseUrl(env, 'LIVE'),
      appKey,
      appSecret,
      // Deliberately omit x-access-token:
      // the token is the credential being checked.
      method: 'POST',
      path: '/openapi/auth/token/check',
      body: { token },
    });

    const parsed =
      result.parsedBody as
        Record<string, unknown> | null;

    if (!result.response.ok) {
      const rawCode =
        parsed?.error_code ?? parsed?.code;

      return {
        ok: false,
        status: 'UNKNOWN',
        httpStatus: result.response.status,
        errorCode:
          rawCode == null
            ? null
            : String(rawCode).slice(0, 80),
      };
    }

    const status =
      normalizeStatus(parsed?.status);

    return {
      ok: status === 'NORMAL',
      status,
      httpStatus: result.response.status,
      errorCode: null,
    };
  } catch {
    return {
      ok: false,
      status: 'UNKNOWN',
      httpStatus: null,
      errorCode: 'NETWORK_OR_RUNTIME',
    };
  }
}
