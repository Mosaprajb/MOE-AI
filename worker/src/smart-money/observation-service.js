import { evaluateSmartMoneyScannerBatch } from './scanner-adapter.js';

const SUPPORTED_TIMEFRAMES = Object.freeze({
  '1m': { minutes: 1, alpaca: '1Min', lookbackDays: 3 },
  '5m': { minutes: 5, alpaca: '5Min', lookbackDays: 15 },
  '15m': { minutes: 15, alpaca: '15Min', lookbackDays: 30 },
});

function integer(value, fallback, minimum = 1, maximum = 1000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function timeframeConfig(value) {
  const normalized = text(value, '5m').toLowerCase();
  return { name: SUPPORTED_TIMEFRAMES[normalized] ? normalized : '5m', ...(SUPPORTED_TIMEFRAMES[normalized] || SUPPORTED_TIMEFRAMES['5m']) };
}

function parseBars(items = []) {
  return items.map((bar) => ({
    t: new Date(bar.t).getTime(),
    o: Number(bar.o),
    h: Number(bar.h),
    l: Number(bar.l),
    c: Number(bar.c),
    v: Number(bar.v || 0),
  })).filter((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
}

function symbolList(universe = [], env = {}) {
  const configured = text(env.SMART_MONEY_OBSERVATION_SYMBOLS)
    .split(',')
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  const source = configured.length ? configured : universe;
  const limit = integer(env.SMART_MONEY_OBSERVATION_LIMIT, 40, 5, 100);
  return [...new Set(source.map((symbol) => String(symbol || '').trim().toUpperCase()))]
    .filter((symbol) => /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol))
    .slice(0, limit);
}

export function smartMoneyObservationDue(now, timeframe = '5m') {
  const config = timeframeConfig(timeframe);
  const minuteBucket = Math.floor(Number(now) / 60_000);
  return config.minutes === 1 || (minuteBucket - 1) % config.minutes === 0;
}

async function fetchObservationBars({ env, now, window, symbols, timeframe, fetchImpl }) {
  const config = timeframeConfig(timeframe);
  const output = Object.fromEntries(symbols.map((symbol) => [symbol, { bars: [], timeframe: config.name, source: 'AUTO_SCANNER_SM_OBSERVATION' }]));
  const start = new Date(now - config.lookbackDays * 86_400_000).toISOString();
  const end = new Date(now).toISOString();

  for (let index = 0; index < symbols.length; index += 30) {
    const batch = symbols.slice(index, index + 30);
    let token = '';
    let pages = 0;
    do {
      const query = new URLSearchParams({
        symbols: batch.join(','),
        timeframe: config.alpaca,
        start,
        end,
        limit: '10000',
        adjustment: 'raw',
        feed: window.dataFeed || 'iex',
        sort: 'asc',
      });
      if (token) query.set('page_token', token);
      const response = await fetchImpl(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
        headers: {
          'APCA-API-KEY-ID': env.ALPACA_KEY_ID,
          'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY,
        },
      });
      if (!response.ok) throw new Error(`Smart Money observation market data failed: ${response.status}`);
      const payload = await response.json();
      for (const [symbol, bars] of Object.entries(payload.bars || {})) {
        if (!output[symbol]) continue;
        output[symbol].bars.push(...parseBars(bars));
      }
      token = payload.next_page_token || '';
      pages += 1;
    } while (token && pages < 4);
  }
  return output;
}

function compactOpportunity(item) {
  const candidate = item.candidate || {};
  return Object.freeze({
    symbol: item.symbol,
    timeframe: candidate.timeframe || null,
    setupFamily: item.setupFamily,
    direction: item.direction,
    setupScore: Number(item.setupScore || 0),
    candidateState: candidate.state || null,
    entry: candidate.entry ?? null,
    stopLoss: candidate.stopLoss ?? null,
    takeProfit: candidate.takeProfit ?? null,
    rewardRisk: candidate.rewardRisk ?? null,
    failedConditions: Array.isArray(item.failedConditions) ? item.failedConditions.slice(0, 8) : [],
    observationOnly: true,
    executionAllowed: false,
  });
}

export async function runSmartMoneyObservation({
  env = {},
  scheduledTime = Date.now(),
  window = {},
  universe = [],
  fetchImpl = fetch,
  evaluator = evaluateSmartMoneyScannerBatch,
} = {}) {
  const now = Number(scheduledTime) || Date.now();
  const timeframe = timeframeConfig(env.SMART_MONEY_OBSERVATION_TIMEFRAME).name;
  const symbols = symbolList(universe, env);
  const base = {
    enabled: env.SMART_MONEY_OBSERVATION_ENABLED === 'true',
    evaluatedAt: new Date(now).toISOString(),
    timeframe,
    session: window.label || 'UNKNOWN',
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  };

  if (!base.enabled) return Object.freeze({ ...base, ok: true, skipped: 'SMART_MONEY_OBSERVATION_DISABLED', topOpportunities: [] });
  if (String(env.WEBULL_LIVE_TRADING || '').toLowerCase() === 'true') {
    return Object.freeze({ ...base, ok: false, skipped: 'LIVE_TRADING_SAFETY_LOCK', topOpportunities: [] });
  }
  if (!window.open) return Object.freeze({ ...base, ok: true, skipped: 'NO_ACTIVE_MARKET_SESSION', topOpportunities: [] });
  if (!smartMoneyObservationDue(now, timeframe)) return Object.freeze({ ...base, ok: true, skipped: 'WAITING_FOR_COMPLETED_OBSERVATION_CANDLE', topOpportunities: [] });
  if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY) {
    return Object.freeze({ ...base, ok: false, skipped: 'ALPACA_MARKET_DATA_SECRETS_MISSING', topOpportunities: [] });
  }
  if (!symbols.length) return Object.freeze({ ...base, ok: false, skipped: 'OBSERVATION_UNIVERSE_EMPTY', topOpportunities: [] });

  const marketDataBySymbol = await fetchObservationBars({ env, now, window, symbols, timeframe, fetchImpl });
  const batch = await evaluator({ symbols, marketDataBySymbol, timeframe, now, limit: symbols.length });
  const topLimit = integer(env.SMART_MONEY_OBSERVATION_TOP_RESULTS, 10, 1, 25);
  const topOpportunities = batch.observations
    .filter((item) => Number(item.setupScore || 0) > 0)
    .slice(0, topLimit)
    .map(compactOpportunity);

  return Object.freeze({
    ...base,
    ok: true,
    requestedSymbols: symbols.length,
    evaluatedSymbols: batch.observations.length,
    rejectedSymbols: batch.rejected.length,
    topOpportunities,
    rejected: batch.rejected.slice(0, 20),
  });
}
