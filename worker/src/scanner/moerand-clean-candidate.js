import {
  MOERAND_CLEAN_STRATEGY_ID,
  evaluateMoerandClean,
  normalizeMoerandCleanSettings,
} from '../strategies/moerand-clean.js';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 4) {
  return Number(finite(value).toFixed(digits));
}

export function moerandCleanScannerEnabled(env = {}) {
  return text(env.MOE_ACTIVE_STRATEGY).toUpperCase() === MOERAND_CLEAN_STRATEGY_ID;
}

export function moerandCleanSettingsFromEnv(env = {}, timeframeMinutes = null) {
  return normalizeMoerandCleanSettings({
    keyValue: env.MOERAND_CLEAN_KEY_VALUE ?? env.MOERAND_CLEAN_ATR_MULT,
    atrPeriod: env.MOERAND_CLEAN_ATR_PERIOD,
    useHeikinAshi: env.MOERAND_CLEAN_USE_HEIKIN_ASHI,
    timeframeMinutes: timeframeMinutes ?? env.MOERAND_CLEAN_TIMEFRAME_MINUTES,
    sessionWindow: env.MOERAND_CLEAN_SESSION_WINDOW,
    sessionTimezone: env.MOERAND_CLEAN_SESSION_TIMEZONE,
  });
}

export function createMoerandCleanCandidate({
  symbol,
  bars = [],
  now = Date.now(),
  profile = {},
  env = {},
} = {}) {
  const timeframeMinutes = Math.max(1, Math.min(15, Math.trunc(Number(
    profile.primaryMinutes ?? env.MOERAND_CLEAN_TIMEFRAME_MINUTES ?? 5,
  )) || 5));
  const settings = moerandCleanSettingsFromEnv(env, timeframeMinutes);
  const timeframeMs = settings.timeframeMinutes * 60_000;
  const complete = (Array.isArray(bars) ? bars : [])
    .filter((bar) => Number(bar?.t) + timeframeMs <= now)
    .slice(-2_000);
  if (complete.length < settings.atrPeriod + 2) return null;

  const evaluated = evaluateMoerandClean(complete, settings, {
    allCandlesClosed: true,
    now,
  });
  if (evaluated.signal !== 'BUY') return null;

  const entry = finite(evaluated.entryPrice);
  const stopLoss = finite(evaluated.stopLevel);
  const risk = Math.max(entry - stopLoss, 0.01);
  const targetR = Math.max(0.5, finite(env.MOE_AI_MIN_RISK_REWARD, 2));
  if (!(entry > 0 && stopLoss > 0 && stopLoss < entry)) return null;

  const higherMinutes = Number(profile.higherMinutes) || (settings.timeframeMinutes < 15 ? 15 : 60);
  return {
    symbol: text(symbol).toUpperCase(),
    barTime: evaluated.signalBarTime,
    entry: round(entry),
    stopLoss: round(stopLoss),
    takeProfit: round(entry + risk * targetR),
    score: Math.max(70, finite(env.MOERAND_CLEAN_SCANNER_SCORE, 80)),
    relativeVolume: null,
    atr: evaluated.diagnostics?.atr ?? null,
    reason: 'MOERAND_CLEAN_UT_BOT_CLOSED_BAR_BUY',
    timeframe: `${settings.timeframeMinutes}m`,
    higherTimeframe: higherMinutes >= 60 ? `${higherMinutes / 60}h` : `${higherMinutes}m`,
    profile: `${settings.timeframeMinutes}m->${higherMinutes >= 60 ? `${higherMinutes / 60}h` : `${higherMinutes}m`}`,
    htfAligned: true,
    sourceStrategy: MOERAND_CLEAN_STRATEGY_ID,
    signalTiming: 'CANDLE_CLOSE_ONLY',
    candleSource: settings.useHeikinAshi ? 'HEIKIN_ASHI_CLOSE' : 'REGULAR_CLOSE',
    strategySettings: settings,
  };
}
