import type { MobileEnv } from './mobile-env';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const MOBILE_SESSION_COOKIE = 'moe_mobile_session';
const SESSION_VERSION = 1;
const DEFAULT_TTL_SECONDS = 8 * 60 * 60;
const MIN_TTL_SECONDS = 5 * 60;
const MAX_TTL_SECONDS = 24 * 60 * 60;

export interface MobileSessionPayload {
  v: 1;
  iat: number;
  exp: number;
  nonce: string;
}

function requireSessionSecret(env: MobileEnv): string {
  const value = env.MOE_MOBILE_SESSION_SECRET?.trim();
  if (!value || value.length < 32) {
    throw new Error('MOE_MOBILE_SESSION_SECRET must contain at least 32 characters');
  }
  return value;
}

export function mobileSessionTtlSeconds(env: MobileEnv): number {
  const parsed = Number(env.MOE_MOBILE_SESSION_TTL_SECONDS ?? DEFAULT_TTL_SECONDS);
  if (!Number.isFinite(parsed)) return DEFAULT_TTL_SECONDS;
  return Math.max(MIN_TTL_SECONDS, Math.min(MAX_TTL_SECONDS, Math.floor(parsed)));
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function textToBase64Url(value: string): string {
  return bytesToBase64Url(encoder.encode(value));
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  const binary = atob(padded);
  return Uint8Array.from(binary, char => char.charCodeAt(0));
}

async function importHmacKey(
  secret: string,
  usages: Array<'sign' | 'verify'>,
): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    usages,
  );
}

async function signSegment(segment: string, secret: string): Promise<string> {
  const key = await importHmacKey(secret, ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(segment));
  return bytesToBase64Url(new Uint8Array(signature));
}

async function verifySegment(segment: string, signature: string, secret: string): Promise<boolean> {
  let decodedSignature: Uint8Array;
  try {
    decodedSignature = base64UrlToBytes(signature);
  } catch {
    return false;
  }
  const key = await importHmacKey(secret, ['verify']);
  return crypto.subtle.verify('HMAC', key, decodedSignature, encoder.encode(segment));
}

export async function createMobileSessionToken(
  env: MobileEnv,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<{ token: string; payload: MobileSessionPayload; ttlSeconds: number }> {
  const ttlSeconds = mobileSessionTtlSeconds(env);
  const payload: MobileSessionPayload = {
    v: SESSION_VERSION,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
    nonce: crypto.randomUUID(),
  };
  const segment = textToBase64Url(JSON.stringify(payload));
  const signature = await signSegment(segment, requireSessionSecret(env));
  return { token: `${segment}.${signature}`, payload, ttlSeconds };
}

export async function verifyMobileSessionToken(
  token: string,
  env: MobileEnv,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<MobileSessionPayload | null> {
  const [segment, signature, extra] = token.split('.');
  if (!segment || !signature || extra) return null;

  let secret: string;
  try {
    secret = requireSessionSecret(env);
  } catch {
    return null;
  }

  if (!(await verifySegment(segment, signature, secret))) return null;

  try {
    const payload = JSON.parse(decoder.decode(base64UrlToBytes(segment))) as MobileSessionPayload;
    if (payload.v !== SESSION_VERSION) return null;
    if (!Number.isInteger(payload.iat) || !Number.isInteger(payload.exp)) return null;
    if (payload.iat > nowSeconds + 60) return null;
    if (payload.exp <= nowSeconds) return null;
    if (payload.exp - payload.iat > MAX_TTL_SECONDS) return null;
    if (typeof payload.nonce !== 'string' || payload.nonce.length < 16) return null;
    return payload;
  } catch {
    return null;
  }
}

export function readCookie(request: Request, name = MOBILE_SESSION_COOKIE): string | null {
  const raw = request.headers.get('cookie');
  if (!raw) return null;
  for (const item of raw.split(';')) {
    const index = item.indexOf('=');
    if (index < 0) continue;
    const key = item.slice(0, index).trim();
    if (key !== name) continue;
    return decodeURIComponent(item.slice(index + 1).trim());
  }
  return null;
}

export async function readValidMobileSession(
  request: Request,
  env: MobileEnv,
): Promise<MobileSessionPayload | null> {
  const token = readCookie(request);
  return token ? verifyMobileSessionToken(token, env) : null;
}

export function buildMobileSessionCookie(token: string, ttlSeconds: number): string {
  return [
    `${MOBILE_SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    `Max-Age=${ttlSeconds}`,
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
}

export function clearMobileSessionCookie(): string {
  return [
    `${MOBILE_SESSION_COOKIE}=`,
    'Path=/',
    'Max-Age=0',
    'Expires=Thu, 01 Jan 1970 00:00:00 GMT',
    'HttpOnly',
    'Secure',
    'SameSite=Strict',
  ].join('; ');
}

async function digest(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(value)));
}

export async function constantTimeTextEqual(left: string, right: string): Promise<boolean> {
  const [a, b] = await Promise.all([digest(left), digest(right)]);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    difference |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return difference === 0;
}

export async function verifyMobileControlPin(pin: string, env: MobileEnv): Promise<boolean> {
  const expected = env.MOE_MOBILE_CONTROL_PIN?.trim();
  if (!expected) return false;
  return constantTimeTextEqual(pin.trim(), expected);
}

export async function mobileRequestFingerprint(request: Request, env: MobileEnv): Promise<string> {
  const source = [
    request.headers.get('cf-connecting-ip') ?? 'unknown',
    request.headers.get('user-agent') ?? 'unknown',
  ].join('|');
  const key = await importHmacKey(requireSessionSecret(env), ['sign']);
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(source));
  return Array.from(new Uint8Array(signature))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}
