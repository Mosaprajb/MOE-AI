const DEFAULT_SYMBOLS = Object.freeze(['SPY', 'QQQ']);
const DEFAULT_MINIMUM_BARS = 50;
const DEFAULT_LOOKBACK_DAYS = 90;
const DEFAULT_CACHE_SECONDS = 60;
const INTERNAL_CACHE_ORIGIN = 'https://moerand.internal';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function ema(values, length) {
  if (!Array.isArray(values) || values.length < length) return null;
  const alpha = 2 / (length + 1);
  let output = null;
  for (const raw of values) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    output = output == null ? value : value * alpha + output * (1 - alpha);
  }
  return output;
}

export function hourlyTrend(bars = [], minimumBars = DEFAULT_MINIMUM_BARS) {
  const closes = bars.map((bar) => Number(bar?.c)).filter(Number.isFinite).slice(-1_000);
  const requiredBars = Math.max(50, Number(minimumBars) || DEFAULT_MINIMUM_BARS);
  if (closes.length < requiredBars) {
    return {
      ready: false,
      trend: 'UNKNOWN',
      latest: null,
      ema20: null,
      ema50: null,
      barCount: closes.length,
      requiredBars,
    };
  }

  const latest = closes.at(-1);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  let trend = 'NEUTRAL';
  if (latest > ema20 && ema20 > ema50) trend = 'BULLISH';
  else if (latest < ema20 && ema20 < ema50) trend = 'BEARISH';

  return {
    ready: true,
    trend,
    latest: Number(latest.toFixed(2)),
    ema20: Number(ema20.toFixed(2)),
    ema50: Number(ema50.toFixed(2)),
    barCount: closes.length,
    requiredBars,
  };
}

async function cachedProbe(cacheKey, producer, ttlSeconds = DEFAULT_CACHE_SECONDS) {
  const cache = globalThis.caches?.default;
  const cacheRequest = new Request(`${INTERNAL_CACHE_ORIGIN}/alpaca-market-regime-cache/${cacheKey}`);
  if (cache) {
    const cached = await cache.match(cacheRequest);
    if (cached) return cached.json();
  }

  const value = await producer();
  if (cache) {
    await cache.put(cacheRequest, Response.json(value, {
      headers: { 'cache-control': `public, max-age=${ttlSeconds}` },
    })).catch(() => undefined);
  }
  return value;
}

async function fetchSymbolHourlyBars(symbol, env, { fetchImpl, now, lookbackDays }) {
  const end = now instanceof Date ? now : new Date(now);
  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60_000);
  const query = new URLSearchParams({
    timeframe: '1Hour',
    start: start.toISOString(),
    end: end.toISOString(),
    limit: '1000',
    adjustment: 'raw',
    feed: 'iex',
    sort: 'asc',
  });
  const response = await fetchImpl(`https://data.alpaca.markets/v2/stocks/${symbol}/bars?${query}`, {
    headers: {
      'APCA-API-KEY-ID': text(env.ALPACA_KEY_ID),
      'APCA-API-SECRET-KEY': text(env.ALPACA_SECRET_KEY),
    },
  });
  if (!response.ok) throw new Error(`ALPACA_HTTP_${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload?.bars) ? payload.bars : [];
}

function errorResult(reason = 'ALPACA_PROBE_FAILED') {
  return {
    status: 'ERROR',
    reason,
    regime: 'UNKNOWN',
    indexes: { SPY: { trend: 'UNKNOWN' }, QQQ: { trend: 'UNKNOWN' } },
    checkedAt: iso(),
  };
}

export async function probeAlpacaHourlyRegime(env = {}, options = {}) {
  if (!text(env.ALPACA_KEY_ID) || !text(env.ALPACA_SECRET_KEY)) {
    return errorResult('CREDENTIALS_MISSING');
  }

  const fetchImpl = options.fetchImpl || globalThis.fetch;
  const now = options.now instanceof Date ? options.now : new Date(options.now || Date.now());
  const symbols = Array.isArray(options.symbols) && options.symbols.length
    ? options.symbols.map((symbol) => text(symbol).toUpperCase()).filter(Boolean)
    : [...DEFAULT_SYMBOLS];
  const minimumBars = Math.max(50, Number(options.minimumBars) || DEFAULT_MINIMUM_BARS);
  const lookbackDays = Math.max(30, Number(options.lookbackDays) || DEFAULT_LOOKBACK_DAYS);

  const producer = async () => {
    try {
      const results = await Promise.all(symbols.map(async (symbol) => {
        const bars = await fetchSymbolHourlyBars(symbol, env, { fetchImpl, now, lookbackDays });
        return [symbol, hourlyTrend(bars, minimumBars)];
      }));
      const indexes = Object.fromEntries(results);
      if (results.some(([, trend]) => !trend.ready)) {
        return {
          ...errorResult('ALPACA_HOURLY_HISTORY_INCOMPLETE'),
          indexes,
          checkedAt: iso(now),
        };
      }

      const trends = results.map(([, trend]) => trend.trend);
      const regime = trends.every((value) => value === 'BULLISH')
        ? 'BULLISH'
        : trends.every((value) => value === 'BEARISH')
          ? 'BEARISH'
          : 'NEUTRAL';
      return {
        status: 'CONNECTED',
        reason: null,
        regime,
        indexes,
        checkedAt: iso(now),
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const reason = /^ALPACA_HTTP_\d{3}$/.test(message) ? message : 'ALPACA_PROBE_FAILED';
      return { ...errorResult(reason), checkedAt: iso(now) };
    }
  };

  if (options.cache === false || fetchImpl !== globalThis.fetch) return producer();
  return cachedProbe('hourly-regime-v2', producer, Number(options.cacheSeconds) || DEFAULT_CACHE_SECONDS);
}
