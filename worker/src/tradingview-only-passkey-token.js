const encoder = new TextEncoder();
const decoder = new TextDecoder();

export const SESSION_COOKIE = 'moe_tv_session';
export const PASSKEY_COOKIE = 'moe_tv_passkey';
export const MOBILE_ASSET_VERSION = '20260804-9';
export const PASSKEY_TTL_SECONDS = 31_536_000;
const CHALLENGE_TTL_MS = 5 * 60 * 1000;

export function base64UrlEncode(bytes) {
  const value = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []);
  let binary = '';
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  const binary = atob(padded);
  const output = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) output[index] = binary.charCodeAt(index);
  return output;
}

function randomBytes(length = 32) {
  const value = new Uint8Array(length);
  crypto.getRandomValues(value);
  return value;
}

function constantTimeEqual(left, right) {
  const a = encoder.encode(String(left || ''));
  const b = encoder.encode(String(right || ''));
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

function secret(env = {}) {
  const value = String(env.MOE_MOBILE_SESSION_SECRET || env.MOE_WEBHOOK_SECRET || '').trim();
  if (value.length < 16) throw new Error('A secure mobile session secret is not configured');
  return value;
}

async function hmac(value, env) {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret(env)),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

export async function createSignedToken(payload, env) {
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  return `${body}.${base64UrlEncode(await hmac(body, env))}`;
}

export async function readSignedToken(token, env) {
  const [body, signature, extra] = String(token || '').split('.');
  if (!body || !signature || extra) return null;
  if (!constantTimeEqual(signature, base64UrlEncode(await hmac(body, env)))) return null;
  try {
    return JSON.parse(decoder.decode(base64UrlDecode(body)));
  } catch {
    return null;
  }
}

export function cookieValue(request, name) {
  const source = String(request.headers.get('cookie') || '');
  for (const part of source.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() === name) return part.slice(separator + 1).trim();
  }
  return '';
}

export async function createDashboardSession(env) {
  const issuedAt = Date.now();
  const requested = Number(env.MOE_TRADINGVIEW_SESSION_TTL_SECONDS);
  const ttlSeconds = Math.max(300, Math.min(86_400, Number.isFinite(requested) ? requested : 43_200));
  const payload = {
    scope: 'MOE_TRADINGVIEW_DASHBOARD',
    issuedAt,
    expiresAt: issuedAt + ttlSeconds * 1000,
    nonce: crypto.randomUUID(),
  };
  return { token: await createSignedToken(payload, env), payload, ttlSeconds };
}

export function dashboardSessionCookie(session) {
  return `${SESSION_COOKIE}=${session.token}; Path=/; Max-Age=${session.ttlSeconds}; HttpOnly; Secure; SameSite=Lax`;
}

export async function readPasskeyRecord(request, env) {
  const token = cookieValue(request, PASSKEY_COOKIE);
  if (!token) return null;
  const record = await readSignedToken(token, env);
  const hostname = new URL(request.url).hostname;
  if (!record || record.scope !== 'MOE_TRADINGVIEW_PASSKEY') return null;
  if (!record.credentialId || !record.publicKeySpki || record.algorithm !== -7) return null;
  if (record.expiresAt <= Date.now() || record.rpId !== hostname) return null;
  return record;
}

export async function passkeyRecordCookie(record, env) {
  const token = await createSignedToken(record, env);
  return `${PASSKEY_COOKIE}=${token}; Path=/; Max-Age=${PASSKEY_TTL_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
}

export async function createChallenge(kind, request, env) {
  const url = new URL(request.url);
  const issuedAt = Date.now();
  const payload = {
    scope: 'MOE_TRADINGVIEW_PASSKEY_CHALLENGE',
    kind,
    challenge: base64UrlEncode(randomBytes(32)),
    origin: url.origin,
    rpId: url.hostname,
    issuedAt,
    expiresAt: issuedAt + CHALLENGE_TTL_MS,
    nonce: crypto.randomUUID(),
  };
  return { ...payload, token: await createSignedToken(payload, env) };
}

export async function verifyChallenge(token, kind, request, env) {
  const payload = await readSignedToken(token, env);
  const url = new URL(request.url);
  if (!payload || payload.scope !== 'MOE_TRADINGVIEW_PASSKEY_CHALLENGE') return null;
  if (payload.kind !== kind || payload.origin !== url.origin || payload.rpId !== url.hostname) return null;
  if (payload.expiresAt <= Date.now() || payload.issuedAt > Date.now() + 10_000) return null;
  return payload;
}

export function requestIsSameSite(request) {
  const url = new URL(request.url);
  const origin = String(request.headers.get('origin') || '').trim();
  if (origin && origin !== 'null' && origin !== url.origin) return false;
  const referer = String(request.headers.get('referer') || '').trim();
  if (referer) {
    try {
      if (new URL(referer).origin !== url.origin) return false;
    } catch {
      return false;
    }
  }
  const site = String(request.headers.get('sec-fetch-site') || '').toLowerCase();
  return !site || ['same-origin', 'same-site', 'none'].includes(site);
}
