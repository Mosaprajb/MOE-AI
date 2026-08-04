import { base64UrlDecode, base64UrlEncode, PASSKEY_TTL_SECONDS } from './tradingview-only-passkey-token.js';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function bytesEqual(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left || []);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right || []);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

async function verifyClientData(encoded, type, challenge) {
  let bytes;
  let payload;
  try {
    bytes = base64UrlDecode(encoded);
    payload = JSON.parse(decoder.decode(bytes));
  } catch {
    return null;
  }
  if (payload.type !== type || payload.challenge !== challenge.challenge || payload.origin !== challenge.origin) return null;
  if (payload.crossOrigin === true) return null;
  return { bytes, payload };
}

async function inspectAuthenticatorData(encoded, rpId) {
  let bytes;
  try {
    bytes = base64UrlDecode(encoded);
  } catch {
    return null;
  }
  if (bytes.length < 37) return null;
  const expected = new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(rpId)));
  if (!bytesEqual(bytes.slice(0, 32), expected)) return null;
  const flags = bytes[32];
  if ((flags & 0x01) === 0 || (flags & 0x04) === 0) return null;
  const counter = new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0, false);
  return { bytes, flags, counter };
}

function concatBytes(...parts) {
  const values = parts.map((part) => part instanceof Uint8Array ? part : new Uint8Array(part || []));
  const output = new Uint8Array(values.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of values) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}

function readDerLength(bytes, offset) {
  const first = bytes[offset];
  if (first < 0x80) return { length: first, next: offset + 1 };
  const count = first & 0x7f;
  if (count < 1 || count > 2 || offset + count >= bytes.length) throw new Error('Invalid DER length');
  let length = 0;
  for (let index = 0; index < count; index += 1) length = (length << 8) | bytes[offset + 1 + index];
  return { length, next: offset + 1 + count };
}

function fixedInteger(bytes, size = 32) {
  let value = bytes;
  while (value.length > 1 && value[0] === 0) value = value.slice(1);
  if (value.length > size) throw new Error('Invalid ECDSA integer');
  const output = new Uint8Array(size);
  output.set(value, size - value.length);
  return output;
}

function derToP1363(signature) {
  const bytes = signature instanceof Uint8Array ? signature : new Uint8Array(signature || []);
  let offset = 0;
  if (bytes[offset++] !== 0x30) throw new Error('Invalid ECDSA signature');
  const sequence = readDerLength(bytes, offset);
  offset = sequence.next;
  if (offset + sequence.length !== bytes.length || bytes[offset++] !== 0x02) throw new Error('Invalid ECDSA sequence');
  const rLength = readDerLength(bytes, offset);
  offset = rLength.next;
  const r = bytes.slice(offset, offset + rLength.length);
  offset += rLength.length;
  if (bytes[offset++] !== 0x02) throw new Error('Invalid ECDSA S');
  const sLength = readDerLength(bytes, offset);
  offset = sLength.next;
  const s = bytes.slice(offset, offset + sLength.length);
  offset += sLength.length;
  if (offset !== bytes.length) throw new Error('Invalid ECDSA trailing data');
  return concatBytes(fixedInteger(r), fixedInteger(s));
}

async function importPublicKey(record) {
  if (record.algorithm !== -7) throw new Error('Unsupported passkey algorithm');
  return crypto.subtle.importKey(
    'spki',
    base64UrlDecode(record.publicKeySpki),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
}

export async function createPasskeyRecord(body, challenge) {
  const credential = body?.credential;
  const response = credential?.response;
  if (!credential || credential.type !== 'public-key' || !response) throw new Error('Invalid Face ID registration response');
  if (credential.id !== credential.rawId) throw new Error('Credential identifier mismatch');
  const client = await verifyClientData(response.clientDataJSON, 'webauthn.create', challenge);
  const authenticator = await inspectAuthenticatorData(response.authenticatorData, challenge.rpId);
  if (!client || !authenticator || Number(response.algorithm) !== -7 || !response.publicKey) {
    throw new Error('Face ID registration could not be verified');
  }
  await importPublicKey({ algorithm: -7, publicKeySpki: response.publicKey });
  return {
    scope: 'MOE_TRADINGVIEW_PASSKEY',
    credentialId: credential.id,
    publicKeySpki: response.publicKey,
    algorithm: -7,
    counter: authenticator.counter,
    transports: Array.isArray(response.transports) ? response.transports.slice(0, 8) : [],
    rpId: challenge.rpId,
    createdAt: Date.now(),
    expiresAt: Date.now() + PASSKEY_TTL_SECONDS * 1000,
  };
}

export async function verifyPasskeyAssertion(record, body, challenge) {
  const credential = body?.credential;
  const response = credential?.response;
  if (!credential || credential.type !== 'public-key' || !response) throw new Error('Invalid Face ID response');
  if (credential.id !== record.credentialId || credential.rawId !== record.credentialId) throw new Error('Unknown Face ID credential');
  const client = await verifyClientData(response.clientDataJSON, 'webauthn.get', challenge);
  const authenticator = await inspectAuthenticatorData(response.authenticatorData, challenge.rpId);
  if (!client || !authenticator || !response.signature) throw new Error('Face ID verification data is invalid');
  if (record.counter > 0 && authenticator.counter > 0 && authenticator.counter <= record.counter) {
    throw new Error('Face ID counter validation failed');
  }
  const key = await importPublicKey(record);
  const clientHash = new Uint8Array(await crypto.subtle.digest('SHA-256', client.bytes));
  const signedData = concatBytes(authenticator.bytes, clientHash);
  const der = base64UrlDecode(response.signature);
  let verified = false;
  try {
    verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, derToP1363(der), signedData);
  } catch {
    verified = false;
  }
  if (!verified) {
    try {
      verified = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, der, signedData);
    } catch {
      verified = false;
    }
  }
  if (!verified) throw new Error('Face ID signature verification failed');
  return { ...record, counter: authenticator.counter, lastUsedAt: Date.now() };
}

export function browserRegistrationPayload(credential) {
  const response = credential.response;
  return {
    id: credential.id,
    rawId: base64UrlEncode(credential.rawId),
    type: credential.type,
    response: {
      clientDataJSON: base64UrlEncode(response.clientDataJSON),
      authenticatorData: base64UrlEncode(response.getAuthenticatorData()),
      publicKey: base64UrlEncode(response.getPublicKey()),
      algorithm: response.getPublicKeyAlgorithm(),
      transports: typeof response.getTransports === 'function' ? response.getTransports() : [],
    },
  };
}
