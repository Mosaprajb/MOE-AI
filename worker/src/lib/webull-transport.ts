import type { Env, TradingMode } from './types';

const WEBULL_BASE_SANDBOX = 'https://api.sandbox.webull.com';
const WEBULL_BASE_LIVE = 'https://api.webull.com';
const encoder = new TextEncoder();

export interface WebullApiCredentials {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  accessToken: string;
  accountId: string;
}

export interface WebullSignedRequestResult {
  response: Response;
  url: URL;
  bodyText: string;
  bodyMd5: string | null;
  timestamp: string;
  nonce: string;
  rawBody: string;
  parsedBody: unknown;
}

export function webullBaseUrl(
  env: Env,
  mode: TradingMode,
): string {
  if (mode === 'LIVE') {
    return (
      env.WEBULL_LIVE_API_BASE_URL?.replace(/\/$/, '')
      ?? WEBULL_BASE_LIVE
    );
  }

  return (
    env.WEBULL_SANDBOX_API_BASE_URL?.replace(/\/$/, '')
    ?? WEBULL_BASE_SANDBOX
  );
}

export function getWebullCredentials(
  env: Env,
  mode: TradingMode,
): WebullApiCredentials | null {
  if (mode === 'LIVE') {
    const appKey = env.WEBULL_LIVE_APP_KEY;
    const appSecret = env.WEBULL_LIVE_APP_SECRET;
    const accessToken = env.WEBULL_LIVE_ACCESS_TOKEN;
    const accountId = env.WEBULL_LIVE_ACCOUNT_ID;

    if (!appKey || !appSecret || !accessToken || !accountId) {
      return null;
    }

    return {
      baseUrl: webullBaseUrl(env, 'LIVE'),
      appKey,
      appSecret,
      accessToken,
      accountId,
    };
  }

  const appKey =
    env.WEBULL_SANDBOX_APP_KEY ?? env.WEBULL_APP_KEY;
  const appSecret =
    env.WEBULL_SANDBOX_APP_SECRET ?? env.WEBULL_APP_SECRET;
  const accessToken =
    env.WEBULL_SANDBOX_ACCESS_TOKEN ?? env.WEBULL_ACCESS_TOKEN;
  const accountId =
    env.WEBULL_SANDBOX_ACCOUNT_ID ?? env.WEBULL_ACCOUNT_ID;

  if (!appKey || !appSecret || !accessToken || !accountId) {
    return null;
  }

  return {
    baseUrl: webullBaseUrl(env, 'SANDBOX'),
    appKey,
    appSecret,
    accessToken,
    accountId,
  };
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function compactUtcTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** RFC 1321 MD5, returned as uppercase hexadecimal as required by Webull. */
function md5(input: string): string {
  const bytes = Array.from(encoder.encode(input));
  const bitLength = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);

  const low = bitLength >>> 0;
  const high = Math.floor(bitLength / 0x100000000) >>> 0;

  for (let i = 0; i < 4; i++) {
    bytes.push((low >>> (8 * i)) & 0xff);
  }

  for (let i = 0; i < 4; i++) {
    bytes.push((high >>> (8 * i)) & 0xff);
  }

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;

  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22,
    7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20,
    5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23,
    4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21,
    6, 10, 15, 21, 6, 10, 15, 21,
  ];

  const constants = Array.from(
    { length: 64 },
    (_, i) =>
      Math.floor(
        Math.abs(Math.sin(i + 1)) * 0x100000000,
      ) | 0,
  );

  for (
    let offset = 0;
    offset < bytes.length;
    offset += 64
  ) {
    const words = Array.from({ length: 16 }, (_, i) => {
      const j = offset + i * 4;
      return (
        bytes[j]
        | (bytes[j + 1] << 8)
        | (bytes[j + 2] << 16)
        | (bytes[j + 3] << 24)
      ) | 0;
    });

    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f;
      let g;

      if (i < 16) {
        f = (b & c) | (~b & d);
        g = i;
      } else if (i < 32) {
        f = (d & b) | (~d & c);
        g = (5 * i + 1) % 16;
      } else if (i < 48) {
        f = b ^ c ^ d;
        g = (3 * i + 5) % 16;
      } else {
        f = c ^ (b | ~d);
        g = (7 * i) % 16;
      }

      f = (f + a + constants[i] + words[g]) | 0;
      a = d;
      d = c;
      c = b;

      b = (
        b
        + (
          (f << shifts[i])
          | (f >>> (32 - shifts[i]))
        )
      ) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return [a0, b0, c0, d0]
    .map(word =>
      [0, 8, 16, 24]
        .map(shift =>
          ((word >>> shift) & 0xff)
            .toString(16)
            .padStart(2, '0'),
        )
        .join(''),
    )
    .join('')
    .toUpperCase();
}

async function createSignature(params: {
  path: string;
  query: URLSearchParams;
  body: string;
  appKey: string;
  appSecret: string;
  host: string;
  timestamp: string;
  nonce: string;
}): Promise<string> {
  const values: Record<string, string> = {
    host: params.host,
    'x-app-key': params.appKey,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': params.nonce,
    'x-signature-version': '1.0',
    'x-timestamp': params.timestamp,
  };

  for (const [key, value] of params.query.entries()) {
    values[key] = value;
  }

  const canonical = Object.keys(values)
    .sort()
    .map(key => `${key}=${values[key]}`)
    .join('&');

  const source = params.body
    ? `${params.path}&${canonical}&${md5(params.body)}`
    : `${params.path}&${canonical}`;

  const signingKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${params.appSecret}&`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );

  return toBase64(
    await crypto.subtle.sign(
      'HMAC',
      signingKey,
      encoder.encode(encodeURIComponent(source)),
    ),
  );
}

export async function webullSignedRequest(params: {
  baseUrl: string;
  appKey: string;
  appSecret: string;
  accessToken?: string;
  method: string;
  path: string;
  query?: Record<
    string,
    string | number | null | undefined
  >;
  body?: unknown;
}): Promise<WebullSignedRequestResult> {
  const base = params.baseUrl.replace(/\/$/, '');
  const url = new URL(params.path, `${base}/`);

  for (
    const [key, value]
    of Object.entries(params.query ?? {})
  ) {
    if (value != null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  }

  const bodyText =
    params.body != null
      ? JSON.stringify(params.body)
      : '';

  const timestamp = compactUtcTimestamp();
  const nonce =
    crypto.randomUUID().replaceAll('-', '');

  const signature = await createSignature({
    path: url.pathname,
    query: url.searchParams,
    body: bodyText,
    appKey: params.appKey,
    appSecret: params.appSecret,
    host: url.host,
    timestamp,
    nonce,
  });

  const headers: Record<string, string> = {
    Accept: 'application/json',
    'x-app-key': params.appKey,
    'x-timestamp': timestamp,
    'x-signature-version': '1.0',
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': nonce,
    'x-version': 'v2',
    'x-signature': signature,
  };

  if (bodyText) {
    headers['content-type'] = 'application/json';
  }

  if (params.accessToken) {
    headers['x-access-token'] = params.accessToken;
  }

  const response = await fetch(url.toString(), {
    method: params.method,
    headers,
    ...(bodyText ? { body: bodyText } : {}),
  });

  const rawBody = await response.text();

  let parsedBody: unknown = null;
  try {
    parsedBody = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    parsedBody = null;
  }

  return {
    response,
    url,
    bodyText,
    bodyMd5: bodyText ? md5(bodyText) : null,
    timestamp,
    nonce,
    rawBody,
    parsedBody,
  };
}
