export const SCAN_SOURCE_MODE_SCHEMA = 'MOE.ScanSourceMode';
export const SCAN_SOURCE_MODE_VERSION = '1.0.0';
export const SCAN_SOURCE_MODE_API_PATH = '/api/scanner/source-mode';
export const SCAN_SOURCE_MODE_STORAGE_KEY = 'scanner:source-mode:v1';
export const SCAN_SOURCE_MODE_AUDIT_KEY = 'scanner:source-mode:audit:v1';

export const SCAN_SOURCE_MODES = Object.freeze({
  FULL_UNIVERSE: 'FULL_UNIVERSE',
  CURATED_UNIVERSE: 'CURATED_UNIVERSE',
  FOCUSED_SCAN: 'FOCUSED_SCAN',
});

const VALID_MODES = new Set(Object.values(SCAN_SOURCE_MODES));
const SYMBOL_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const MAX_CURATED_SYMBOLS = 500;
const MAX_FOCUSED_SYMBOLS = 50;
const DEFAULT_FOCUSED_TTL_MS = 4 * 60 * 60_000;
const MAX_AUDIT = 500;

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function timestamp(value, fallback = Date.now()) {
  const parsed = value instanceof Date ? value.getTime() : new Date(value ?? fallback).getTime();
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizeScanSymbol(value) {
  const symbol = text(value).toUpperCase();
  return SYMBOL_RE.test(symbol) ? symbol : null;
}

export function normalizeScanSymbols(value, maximum = MAX_CURATED_SYMBOLS) {
  const source = Array.isArray(value)
    ? value
    : text(value).split(/[\s,;]+/g);
  return [...new Set(source.map(normalizeScanSymbol).filter(Boolean))].slice(0, maximum);
}

export function validateScanSymbols(value, maximum = MAX_CURATED_SYMBOLS) {
  const source = Array.isArray(value) ? value : text(value).split(/[\s,;]+/g).filter(Boolean);
  const invalid = source
    .map((item) => text(item).toUpperCase())
    .filter((item) => item && !SYMBOL_RE.test(item));
  const symbols = normalizeScanSymbols(source, maximum);
  return {
    valid: invalid.length === 0 && symbols.length <= maximum,
    symbols,
    invalid,
    maximum,
  };
}

function normalizeMode(value) {
  const mode = text(value, SCAN_SOURCE_MODES.FULL_UNIVERSE).toUpperCase();
  return VALID_MODES.has(mode) ? mode : SCAN_SOURCE_MODES.FULL_UNIVERSE;
}

function defaultState() {
  return {
    schema: SCAN_SOURCE_MODE_SCHEMA,
    schemaVersion: SCAN_SOURCE_MODE_VERSION,
    mode: SCAN_SOURCE_MODES.FULL_UNIVERSE,
    curatedSymbols: [],
    focusedSymbols: [],
    focusedExpiresAt: null,
    updatedAt: null,
    updatedBy: null,
  };
}

function normalizeState(value = {}, now = Date.now()) {
  const state = {
    ...defaultState(),
    ...(value && typeof value === 'object' ? value : {}),
  };
  state.mode = normalizeMode(state.mode);
  state.curatedSymbols = normalizeScanSymbols(state.curatedSymbols, MAX_CURATED_SYMBOLS);
  state.focusedSymbols = normalizeScanSymbols(state.focusedSymbols, MAX_FOCUSED_SYMBOLS);
  const expiresAt = timestamp(state.focusedExpiresAt, 0);
  if (!expiresAt || expiresAt <= now) {
    state.focusedSymbols = [];
    state.focusedExpiresAt = null;
    if (state.mode === SCAN_SOURCE_MODES.FOCUSED_SCAN) state.mode = SCAN_SOURCE_MODES.FULL_UNIVERSE;
  }
  return state;
}

function publicState(state, fullUniverseSize = null) {
  const activeSymbols = state.mode === SCAN_SOURCE_MODES.CURATED_UNIVERSE
    ? state.curatedSymbols
    : state.mode === SCAN_SOURCE_MODES.FOCUSED_SCAN
      ? state.focusedSymbols
      : [];
  return Object.freeze({
    schema: SCAN_SOURCE_MODE_SCHEMA,
    schemaVersion: SCAN_SOURCE_MODE_VERSION,
    mode: state.mode,
    defaultMode: SCAN_SOURCE_MODES.FULL_UNIVERSE,
    curatedSymbols: Object.freeze([...state.curatedSymbols]),
    focusedSymbols: Object.freeze([...state.focusedSymbols]),
    activeSymbols: Object.freeze([...activeSymbols]),
    activeSymbolCount: state.mode === SCAN_SOURCE_MODES.FULL_UNIVERSE ? fullUniverseSize : activeSymbols.length,
    focusedExpiresAt: state.focusedExpiresAt,
    updatedAt: state.updatedAt,
    updatedBy: state.updatedBy,
    symbolSelectionOnly: true,
    strategyLogicAffected: false,
    positionSizingAffected: false,
    riskGatesAffected: false,
    liveLockAffected: false,
  });
}

export async function readScanSourceMode(storage, { now = Date.now(), fullUniverseSize = null } = {}) {
  const stored = await storage.get(SCAN_SOURCE_MODE_STORAGE_KEY);
  const state = normalizeState(stored, timestamp(now));
  if (stored && (state.mode !== stored.mode || state.focusedExpiresAt !== stored.focusedExpiresAt)) {
    await storage.put(SCAN_SOURCE_MODE_STORAGE_KEY, state);
  }
  return publicState(state, fullUniverseSize);
}

async function recordAudit(storage, event) {
  const existing = await storage.get(SCAN_SOURCE_MODE_AUDIT_KEY);
  const audit = Object.freeze({
    id: `scan-mode-audit-${crypto.randomUUID()}`,
    type: 'SCAN_MODE_CHANGED',
    previousMode: event.previousMode,
    mode: event.mode,
    symbols: Object.freeze([...(event.symbols || [])]),
    symbolCount: (event.symbols || []).length,
    actor: text(event.actor, 'DASHBOARD'),
    symbolSelectionOnly: true,
    riskGatesBypassed: false,
    liveLockBypassed: false,
    createdAt: iso(event.createdAt),
  });
  await storage.put(SCAN_SOURCE_MODE_AUDIT_KEY, [audit, ...(Array.isArray(existing) ? existing : [])].slice(0, MAX_AUDIT));
  console.log(JSON.stringify({ event: 'SCAN_MODE_CHANGED', ...audit }));
  return audit;
}

export async function updateScanSourceMode(storage, patch = {}, {
  now = Date.now(),
  actor = 'DASHBOARD',
  fullUniverseSize = null,
} = {}) {
  const nowMs = timestamp(now);
  const previous = normalizeState(await storage.get(SCAN_SOURCE_MODE_STORAGE_KEY), nowMs);
  const mode = normalizeMode(patch.mode);
  const next = { ...previous, mode, updatedAt: iso(nowMs), updatedBy: text(actor, 'DASHBOARD') };

  if (mode === SCAN_SOURCE_MODES.CURATED_UNIVERSE) {
    const checked = validateScanSymbols(patch.symbols ?? patch.curatedSymbols, MAX_CURATED_SYMBOLS);
    if (!checked.valid || !checked.symbols.length) {
      const error = new Error('Curated Universe requires at least one valid ticker.');
      error.code = 'INVALID_CURATED_SYMBOLS';
      error.invalidSymbols = checked.invalid;
      throw error;
    }
    next.curatedSymbols = checked.symbols;
  }

  if (mode === SCAN_SOURCE_MODES.FOCUSED_SCAN) {
    const checked = validateScanSymbols(patch.symbols ?? patch.focusedSymbols, MAX_FOCUSED_SYMBOLS);
    if (!checked.valid || !checked.symbols.length) {
      const error = new Error('Focused Scan requires at least one valid ticker.');
      error.code = 'INVALID_FOCUSED_SYMBOLS';
      error.invalidSymbols = checked.invalid;
      throw error;
    }
    const ttlMs = Math.max(5 * 60_000, Math.min(24 * 60 * 60_000, Number(patch.ttlMs) || DEFAULT_FOCUSED_TTL_MS));
    next.focusedSymbols = checked.symbols;
    next.focusedExpiresAt = iso(nowMs + ttlMs);
  }

  await storage.put(SCAN_SOURCE_MODE_STORAGE_KEY, next);
  const symbols = mode === SCAN_SOURCE_MODES.CURATED_UNIVERSE
    ? next.curatedSymbols
    : mode === SCAN_SOURCE_MODES.FOCUSED_SCAN
      ? next.focusedSymbols
      : [];
  const audit = await recordAudit(storage, {
    previousMode: previous.mode,
    mode,
    symbols,
    actor,
    createdAt: nowMs,
  });
  return { scanMode: publicState(next, fullUniverseSize), audit };
}

export async function listScanSourceModeAudit(storage, { limit = 100 } = {}) {
  const existing = await storage.get(SCAN_SOURCE_MODE_AUDIT_KEY);
  return (Array.isArray(existing) ? existing : []).slice(0, Math.max(1, Math.min(500, Number(limit) || 100)));
}

export function selectedScanSymbols(scanMode, fullUniverse = []) {
  if (scanMode?.mode === SCAN_SOURCE_MODES.CURATED_UNIVERSE) return normalizeScanSymbols(scanMode.curatedSymbols);
  if (scanMode?.mode === SCAN_SOURCE_MODES.FOCUSED_SCAN) return normalizeScanSymbols(scanMode.focusedSymbols, MAX_FOCUSED_SYMBOLS);
  return normalizeScanSymbols(fullUniverse, 10_000);
}

export function createScanFilteredFetch(baseFetch, selectedSymbols = []) {
  const selected = new Set(normalizeScanSymbols(selectedSymbols, 10_000));
  if (!selected.size) return baseFetch;
  return async function scanFilteredFetch(input, init) {
    const requestUrl = typeof input === 'string' || input instanceof URL
      ? new URL(input)
      : new URL(input.url);
    const isAlpacaUniverseBars = requestUrl.hostname === 'data.alpaca.markets'
      && requestUrl.pathname === '/v2/stocks/bars'
      && requestUrl.searchParams.has('symbols');
    if (!isAlpacaUniverseBars) return baseFetch(input, init);

    const requested = normalizeScanSymbols(requestUrl.searchParams.get('symbols'), 10_000);
    const intersection = requested.filter((symbol) => selected.has(symbol));
    if (!intersection.length) {
      return Response.json({ bars: {}, next_page_token: null }, { status: 200 });
    }
    requestUrl.searchParams.set('symbols', intersection.join(','));
    if (typeof input === 'string' || input instanceof URL) return baseFetch(requestUrl.toString(), init);
    return baseFetch(new Request(requestUrl.toString(), input), init);
  };
}
