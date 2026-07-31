export const MARKET_TIMEFRAMES = Object.freeze({
  '1m': Object.freeze({ milliseconds: 60_000, alpaca: '1Min', polygon: Object.freeze([1, 'minute']), webull: 'M1', finnhub: '1', yahoo: '1m' }),
  '5m': Object.freeze({ milliseconds: 300_000, alpaca: '5Min', polygon: Object.freeze([5, 'minute']), webull: 'M5', finnhub: '5', yahoo: '5m' }),
  '15m': Object.freeze({ milliseconds: 900_000, alpaca: '15Min', polygon: Object.freeze([15, 'minute']), webull: 'M15', finnhub: '15', yahoo: '15m' }),
  '1h': Object.freeze({ milliseconds: 3_600_000, alpaca: '1Hour', polygon: Object.freeze([1, 'hour']), webull: 'M60', finnhub: '60', yahoo: '60m' }),
  '4h': Object.freeze({ milliseconds: 14_400_000, alpaca: '4Hour', polygon: Object.freeze([4, 'hour']), webull: 'M240', finnhub: '60', yahoo: '1h' }),
  '1d': Object.freeze({ milliseconds: 86_400_000, alpaca: '1Day', polygon: Object.freeze([1, 'day']), webull: 'D', finnhub: 'D', yahoo: '1d' }),
});

export function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(symbol)) throw new Error('Invalid market-data symbol.');
  return symbol;
}

export function normalizeTimeframe(value = '5m') {
  const timeframe = String(value || '5m').trim().toLowerCase();
  if (!MARKET_TIMEFRAMES[timeframe]) throw new Error(`Unsupported market-data timeframe: ${timeframe}.`);
  return timeframe;
}

export function positiveInteger(value, fallback, minimum = 0, maximum = 100_000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

export function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function timestampMilliseconds(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value === 'number' || /^\d+(?:\.\d+)?$/.test(String(value))) {
    let number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return fallback;
    if (number > 1e17) number /= 1e6;
    else if (number > 1e14) number /= 1e3;
    else if (number < 1e11) number *= 1e3;
    return Math.round(number);
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

export async function fetchJson(fetchImpl, url, init = {}) {
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const response = await fetchImpl(url, init);
  if (!response || typeof response !== 'object') throw new Error('Market-data provider returned no HTTP response.');
  if (!response.ok) {
    let detail = '';
    try {
      const text = await response.text();
      detail = text ? `: ${text.slice(0, 240)}` : '';
    } catch {
      detail = '';
    }
    const error = new Error(`Market-data HTTP ${response.status || 'error'}${detail}`);
    error.status = Number(response.status) || 0;
    throw error;
  }
  const payload = await response.json();
  if (!payload || typeof payload !== 'object') throw new Error('Market-data provider returned invalid JSON.');
  return payload;
}

export function withQuery(baseUrl, path, query = {}) {
  const url = new URL(path, baseUrl);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, String(value));
  }
  return url.toString();
}

export function providerIdentity(name, rateLimit) {
  const normalized = String(name || '').trim().toLowerCase();
  if (!normalized) throw new Error('Market-data provider name is required.');
  return Object.freeze({
    name: normalized,
    rateLimit: Object.freeze({
      requests: positiveInteger(rateLimit?.requests, 60, 1, 100_000),
      intervalMs: positiveInteger(rateLimit?.intervalMs, 60_000, 1, 3_600_000),
    }),
  });
}

export function unwrapArray(payload, keys = []) {
  for (const key of keys) {
    const value = key.split('.').reduce((current, part) => current?.[part], payload);
    if (Array.isArray(value)) return value;
  }
  return Array.isArray(payload) ? payload : [];
}

export function unwrapObject(payload, keys = []) {
  for (const key of keys) {
    const value = key.split('.').reduce((current, part) => current?.[part], payload);
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  }
  return payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
}

export function aggregateBars(rows, bucketMs) {
  const size = positiveInteger(bucketMs, 0, 1, 604_800_000);
  const buckets = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const timestamp = timestampMilliseconds(row?.timestamp ?? row?.time ?? row?.t);
    const open = finiteNumber(row?.open ?? row?.o);
    const high = finiteNumber(row?.high ?? row?.h);
    const low = finiteNumber(row?.low ?? row?.l);
    const close = finiteNumber(row?.close ?? row?.c);
    const volume = finiteNumber(row?.volume ?? row?.v, 0);
    if (!timestamp || ![open, high, low, close].every(Number.isFinite)) continue;
    const key = Math.floor(timestamp / size) * size;
    const existing = buckets.get(key);
    if (!existing) {
      buckets.set(key, { timestamp: key, open, high, low, close, volume, trades: finiteNumber(row?.trades ?? row?.n, 0) });
      continue;
    }
    existing.high = Math.max(existing.high, high);
    existing.low = Math.min(existing.low, low);
    existing.close = close;
    existing.volume += volume;
    existing.trades += finiteNumber(row?.trades ?? row?.n, 0);
  }
  return [...buckets.values()].sort((left, right) => left.timestamp - right.timestamp);
}
