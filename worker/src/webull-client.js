const encoder = new TextEncoder();

function toBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function compactUtcTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z');
}

function requireSecret(env, name) {
  const value = String(env[name] || '').trim();
  if (!value) throw new Error(`Missing Cloudflare secret: ${name}`);
  return value;
}

function getBaseUrl(env) {
  const configured = String(env.WEBULL_API_BASE_URL || '').trim();
  if (configured) return configured.replace(/\/$/, '');
  return env.WEBULL_ENVIRONMENT === 'production'
    ? 'https://api.webull.com'
    : 'https://api.sandbox.webull.com';
}

async function signGetRequest({ path, query, appKey, appSecret, host, timestamp, nonce }) {
  const signingValues = {
    host,
    'x-app-key': appKey,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': nonce,
    'x-signature-version': '1.0',
    'x-timestamp': timestamp,
  };

  for (const [key, value] of query.entries()) signingValues[key] = value;

  const sorted = Object.entries(signingValues)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, value]) => `${key}=${value}`)
    .join('&');

  const encodedString = encodeURIComponent(`${path}&${sorted}`);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    encoder.encode(`${appSecret}&`),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const signature = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(encodedString));
  return toBase64(signature);
}

export async function webullGet(path, queryObject = {}, env = {}) {
  if (!path.startsWith('/')) throw new Error('Webull path must start with /');

  const appKey = requireSecret(env, 'WEBULL_APP_KEY');
  const appSecret = requireSecret(env, 'WEBULL_APP_SECRET');
  const accessToken = requireSecret(env, 'WEBULL_ACCESS_TOKEN');
  const baseUrl = getBaseUrl(env);
  const url = new URL(path, `${baseUrl}/`);

  for (const [key, value] of Object.entries(queryObject)) {
    if (value != null && value !== '') url.searchParams.set(key, String(value));
  }

  const timestamp = compactUtcTimestamp();
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const signature = await signGetRequest({
    path: url.pathname,
    query: url.searchParams,
    appKey,
    appSecret,
    host: url.host,
    timestamp,
    nonce,
  });

  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'x-app-key': appKey,
      'x-timestamp': timestamp,
      'x-signature-version': '1.0',
      'x-signature-algorithm': 'HMAC-SHA1',
      'x-signature-nonce': nonce,
      'x-version': 'v2',
      'x-signature': signature,
      'x-access-token': accessToken,
    },
  });

  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }

  if (!response.ok) {
    const message = data?.message || data?.error || `Webull request failed with ${response.status}`;
    throw new Error(message);
  }

  return data;
}

export async function getWebullAccounts(env) {
  return webullGet('/openapi/account/list', {}, env);
}

export async function getWebullBalance(accountId, env) {
  if (!accountId) throw new Error('account_id is required');
  return webullGet('/openapi/assets/balance', { account_id: accountId }, env);
}

export async function getWebullPositions(accountId, env) {
  if (!accountId) throw new Error('account_id is required');
  return webullGet('/openapi/assets/positions', { account_id: accountId }, env);
}

export async function getWebullAccountSnapshot(accountId, env) {
  const [balance, positions] = await Promise.all([
    getWebullBalance(accountId, env),
    getWebullPositions(accountId, env),
  ]);

  return {
    accountId,
    balance,
    positions,
    fetchedAt: new Date().toISOString(),
    readOnly: true,
  };
}
