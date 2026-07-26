import { MARKET_SESSIONS, normalizeCandleSeries } from './contracts.js';

const EXCHANGE_TIME_ZONE = 'America/New_York';
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
const TIMEFRAME_MINUTES = Object.freeze({ '1m': 1, '5m': 5, '15m': 15, '1h': 60, '4h': 240, '1d': 1440, '1w': 10080 });

function finite(value, fallback = null) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function mean(values) {
  const finiteValues = values.filter(Number.isFinite);
  return finiteValues.length ? finiteValues.reduce((sum, value) => sum + value, 0) / finiteValues.length : null;
}

function standardDeviation(values) {
  const average = mean(values);
  if (average == null || values.length < 2) return 0;
  const variance = values.reduce((sum, value) => sum + (value - average) ** 2, 0) / (values.length - 1);
  return Math.sqrt(Math.max(variance, 0));
}

function exchangeParts(timestamp) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: EXCHANGE_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday,
    dateKey: `${values.year}-${values.month}-${values.day}`,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function marketSessionAt(timestamp) {
  const parts = exchangeParts(timestamp);
  if (!WEEKDAYS.has(parts.weekday)) return 'CLOSED';
  if (parts.minutes >= 20 * 60 || parts.minutes < 4 * 60) return 'OVERNIGHT';
  if (parts.minutes < 9 * 60 + 30) return 'PREMARKET';
  if (parts.minutes < 16 * 60) return 'REGULAR';
  if (parts.minutes < 20 * 60) return 'AFTER_HOURS';
  return 'CLOSED';
}

export function timeframeMinutes(value) {
  const normalized = text(value).toLowerCase();
  if (TIMEFRAME_MINUTES[normalized]) return TIMEFRAME_MINUTES[normalized];
  const numeric = Math.floor(Number(value));
  if (Number.isFinite(numeric) && numeric > 0 && numeric <= 10080) return numeric;
  throw new Error(`Unsupported liquidity-sweep timeframe: ${value}`);
}

export function inferTickSize(price, supplied = null) {
  const explicit = finite(supplied);
  if (explicit != null && explicit > 0) return explicit;
  const reference = finite(price);
  if (reference == null || reference <= 0) throw new Error('A positive reference price is required to infer tick size');
  return reference < 1 ? 0.0001 : 0.01;
}

export function calculateAtr(candles, period = 14) {
  if (!Array.isArray(candles) || candles.length < period + 1) throw new Error(`ATR requires at least ${period + 1} completed candles`);
  const trueRanges = [];
  for (let index = 1; index < candles.length; index += 1) {
    const candle = candles[index];
    const previousClose = candles[index - 1].close;
    trueRanges.push(Math.max(
      candle.high - candle.low,
      Math.abs(candle.high - previousClose),
      Math.abs(candle.low - previousClose),
    ));
  }
  return Number(mean(trueRanges.slice(-period)).toFixed(8));
}

export function calculateRelativeVolume(candles, lookback = 20) {
  if (!Array.isArray(candles) || candles.length < 2) return null;
  const latest = candles.at(-1).volume;
  const baseline = mean(candles.slice(-(lookback + 1), -1).map((candle) => candle.volume));
  if (!(baseline > 0)) return null;
  return Number((latest / baseline).toFixed(4));
}

export function calculateSessionRelativeVolume(candles, {
  minimumSamples = 3,
  maximumSessions = 20,
} = {}) {
  const values = Array.isArray(candles) ? candles : [];
  const latest = values.at(-1);
  if (!latest || !(finite(latest.timestamp) > 0) || !Number.isFinite(finite(latest.volume))) {
    return Object.freeze({
      value: null,
      method: 'SESSION_TIME_NORMALIZED',
      available: false,
      reason: 'LATEST_COMPLETED_CANDLE_UNAVAILABLE',
      latestVolume: null,
      baselineVolume: null,
      sampleCount: 0,
      session: null,
      slotMinutes: null,
      dateKey: null,
      baselineDates: [],
    });
  }

  const required = Math.max(2, Math.min(20, Math.floor(Number(minimumSamples) || 3)));
  const limit = Math.max(required, Math.min(60, Math.floor(Number(maximumSessions) || 20)));
  const latestParts = exchangeParts(latest.timestamp);
  const byDate = new Map();
  for (let index = values.length - 2; index >= 0; index -= 1) {
    const candle = values[index];
    if (candle.session !== latest.session) continue;
    const parts = exchangeParts(candle.timestamp);
    if (parts.dateKey === latestParts.dateKey || parts.minutes !== latestParts.minutes) continue;
    if (!Number.isFinite(finite(candle.volume)) || candle.volume < 0) continue;
    if (!byDate.has(parts.dateKey)) byDate.set(parts.dateKey, candle.volume);
    if (byDate.size >= limit) break;
  }

  const samples = [...byDate.entries()];
  const baselineVolume = mean(samples.map(([, volume]) => volume));
  const available = samples.length >= required && baselineVolume > 0;
  return Object.freeze({
    value: available ? Number((latest.volume / baselineVolume).toFixed(4)) : null,
    method: 'SESSION_TIME_NORMALIZED',
    available,
    reason: available ? 'SESSION_SLOT_BASELINE_AVAILABLE' : 'INSUFFICIENT_SESSION_SLOT_HISTORY',
    latestVolume: latest.volume,
    baselineVolume: baselineVolume == null ? null : Number(baselineVolume.toFixed(4)),
    sampleCount: samples.length,
    requiredSamples: required,
    maximumSessions: limit,
    session: latest.session,
    slotMinutes: latestParts.minutes,
    dateKey: latestParts.dateKey,
    baselineDates: samples.map(([dateKey]) => dateKey),
  });
}

export function calculateRealizedVolatility(candles, lookback = 20) {
  if (!Array.isArray(candles) || candles.length < 3) return null;
  const closes = candles.slice(-(lookback + 1)).map((candle) => candle.close);
  const returns = [];
  for (let index = 1; index < closes.length; index += 1) {
    if (closes[index] > 0 && closes[index - 1] > 0) returns.push(Math.log(closes[index] / closes[index - 1]));
  }
  if (returns.length < 2) return 0;
  return Number((standardDeviation(returns) * Math.sqrt(returns.length) * 100).toFixed(4));
}

function spreadMetrics(bid, ask) {
  const normalizedBid = finite(bid);
  const normalizedAsk = finite(ask);
  if (normalizedBid == null && normalizedAsk == null) return { bid: null, ask: null, spread: null, spreadPercent: null };
  if (!(normalizedBid > 0) || !(normalizedAsk > 0) || normalizedAsk < normalizedBid) {
    throw new Error('Bid and ask must be positive and ask must not be below bid');
  }
  const midpoint = (normalizedBid + normalizedAsk) / 2;
  const spread = normalizedAsk - normalizedBid;
  return {
    bid: normalizedBid,
    ask: normalizedAsk,
    spread: Number(spread.toFixed(8)),
    spreadPercent: Number((spread / midpoint * 100).toFixed(6)),
  };
}

function normalizeRawBar(bar, timeframeMs, now, source) {
  const timestamp = finite(bar.timestamp ?? bar.t);
  if (!(timestamp > 0)) throw new Error('Every market-data bar requires a positive timestamp');
  const declaredComplete = bar.complete !== false;
  const timeComplete = timestamp + timeframeMs <= now;
  if (!declaredComplete || !timeComplete) return null;
  const session = text(bar.session).toUpperCase() || marketSessionAt(timestamp);
  if (!MARKET_SESSIONS.includes(session)) throw new Error(`Unsupported market session: ${session}`);
  return {
    timestamp,
    open: bar.open ?? bar.o,
    high: bar.high ?? bar.h,
    low: bar.low ?? bar.l,
    close: bar.close ?? bar.c,
    volume: bar.volume ?? bar.v ?? 0,
    session,
    complete: true,
    source: text(bar.source, source).slice(0, 64),
  };
}

function missingBarCount(candles, timeframeMs) {
  let missing = 0;
  for (let index = 1; index < candles.length; index += 1) {
    const previous = candles[index - 1];
    const current = candles[index];
    const previousParts = exchangeParts(previous.timestamp);
    const currentParts = exchangeParts(current.timestamp);
    if (previous.session !== current.session || previousParts.dateKey !== currentParts.dateKey) continue;
    const distance = current.timestamp - previous.timestamp;
    if (distance > timeframeMs * 1.5) missing += Math.max(0, Math.round(distance / timeframeMs) - 1);
  }
  return missing;
}

export function normalizeMarketData({
  bars,
  timeframe,
  now = Date.now(),
  source = 'UNKNOWN',
  bid = null,
  ask = null,
  tickSize = null,
  config,
} = {}) {
  if (!config?.dataQuality || !config?.risk) throw new Error('Validated liquidity-sweep configuration is required');
  if (!Array.isArray(bars) || bars.length === 0) throw new Error('Market-data bars are required');
  const currentTime = now instanceof Date ? now.getTime() : Number(now);
  if (!Number.isFinite(currentTime)) throw new Error('now must be a valid timestamp');
  const minutes = timeframeMinutes(timeframe);
  const timeframeMs = minutes * 60_000;
  const eligible = [];
  let excludedIncompleteBars = 0;
  for (const bar of bars) {
    const normalized = normalizeRawBar(bar, timeframeMs, currentTime, source);
    if (normalized) eligible.push(normalized);
    else excludedIncompleteBars += 1;
  }
  const candles = normalizeCandleSeries(eligible);
  if (candles.length < config.dataQuality.minimumBars) {
    throw new Error(`Insufficient completed candles: ${candles.length} < ${config.dataQuality.minimumBars}`);
  }

  const latest = candles.at(-1);
  const dataDelaySeconds = Math.max(0, (currentTime - (latest.timestamp + timeframeMs)) / 1000);
  if (dataDelaySeconds > config.dataQuality.maximumDelaySeconds) {
    throw new Error(`Market data is delayed by ${Math.round(dataDelaySeconds)} seconds`);
  }

  const missingBars = missingBarCount(candles, timeframeMs);
  if (missingBars > config.dataQuality.maximumMissingBars) {
    throw new Error(`Market data has ${missingBars} missing bars, above the configured maximum`);
  }

  const recentVolume = candles.slice(-Math.max(config.dataQuality.volumeLookback, 5)).map((candle) => candle.volume);
  const zeroVolumeBars = recentVolume.filter((volume) => volume === 0).length;
  if (config.dataQuality.rejectZeroVolume && (latest.volume === 0 || zeroVolumeBars === recentVolume.length)) {
    throw new Error('Recent market data has unreliable zero volume');
  }

  const atr = calculateAtr(candles, config.dataQuality.atrPeriod);
  const sessionRelativeVolume = calculateSessionRelativeVolume(candles, {
    minimumSamples: 3,
    maximumSessions: Math.max(3, Math.min(30, Number(config.dataQuality.volumeLookback) || 20)),
  });
  const fallbackRelativeVolume = calculateRelativeVolume(candles, config.dataQuality.volumeLookback);
  const relativeVolume = sessionRelativeVolume.available ? sessionRelativeVolume.value : fallbackRelativeVolume;
  const relativeVolumeMethod = sessionRelativeVolume.available
    ? 'SESSION_TIME_NORMALIZED'
    : 'RECENT_COMPLETED_CANDLE_LOOKBACK';
  const relativeVolumeDetails = Object.freeze({
    ...sessionRelativeVolume,
    value: relativeVolume,
    method: relativeVolumeMethod,
    fallbackUsed: !sessionRelativeVolume.available,
    fallbackReason: sessionRelativeVolume.available ? null : sessionRelativeVolume.reason,
    fallbackLookbackBars: sessionRelativeVolume.available ? null : config.dataQuality.volumeLookback,
  });
  const realizedVolatilityPercent = calculateRealizedVolatility(candles, config.dataQuality.realizedVolatilityLookback);
  const spread = spreadMetrics(bid, ask);
  if (spread.spreadPercent != null && spread.spreadPercent > config.risk.maximumSpreadPercent) {
    throw new Error(`Spread ${spread.spreadPercent}% exceeds ${config.risk.maximumSpreadPercent}%`);
  }
  const normalizedTickSize = inferTickSize(latest.close, tickSize);
  const dataQualityScore = clamp(Math.round(
    100
    - Math.min(35, dataDelaySeconds / Math.max(config.dataQuality.maximumDelaySeconds, 1) * 35)
    - Math.min(25, missingBars * 10)
    - Math.min(20, zeroVolumeBars / recentVolume.length * 20)
    - Math.min(20, spread.spreadPercent == null ? 5 : spread.spreadPercent / Math.max(config.risk.maximumSpreadPercent, 0.0001) * 20)
  ), 0, 100);

  return Object.freeze({
    timeframe: text(timeframe).toLowerCase(),
    timeframeMinutes: minutes,
    timeframeMs,
    exchangeTimeZone: EXCHANGE_TIME_ZONE,
    normalizedAt: new Date(currentTime).toISOString(),
    source: text(source, 'UNKNOWN'),
    candles,
    latest,
    session: latest.session,
    tickSize: normalizedTickSize,
    atr,
    relativeVolume,
    relativeVolumeMethod,
    relativeVolumeDetails,
    realizedVolatilityPercent,
    spread,
    quality: Object.freeze({
      accepted: true,
      score: dataQualityScore,
      dataDelaySeconds: Number(dataDelaySeconds.toFixed(3)),
      missingBars,
      zeroVolumeBars,
      excludedIncompleteBars,
      completedBars: candles.length,
    }),
  });
}
