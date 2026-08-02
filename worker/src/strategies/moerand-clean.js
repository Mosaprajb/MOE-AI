// MOERAND Clean — closed-bar, regular-session, LONG-only spot-equity strategy.
//
// This module is deliberately pure. It has no broker, storage, risk, fusion, or dashboard
// dependencies. The caller supplies fully formed candles plus the previously persisted state.
// The evaluator returns timing intent only; every portfolio/risk/execution gate remains external.

export const MOERAND_CLEAN_STRATEGY_ID = 'MOERAND_CLEAN_INTERNAL';
export const MOERAND_CLEAN_SOURCE_TYPE = 'INTERNAL_PIPELINE';

export const MOERAND_CLEAN_DEFAULTS = Object.freeze({
  trendLen: 50,
  breakoutLen: 20,
  minRvol: 1.2,
  rvolPeriod: 20,
  atrPeriod: 2,
  atrMult: 1,
  enableBreakeven: true,
  sessionWindow: '0930-1600',
  sessionTimezone: 'America/New_York',
  timeframeMinutes: 5,
});

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInteger(value, fallback, minimum = 1, maximum = 10_000) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function positive(value, fallback, minimum = Number.EPSILON) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function boolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function firstDefined(source, keys, fallback) {
  for (const key of keys) {
    if (source?.[key] != null && source[key] !== '') return source[key];
  }
  return fallback;
}

export function normalizeMoerandCleanSettings(input = {}) {
  const defaults = MOERAND_CLEAN_DEFAULTS;
  return Object.freeze({
    trendLen: boundedInteger(firstDefined(input, ['trendLen', 'MOERAND_CLEAN_TREND_LEN'], defaults.trendLen), defaults.trendLen, 2, 500),
    breakoutLen: boundedInteger(firstDefined(input, ['breakoutLen', 'MOERAND_CLEAN_BREAKOUT_LEN'], defaults.breakoutLen), defaults.breakoutLen, 2, 500),
    minRvol: positive(firstDefined(input, ['minRvol', 'MOERAND_CLEAN_MIN_RVOL'], defaults.minRvol), defaults.minRvol, 0),
    rvolPeriod: boundedInteger(firstDefined(input, ['rvolPeriod', 'MOERAND_CLEAN_RVOL_PERIOD'], defaults.rvolPeriod), defaults.rvolPeriod, 2, 500),
    atrPeriod: boundedInteger(firstDefined(input, ['atrPeriod', 'MOERAND_CLEAN_ATR_PERIOD'], defaults.atrPeriod), defaults.atrPeriod, 1, 500),
    atrMult: positive(firstDefined(input, ['atrMult', 'MOERAND_CLEAN_ATR_MULT'], defaults.atrMult), defaults.atrMult),
    enableBreakeven: boolean(firstDefined(input, ['enableBreakeven', 'MOERAND_CLEAN_ENABLE_BREAKEVEN'], defaults.enableBreakeven), defaults.enableBreakeven),
    sessionWindow: normalizeSessionWindow(firstDefined(input, ['sessionWindow', 'MOERAND_CLEAN_SESSION_WINDOW'], defaults.sessionWindow)),
    sessionTimezone: text(firstDefined(input, ['sessionTimezone', 'MOERAND_CLEAN_SESSION_TIMEZONE'], defaults.sessionTimezone), defaults.sessionTimezone),
    timeframeMinutes: boundedInteger(firstDefined(input, ['timeframeMinutes', 'MOERAND_CLEAN_TIMEFRAME_MINUTES'], defaults.timeframeMinutes), defaults.timeframeMinutes, 1, 240),
  });
}

function normalizeSessionWindow(value) {
  const normalized = text(value, MOERAND_CLEAN_DEFAULTS.sessionWindow).replace(/[^0-9-]/g, '');
  if (!/^\d{4}-\d{4}$/.test(normalized)) return MOERAND_CLEAN_DEFAULTS.sessionWindow;
  const [start, end] = normalized.split('-').map(clockMinutes);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? normalized
    : MOERAND_CLEAN_DEFAULTS.sessionWindow;
}

function clockMinutes(value) {
  const normalized = String(value || '').padStart(4, '0');
  const hour = Number(normalized.slice(0, 2));
  const minute = Number(normalized.slice(2, 4));
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return NaN;
  return hour * 60 + minute;
}

function sessionBounds(settings) {
  const [start, end] = settings.sessionWindow.split('-');
  return { startMinutes: clockMinutes(start), endMinutes: clockMinutes(end) };
}

function normalizeTimestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return new Date(value).getTime();
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
}

function normalizeCandle(candle = {}) {
  const normalized = {
    t: normalizeTimestamp(candle.t ?? candle.timestamp ?? candle.time),
    o: Number(candle.o ?? candle.open),
    h: Number(candle.h ?? candle.high),
    l: Number(candle.l ?? candle.low),
    c: Number(candle.c ?? candle.close),
    v: Number(candle.v ?? candle.volume ?? 0),
    explicitlyClosed: candle.closed !== false && candle.isClosed !== false && candle.complete !== false,
  };
  const pricesValid = [normalized.t, normalized.o, normalized.h, normalized.l, normalized.c, normalized.v].every(Number.isFinite);
  if (!pricesValid || normalized.h < normalized.l || normalized.v < 0) return null;
  return normalized;
}

function zonedParts(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    weekday: values.weekday,
    hour: Number(values.hour),
    minute: Number(values.minute),
  };
}

function sessionKeyFor(timestamp, timeZone) {
  const parts = zonedParts(timestamp, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function sessionBarInfo(bar, settings) {
  const parts = zonedParts(bar.t, settings.sessionTimezone);
  const minutes = parts.hour * 60 + parts.minute;
  const { startMinutes, endMinutes } = sessionBounds(settings);
  const regularWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(parts.weekday);
  const inSession = regularWeekday
    && minutes >= startMinutes
    && minutes + settings.timeframeMinutes <= endMinutes;
  return {
    sessionKey: `${parts.year}-${parts.month}-${parts.day}`,
    minutes,
    inSession,
    firstBar: minutes === startMinutes,
    finalBar: inSession && minutes + settings.timeframeMinutes >= endMinutes,
  };
}

function simpleAverage(values) {
  if (!values.length || values.some((value) => !Number.isFinite(value))) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emaAt(values, length, index) {
  if (index < length - 1) return null;
  let ema = simpleAverage(values.slice(0, length));
  if (!Number.isFinite(ema)) return null;
  const alpha = 2 / (length + 1);
  for (let cursor = length; cursor <= index; cursor += 1) {
    ema = values[cursor] * alpha + ema * (1 - alpha);
  }
  return ema;
}

function trueRange(current, previous) {
  if (!previous) return current.h - current.l;
  return Math.max(
    current.h - current.l,
    Math.abs(current.h - previous.c),
    Math.abs(current.l - previous.c),
  );
}

function atrAt(bars, period, index) {
  if (index < period - 1) return null;
  const ranges = bars.slice(0, index + 1).map((bar, cursor) => trueRange(bar, bars[cursor - 1]));
  let atr = simpleAverage(ranges.slice(0, period));
  if (!Number.isFinite(atr)) return null;
  for (let cursor = period; cursor <= index; cursor += 1) {
    atr = ((atr * (period - 1)) + ranges[cursor]) / period;
  }
  return atr;
}

function highestPrior(bars, length, index) {
  if (index < length) return null;
  const highs = bars.slice(index - length, index).map((bar) => bar.h);
  return highs.length === length ? Math.max(...highs) : null;
}

function rvolAt(bars, period, index) {
  if (index < period - 1) return null;
  const average = simpleAverage(bars.slice(index - period + 1, index + 1).map((bar) => bar.v));
  if (!Number.isFinite(average) || average <= 0) return null;
  return bars[index].v / average;
}

function emptyState() {
  return {
    inPosition: false,
    entryPrice: null,
    stopLevel: null,
    initialRisk: null,
    breakevenLocked: false,
    sessionKey: null,
    sessionBarsCompleted: 0,
    lastEvaluatedBarTime: null,
    lastSignal: 'NONE',
    lastExitReason: null,
  };
}

function normalizedState(previousState = {}) {
  const state = emptyState();
  const inPosition = previousState?.inPosition === true;
  return {
    ...state,
    inPosition,
    entryPrice: inPosition && Number.isFinite(Number(previousState.entryPrice)) ? Number(previousState.entryPrice) : null,
    stopLevel: inPosition && Number.isFinite(Number(previousState.stopLevel)) ? Number(previousState.stopLevel) : null,
    initialRisk: inPosition && Number.isFinite(Number(previousState.initialRisk)) ? Number(previousState.initialRisk) : null,
    breakevenLocked: inPosition && previousState.breakevenLocked === true,
    sessionKey: text(previousState.sessionKey) || null,
    sessionBarsCompleted: Math.max(0, Math.trunc(finite(previousState.sessionBarsCompleted, 0))),
    lastEvaluatedBarTime: Number.isFinite(Number(previousState.lastEvaluatedBarTime))
      ? Number(previousState.lastEvaluatedBarTime)
      : null,
    lastSignal: text(previousState.lastSignal, 'NONE').toUpperCase(),
    lastExitReason: text(previousState.lastExitReason) || null,
  };
}

function resetForSession(state, sessionKey) {
  state.inPosition = false;
  state.entryPrice = null;
  state.stopLevel = null;
  state.initialRisk = null;
  state.breakevenLocked = false;
  state.sessionKey = sessionKey;
  state.sessionBarsCompleted = 0;
  state.lastSignal = 'NONE';
  state.lastExitReason = null;
}

function publicPrice(value) {
  if (value == null || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(6)) : null;
}

function eventResult(state, diagnostics, event = {}) {
  const signal = event.signal || 'NONE';
  return {
    strategy: MOERAND_CLEAN_STRATEGY_ID,
    sourceType: MOERAND_CLEAN_SOURCE_TYPE,
    signal,
    stopLevel: publicPrice(state.stopLevel),
    entryPrice: publicPrice(state.entryPrice),
    initialRisk: publicPrice(state.initialRisk),
    breakevenLocked: state.breakevenLocked === true,
    exitReason: event.exitReason || null,
    exitPrice: publicPrice(event.exitPrice),
    signalBarTime: event.signalBarTime ?? null,
    state: Object.freeze({ ...state }),
    diagnostics: Object.freeze({ ...diagnostics }),
  };
}

export function evaluateMoerandClean(candles = [], settingsInput = {}, sessionContext = {}) {
  const settings = normalizeMoerandCleanSettings(settingsInput);
  const timeframeMs = settings.timeframeMinutes * 60_000;
  const cutoff = normalizeTimestamp(sessionContext.now ?? sessionContext.evaluatedAt ?? Date.now());
  const allCandlesClosed = sessionContext.allCandlesClosed === true;
  const normalized = (Array.isArray(candles) ? candles : [])
    .map(normalizeCandle)
    .filter(Boolean)
    .filter((bar) => bar.explicitlyClosed)
    .filter((bar) => allCandlesClosed || bar.t + timeframeMs <= cutoff)
    .sort((left, right) => left.t - right.t)
    .filter((bar, index, all) => index === all.length - 1 || bar.t !== all[index + 1].t);

  const regularBars = normalized.filter((bar) => sessionBarInfo(bar, settings).inSession);
  const state = normalizedState(sessionContext.previousState || sessionContext.state || {});
  if (!regularBars.length) {
    return eventResult(state, {
      status: 'NO_CLOSED_REGULAR_SESSION_BARS',
      settings,
      evaluatedBars: 0,
    });
  }

  const pending = state.lastEvaluatedBarTime == null
    ? [regularBars.at(-1)]
    : regularBars.filter((bar) => bar.t > state.lastEvaluatedBarTime);

  if (!pending.length) {
    return eventResult(state, {
      status: 'NO_NEW_CLOSED_BAR',
      settings,
      evaluatedBars: 0,
      latestClosedBarTime: regularBars.at(-1).t,
    });
  }

  let emitted = { signal: 'NONE', exitReason: null, exitPrice: null, signalBarTime: null };
  let latestDiagnostics = {};

  for (const bar of pending) {
    const index = regularBars.findIndex((candidate) => candidate.t === bar.t);
    if (index < 0) continue;
    const info = sessionBarInfo(bar, settings);
    const sessionChanged = state.sessionKey !== info.sessionKey;
    if (sessionChanged) resetForSession(state, info.sessionKey);

    if (state.lastEvaluatedBarTime == null && state.sessionBarsCompleted === 0 && !info.firstBar) {
      state.sessionBarsCompleted = regularBars.slice(0, index)
        .filter((candidate) => sessionKeyFor(candidate.t, settings.sessionTimezone) === info.sessionKey)
        .length;
    }

    const closes = regularBars.map((candidate) => candidate.c);
    const trendEma = emaAt(closes, settings.trendLen, index);
    const priorBreakoutHigh = highestPrior(regularBars, settings.breakoutLen, index);
    const relativeVolume = rvolAt(regularBars, settings.rvolPeriod, index);
    const atr = atrAt(regularBars, settings.atrPeriod, index);
    const firstSessionBar = state.sessionBarsCompleted === 0 || info.firstBar;

    const trendPassed = Number.isFinite(trendEma) && bar.c > trendEma;
    const breakoutPassed = Number.isFinite(priorBreakoutHigh) && bar.c > priorBreakoutHigh;
    const rvolPassed = Number.isFinite(relativeVolume) && relativeVolume >= settings.minRvol;
    const indicatorsReady = [trendEma, priorBreakoutHigh, relativeVolume, atr].every(Number.isFinite);

    emitted = { signal: 'NONE', exitReason: null, exitPrice: null, signalBarTime: null };

    if (state.inPosition) {
      const candidateStop = Number.isFinite(atr)
        ? bar.c - atr * settings.atrMult
        : state.stopLevel;
      if (Number.isFinite(candidateStop)) {
        state.stopLevel = Number.isFinite(state.stopLevel)
          ? Math.max(state.stopLevel, candidateStop)
          : candidateStop;
      }

      if (
        settings.enableBreakeven
        && !state.breakevenLocked
        && Number.isFinite(state.initialRisk)
        && bar.c - state.entryPrice >= state.initialRisk
      ) {
        state.breakevenLocked = true;
      }
      if (state.breakevenLocked && Number.isFinite(state.entryPrice)) {
        state.stopLevel = Number.isFinite(state.stopLevel)
          ? Math.max(state.stopLevel, state.entryPrice)
          : state.entryPrice;
      }

      if (info.finalBar) {
        emitted = {
          signal: 'SELL',
          exitReason: 'SESSION_END_FORCED_CLOSE',
          exitPrice: bar.c,
          signalBarTime: bar.t,
        };
        state.inPosition = false;
        state.entryPrice = null;
        state.stopLevel = null;
        state.initialRisk = null;
        state.breakevenLocked = false;
      } else if (Number.isFinite(state.stopLevel) && bar.c < state.stopLevel) {
        emitted = {
          signal: 'SELL',
          exitReason: 'TRAILING_STOP_CLOSE',
          exitPrice: bar.c,
          signalBarTime: bar.t,
        };
        state.inPosition = false;
        state.entryPrice = null;
        state.stopLevel = null;
        state.initialRisk = null;
        state.breakevenLocked = false;
      }
    } else if (!firstSessionBar && !info.finalBar && indicatorsReady && trendPassed && breakoutPassed && rvolPassed) {
      const initialRisk = atr * settings.atrMult;
      state.inPosition = true;
      state.entryPrice = bar.c;
      state.initialRisk = initialRisk;
      state.stopLevel = bar.c - initialRisk;
      state.breakevenLocked = false;
      emitted = {
        signal: 'BUY',
        exitReason: null,
        exitPrice: null,
        signalBarTime: bar.t,
      };
    }

    state.sessionBarsCompleted += 1;
    state.lastEvaluatedBarTime = bar.t;
    state.lastSignal = emitted.signal;
    state.lastExitReason = emitted.exitReason;

    latestDiagnostics = {
      status: emitted.signal === 'NONE' ? (indicatorsReady ? 'NO_SIGNAL' : 'WARMING_UP') : emitted.signal,
      settings,
      sessionKey: info.sessionKey,
      firstSessionBar,
      finalSessionBar: info.finalBar,
      closedBarTime: bar.t,
      close: publicPrice(bar.c),
      trendEma: publicPrice(trendEma),
      priorBreakoutHigh: publicPrice(priorBreakoutHigh),
      relativeVolume: publicPrice(relativeVolume),
      atr: publicPrice(atr),
      trendPassed,
      breakoutPassed,
      rvolPassed,
      indicatorsReady,
      entryGate: trendPassed && breakoutPassed && rvolPassed,
      fullyClosedOnly: true,
      longOnly: true,
      spotEquitiesOnly: true,
    };
  }

  return eventResult(state, {
    ...latestDiagnostics,
    evaluatedBars: pending.length,
  }, emitted);
}

export function isValidMoerandCleanSymbol(value) {
  return TICKER_RE.test(text(value).toUpperCase());
}
