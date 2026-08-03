import { MOBILE_DASHBOARD_HTML } from './moe-mobile-html.js';

export const MOBILE_DASHBOARD_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
export const MOBILE_SESSION_COOKIE = 'moe_mobile_session';
export const MOBILE_PASSCODE_SECURITY_KEY = 'mobile-passcode-security:v1';
export const MOBILE_CONFIG_KEY = 'mobile-dashboard-config:v1';
export const MOBILE_RUNTIME_KEY = 'mobile-dashboard-runtime:v1';

export const MOBILE_API_PATHS = new Set([
  '/api/health',
  '/api/config',
  '/api/market/session',
  '/api/trading/session-policy',
  '/api/scanner/source-mode',
  '/api/scanner/diagnostic',
  '/api/scanner/live-activity',
  '/api/trades',
  '/api/trades/close',
  '/api/trades/analytics',
  '/api/trading-intelligence/portfolio-risk',
  '/api/trading-intelligence/active-position',
  '/api/trading/mode',
]);

const PASSCODE_FORMAT = 'pbkdf2-sha256';
const DEFAULT_ITERATIONS = 210_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const STRATEGIES = new Set([
  'FUSION_V2',
  'MOERAND_SIMPLE_INTERNAL',
  'MOERAND_SCALP_INTERNAL',
  'MOERAND_CLEAN_INTERNAL',
]);
const SESSIONS = new Set(['PREMARKET', 'REGULAR', 'AFTER_HOURS']);

function enabled(value) {
  return String(value || '').trim().toLowerCase() === 'true';
}

function number(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback, minimum = 1, maximum = 10_000_000) {
  return Math.min(maximum, Math.max(minimum, Math.floor(number(value, fallback))));
}

function base64UrlEncode(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

function constantTimeEqual(left, right) {
  const a = left instanceof Uint8Array ? left : new Uint8Array(left || []);
  const b = right instanceof Uint8Array ? right : new Uint8Array(right || []);
  let difference = a.length ^ b.length;
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) difference |= (a[index] || 0) ^ (b[index] || 0);
  return difference === 0;
}

async function pbkdf2(passcode, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(passcode), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    hash: 'SHA-256',
    salt,
    iterations,
  }, key, 256);
  return new Uint8Array(bits);
}

export async function createMobilePasscodeHash(passcode, options = {}) {
  const normalized = String(passcode || '').trim();
  if (!/^\d{6}$/.test(normalized)) throw new Error('Passcode must contain exactly 6 digits.');
  const iterations = integer(options.iterations, DEFAULT_ITERATIONS, 100_000, 2_000_000);
  const salt = options.salt instanceof Uint8Array ? options.salt : crypto.getRandomValues(new Uint8Array(16));
  if (salt.length < 16) throw new Error('Passcode salt must contain at least 16 bytes.');
  const digest = await pbkdf2(normalized, salt, iterations);
  return `${PASSCODE_FORMAT}$${iterations}$${base64UrlEncode(salt)}$${base64UrlEncode(digest)}`;
}

function parseStoredPasscode(value) {
  const [format, iterationsRaw, saltRaw, digestRaw, ...extra] = String(value || '').trim().split('$');
  if (format !== PASSCODE_FORMAT || extra.length || !iterationsRaw || !saltRaw || !digestRaw) {
    throw new Error('Mobile passcode hash is invalid or not configured.');
  }
  const iterations = integer(iterationsRaw, 0, 100_000, 2_000_000);
  if (!iterations) throw new Error('Mobile passcode hash is invalid or not configured.');
  const salt = base64UrlDecode(saltRaw);
  const digest = base64UrlDecode(digestRaw);
  if (salt.length < 16 || digest.length !== 32) throw new Error('Mobile passcode hash is invalid or not configured.');
  return { iterations, salt, digest };
}

async function passcodeMatches(passcode, stored) {
  const parsed = parseStoredPasscode(stored);
  const candidate = await pbkdf2(String(passcode || '').trim(), parsed.salt, parsed.iterations);
  return constantTimeEqual(candidate, parsed.digest);
}

function lockoutSettings(env = {}) {
  return {
    maximumAttempts: integer(env.MOE_LIVE_PIN_MAX_ATTEMPTS, 5, 3, 20),
    lockoutMinutes: integer(env.MOE_LIVE_PIN_LOCKOUT_MINUTES, 15, 1, 1440),
  };
}

async function readPasscodeSecurity(storage) {
  const saved = await storage.get(MOBILE_PASSCODE_SECURITY_KEY);
  return saved && typeof saved === 'object'
    ? saved
    : { failedAttempts: 0, lockedUntil: null, lastFailureAt: null };
}

export async function verifyMobilePasscode(storage, passcode, env = {}, now = Date.now()) {
  const timestamp = Number(now) || Date.now();
  const security = await readPasscodeSecurity(storage);
  const lockedUntil = security.lockedUntil ? Date.parse(security.lockedUntil) : 0;
  if (lockedUntil > timestamp) {
    throw new Error(`Passcode is temporarily locked until ${security.lockedUntil}.`);
  }

  const configuredHash = String(env.MOE_MOBILE_PASSCODE_HASH || '').trim();
  if (!configuredHash) throw new Error('Mobile passcode hash is invalid or not configured.');

  let valid = false;
  try {
    valid = /^\d{6}$/.test(String(passcode || '').trim())
      && await passcodeMatches(passcode, configuredHash);
  } catch (error) {
    if (/invalid or not configured/i.test(error instanceof Error ? error.message : '')) throw error;
    valid = false;
  }

  if (!valid) {
    const { maximumAttempts, lockoutMinutes } = lockoutSettings(env);
    const failedAttempts = Number(security.failedAttempts || 0) + 1;
    const lockoutTriggered = failedAttempts >= maximumAttempts;
    const nextLockedUntil = lockoutTriggered
      ? new Date(timestamp + lockoutMinutes * 60_000).toISOString()
      : null;
    await storage.put(MOBILE_PASSCODE_SECURITY_KEY, {
      failedAttempts: lockoutTriggered ? 0 : failedAttempts,
      lastFailureAt: new Date(timestamp).toISOString(),
      lockedUntil: nextLockedUntil,
    });
    if (lockoutTriggered) {
      throw new Error(`Wrong passcode. Too many invalid attempts; access is locked for ${lockoutMinutes} minutes.`);
    }
    const remaining = Math.max(0, maximumAttempts - failedAttempts);
    throw new Error(`Wrong passcode. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`);
  }

  await storage.put(MOBILE_PASSCODE_SECURITY_KEY, {
    failedAttempts: 0,
    lockedUntil: null,
    lastFailureAt: null,
  });
  return { verified: true };
}

async function hmac(secret, value) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(value)));
}

function sessionSecret(env = {}) {
  const secret = String(env.MOE_MOBILE_SESSION_SECRET || '').trim();
  if (secret.length < 32) throw new Error('MOE_MOBILE_SESSION_SECRET must contain at least 32 characters.');
  return secret;
}

function sessionTtlSeconds(env = {}) {
  return integer(env.MOE_MOBILE_SESSION_TTL_MINUTES, 10, 1, 60) * 60;
}

export async function createMobileSession(env = {}, now = Date.now()) {
  const issuedAt = Number(now) || Date.now();
  const ttlSeconds = sessionTtlSeconds(env);
  const payload = {
    scope: 'MOE_MOBILE_DASHBOARD',
    issuedAt,
    expiresAt: issuedAt + ttlSeconds * 1000,
    nonce: crypto.randomUUID(),
  };
  const body = base64UrlEncode(encoder.encode(JSON.stringify(payload)));
  const signature = base64UrlEncode(await hmac(sessionSecret(env), body));
  return { token: `${body}.${signature}`, payload, ttlSeconds };
}

export async function verifyMobileSessionToken(token, env = {}, now = Date.now()) {
  const [body, signature, ...extra] = String(token || '').split('.');
  if (!body || !signature || extra.length) throw new Error('Invalid mobile session.');
  const expected = await hmac(sessionSecret(env), body);
  if (!constantTimeEqual(expected, base64UrlDecode(signature))) throw new Error('Invalid mobile session.');
  let payload;
  try { payload = JSON.parse(decoder.decode(base64UrlDecode(body))); }
  catch { throw new Error('Invalid mobile session.'); }
  const timestamp = Number(now) || Date.now();
  if (payload?.scope !== 'MOE_MOBILE_DASHBOARD' || !Number.isFinite(payload?.expiresAt) || payload.expiresAt <= timestamp) {
    throw new Error('Invalid or expired mobile session.');
  }
  return payload;
}

function cookieValue(request, name) {
  const cookie = request.headers.get('cookie') || '';
  for (const part of cookie.split(';')) {
    const [key, ...value] = part.trim().split('=');
    if (key === name) return value.join('=');
  }
  return '';
}

export async function requireMobileSession(request, env = {}) {
  return verifyMobileSessionToken(cookieValue(request, MOBILE_SESSION_COOKIE), env);
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  return origin === new URL(request.url).origin;
}

function secureJson(payload, status = 200, headers = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      ...headers,
    },
  });
}

export function isMobileDashboardPath(pathname) {
  return MOBILE_DASHBOARD_PATHS.has(pathname);
}

export function isMobileClientRequest(request) {
  if (request.headers.get('x-moe-mobile-client') === '1') return true;
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try { return isMobileDashboardPath(new URL(referer).pathname); }
  catch { return false; }
}

export function isMobileProtectedApiPath(pathname) {
  return MOBILE_API_PATHS.has(pathname);
}

export function serveMobileDashboard(request) {
  if (!['GET', 'HEAD'].includes(request.method)) return secureJson({ ok: false, error: 'Method not allowed.' }, 405);
  const headers = {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'referrer-policy': 'same-origin',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
  };
  return new Response(request.method === 'HEAD' ? null : MOBILE_DASHBOARD_HTML, { status: 200, headers });
}

export async function handleMobilePasscode(request, env, stub) {
  if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed.' }, 405);
  if (!sameOrigin(request)) return secureJson({ ok: false, error: 'Invalid request origin.' }, 403);
  let payload;
  try { payload = await request.json(); }
  catch { return secureJson({ ok: false, error: 'Invalid JSON payload.' }, 400); }
  if (payload?.action !== 'verifyPasscode') return null;
  try {
    await stub.verifyMobilePasscode(payload.passcode, {
      passcodeHash: String(env.MOE_MOBILE_PASSCODE_HASH || '').trim(),
      ...lockoutSettings(env),
    });
    const session = await createMobileSession(env);
    return secureJson({
      ok: true,
      verified: true,
      expiresAt: new Date(session.payload.expiresAt).toISOString(),
    }, 200, {
      'set-cookie': `${MOBILE_SESSION_COOKIE}=${session.token}; Path=/; Max-Age=${session.ttlSeconds}; HttpOnly; Secure; SameSite=Strict`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid passcode.';
    const status = /locked/i.test(message) ? 423 : /not configured/i.test(message) ? 503 : 401;
    return secureJson({ ok: false, error: message }, status);
  }
}

export async function mobileSessionErrorResponse(request, env) {
  try {
    await requireMobileSession(request, env);
    return null;
  } catch (error) {
    return secureJson({
      ok: false,
      error: error instanceof Error ? error.message : 'Invalid mobile session.',
    }, 401, {
      'set-cookie': `${MOBILE_SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Strict`,
    });
  }
}

function ceiling(env = {}) {
  const portfolioRisk = number(env.MOE_MAX_PORTFOLIO_RISK_PERCENT, 1);
  const openRisk = number(env.MOE_MAX_OPEN_RISK_PERCENT, portfolioRisk);
  return {
    cashAllocationPercent: Math.min(100, Math.max(0, number(env.MOE_MOBILE_MAX_CASH_ALLOCATION_PERCENT, 100))),
    marginAllocationPercent: Math.min(100, Math.max(0, number(env.MOE_MOBILE_MAX_MARGIN_ALLOCATION_PERCENT, 100))),
    takeProfitR: Math.min(20, Math.max(0.5, number(env.MOE_MOBILE_MAX_TAKE_PROFIT_R, 5))),
    riskPerTradePercent: Math.min(openRisk, portfolioRisk),
    maxDailyTrades: integer(env.MOE_MAX_DAILY_TRADES, 3, 1, 100),
    maxDailyLossPercent: Math.max(0.1, number(env.MOE_MAX_DAILY_LOSS_PERCENT, 2)),
  };
}

export function defaultMobileConfig(env = {}) {
  const limits = ceiling(env);
  return {
    cashAllocationPercent: Math.min(25, limits.cashAllocationPercent),
    marginAllocationPercent: 0,
    takeProfitR: Math.min(2, limits.takeProfitR),
    riskPerTradePercent: Math.min(1, limits.riskPerTradePercent),
    maxDailyTrades: Math.min(3, limits.maxDailyTrades),
    maxDailyLossPercent: Math.min(2, limits.maxDailyLossPercent),
  };
}

const CONFIG_MINIMUMS = Object.freeze({
  cashAllocationPercent: 0,
  marginAllocationPercent: 0,
  takeProfitR: 0.5,
  riskPerTradePercent: 0.1,
  maxDailyTrades: 1,
  maxDailyLossPercent: 0.1,
});

export function validateMobileConfig(input = {}, env = {}, current = defaultMobileConfig(env)) {
  const limits = ceiling(env);
  const next = { ...current };
  for (const key of Object.keys(CONFIG_MINIMUMS)) {
    if (input[key] == null) continue;
    const value = Number(input[key]);
    if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number.`);
    if (value < CONFIG_MINIMUMS[key]) throw new Error(`${key} must be at least ${CONFIG_MINIMUMS[key]}.`);
    if (value > limits[key]) throw new Error(`${key} exceeds the server-side ceiling of ${limits[key]}.`);
    next[key] = key === 'maxDailyTrades' ? Math.floor(value) : Number(value);
  }
  return next;
}

export async function readMobileConfig(storage, env = {}) {
  const saved = await storage.get(MOBILE_CONFIG_KEY);
  return validateMobileConfig(saved && typeof saved === 'object' ? saved : {}, env);
}

export async function updateMobileConfig(storage, patch = {}, env = {}) {
  const current = await readMobileConfig(storage, env);
  const config = validateMobileConfig(patch, env, current);
  await storage.put(MOBILE_CONFIG_KEY, config);
  return config;
}

function normalizeSymbols(values) {
  if (!Array.isArray(values)) return [];
  const symbols = [...new Set(values.map((value) => String(value || '').trim().toUpperCase()).filter(Boolean))];
  const invalid = symbols.filter((symbol) => !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol));
  if (invalid.length) throw new Error(`Invalid symbols: ${invalid.join(', ')}.`);
  return symbols.slice(0, 50);
}

function normalizeSessions(values) {
  if (!Array.isArray(values)) return ['REGULAR'];
  const sessions = [...new Set(values.map((value) => String(value || '').trim().toUpperCase()))];
  const invalid = sessions.filter((value) => !SESSIONS.has(value));
  if (invalid.length) throw new Error(`Invalid trading sessions: ${invalid.join(', ')}.`);
  if (!sessions.length) throw new Error('At least one trading session is required.');
  return sessions;
}

export function defaultMobileRuntime(env = {}) {
  return {
    mode: 'SANDBOX',
    armed: false,
    strategy: 'FUSION_V2',
    symbols: [],
    sessions: ['REGULAR'],
    settings: defaultMobileConfig(env),
    updatedAt: null,
    updatedBy: null,
  };
}

export async function readMobileRuntime(storage, env = {}) {
  const saved = await storage.get(MOBILE_RUNTIME_KEY);
  const base = defaultMobileRuntime(env);
  if (!saved || typeof saved !== 'object') return base;
  return {
    ...base,
    ...saved,
    mode: String(saved.mode || base.mode).toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX',
    armed: saved.armed === true,
    strategy: STRATEGIES.has(String(saved.strategy || '').toUpperCase()) ? String(saved.strategy).toUpperCase() : base.strategy,
    symbols: normalizeSymbols(saved.symbols),
    sessions: normalizeSessions(saved.sessions),
    settings: validateMobileConfig(saved.settings || {}, env),
  };
}

export async function updateMobileRuntime(storage, patch = {}, env = {}, actor = 'MOBILE_DASHBOARD') {
  const current = await readMobileRuntime(storage, env);
  const mode = patch.mode == null ? current.mode : String(patch.mode).trim().toUpperCase();
  if (!['SANDBOX', 'LIVE'].includes(mode)) throw new Error('mode must be SANDBOX or LIVE.');
  const strategy = patch.strategy == null ? current.strategy : String(patch.strategy).trim().toUpperCase();
  if (!STRATEGIES.has(strategy)) throw new Error('Unsupported trading strategy.');
  const settings = patch.settings == null ? current.settings : validateMobileConfig(patch.settings, env, current.settings);
  const next = {
    ...current,
    mode,
    armed: patch.armed == null ? current.armed : patch.armed === true,
    strategy,
    symbols: patch.symbols == null ? current.symbols : normalizeSymbols(patch.symbols),
    sessions: patch.sessions == null ? current.sessions : normalizeSessions(patch.sessions),
    settings,
    updatedAt: new Date().toISOString(),
    updatedBy: String(actor || 'MOBILE_DASHBOARD').slice(0, 64),
  };
  if (next.armed && !next.symbols.length) throw new Error('At least one symbol is required before arming trading.');
  await storage.put(MOBILE_RUNTIME_KEY, next);
  return next;
}

export function mobileDashboardSecurityEnabled(env = {}) {
  return enabled(env.MOE_MOBILE_DASHBOARD_ENABLED ?? 'true');
}
