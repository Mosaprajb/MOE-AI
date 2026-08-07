import type { Env } from './types';

const WEBULL_BASE_LIVE = 'https://api.webull.com';
const encoder = new TextEncoder();

export type WebullTokenStatus = 'PENDING' | 'NORMAL' | 'INVALID' | 'EXPIRED' | 'UNKNOWN';

export interface WebullTokenCheckResult {
  ok: boolean;
  status: WebullTokenStatus;
  httpStatus: number | null;
  errorCode: string | null;
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function compactUtcTimestamp(date = new Date()): string {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function md5(input: string): string {
  const bytes = Array.from(encoder.encode(input));
  const bitLength = bytes.length * 8;

  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);

  const low = bitLength >>> 0;
  const high = Math.floor(bitLength / 0x100000000) >>> 0;
  for (let i = 0; i < 4; i++) bytes.push((low >>> (8 * i)) & 0xff);
  for (let i = 0; i < 4; i++) bytes.push((high >>> (8 * i)) & 0xff);

  let a0 = 0x67452301 | 0;
  let b0 = 0xefcdab89 | 0;
  let c0 = 0x98badcfe | 0;
  let d0 = 0x10325476 | 0;
  const shifts = [
    7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22,
    5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20,
    4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23,
    6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21,
  ];
  const constants = Array.from(
    { length: 64 },
    (_, i) => Math.floor(Math.abs(Math.sin(i + 1)) * 0x100000000) | 0,
  );

  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = Array.from({ length: 16 }, (_, i) => {
      const j = offset + i * 4;
      return (bytes[j] | (bytes[j + 1] << 8) | (bytes[j + 2] << 16) | (bytes[j + 3] << 24)) | 0;
    });
    let a = a0;
    let b = b0;
    let c = c0;
    let d = d0;

    for (let i = 0; i < 64; i++) {
      let f: number;
      let g: number;
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
      b = (b + ((f << shifts[i]) | (f >>> (32 - shifts[i])))) | 0;
    }

    a0 = (a0 + a) | 0;
    b0 = (b0 + b) | 0;
    c0 = (c0 + c) | 0;
    d0 = (d0 + d) | 0;
  }

  return [a0, b0, c0, d0]
    .map(word => [0, 8, 16, 24]
      .map(shift => ((word >>> shift) & 0xff).toString(16).padStart(2, '0'))
      .join(''))
    .join('')
    .toUpperCase();
}

async function signature(params: {
  path: string;
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
  const canonical = Object.keys(values)
    .sort()
    .map(key => `${key}=${values[key]}`)
    .join('&');
  const source = `${params.path}&${canonical}&${md5(params.body)}`;
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${params.appSecret}&`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  return toBase64(await crypto.subtle.sign(
    'HMAC',
    key,
    encoder.encode(encodeURIComponent(source)),
  ));
}

function normalizeStatus(value: unknown): WebullTokenStatus {
  const status = String(value ?? '').trim().toUpperCase();
  return status === 'PENDING' || status === 'NORMAL' || status === 'INVALID' || status === 'EXPIRED'
    ? status
    : 'UNKNOWN';
}

export async function checkLiveWebullToken(env: Env): Promise<WebullTokenCheckResult> {
  const appKey = String(env.WEBULL_LIVE_APP_KEY ?? '').trim();
  const appSecret = String(env.WEBULL_LIVE_APP_SECRET ?? '').trim();
  const token = String(env.WEBULL_LIVE_ACCESS_TOKEN ?? '').trim();
  if (!appKey || !appSecret || !token) {
    return { ok: false, status: 'UNKNOWN', httpStatus: null, errorCode: 'NOT_CONFIGURED' };
  }

  const base = String(env.WEBULL_LIVE_API_BASE_URL ?? WEBULL_BASE_LIVE).replace(/\/$/u, '');
  const url = new URL('/openapi/auth/token/check', `${base}/`);
  const body = JSON.stringify({ token });
  const timestamp = compactUtcTimestamp();
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const xSignature = await signature({
    path: url.pathname,
    body,
    appKey,
    appSecret,
    host: url.host,
    timestamp,
    nonce,
  });

  try {
    const response = await fetch(url.toString(), {
      method: 'POST',
      headers: {
        Accept: 'application/json',
        'content-type': 'application/json',
        'x-app-key': appKey,
        'x-timestamp': timestamp,
        'x-signature-version': '1.0',
        'x-signature-algorithm': 'HMAC-SHA1',
        'x-signature-nonce': nonce,
        'x-version': 'v2',
        'x-signature': xSignature,
      },
      body,
    });
    const parsed = await response.json().catch(() => null) as Record<string, unknown> | null;
    if (!response.ok) {
      const rawCode = parsed?.error_code ?? parsed?.code;
      return {
        ok: false,
        status: 'UNKNOWN',
        httpStatus: response.status,
        errorCode: rawCode == null ? null : String(rawCode).slice(0, 80),
      };
    }
    const status = normalizeStatus(parsed?.status);
    return {
      ok: status === 'NORMAL',
      status,
      httpStatus: response.status,
      errorCode: null,
    };
  } catch {
    return { ok: false, status: 'UNKNOWN', httpStatus: null, errorCode: 'NETWORK_OR_RUNTIME' };
  }
}
