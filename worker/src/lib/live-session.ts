import type { LiveControlEnv } from './live-policy';

export const LIVE_CONTROL_BUILD_ID = 'live-control-v3-20260806';
export const LIVE_SESSION_HEADER = 'x-moe-live-session';
const LIVE_SESSION_SCOPE = 'MOE_LIVE_TRADING';
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface LiveSessionPayload {
  scope: typeof LIVE_SESSION_SCOPE;
  issuedAt: number;
  expiresAt: number;
  nonce: string;
}

export interface LiveSessionVerification {
  ok: boolean;
  code?: string;
  payload?: LiveSessionPayload;
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/gu, '-')
    .replace(/\//gu, '_')
    .replace(/=+$/gu, '');
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/gu, '+').replace(/_/gu, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left[index] ^ right[index];
  }
  return difference === 0;
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

async function hmac(secret: string, value: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function verifyLivePin(pin: string, env: LiveControlEnv): Promise<boolean> {
  const configuredPin = String(env.MOE_LIVE_TRADING_PIN ?? '').trim();
  const suppliedPin = String(pin ?? '').trim();
  if (!configuredPin || !suppliedPin) return false;
  const [expected, supplied] = await Promise.all([
    sha256(configuredPin),
    sha256(suppliedPin),
  ]);
  return constantTimeEqual(expected, supplied);
}

export async function createLiveSession(env: LiveControlEnv): Promise<{
  token: string;
  expiresAt: string;
  ttlMinutes: number;
}> {
  const secret = String(env.MOE_LIVE_SESSION_SECRET ?? '').trim();
  if (!secret) throw new Error('MOE_LIVE_SESSION_SECRET is not configured');
  const configuredTtl = Number(env.MOE_LIVE_SESSION_TTL_MINUTES ?? 15);
  const ttlMinutes = Math.max(1, Math.min(60, Number.isFinite(configuredTtl) ? configuredTtl : 15));
  const issuedAt = Date.now();
  const payload: LiveSessionPayload = {
    scope: LIVE_SESSION_SCOPE,
    issuedAt,
    expiresAt: issuedAt + ttlMinutes * 60_000,
    nonce: crypto.randomUUID(),
  };
  const body = base64Url(encoder.encode(JSON.stringify(payload)));
  const signature = base64Url(await hmac(secret, body));
  return {
    token: `${body}.${signature}`,
    expiresAt: new Date(payload.expiresAt).toISOString(),
    ttlMinutes,
  };
}

export async function verifyLiveSessionToken(
  token: string,
  env: LiveControlEnv,
): Promise<LiveSessionVerification> {
  const secret = String(env.MOE_LIVE_SESSION_SECRET ?? '').trim();
  if (!token || !secret) return { ok: false, code: 'LIVE_SESSION_REQUIRED' };
  const parts = token.split('.');
  if (parts.length !== 2) return { ok: false, code: 'LIVE_SESSION_INVALID' };
  try {
    const expected = await hmac(secret, parts[0]);
    const supplied = decodeBase64Url(parts[1]);
    if (!constantTimeEqual(expected, supplied)) {
      return { ok: false, code: 'LIVE_SESSION_INVALID' };
    }
    const payload = JSON.parse(decoder.decode(decodeBase64Url(parts[0]))) as LiveSessionPayload;
    if (payload.scope !== LIVE_SESSION_SCOPE) {
      return { ok: false, code: 'LIVE_SESSION_INVALID' };
    }
    if (!Number.isFinite(payload.expiresAt) || payload.expiresAt <= Date.now()) {
      return { ok: false, code: 'LIVE_SESSION_EXPIRED' };
    }
    return { ok: true, payload };
  } catch {
    return { ok: false, code: 'LIVE_SESSION_INVALID' };
  }
}

export async function verifyLiveSession(
  request: Request,
  env: LiveControlEnv,
): Promise<LiveSessionVerification> {
  return verifyLiveSessionToken(String(request.headers.get(LIVE_SESSION_HEADER) ?? '').trim(), env);
}
