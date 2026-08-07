import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMobileSessionCookie,
  clearMobileSessionCookie,
  createMobileSessionToken,
  mobileSessionTtlSeconds,
  verifyMobileControlPin,
  verifyMobileSessionToken,
} from '../src/lib/mobile-session.ts';

const env = {
  MOE_MOBILE_SESSION_SECRET: 's'.repeat(48),
  MOE_MOBILE_CONTROL_PIN: '246810',
  MOE_MOBILE_SESSION_TTL_SECONDS: '3600',
};

test('mobile session token round-trips and expires', async () => {
  const created = await createMobileSessionToken(env, 1_000);
  assert.equal(created.ttlSeconds, 3600);
  assert.equal((await verifyMobileSessionToken(created.token, env, 1_001))?.exp, 4_600);
  assert.equal(await verifyMobileSessionToken(created.token, env, 4_600), null);
});

test('mobile session rejects a modified signature', async () => {
  const created = await createMobileSessionToken(env, 2_000);
  const [segment, signature] = created.token.split('.');
  assert.ok(segment);
  assert.ok(signature);
  const tamperedSignature = `${signature[0] === 'A' ? 'B' : 'A'}${signature.slice(1)}`;
  const tampered = `${segment}.${tamperedSignature}`;
  assert.equal(await verifyMobileSessionToken(tampered, env, 2_001), null);
});

test('control PIN comparison is exact and session TTL is bounded', async () => {
  assert.equal(await verifyMobileControlPin('246810', env), true);
  assert.equal(await verifyMobileControlPin('246811', env), false);
  assert.equal(mobileSessionTtlSeconds({ ...env, MOE_MOBILE_SESSION_TTL_SECONDS: '1' }), 300);
  assert.equal(mobileSessionTtlSeconds({ ...env, MOE_MOBILE_SESSION_TTL_SECONDS: '999999' }), 86400);
});

test('session cookies are secure and clearable', async () => {
  const created = await createMobileSessionToken(env, 3_000);
  const cookie = buildMobileSessionCookie(created.token, created.ttlSeconds);
  assert.match(cookie, /HttpOnly/u);
  assert.match(cookie, /Secure/u);
  assert.match(cookie, /SameSite=Strict/u);
  assert.match(clearMobileSessionCookie(), /Max-Age=0/u);
});
