export const MOERAND_CLEAN_STRATEGY_ID = 'MOERAND_CLEAN_INTERNAL';
export const MOERAND_CLEAN_SOURCE_TYPE = 'INTERNAL_PIPELINE';

export const MOERAND_CLEAN_DEFAULTS = Object.freeze({
  keyValue: 1,
  atrPeriod: 2,
  useHeikinAshi: false,
  sessionWindow: '0930-1600',
  sessionTimezone: 'America/New_York',
  timeframeMinutes: 5,
});

const TICKER_RE = /^[A-Z][A-Z0-9.-]{0,9}$/;
const MINUTE_MS = 60_000;

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

function positive(value, fallback, minimum = Number.EPSILON, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.min(maximum, Math.max(minimum, parsed))
    : fallback;
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
  const keyValue = positive(first(input, [
    'keyValue',
    'sensitivity',
    'atrMult',
    'MOERAND_CLEAN_KEY_VALUE',
    'MOERAND_CLEAN_ATR_MULT',
  ], defaults.keyValue), defaults.keyValue, 0.1, 100);

  return Object.freeze({
    keyValue,
    // Kept as an alias so older callers and stored reports remain readable.
    atrMult: keyValue,
    atrPeriod: integer(first(input, ['atrPeriod', 'MOERAND_CLEAN_ATR_PERIOD'], defaults.atrPeriod), defaults.atrPeriod, 1, 500),
    useHeikinAshi: bool(first(input, [
      'useHeikinAshi',
      'signalsFromHeikinAshi',
      'MOERAND_CLEAN_USE_HEIKIN_ASHI',
    ], defaults.useHeikinAshi), defaults.useHeikinAshi),
    sessionWindow: sessionWindow(first(input, ['sessionWindow', 'MOERAND_CLEAN_SESSION_WINDOW'], defaults.sessionWindow)),
    sessionTimezone: text(first(input, ['sessionTimezone', 'MOERAND_CLEAN_SESSION_TIMEZONE'], defaults.sessionTimezone), defaults.sessionTimezone),
    timeframeMinutes: integer(first(input, ['timeframeMinutes', 'MOERAND_CLEAN_TIMEFRAME_MINUTES'], defaults.timeframeMinutes), defaults.timeframeMinutes, 1, 15),
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

function sessionBounds(settings) {
  const [startToken, endToken] = settings.sessionWindow.split('-');
  return { start: clockMinutes(startToken), end: clockMinutes(endToken) };
}

function inferResolutionMinutes(bars = []) {
  const differences = [];
  for (let index = 1; index < bars.length; index += 1) {
    const difference = bars[index].t - bars[index - 1].t;
    if (difference > 0) differences.push(difference / MINUTE_MS);
  }
  return differences.length ? Math.min(...differences) : null;
}

function aggregateClosedBars(input, settings, cutoff, allCandlesClosed) {
  const raw = (Array.isArray(input) ? input : [])
    .map(candle)
    .filter(Boolean)
    .filter((bar) => bar.closed)
    .sort((left, right) => left.t - right.t)
    .filter((bar, index, all) => index === all.length - 1 || bar.t !== all[index + 1].t);

  const sourceResolutionMinutes = inferResolutionMinutes(raw);
  if (Number.isFinite(sourceResolutionMinutes) && sourceResolutionMinutes > settings.timeframeMinutes) {
    return {
      bars: [],
      sourceResolutionMinutes,
      resolutionTooCoarse: true,
    };
  }

  const { start, end } = sessionBounds(settings);
  const groups = new Map();
  for (const bar of raw) {
    const local = zoned(bar.t, settings.sessionTimezone);
    if (!['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(local.weekday)) continue;
    if (local.minutes < start || local.minutes >= end) continue;

    const bucketIndex = Math.floor((local.minutes - start) / settings.timeframeMinutes);
    const bucketMinute = start + bucketIndex * settings.timeframeMinutes;
    const durationMinutes = Math.min(settings.timeframeMinutes, end - bucketMinute);
    const bucketStart = bar.t - (local.minutes - bucketMinute) * MINUTE_MS;
    const key = `${local.key}:${bucketStart}`;
    const previous = groups.get(key);
    if (!previous) {
      groups.set(key, {
        t: bucketStart,
        o: bar.o,
        h: bar.h,
        l: bar.l,
        c: bar.c,
        v: bar.v,
        sessionKey: local.key,
        bucketMinute,
        durationMinutes,
      });
    } else {
      previous.h = Math.max(previous.h, bar.h);
      previous.l = Math.min(previous.l, bar.l);
      previous.c = bar.c;
      previous.v += bar.v;
    }
  }

  const bars = [...groups.values()]
    .filter((bar) => allCandlesClosed === true || bar.t + bar.durationMinutes * MINUTE_MS <= cutoff)
    .sort((left, right) => left.t - right.t)
    .map((bar) => ({
      ...bar,
      firstBar: bar.bucketMinute === start,
      finalBar: bar.bucketMinute + bar.durationMinutes >= end,
    }));

  return {
    bars,
    sourceResolutionMinutes,
    resolutionTooCoarse: false,
  };
}

function trueRange(current, previous) {
  if (!previous) return current.h - current.l;
  return Math.max(current.h - current.l, Math.abs(current.h - previous.c), Math.abs(current.l - previous.c));
}

function atrSeries(bars, period) {
  const ranges = bars.map((bar, index) => trueRange(bar, bars[index - 1]));
  const output = Array(bars.length).fill(null);
  if (ranges.length < period) return output;
  let current = ranges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  output[period - 1] = current;
  for (let index = period; index < ranges.length; index += 1) {
    current = ((current * (period - 1)) + ranges[index]) / period;
    output[index] = current;
  }
  return output;
}

function heikinAshiSources(bars) {
  const output = [];
  let sessionKey = null;
  let previousOpen = null;
  let previousClose = null;
  for (const bar of bars) {
    if (bar.sessionKey !== sessionKey) {
      sessionKey = bar.sessionKey;
      previousOpen = null;
      previousClose = null;
    }
    const close = (bar.o + bar.h + bar.l + bar.c) / 4;
    const open = previousOpen == null ? (bar.o + bar.c) / 2 : (previousOpen + previousClose) / 2;
    output.push({ open, close });
    previousOpen = open;
    previousClose = close;
  }
  return output;
}

function utBotSeries(bars, settings) {
  const atrValues = atrSeries(bars, settings.atrPeriod);
  const heikin = heikinAshiSources(bars);
  const rows = [];
  let previousSession = null;
  let previousStop = 0;
  let previousSource = null;

  for (let index = 0; index < bars.length; index += 1) {
    const bar = bars[index];
    if (bar.sessionKey !== previousSession) {
      previousSession = bar.sessionKey;
      previousStop = 0;
      previousSource = null;
    }

    const source = settings.useHeikinAshi ? heikin[index].close : bar.c;
    const atr = atrValues[index];
    let trailingStop = null;
    let crossedAbove = false;
    let crossedBelow = false;

    if (Number.isFinite(atr)) {
      const lossDistance = settings.keyValue * atr;
      if (source > previousStop && previousSource != null && previousSource > previousStop) {
        trailingStop = Math.max(previousStop, source - lossDistance);
      } else if (source < previousStop && previousSource != null && previousSource < previousStop) {
        trailingStop = Math.min(previousStop, source + lossDistance);
      } else {
        trailingStop = source > previousStop
          ? source - lossDistance
          : source + lossDistance;
      }

      if (previousSource != null && Number.isFinite(previousStop)) {
        crossedAbove = previousSource <= previousStop && source > trailingStop;
        crossedBelow = previousSource >= previousStop && source < trailingStop;
      }
      previousStop = trailingStop;
    }

    rows.push({
      ...bar,
      source,
      signalOpen: settings.useHeikinAshi ? heikin[index].open : bar.o,
      atr,
      trailingStop,
      crossedAbove,
      crossedBelow,
      buyCondition: Number.isFinite(trailingStop) && source > trailingStop && crossedAbove,
      sellCondition: Number.isFinite(trailingStop) && source < trailingStop && crossedBelow,
    });
    previousSource = source;
  }
  return rows;
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
    breakevenLocked: false,
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
    breakevenLocked: false,
    exitReason: event.exitReason || null,
    exitPrice: price(event.exitPrice),
    signalBarTime: event.signalBarTime ?? null,
    state: Object.freeze({ ...state }),
    diagnostics: Object.freeze({ ...diagnostics }),
  };
}

export function evaluateMoerandClean(candles = [], settingsInput = {}, sessionContext = {}) {
  const settings = normalizeMoerandCleanSettings(settingsInput);
  const cutoff = timestamp(sessionContext.now ?? sessionContext.evaluatedAt ?? Date.now());
  const aggregated = aggregateClosedBars(
    candles,
    settings,
    cutoff,
    sessionContext.allCandlesClosed === true,
  );
  const state = stateFrom(sessionContext.previousState || sessionContext.state || {});

  if (aggregated.resolutionTooCoarse) {
    return response(state, {
      status: 'SOURCE_RESOLUTION_TOO_COARSE',
      settings,
      evaluatedBars: 0,
      sourceResolutionMinutes: aggregated.sourceResolutionMinutes,
      fullyClosedOnly: true,
      signalTiming: 'CANDLE_CLOSE_ONLY',
    });
  }

  const rows = utBotSeries(aggregated.bars, settings);
  if (!rows.length) {
    return response(state, {
      status: 'NO_CLOSED_REGULAR_SESSION_BARS',
      settings,
      evaluatedBars: 0,
      sourceResolutionMinutes: aggregated.sourceResolutionMinutes,
      fullyClosedOnly: true,
      signalTiming: 'CANDLE_CLOSE_ONLY',
    });
  }

  const pending = state.lastEvaluatedBarTime == null
    ? [rows.at(-1)]
    : rows.filter((bar) => bar.t > state.lastEvaluatedBarTime);
  if (!pending.length) {
    return response(state, {
      status: 'NO_NEW_CLOSED_BAR',
      settings,
      evaluatedBars: 0,
      latestClosedBarTime: rows.at(-1).t,
      sourceResolutionMinutes: aggregated.sourceResolutionMinutes,
      fullyClosedOnly: true,
      signalTiming: 'CANDLE_CLOSE_ONLY',
    });
  }

  let event = { signal: 'NONE', exitReason: null, exitPrice: null, signalBarTime: null };
  let diagnostics = {};

  for (const bar of pending) {
    if (state.sessionKey !== bar.sessionKey) reset(state, bar.sessionKey);
    event = { signal: 'NONE', exitReason: null, exitPrice: null, signalBarTime: null };
    if (Number.isFinite(bar.trailingStop)) state.stopLevel = bar.trailingStop;

    if (state.inPosition) {
      if (bar.finalBar) {
        event = {
          signal: 'SELL',
          exitReason: 'SESSION_END_FORCED_CLOSE',
          exitPrice: bar.c,
          signalBarTime: bar.t,
        };
      } else if (bar.sellCondition) {
        event = {
          signal: 'SELL',
          exitReason: 'UT_BOT_CLOSED_BAR_SELL',
          exitPrice: bar.c,
          signalBarTime: bar.t,
        };
      }
      if (event.signal === 'SELL') {
        state.inPosition = false;
        state.entryPrice = null;
        state.stopLevel = null;
        state.initialRisk = null;
      }
    } else if (!bar.finalBar && bar.buyCondition) {
      state.inPosition = true;
      state.entryPrice = bar.c;
      state.stopLevel = bar.trailingStop;
      state.initialRisk = Math.max(
        bar.c - bar.trailingStop,
        Math.abs(bar.source - bar.trailingStop),
        0.01,
      );
      event = {
        signal: 'BUY',
        exitReason: null,
        exitPrice: null,
        signalBarTime: bar.t,
      };
    }

    state.sessionBarsCompleted = rows.filter((candidate) => (
      candidate.sessionKey === bar.sessionKey && candidate.t <= bar.t
    )).length;
    state.lastEvaluatedBarTime = bar.t;
    state.lastSignal = event.signal;
    state.lastExitReason = event.exitReason;

    diagnostics = {
      status: event.signal === 'NONE'
        ? (Number.isFinite(bar.atr) ? 'NO_SIGNAL' : 'WARMING_UP')
        : event.signal,
      settings,
      sessionKey: bar.sessionKey,
      sessionBarsCompleted: state.sessionBarsCompleted,
      firstSessionBar: bar.firstBar,
      finalSessionBar: bar.finalBar,
      closedBarTime: bar.t,
      close: price(bar.c),
      sourcePrice: price(bar.source),
      signalOpen: price(bar.signalOpen),
      atr: price(bar.atr),
      trailingStop: price(bar.trailingStop),
      crossedAbove: bar.crossedAbove,
      crossedBelow: bar.crossedBelow,
      buyCondition: bar.buyCondition,
      sellCondition: bar.sellCondition,
      candleSource: settings.useHeikinAshi ? 'HEIKIN_ASHI_CLOSE' : 'REGULAR_CLOSE',
      timeframeMinutes: settings.timeframeMinutes,
      sourceResolutionMinutes: aggregated.sourceResolutionMinutes,
      fullyClosedOnly: true,
      signalTiming: 'CANDLE_CLOSE_ONLY',
      utBotCompatible: true,
      longOnly: true,
      spotEquitiesOnly: true,
      sessionIsolated: true,
    };
  }

  return response(state, { ...diagnostics, evaluatedBars: pending.length }, event);
}

export function isValidMoerandCleanSymbol(value) {
  return TICKER_RE.test(text(value).toUpperCase());
}
