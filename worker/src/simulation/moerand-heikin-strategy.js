// Simulation-only MOERAND Simple strategy aligned with the 5-minute Heikin Ashi rules.
//
// Safety and fidelity:
// - Historical 5-minute OHLC bars are converted to Heikin Ashi before signal evaluation.
// - BUY requires a confirmed bullish, rising Heikin Ashi crossover above the ATR trail.
// - SELL is emitted immediately on the first simulated signal bar crossing below the ATR trail.
// - A configurable re-entry cooldown prevents rapid flip signals.
// - This module never imports a broker and never grants execution authority.

const STRATEGY = 'MOERAND_SIMPLE_INTERNAL';
const FIVE_MINUTES_MS = 5 * 60_000;
const DEFAULT_ATR_PERIOD = 10;
const DEFAULT_KEY_VALUE = 1;
const DEFAULT_MIN_REENTRY_BARS = 2;

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function boundedInteger(value, fallback, minimum, maximum) {
  const parsed = Math.trunc(Number(value));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, parsed));
}

function enabled(value, fallback = true) {
  if (value == null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function roundPrice(value) {
  return Number(finite(value).toFixed(4));
}

function normalizeBar(bar = {}) {
  const normalized = {
    t: Number(bar.t),
    o: Number(bar.o),
    h: Number(bar.h),
    l: Number(bar.l),
    c: Number(bar.c),
    v: Number(bar.v || 0),
  };
  return [normalized.t, normalized.o, normalized.h, normalized.l, normalized.c].every(Number.isFinite)
    ? normalized
    : null;
}

export function toHeikinAshiBars(input = []) {
  const bars = (Array.isArray(input) ? input : []).map(normalizeBar).filter(Boolean);
  let previousOpen = null;
  let previousClose = null;

  return bars.map((bar) => {
    const close = (bar.o + bar.h + bar.l + bar.c) / 4;
    const open = previousOpen == null
      ? (bar.o + bar.c) / 2
      : (previousOpen + previousClose) / 2;
    const output = {
      t: bar.t,
      o: open,
      h: Math.max(bar.h, open, close),
      l: Math.min(bar.l, open, close),
      c: close,
      v: bar.v,
      rawClose: bar.c,
    };
    previousOpen = open;
    previousClose = close;
    return output;
  });
}

function trueRange(current, previous) {
  if (!previous) return current.h - current.l;
  return Math.max(
    current.h - current.l,
    Math.abs(current.h - previous.c),
    Math.abs(current.l - previous.c),
  );
}

function currentAtr(bars, period) {
  if (bars.length < period) return null;
  const trueRanges = bars.map((bar, index) => trueRange(bar, bars[index - 1]));
  let atr = trueRanges.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  for (let index = period; index < trueRanges.length; index += 1) {
    atr = ((atr * (period - 1)) + trueRanges[index]) / period;
  }
  return atr;
}

export function runMoerandHeikinStrategy({
  symbol,
  bars,
  previousState = {},
  env = {},
  simulatedAt = Date.now(),
} = {}) {
  const heikinBars = toHeikinAshiBars(bars);
  const current = heikinBars.at(-1);
  const previous = heikinBars.at(-2);
  const atrPeriod = boundedInteger(env.MOERAND_SIMULATION_ATR_PERIOD, DEFAULT_ATR_PERIOD, 1, 100);
  const keyValue = Math.max(0.1, finite(env.MOERAND_SIMULATION_KEY_VALUE, DEFAULT_KEY_VALUE));
  const minimumReentryBars = boundedInteger(
    env.MOERAND_SIMULATION_MIN_REENTRY_BARS,
    DEFAULT_MIN_REENTRY_BARS,
    0,
    24,
  );
  const requireBullishConfirmation = enabled(
    env.MOERAND_SIMULATION_REQUIRE_BULLISH_CONFIRMATION,
    true,
  );

  const state = {
    trailingStop: Number.isFinite(Number(previousState.trailingStop))
      ? Number(previousState.trailingStop)
      : 0,
    inPosition: previousState.inPosition === true,
    lastExitBarTime: Number.isFinite(Number(previousState.lastExitBarTime))
      ? Number(previousState.lastExitBarTime)
      : null,
    lastSignal: String(previousState.lastSignal || 'WAIT'),
  };

  const atr = currentAtr(heikinBars, atrPeriod);
  if (!current || !previous || !Number.isFinite(atr)) {
    return {
      strategy: STRATEGY,
      detected: false,
      accepted: false,
      opportunity: null,
      rejection: null,
      closeInstruction: null,
      nextState: state,
      diagnostics: {
        signal: 'WARMING_UP',
        candleSource: 'HEIKIN_ASHI',
        timeframe: '5m',
        atrPeriod,
        availableBars: heikinBars.length,
      },
    };
  }

  const source = current.c;
  const previousSource = previous.c;
  const previousStop = state.trailingStop;
  const lossDistance = atr * keyValue;
  let trailingStop;

  if (source > previousStop && previousSource > previousStop) {
    trailingStop = Math.max(previousStop, source - lossDistance);
  } else if (source < previousStop && previousSource < previousStop) {
    trailingStop = Math.min(previousStop, source + lossDistance);
  } else {
    trailingStop = source > previousStop
      ? source - lossDistance
      : source + lossDistance;
  }

  const crossedAbove = previousSource <= previousStop && source > trailingStop;
  const crossedBelow = previousSource >= previousStop && source < trailingStop;
  const bullish = current.c > current.o;
  const rising = current.c > previous.c;
  const confirmationPassed = !requireBullishConfirmation || (bullish && rising);
  const cooldownMs = minimumReentryBars * FIVE_MINUTES_MS;
  const cooldownPassed = state.lastExitBarTime == null
    || current.t - state.lastExitBarTime >= cooldownMs;

  const buySignal = !state.inPosition
    && source > trailingStop
    && crossedAbove
    && confirmationPassed
    && cooldownPassed;
  const sellSignal = state.inPosition
    && source < trailingStop
    && crossedBelow;

  state.trailingStop = trailingStop;
  state.lastSignal = buySignal ? 'BUY' : sellSignal ? 'SELL' : 'WAIT';

  let opportunity = null;
  let closeInstruction = null;
  if (buySignal) {
    state.inPosition = true;
    const initialRisk = Math.max(source - trailingStop, 0.01);
    opportunity = {
      id: `SIM-MOERAND-HA-${symbol}-${current.t}`,
      symbol,
      direction: 'LONG',
      timeframe: '5m',
      score: 75,
      confidence: { value: 75, source: STRATEGY },
      entry: roundPrice(source),
      stopLoss: roundPrice(trailingStop),
      takeProfit: roundPrice(source + initialRisk * 2),
      createdAt: iso(simulatedAt),
      validForMs: 30 * 60_000,
      reasons: ['HEIKIN_ASHI_ATR_CROSSOVER_CONFIRMED'],
      metadata: {
        setupFamily: 'UT_BOT_ATR_HEIKIN_ASHI',
        sourceStrategy: STRATEGY,
        simulation: true,
        notRealMarketData: true,
        historicalBarTime: iso(current.t),
        candleSource: 'HEIKIN_ASHI',
        timeframe: '5m',
        buyConfirmation: requireBullishConfirmation
          ? 'BULLISH_AND_RISING_HEIKIN_ASHI'
          : 'ATR_CROSSOVER_ONLY',
        sellExecution: 'IMMEDIATE_ON_SIMULATED_SIGNAL_BAR',
        minimumReentryBars,
        dynamicTrailingStop: true,
        historicalExecutionApproximation: 'FIVE_MINUTE_OHLC',
      },
      observationOnly: true,
      executionEnabled: false,
      executionAllowed: false,
      liveExecutionAllowed: false,
    };
  }

  if (sellSignal) {
    state.inPosition = false;
    state.lastExitBarTime = current.t;
    closeInstruction = {
      strategy: STRATEGY,
      symbol,
      price: roundPrice(current.rawClose),
      reason: 'HEIKIN_ASHI_ATR_TRAILING_STOP_SIGNAL',
      simulatedAt: iso(current.t),
      immediate: true,
    };
  }

  return {
    strategy: STRATEGY,
    detected: buySignal,
    accepted: buySignal,
    opportunity,
    rejection: null,
    closeInstruction,
    nextState: state,
    diagnostics: {
      signal: state.lastSignal,
      candleSource: 'HEIKIN_ASHI',
      timeframe: '5m',
      atr: roundPrice(atr),
      atrPeriod,
      keyValue,
      trailingStop: roundPrice(trailingStop),
      heikinOpen: roundPrice(current.o),
      heikinClose: roundPrice(current.c),
      bullish,
      rising,
      confirmationPassed,
      cooldownPassed,
      minimumReentryBars,
    },
  };
}
