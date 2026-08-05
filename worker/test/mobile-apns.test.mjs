import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAPNsProviderToken,
  getAPNsConfigurationStatus,
  isValidDeviceToken,
  normalizeDeviceToken,
  sendPushToDevice,
  validatePushRegistration,
} from '../src/lib/apns.ts';

function base64UrlDecode(segment) {
  const normalized = segment.replaceAll('-', '+').replaceAll('_', '/');
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

async function createPrivateKeyPem() {
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const pkcs8 = new Uint8Array(await crypto.subtle.exportKey('pkcs8', pair.privateKey));
  const base64 = Buffer.from(pkcs8).toString('base64').match(/.{1,64}/gu).join('\n');
  return `-----BEGIN PRIVATE KEY-----\n${base64}\n-----END PRIVATE KEY-----`;
}

const token = 'ab'.repeat(32);

test('APNs device registration validates token, platform, topic and environment', () => {
  const env = { APNS_BUNDLE_ID: 'com.moerand.moeai' };
  assert.equal(normalizeDeviceToken(`<${token}>`), token);
  assert.equal(isValidDeviceToken(token), true);
  assert.equal(isValidDeviceToken('not-a-token'), false);
  assert.deepEqual(
    validatePushRegistration({
      token,
      platform: 'ios',
      bundleIdentifier: 'com.moerand.moeai',
      environment: 'sandbox',
    }, env),
    { token, bundleIdentifier: 'com.moerand.moeai', environment: 'development' },
  );
  assert.throws(() => validatePushRegistration({
    token,
    platform: 'android',
    bundleIdentifier: 'com.moerand.moeai',
    environment: 'development',
  }, env));
});

test('APNs remains disabled and fail-closed before Apple secrets are added', () => {
  const status = getAPNsConfigurationStatus({ APNS_ENABLED: 'false' });
  assert.equal(status.enabled, false);
  assert.equal(status.configured, false);
  assert.ok(status.missing.includes('APNS_PRIVATE_KEY_P8'));
});

test('provider authentication token uses ES256 claims', async () => {
  const privateKey = await createPrivateKeyPem();
  const env = {
    APNS_ENABLED: 'true',
    APNS_TEAM_ID: 'TEAM123456',
    APNS_KEY_ID: 'KEY1234567',
    APNS_PRIVATE_KEY_P8: privateKey,
    APNS_BUNDLE_ID: 'com.moerand.moeai',
  };
  const jwt = await createAPNsProviderToken(env, 1_700_000_000);
  const [header, claims, signature] = jwt.split('.');
  assert.deepEqual(JSON.parse(base64UrlDecode(header)), { alg: 'ES256', kid: 'KEY1234567' });
  assert.deepEqual(JSON.parse(base64UrlDecode(claims)), { iss: 'TEAM123456', iat: 1_700_000_000 });
  assert.ok(signature.length > 40);
});

test('APNs sender does not call the network while disabled', async () => {
  let calls = 0;
  const result = await sendPushToDevice(
    { APNS_ENABLED: 'false' },
    {
      id: 'device-1',
      token,
      tokenHash: 'hash',
      bundleIdentifier: 'com.moerand.moeai',
      environment: 'development',
    },
    { type: 'TEST', title: 'MOE-AI', body: 'Test' },
    async () => {
      calls += 1;
      return new Response(null, { status: 200 });
    },
  );
  assert.equal(calls, 0);
  assert.equal(result.reason, 'APNS_DISABLED');
});

test('APNs sender includes mandatory alert headers when configured', async () => {
  const privateKey = await createPrivateKeyPem();
  const env = {
    APNS_ENABLED: 'true',
    APNS_TEAM_ID: 'TEAM123456',
    APNS_KEY_ID: 'KEY1234567',
    APNS_PRIVATE_KEY_P8: privateKey,
    APNS_BUNDLE_ID: 'com.moerand.moeai',
  };
  let request;
  const result = await sendPushToDevice(
    env,
    {
      id: 'device-2',
      token,
      tokenHash: 'hash',
      bundleIdentifier: 'com.moerand.moeai',
      environment: 'development',
    },
    { type: 'TEST', title: 'MOE-AI', body: 'Connected', collapseId: 'test' },
    async (url, init) => {
      request = { url, init };
      return new Response(null, { status: 200, headers: { 'apns-id': 'accepted-id' } });
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.apnsId, 'accepted-id');
  assert.match(request.url, /^https:\/\/api\.development\.push\.apple\.com\/3\/device\//u);
  assert.equal(request.init.headers['apns-topic'], 'com.moerand.moeai');
  assert.equal(request.init.headers['apns-push-type'], 'alert');
  assert.equal(request.init.headers['apns-priority'], '10');
  assert.match(request.init.headers.authorization, /^bearer /u);
});
