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

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback, minimum = 1, maximum = 10_000) {
  const parsed = Math.trunc(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function positive(value, fallback, minimum = Number.EPSILON) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= minimum ? parsed : fallback;
}

function bool(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function first(source, keys, fallback) {
  for (const key of keys) {
    if (source?.[key] != null && source[key] !== '') return source[key];
  }
  return fallback;
}

function clockMinutes(value) {
  const token = String(value || '').padStart(4, '0');
  const hour = Number(token.slice(0, 2));
  const minute = Number(token.slice(2, 4));
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || hour > 23 || minute > 59) return NaN;
  return hour * 60 + minute;
}

function sessionWindow(value) {
  const normalized = text(value, MOERAND_CLEAN_DEFAULTS.sessionWindow).replace(/[^0-9-]/g, '');
  if (!/^\d{4}-\d{4}$/.test(normalized)) return MOERAND_CLEAN_DEFAULTS.sessionWindow;
  const [start, end] = normalized.split('-').map(clockMinutes);
  return Number.isFinite(start) && Number.isFinite(end) && end > start
    ? normalized
    : MOERAND_CLEAN_DEFAULTS.sessionWindow;
}

export function normalizeMoerandCleanSettings(input = {}) {
  const defaults = MOERAND_CLEAN_DEFAULTS;
  return Object.freeze({
    trendLen: integer(first(input, ['trendLen', 'MOERAND_CLEAN_TREND_LEN'], defaults.trendLen), defaults.trendLen, 2, 500),
    breakoutLen: integer(first(input, ['breakoutLen', 'MOERAND_CLEAN_BREAKOUT_LEN'], defaults.breakoutLen), defaults.breakoutLen, 2, 500),
    minRvol: positive(first(input, ['minRvol', 'MOERAND_CLEAN_MIN_RVOL'], defaults.minRvol), defaults.minRvol, 0),
    rvolPeriod: integer(first(input, ['rvolPeriod', 'MOERAND_CLEAN_RVOL_PERIOD'], defaults.rvolPeriod), defaults.rvolPeriod, 2, 500),
    atrPeriod: integer(first(input, ['atrPeriod', 'MOERAND_CLEAN_ATR_PERIOD'], defaults.atrPeriod), defaults.atrPeriod, 1, 500),
    atrMult: positive(first(input, ['atrMult', 'MOERAND_CLEAN_ATR_MULT'], defaults.atrMult), defaults.atrMult),
    enableBreakeven: bool(first(input, ['enableBreakeven', 'MOERAND_CLEAN_ENABLE_BREAKEVEN'], defaults.enableBreakeven), defaults.enableBreakeven),
    sessionWindow: sessionWindow(first(input, ['sessionWindow', 'MOERAND_CLEAN_SESSION_WINDOW'], defaults.sessionWindow)),
    sessionTimezone: text(first(input, ['sessionTimezone', 'MOERAND_CLEAN_SESSION_TIMEZONE'], defaults.sessionTimezone), defaults.sessionTimezone),
    timeframeMinutes: integer(first(input, ['timeframeMinutes', 'MOERAND_CLEAN_TIMEFRAME_MINUTES'], defaults.timeframeMinutes), defaults.timeframeMinutes, 1, 240),
  });
}

function timestamp(value) {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) return new Date(value).getTime();
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed < 10_000_000_000 ? parsed * 1_000 : parsed;
}

function candle(value = {}) {
  const output = {
    t: timestamp(value.t ?? value.timestamp ?? value.time),
    o: Number(value.o ?? value.open),
    h: Number(value.h ?? value.high),
    l: Number(value.l ?? value.low),
    c: Number(value.c ?? value.close),
    v: Number(value.v ?? value.volume ?? 0),
    closed: value.closed !== false && value.isClosed !== false && value.complete !== false,
  };
  return [output.t, output.o, output.h, output.l, output.c, output.v].every(Number.isFinite)
    && output.h >= output.l
    && output.v >= 0
    ? output
    : null;
}

function zoned(timestampValue, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestampValue));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    key: `${values.year}-${values.month}-${values.day}`,
    weekday: values.weekday,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

function barSessionInfo(bar, settings) {
  const local = zoned(bar.t, settings.sessionTimezone);
  const [startToken, endToken] = settings.sessionWindow.split('-');
  const start = clockMinutes(startToken);
  const end = clockMinutes(endToken);
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(local.weekday);
  const inSession = weekday && local.minutes >= start && local.minutes + settings.timeframeMinutes <= end;
  return {
    sessionKey: local.key,
    inSession,
    firstBar: inSession && local.minutes === start,
    finalBar: inSession && local.minutes + settings.timeframeMinutes >= end,
  };
}

function average(values) {
  return values.length && values.every(Number.isFinite)
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function ema(values, length) {
  if (values.length < length) return null;
  let current = average(values.slice(0, length));
  const alpha = 2 / (length + 1);
  for (let index = length; index < values.length; index += 1) {
    current = values[index] * alpha + current * (1 - alpha);
  }
  return current;
}

function trueRange(current, previous) {
  if (!previous) return current.h - current.l;
  return Math.max(current.h - current.l, Math.abs(current.h - previous.c), Math.abs(current.l - previous.c));
}

function atr(bars, period) {
  if (bars.length < period) return null;
  const ranges = bars.map((bar, index) => trueRange(bar, bars[index - 1]));
  let current = average(ranges.slice(0, period));
  for (let index = period; index < ranges.length; index += 1) {
    current = ((current * (period - 1)) + ranges[index]) / period;
  }
  return current;
}

function priorHigh(bars, length) {
  if (bars.length <= length) return null;
  return Math.max(...bars.slice(-(length + 1), -1).map((bar) => bar.h));
}

function rvol(bars, period) {
  if (bars.length < period) return null;
  const sample = bars.slice(-period);
  const mean = average(sample.map((bar) => bar.v));
  return Number.isFinite(mean) && mean > 0 ? sample.at(-1).v / mean : null;
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

function stateFrom(value = {}) {
  const inPosition = value.inPosition === true;
  return {
    ...emptyState(),
    inPosition,
    entryPrice: inPosition && Number.isFinite(Number(value.entryPrice)) ? Number(value.entryPrice) : null,
    stopLevel: inPosition && Number.isFinite(Number(value.stopLevel)) ? Number(value.stopLevel) : null,
    initialRisk: inPosition && Number.isFinite(Number(value.initialRisk)) ? Number(value.initialRisk) : null,
    breakevenLocked: inPosition && value.breakevenLocked === true,
    sessionKey: text(value.sessionKey) || null,
    sessionBarsCompleted: Math.max(0, Math.trunc(finite(value.sessionBarsCompleted))),
    lastEvaluatedBarTime: Number.isFinite(Number(value.lastEvaluatedBarTime)) ? Number(value.lastEvaluatedBarTime) : null,
    lastSignal: text(value.lastSignal, 'NONE').toUpperCase(),
    lastExitReason: text(value.lastExitReason) || null,
  };
}

function reset(state, sessionKey) {
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

function price(value) {
  if (value == null || value === '') return null;
  return Number.isFinite(Number(value)) ? Number(Number(value).toFixed(6)) : null;
}

function response(state, diagnostics, event = {}) {
  return {
    strategy: MOERAND_CLEAN_STRATEGY_ID,
    sourceType: MOERAND_CLEAN_SOURCE_TYPE,
    signal: event.signal || 'NONE',
    stopLevel: price(state.stopLevel),
    entryPrice: price(state.entryPrice),
    initialRisk: price(state.initialRisk),
    breakevenLocked: state.breakevenLocked,
    exitReason: event.exitReason || null,
    exitPrice: price(event.exitPrice),
    signalBarTime: event.signalBarTime ?? null,
    state: Object.freeze({ ...state }),
    diagnostics: Object.freeze({ ...diagnostics }),
  };
}

export function evaluateMoerandClean(candles = [], settingsInput = {}, sessionContext = {}) {
  const settings = normalizeMoerandCleanSettings(settingsInput);
  const frameMs = settings.timeframeMinutes * 60_000;
  const cutoff = timestamp(sessionContext.now ?? sessionContext.evaluatedAt ?? Date.now());
  const closed = (Array.isArray(candles) ? candles : [])
    .map(candle)
    .filter(Boolean)
    .filter((bar) => bar.closed)
    .filter((bar) => sessionContext.allCandlesClosed === true || bar.t + frameMs <= cutoff)
    .sort((left, right) => left.t - right.t)
    .filter((bar, index, all) => index === all.length - 1 || bar.t !== all[index + 1].t)
    .filter((bar) => barSessionInfo(bar, settings).inSession);

  const state = stateFrom(sessionContext.previousState || sessionContext.state || {});
  if (!closed.length) return response(state, { status: 'NO_CLOSED_REGULAR_SESSION_BARS', settings, evaluatedBars: 0 });

  const pending = state.lastEvaluatedBarTime == null
    ? [closed.at(-1)]
    : closed.filter((bar) => bar.t > state.lastEvaluatedBarTime);
  if (!pending.length) {
    return response(state, {
      status: 'NO_NEW_CLOSED_BAR',
      settings,
      evaluatedBars: 0,
      latestClosedBarTime: closed.at(-1).t,
    });
  }

  let event = { signal: 'NONE', exitReason: null, exitPrice: null, signalBarTime: null };
  let diagnostics = {};

  for (const bar of pending) {
    const info = barSessionInfo(bar, settings);
    if (state.sessionKey !== info.sessionKey) reset(state, info.sessionKey);

    // Critical isolation rule: every indicator uses only bars from this regular session.
    const sessionBars = closed.filter((candidate) => {
      const candidateInfo = barSessionInfo(candidate, settings);
      return candidateInfo.sessionKey === info.sessionKey && candidate.t <= bar.t;
    });
    const firstSessionBar = sessionBars.length === 1 || info.firstBar;
    const trendEma = ema(sessionBars.map((candidate) => candidate.c), settings.trendLen);
    const breakoutHigh = priorHigh(sessionBars, settings.breakoutLen);
    const relativeVolume = rvol(sessionBars, settings.rvolPeriod);
    const currentAtr = atr(sessionBars, settings.atrPeriod);
    const trendPassed = Number.isFinite(trendEma) && bar.c > trendEma;
    const breakoutPassed = Number.isFinite(breakoutHigh) && bar.c > breakoutHigh;
    const rvolPassed = Number.isFinite(relativeVolume) && relativeVolume >= settings.minRvol;
    const ready = [trendEma, breakoutHigh, relativeVolume, currentAtr].every(Number.isFinite);
    event = { signal: 'NONE', exitReason: null, exitPrice: null, signalBarTime: null };

    if (state.inPosition) {
      const candidateStop = Number.isFinite(currentAtr) ? bar.c - currentAtr * settings.atrMult : state.stopLevel;
      if (Number.isFinite(candidateStop)) {
        state.stopLevel = Number.isFinite(state.stopLevel) ? Math.max(state.stopLevel, candidateStop) : candidateStop;
      }
      if (
        settings.enableBreakeven
        && !state.breakevenLocked
        && Number.isFinite(state.initialRisk)
        && bar.c - state.entryPrice >= state.initialRisk
      ) state.breakevenLocked = true;
      if (state.breakevenLocked) state.stopLevel = Math.max(state.stopLevel, state.entryPrice);

      if (info.finalBar) {
        event = { signal: 'SELL', exitReason: 'SESSION_END_FORCED_CLOSE', exitPrice: bar.c, signalBarTime: bar.t };
      } else if (Number.isFinite(state.stopLevel) && bar.c < state.stopLevel) {
        event = { signal: 'SELL', exitReason: 'TRAILING_STOP_CLOSE', exitPrice: bar.c, signalBarTime: bar.t };
      }
      if (event.signal === 'SELL') {
        state.inPosition = false;
        state.entryPrice = null;
        state.stopLevel = null;
        state.initialRisk = null;
        state.breakevenLocked = false;
      }
    } else if (!firstSessionBar && !info.finalBar && ready && trendPassed && breakoutPassed && rvolPassed) {
      state.initialRisk = currentAtr * settings.atrMult;
      state.entryPrice = bar.c;
      state.stopLevel = bar.c - state.initialRisk;
      state.breakevenLocked = false;
      state.inPosition = true;
      event = { signal: 'BUY', exitReason: null, exitPrice: null, signalBarTime: bar.t };
    }

    state.sessionBarsCompleted = sessionBars.length;
    state.lastEvaluatedBarTime = bar.t;
    state.lastSignal = event.signal;
    state.lastExitReason = event.exitReason;
    diagnostics = {
      status: event.signal === 'NONE' ? (ready ? 'NO_SIGNAL' : 'WARMING_UP') : event.signal,
      settings,
      sessionKey: info.sessionKey,
      sessionBarsCompleted: sessionBars.length,
      firstSessionBar,
      finalSessionBar: info.finalBar,
      closedBarTime: bar.t,
      close: price(bar.c),
      trendEma: price(trendEma),
      priorBreakoutHigh: price(breakoutHigh),
      relativeVolume: price(relativeVolume),
      atr: price(currentAtr),
      trendPassed,
      breakoutPassed,
      rvolPassed,
      indicatorsReady: ready,
      entryGate: trendPassed && breakoutPassed && rvolPassed,
      fullyClosedOnly: true,
      regularSessionIndicatorsOnly: true,
      sessionIsolated: true,
      longOnly: true,
      spotEquitiesOnly: true,
    };
  }

  return response(state, { ...diagnostics, evaluatedBars: pending.length }, event);
}

export function isValidMoerandCleanSymbol(value) {
  return TICKER_RE.test(text(value).toUpperCase());
}
