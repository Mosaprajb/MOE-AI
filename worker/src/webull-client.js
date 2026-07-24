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
    : 'https://broker-api.sandbox.webull.com';
}

function md5(input) {
  function add32(a, b) { return (a + b) & 0xffffffff; }
  function cmn(q, a, b, x, s, t) { return add32((add32(a, q) + add32(x, t) << s | (add32(a, q) + add32(x, t)) >>> (32 - s)), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | (~b & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & ~d), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | ~d), a, b, x, s, t); }
  function cycle(state, block) {
    let [a, b, c, d] = state;
    a = ff(a,b,c,d,block[0],7,-680876936); d = ff(d,a,b,c,block[1],12,-389564586); c = ff(c,d,a,b,block[2],17,606105819); b = ff(b,c,d,a,block[3],22,-1044525330);
    a = ff(a,b,c,d,block[4],7,-176418897); d = ff(d,a,b,c,block[5],12,1200080426); c = ff(c,d,a,b,block[6],17,-1473231341); b = ff(b,c,d,a,block[7],22,-45705983);
    a = ff(a,b,c,d,block[8],7,1770035416); d = ff(d,a,b,c,block[9],12,-1958414417); c = ff(c,d,a,b,block[10],17,-42063); b = ff(b,c,d,a,block[11],22,-1990404162);
    a = ff(a,b,c,d,block[12],7,1804603682); d = ff(d,a,b,c,block[13],12,-40341101); c = ff(c,d,a,b,block[14],17,-1502002290); b = ff(b,c,d,a,block[15],22,1236535329);
    a = gg(a,b,c,d,block[1],5,-165796510); d = gg(d,a,b,c,block[6],9,-1069501632); c = gg(c,d,a,b,block[11],14,643717713); b = gg(b,c,d,a,block[0],20,-373897302);
    a = gg(a,b,c,d,block[5],5,-701558691); d = gg(d,a,b,c,block[10],9,38016083); c = gg(c,d,a,b,block[15],14,-660478335); b = gg(b,c,d,a,block[4],20,-405537848);
    a = gg(a,b,c,d,block[9],5,568446438); d = gg(d,a,b,c,block[14],9,-1019803690); c = gg(c,d,a,b,block[3],14,-187363961); b = gg(b,c,d,a,block[8],20,1163531501);
    a = gg(a,b,c,d,block[13],5,-1444681467); d = gg(d,a,b,c,block[2],9,-51403784); c = gg(c,d,a,b,block[7],14,1735328473); b = gg(b,c,d,a,block[12],20,-1926607734);
    a = hh(a,b,c,d,block[5],4,-378558); d = hh(d,a,b,c,block[8],11,-2022574463); c = hh(c,d,a,b,block[11],16,1839030562); b = hh(b,c,d,a,block[14],23,-35309556);
    a = hh(a,b,c,d,block[1],4,-1530992060); d = hh(d,a,b,c,block[4],11,1272893353); c = hh(c,d,a,b,block[7],16,-155497632); b = hh(b,c,d,a,block[10],23,-1094730640);
    a = hh(a,b,c,d,block[13],4,681279174); d = hh(d,a,b,c,block[0],11,-358537222); c = hh(c,d,a,b,block[3],16,-722521979); b = hh(b,c,d,a,block[6],23,76029189);
    a = hh(a,b,c,d,block[9],4,-640364487); d = hh(d,a,b,c,block[12],11,-421815835); c = hh(c,d,a,b,block[15],16,530742520); b = hh(b,c,d,a,block[2],23,-995338651);
    a = ii(a,b,c,d,block[0],6,-198630844); d = ii(d,a,b,c,block[7],10,1126891415); c = ii(c,d,a,b,block[14],15,-1416354905); b = ii(b,c,d,a,block[5],21,-57434055);
    a = ii(a,b,c,d,block[12],6,1700485571); d = ii(d,a,b,c,block[3],10,-1894986606); c = ii(c,d,a,b,block[10],15,-1051523); b = ii(b,c,d,a,block[1],21,-2054922799);
    a = ii(a,b,c,d,block[8],6,1873313359); d = ii(d,a,b,c,block[15],10,-30611744); c = ii(c,d,a,b,block[6],15,-1560198380); b = ii(b,c,d,a,block[13],21,1309151649);
    a = ii(a,b,c,d,block[4],6,-145523070); d = ii(d,a,b,c,block[11],10,-1120210379); c = ii(c,d,a,b,block[2],15,718787259); b = ii(b,c,d,a,block[9],21,-343485551);
    state[0] = add32(a, state[0]); state[1] = add32(b, state[1]); state[2] = add32(c, state[2]); state[3] = add32(d, state[3]);
  }
  const bytes = [...encoder.encode(input)];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  for (let i = 0; i < 8; i++) bytes.push((bitLength >>> (8 * i)) & 0xff);
  const state = [1732584193, -271733879, -1732584194, 271733878];
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const block = [];
    for (let i = 0; i < 16; i++) {
      const j = offset + i * 4;
      block.push(bytes[j] | bytes[j + 1] << 8 | bytes[j + 2] << 16 | bytes[j + 3] << 24);
    }
    cycle(state, block);
  }
  return state.map((word) => [0,8,16,24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')).join('').toUpperCase();
}

async function createSignature({ path, query, body, appKey, appSecret, host, timestamp, nonce }) {
  const values = {
    host,
    'x-app-key': appKey,
    'x-signature-algorithm': 'HMAC-SHA1',
    'x-signature-nonce': nonce,
    'x-signature-version': '1.0',
    'x-timestamp': timestamp,
  };
  for (const [key, value] of query.entries()) values[key] = value;
  const sorted = Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}=${v}`).join('&');
  const signingString = body ? `${path}&${sorted}&${md5(body)}` : `${path}&${sorted}`;
  const cryptoKey = await crypto.subtle.importKey('raw', encoder.encode(`${appSecret}&`), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  return toBase64(await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(encodeURIComponent(signingString))));
}

export async function webullRequest(method, path, { query = {}, body = null } = {}, env = {}) {
  if (!path.startsWith('/')) throw new Error('Webull path must start with /');
  const appKey = requireSecret(env, 'WEBULL_APP_KEY');
  const appSecret = requireSecret(env, 'WEBULL_APP_SECRET');
  const accessToken = requireSecret(env, 'WEBULL_ACCESS_TOKEN');
  const url = new URL(path, `${getBaseUrl(env)}/`);
  for (const [key, value] of Object.entries(query)) if (value != null && value !== '') url.searchParams.set(key, String(value));
  const bodyText = body == null ? '' : JSON.stringify(body);
  const timestamp = compactUtcTimestamp();
  const nonce = crypto.randomUUID().replaceAll('-', '');
  const signature = await createSignature({ path: url.pathname, query: url.searchParams, body: bodyText, appKey, appSecret, host: url.host, timestamp, nonce });
  const response = await fetch(url, {
    method,
    headers: {
      Accept: 'application/json',
      ...(bodyText ? { 'content-type': 'application/json' } : {}),
      'x-app-key': appKey,
      'x-timestamp': timestamp,
      'x-signature-version': '1.0',
      'x-signature-algorithm': 'HMAC-SHA1',
      'x-signature-nonce': nonce,
      'x-version': 'v2',
      'x-signature': signature,
      'x-access-token': accessToken,
    },
    ...(bodyText ? { body: bodyText } : {}),
  });
  const text = await response.text();
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }
  if (!response.ok) throw new Error(data?.message || data?.error || `Webull request failed with ${response.status}`);
  return data;
}

export function webullGet(path, query = {}, env = {}) {
  return webullRequest('GET', path, { query }, env);
}

export async function placeWebullSandboxOrder(accountId, order, env = {}) {
  if (env.WEBULL_ENVIRONMENT === 'production') throw new Error('Sandbox order submission cannot use production environment');
  if (env.WEBULL_SANDBOX_ORDER_SUBMISSION !== 'true') throw new Error('Sandbox order submission is disabled');
  if (!accountId) throw new Error('account_id is required');
  const newOrder = {
    client_order_id: order.signalId,
    combo_type: 'NORMAL',
    instrument_type: 'EQUITY',
    entrust_type: 'QTY',
    support_trading_session: order.session,
    symbol: order.symbol,
    market: 'US',
    side: order.side,
    order_type: order.orderType,
    time_in_force: 'DAY',
    quantity: String(order.quantity),
    ...(order.limitPrice ? { limit_price: String(order.limitPrice) } : {}),
  };
  return webullRequest('POST', '/openapi/trade/order/place', { body: { account_id: accountId, new_orders: [newOrder] } }, env);
}

export function getWebullAccounts(env) { return webullGet('/openapi/account/list', {}, env); }
export function getWebullBalance(accountId, env) { if (!accountId) throw new Error('account_id is required'); return webullGet('/openapi/assets/balance', { account_id: accountId }, env); }
export function getWebullPositions(accountId, env) { if (!accountId) throw new Error('account_id is required'); return webullGet('/openapi/assets/positions', { account_id: accountId }, env); }
export async function getWebullAccountSnapshot(accountId, env) {
  const [balance, positions] = await Promise.all([getWebullBalance(accountId, env), getWebullPositions(accountId, env)]);
  return { accountId, balance, positions, fetchedAt: new Date().toISOString(), readOnly: true };
}
