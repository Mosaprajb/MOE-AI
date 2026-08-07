import type { Env, TradingMode } from './types';

const WEBULL_BASE_SANDBOX = 'https://api.sandbox.webull.com';
const WEBULL_BASE_LIVE = 'https://api.webull.com';
const encoder = new TextEncoder();

export interface WebullOrderDetail {
  clientOrderId: string;
  orderId: string;
  symbol: string;
  status: string;
  filledQuantity: number;
  totalQuantity: number;
}

type WebullOrderDetailCredentials = {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  accessToken: string;
  accountId: string;
};

function credentialsFor(env: Env, mode: TradingMode): WebullOrderDetailCredentials | null {
  if (mode === 'LIVE') {
    const appKey = env.WEBULL_LIVE_APP_KEY;
    const appSecret = env.WEBULL_LIVE_APP_SECRET;
    const accessToken = env.WEBULL_LIVE_ACCESS_TOKEN;
    const accountId = env.WEBULL_LIVE_ACCOUNT_ID;
    if (!appKey || !appSecret || !accessToken || !accountId) return null;
    return {
      baseUrl: env.WEBULL_LIVE_API_BASE_URL?.replace(/\/$/, '') ?? WEBULL_BASE_LIVE,
      appKey,
      appSecret,
      accessToken,
      accountId,
    };
  }

  const appKey = env.WEBULL_SANDBOX_APP_KEY ?? env.WEBULL_APP_KEY;
  const appSecret = env.WEBULL_SANDBOX_APP_SECRET ?? env.WEBULL_APP_SECRET;
  const accessToken = env.WEBULL_SANDBOX_ACCESS_TOKEN ?? env.WEBULL_ACCESS_TOKEN;
  const accountId = env.WEBULL_SANDBOX_ACCOUNT_ID ?? env.WEBULL_ACCOUNT_ID;
  if (!appKey || !appSecret || !accessToken || !accountId) return null;
  return {
    baseUrl: env.WEBULL_SANDBOX_API_BASE_URL?.replace(/\/$/, '') ?? WEBULL_BASE_SANDBOX,
    appKey,
    appSecret,
    accessToken,
    accountId,
  };
}

function normalizeClientOrderId(value: string): string {
  const normalized = value.replace(/[^A-Za-z0-9_-]/gu, '').slice(0, 32);
  if (!normalized) throw new Error('A valid client order ID is required.');
  return normalized;
}

function compactUtcTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function signGetRequest(params: {
  path: string;
  query: URLSearchParams;
  appKey: string;
  appSecret: string;
  host: string;
  timestamp: string;
  nonce: string;
}): Promise<string> {
  const { path, query, appKey, appSecret, host, timestamp, nonce } = params;
  const values: Record<string, string> = {
    host,
    'x-app-key': appKey,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': nonce,
    'x-signature-version': '1.0',
    'x-timestamp': timestamp,
  };
  for (const [key, value] of query.entries()) values[key] = value;

  const canonical = Object.keys(values)
    .sort()
    .map(key => `${key}=${values[key]}`)
    .join('&');
  const encodedString = encodeURIComponent(`${path}&${canonical}`);
  const signingKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${appSecret}&`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return toBase64(await crypto.subtle.sign('HMAC', signingKey, encoder.encode(encodedString)));
}

function extractOrderRows(raw: unknown): Array<Record<string, unknown>> {
  if (!raw || typeof raw !== 'object') return [];
  const object = raw as Record<string, unknown>;
  const data = object.data;
  const root: unknown[] = Array.isArray(raw)
    ? raw
    : Array.isArray(data)
      ? data
      : data && typeof data === 'object'
        ? [data]
        : Array.isArray(object.orders)
          ? object.orders as unknown[]
          : [object];

  return root.flatMap(item => {
    const row = item as Record<string, unknown>;
    return Array.isArray(row.orders)
      ? row.orders as Array<Record<string, unknown>>
      : [row];
  });
}

export function isWebullOrderTerminal(statusValue: string): boolean {
  const status = statusValue.trim().toUpperCase();
  return status === 'CANCELLED' || status === 'FILLED' || status === 'FAILED';
}

export function isWebullOrderFullyFilled(detail: WebullOrderDetail): boolean {
  return detail.status === 'FILLED';
}

export async function getWebullOrderDetail(
  env: Env,
  mode: TradingMode,
  clientOrderIdValue: string,
): Promise<WebullOrderDetail[]> {
  const credentials = credentialsFor(env, mode);
  if (!credentials) {
    throw new Error(`${mode} Webull credentials are unavailable for order-detail verification.`);
  }

  const clientOrderId = normalizeClientOrderId(clientOrderIdValue);
  const url = new URL('/openapi/trade/order/detail', `${credentials.baseUrl}/`);
  url.searchParams.set('account_id', credentials.accountId);
  url.searchParams.set('client_order_id', clientOrderId);

  const timestamp = compactUtcTimestamp();
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const signature = await signGetRequest({
    path: url.pathname,
    query: url.searchParams,
    appKey: credentials.appKey,
    appSecret: credentials.appSecret,
    host: url.host,
    timestamp,
    nonce,
  });

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-app-key': credentials.appKey,
      'x-timestamp': timestamp,
      'x-signature-version': '1.0',
      'x-signature-algorithm': 'HMAC-SHA1',
      'x-signature-nonce': nonce,
      'x-version': 'v2',
      'x-signature': signature,
      'x-access-token': credentials.accessToken,
    },
  });

  const rawBody = await response.text();
  let parsedBody: unknown = null;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsedBody = null;
  }

  if (!response.ok) {
    throw new Error(JSON.stringify({
      request: {
        method: 'GET',
        host: url.host,
        path: url.pathname,
        clientOrderId,
      },
      response: {
        status: response.status,
        statusText: response.statusText,
        rawBody,
        parsedBody,
      },
    }));
  }

  return extractOrderRows(parsedBody)
    .map(order => ({
      clientOrderId: String(order.client_order_id ?? ''),
      orderId: String(order.order_id ?? order.id ?? order.client_order_id ?? ''),
      symbol: String(order.symbol ?? '').toUpperCase(),
      status: String(order.status ?? 'UNKNOWN').toUpperCase(),
      filledQuantity: Number(order.filled_quantity ?? 0),
      totalQuantity: Number(order.total_quantity ?? order.quantity ?? 0),
    }))
    .filter(order => Boolean(order.clientOrderId));
}
