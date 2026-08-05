import type { MobileEnv } from './mobile-env';

const encoder = new TextEncoder();
const DEFAULT_BUNDLE_ID = 'com.moerand.moeai';
const MAX_DEVICES_PER_BROADCAST = 100;
const MAX_PAYLOAD_BYTES = 3800;
const PROVIDER_TOKEN_REFRESH_SECONDS = 50 * 60;

export type PushEnvironment = 'development' | 'production';

export interface MobilePushRegistrationInput {
  token: string;
  platform: string;
  bundleIdentifier: string;
  environment: string;
}

export interface MobilePushDevice {
  id: string;
  token: string;
  tokenHash: string;
  bundleIdentifier: string;
  environment: PushEnvironment;
}

export interface MobilePushNotification {
  type: string;
  title: string;
  body: string;
  symbol?: string;
  accountType?: string;
  price?: number;
  deepLink?: string;
  collapseId?: string;
}

export interface APNsConfigurationStatus {
  enabled: boolean;
  configured: boolean;
  missing: string[];
  bundleIdentifier: string;
}

export interface APNsSendResult {
  ok: boolean;
  status: number;
  apnsId?: string;
  reason?: string;
  deviceId: string;
}

interface ProviderTokenCache {
  cacheKey: string;
  token: string;
  issuedAt: number;
}

let providerTokenCache: ProviderTokenCache | null = null;

function normalizedEnvironment(value: string): PushEnvironment | null {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'development' || normalized === 'sandbox') return 'development';
  if (normalized === 'production' || normalized === 'prod') return 'production';
  return null;
}

export function normalizeDeviceToken(value: string): string {
  return value.replace(/[<>\s]/gu, '').toLowerCase();
}

export function isValidDeviceToken(value: string): boolean {
  const token = normalizeDeviceToken(value);
  return token.length >= 32
    && token.length <= 256
    && token.length % 2 === 0
    && /^[a-f0-9]+$/u.test(token);
}

function validBundleIdentifier(value: string): boolean {
  return value.length >= 3
    && value.length <= 255
    && /^[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+$/u.test(value);
}

export function validatePushRegistration(
  input: MobilePushRegistrationInput,
  env: MobileEnv,
): { token: string; bundleIdentifier: string; environment: PushEnvironment } {
  if (input.platform.trim().toLowerCase() !== 'ios') {
    throw new Error('Only the ios platform is supported');
  }

  const token = normalizeDeviceToken(input.token);
  if (!isValidDeviceToken(token)) throw new Error('Invalid APNs device token');

  const bundleIdentifier = input.bundleIdentifier.trim();
  if (!validBundleIdentifier(bundleIdentifier)) throw new Error('Invalid iOS bundle identifier');

  const expectedBundle = (env.APNS_BUNDLE_ID ?? DEFAULT_BUNDLE_ID).trim();
  if (expectedBundle && bundleIdentifier !== expectedBundle) {
    throw new Error('Bundle identifier does not match the configured APNs topic');
  }

  const environment = normalizedEnvironment(input.environment);
  if (!environment) throw new Error('Invalid APNs environment');

  return { token, bundleIdentifier, environment };
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value));
  return Array.from(new Uint8Array(digest))
    .map(byte => byte.toString(16).padStart(2, '0'))
    .join('');
}

async function runPushSchemaStatement(env: MobileEnv, sql: string): Promise<void> {
  if (!env.DB) throw new Error('D1 DB binding is required for mobile push registration');
  await env.DB.prepare(sql).run();
}

export async function ensureMobilePushSchema(env: MobileEnv): Promise<void> {
  if (!env.DB) throw new Error('D1 DB binding is required for mobile push registration');
  await runPushSchemaStatement(env, `
    CREATE TABLE IF NOT EXISTS mobile_push_devices (
      id TEXT PRIMARY KEY,
      token TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      bundle_id TEXT NOT NULL,
      environment TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'ios',
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_seen_at TEXT NOT NULL,
      last_success_at TEXT,
      last_failure_at TEXT,
      failure_reason TEXT
    )
  `);
  await runPushSchemaStatement(env, `
    CREATE INDEX IF NOT EXISTS idx_mobile_push_devices_active
      ON mobile_push_devices(active, environment, bundle_id)
  `);
  await runPushSchemaStatement(env, `
    CREATE TABLE IF NOT EXISTS mobile_push_events (
      id TEXT PRIMARY KEY,
      device_id TEXT,
      notification_type TEXT NOT NULL,
      symbol TEXT,
      status TEXT NOT NULL,
      apns_id TEXT,
      reason TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await runPushSchemaStatement(env, `
    CREATE INDEX IF NOT EXISTS idx_mobile_push_events_created
      ON mobile_push_events(created_at DESC)
  `);
}

export async function registerMobilePushDevice(
  env: MobileEnv,
  input: MobilePushRegistrationInput,
): Promise<{ registered: boolean; deviceId: string; tokenSuffix: string }> {
  const registration = validatePushRegistration(input, env);
  await ensureMobilePushSchema(env);
  const now = new Date().toISOString();
  const tokenHash = await sha256Hex(registration.token);
  const existing = await env.DB!.prepare(
    'SELECT id FROM mobile_push_devices WHERE token_hash = ? LIMIT 1',
  ).bind(tokenHash).first<{ id: string }>();
  const deviceId = existing?.id ?? crypto.randomUUID();

  await env.DB!.prepare(`
    INSERT INTO mobile_push_devices (
      id, token, token_hash, bundle_id, environment, platform,
      active, created_at, updated_at, last_seen_at, failure_reason
    ) VALUES (?, ?, ?, ?, ?, 'ios', 1, ?, ?, ?, NULL)
    ON CONFLICT(token_hash) DO UPDATE SET
      token = excluded.token,
      bundle_id = excluded.bundle_id,
      environment = excluded.environment,
      platform = 'ios',
      active = 1,
      updated_at = excluded.updated_at,
      last_seen_at = excluded.last_seen_at,
      failure_reason = NULL
  `).bind(
    deviceId,
    registration.token,
    tokenHash,
    registration.bundleIdentifier,
    registration.environment,
    now,
    now,
    now,
  ).run();

  return {
    registered: true,
    deviceId,
    tokenSuffix: registration.token.slice(-8),
  };
}

export async function unregisterMobilePushDevice(
  env: MobileEnv,
  token: string,
): Promise<{ unregistered: boolean }> {
  if (!isValidDeviceToken(token)) throw new Error('Invalid APNs device token');
  await ensureMobilePushSchema(env);
  const tokenHash = await sha256Hex(normalizeDeviceToken(token));
  const result = await env.DB!.prepare(`
    UPDATE mobile_push_devices
       SET active = 0, updated_at = ?, failure_reason = 'UNREGISTERED_BY_DEVICE'
     WHERE token_hash = ?
  `).bind(new Date().toISOString(), tokenHash).run();
  return { unregistered: Number(result.meta.changes ?? 0) > 0 };
}

export async function mobilePushRegistrationStatus(env: MobileEnv): Promise<{
  configured: boolean;
  enabled: boolean;
  activeDevices: number;
  missing: string[];
}> {
  const configuration = getAPNsConfigurationStatus(env);
  let activeDevices = 0;
  if (env.DB) {
    await ensureMobilePushSchema(env);
    const row = await env.DB.prepare(
      'SELECT COUNT(*) AS count FROM mobile_push_devices WHERE active = 1',
    ).first<{ count: number }>();
    activeDevices = Number(row?.count ?? 0);
  }
  return {
    configured: configuration.configured,
    enabled: configuration.enabled,
    activeDevices,
    missing: configuration.missing,
  };
}

export function getAPNsConfigurationStatus(env: MobileEnv): APNsConfigurationStatus {
  const required: Array<[keyof MobileEnv, string | undefined]> = [
    ['APNS_TEAM_ID', env.APNS_TEAM_ID],
    ['APNS_KEY_ID', env.APNS_KEY_ID],
    ['APNS_PRIVATE_KEY_P8', env.APNS_PRIVATE_KEY_P8],
    ['APNS_BUNDLE_ID', env.APNS_BUNDLE_ID],
  ];
  const missing = required.filter(([, value]) => !value?.trim()).map(([key]) => String(key));
  return {
    enabled: env.APNS_ENABLED === 'true',
    configured: missing.length === 0,
    missing,
    bundleIdentifier: env.APNS_BUNDLE_ID?.trim() || DEFAULT_BUNDLE_ID,
  };
}

function base64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/u, '');
}

function base64UrlText(value: string): string {
  return base64Url(encoder.encode(value));
}

function pemToPkcs8(value: string): Uint8Array {
  const normalized = value.replaceAll('\\n', '\n').trim();
  const base64 = normalized
    .replace('-----BEGIN PRIVATE KEY-----', '')
    .replace('-----END PRIVATE KEY-----', '')
    .replace(/\s+/gu, '');
  if (!base64) throw new Error('APNS_PRIVATE_KEY_P8 is empty or malformed');
  const binary = atob(base64);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

export async function createAPNsProviderToken(
  env: MobileEnv,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  const status = getAPNsConfigurationStatus(env);
  if (!status.configured) {
    throw new Error(`APNs configuration is incomplete: ${status.missing.join(', ')}`);
  }

  const keyId = env.APNS_KEY_ID!.trim();
  const teamId = env.APNS_TEAM_ID!.trim();
  const cacheKey = `${teamId}:${keyId}:${await sha256Hex(env.APNS_PRIVATE_KEY_P8!)}`;
  if (
    providerTokenCache
    && providerTokenCache.cacheKey === cacheKey
    && nowSeconds - providerTokenCache.issuedAt < PROVIDER_TOKEN_REFRESH_SECONDS
  ) {
    return providerTokenCache.token;
  }

  const header = base64UrlText(JSON.stringify({ alg: 'ES256', kid: keyId }));
  const claims = base64UrlText(JSON.stringify({ iss: teamId, iat: nowSeconds }));
  const unsigned = `${header}.${claims}`;
  const privateKey = await crypto.subtle.importKey(
    'pkcs8',
    pemToPkcs8(env.APNS_PRIVATE_KEY_P8!),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    encoder.encode(unsigned),
  );
  const token = `${unsigned}.${base64Url(new Uint8Array(signature))}`;
  providerTokenCache = { cacheKey, token, issuedAt: nowSeconds };
  return token;
}

async function listActiveDevices(env: MobileEnv): Promise<MobilePushDevice[]> {
  await ensureMobilePushSchema(env);
  const rows = await env.DB!.prepare(`
    SELECT id, token, token_hash, bundle_id, environment
      FROM mobile_push_devices
     WHERE active = 1
     ORDER BY last_seen_at DESC
     LIMIT ?
  `).bind(MAX_DEVICES_PER_BROADCAST).all<{
    id: string;
    token: string;
    token_hash: string;
    bundle_id: string;
    environment: PushEnvironment;
  }>();
  return (rows.results ?? []).map(row => ({
    id: row.id,
    token: row.token,
    tokenHash: row.token_hash,
    bundleIdentifier: row.bundle_id,
    environment: row.environment,
  }));
}

function notificationPayload(notification: MobilePushNotification): string {
  const payload = JSON.stringify({
    aps: {
      alert: { title: notification.title, body: notification.body },
      sound: 'default',
      'thread-id': notification.symbol ? `trade-${notification.symbol}` : 'moe-system',
    },
    moe: {
      type: notification.type,
      symbol: notification.symbol,
      accountType: notification.accountType,
      price: notification.price,
      deepLink: notification.deepLink,
    },
  });
  if (encoder.encode(payload).byteLength > MAX_PAYLOAD_BYTES) {
    throw new Error('APNs payload exceeds the configured safety limit');
  }
  return payload;
}

async function parseAPNsReason(response: Response): Promise<string | undefined> {
  try {
    const payload = await response.clone().json() as { reason?: string };
    return payload.reason;
  } catch {
    return undefined;
  }
}

async function logPushEvent(
  env: MobileEnv,
  device: MobilePushDevice,
  notification: MobilePushNotification,
  result: APNsSendResult,
): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(`
    INSERT INTO mobile_push_events (
      id, device_id, notification_type, symbol, status, apns_id, reason, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    device.id,
    notification.type,
    notification.symbol ?? null,
    result.ok ? 'ACCEPTED' : 'FAILED',
    result.apnsId ?? null,
    result.reason ?? null,
    new Date().toISOString(),
  ).run();
}

async function updateDeviceDeliveryState(
  env: MobileEnv,
  device: MobilePushDevice,
  result: APNsSendResult,
): Promise<void> {
  if (!env.DB) return;
  const now = new Date().toISOString();
  if (result.ok) {
    await env.DB.prepare(`
      UPDATE mobile_push_devices
         SET last_success_at = ?, updated_at = ?, failure_reason = NULL
       WHERE id = ?
    `).bind(now, now, device.id).run();
    return;
  }

  const shouldDeactivate = result.status === 410
    || ['BadDeviceToken', 'DeviceTokenNotForTopic', 'Unregistered'].includes(result.reason ?? '');
  await env.DB.prepare(`
    UPDATE mobile_push_devices
       SET active = ?, last_failure_at = ?, updated_at = ?, failure_reason = ?
     WHERE id = ?
  `).bind(shouldDeactivate ? 0 : 1, now, now, result.reason ?? `HTTP_${result.status}`, device.id).run();
}

export async function sendPushToDevice(
  env: MobileEnv,
  device: MobilePushDevice,
  notification: MobilePushNotification,
  fetchImpl: typeof fetch = fetch,
): Promise<APNsSendResult> {
  const configuration = getAPNsConfigurationStatus(env);
  if (!configuration.enabled) {
    return { ok: false, status: 503, reason: 'APNS_DISABLED', deviceId: device.id };
  }
  if (!configuration.configured) {
    return {
      ok: false,
      status: 503,
      reason: `APNS_NOT_CONFIGURED:${configuration.missing.join(',')}`,
      deviceId: device.id,
    };
  }
  if (device.bundleIdentifier !== configuration.bundleIdentifier) {
    return { ok: false, status: 400, reason: 'TOPIC_MISMATCH', deviceId: device.id };
  }

  const providerToken = await createAPNsProviderToken(env);
  const apnsId = crypto.randomUUID();
  const host = device.environment === 'development'
    ? 'https://api.development.push.apple.com'
    : 'https://api.push.apple.com';
  const response = await fetchImpl(`${host}/3/device/${device.token}`, {
    method: 'POST',
    headers: {
      authorization: `bearer ${providerToken}`,
      'content-type': 'application/json',
      'apns-topic': device.bundleIdentifier,
      'apns-push-type': 'alert',
      'apns-priority': '10',
      'apns-expiration': '0',
      'apns-id': apnsId,
      ...(notification.collapseId ? { 'apns-collapse-id': notification.collapseId.slice(0, 64) } : {}),
    },
    body: notificationPayload(notification),
  });
  const reason = response.ok ? undefined : await parseAPNsReason(response);
  const result: APNsSendResult = {
    ok: response.ok,
    status: response.status,
    apnsId: response.headers.get('apns-id') ?? apnsId,
    reason,
    deviceId: device.id,
  };
  await Promise.all([
    updateDeviceDeliveryState(env, device, result),
    logPushEvent(env, device, notification, result),
  ]);
  return result;
}

export async function broadcastMobilePush(
  env: MobileEnv,
  notification: MobilePushNotification,
  fetchImpl: typeof fetch = fetch,
): Promise<{ ok: boolean; sent: number; accepted: number; failed: number; results: APNsSendResult[] }> {
  const devices = await listActiveDevices(env);
  const results = await Promise.all(
    devices.map(device => sendPushToDevice(env, device, notification, fetchImpl)),
  );
  const accepted = results.filter(result => result.ok).length;
  return {
    ok: results.length > 0 && accepted === results.length,
    sent: results.length,
    accepted,
    failed: results.length - accepted,
    results,
  };
}
