const PROGRESS_KEY = 'scanner-progress:v1';
const MAX_ROWS = 400;

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function normalizeRow(input = {}, previous = null) {
  const symbol = text(input.symbol ?? previous?.symbol).toUpperCase();
  if (!symbol) return null;
  return {
    symbol,
    status: text(input.status ?? previous?.status, 'WAITING').toUpperCase(),
    price: finite(input.price ?? input.latestPrice, previous?.price ?? null),
    open: finite(input.open, previous?.open ?? null),
    high: finite(input.high, previous?.high ?? null),
    low: finite(input.low, previous?.low ?? null),
    close: finite(input.close ?? input.price, previous?.close ?? previous?.price ?? null),
    bid: finite(input.bid, previous?.bid ?? null),
    ask: finite(input.ask, previous?.ask ?? null),
    entry: finite(input.entry, previous?.entry ?? null),
    stopLoss: finite(input.stopLoss, previous?.stopLoss ?? null),
    takeProfit: finite(input.takeProfit, previous?.takeProfit ?? null),
    score: finite(input.score, previous?.score ?? null),
    brainScore: finite(input.brainScore, previous?.brainScore ?? null),
    relativeVolume: finite(input.relativeVolume, previous?.relativeVolume ?? null),
    spreadPercent: finite(input.spreadPercent, previous?.spreadPercent ?? null),
    volume: finite(input.volume, previous?.volume ?? null),
    profile: text(input.profile ?? previous?.profile),
    reason: text(input.reason ?? previous?.reason),
    barTime: input.barTime ?? previous?.barTime ?? null,
    updatedAt: input.updatedAt || new Date().toISOString(),
  };
}

function defaultProgress() {
  return {
    version: 1,
    runId: null,
    status: 'IDLE',
    phase: 'WAITING',
    currentSymbol: null,
    currentBatch: [],
    currentProfile: null,
    scannedCount: 0,
    totalSymbols: 0,
    progressPercent: 0,
    session: 'CLOSED',
    rows: [],
    startedAt: null,
    updatedAt: null,
    completedAt: null,
  };
}

export async function recordScannerProgress(storage, patch = {}) {
  const previous = (await storage.get(PROGRESS_KEY)) || defaultProgress();
  const newRun = patch.reset === true || (patch.runId && patch.runId !== previous.runId);
  const base = newRun ? defaultProgress() : previous;
  const rowsBySymbol = new Map((Array.isArray(base.rows) ? base.rows : []).map((row) => [row.symbol, row]));

  for (const item of Array.isArray(patch.rows) ? patch.rows : []) {
    const symbol = text(item?.symbol).toUpperCase();
    if (!symbol) continue;
    const normalized = normalizeRow(item, rowsBySymbol.get(symbol));
    if (normalized) rowsBySymbol.set(symbol, normalized);
  }

  const totalSymbols = Math.max(0, Math.floor(finite(patch.totalSymbols, base.totalSymbols) || 0));
  const scannedCount = Math.max(0, Math.min(totalSymbols || Number.MAX_SAFE_INTEGER, Math.floor(finite(patch.scannedCount, base.scannedCount) || 0)));
  const progressPercent = totalSymbols > 0 ? Number(((scannedCount / totalSymbols) * 100).toFixed(1)) : 0;
  const next = {
    ...base,
    ...patch,
    version: 1,
    totalSymbols,
    scannedCount,
    progressPercent,
    currentBatch: Array.isArray(patch.currentBatch) ? patch.currentBatch.map((item) => text(item).toUpperCase()).filter(Boolean).slice(0, 30) : base.currentBatch || [],
    rows: [...rowsBySymbol.values()].slice(0, MAX_ROWS),
    updatedAt: new Date().toISOString(),
  };
  delete next.reset;
  await storage.put(PROGRESS_KEY, next);
  return next;
}

export async function getScannerProgress(storage) {
  const progress = await storage.get(PROGRESS_KEY);
  return progress && typeof progress === 'object' ? { ...defaultProgress(), ...progress } : defaultProgress();
}
