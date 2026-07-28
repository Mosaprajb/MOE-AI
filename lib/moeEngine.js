const MIN_TICK = 0.01;
const MINUTE_MS = 60_000;
const SESSION_KEY_CACHE = new Map();

export const MOE_VERSION = '6.3.1';

export const MOE_CONFIG = Object.freeze({
  primaryTimeframeMinutes: 1,
  preferredTimeframeMinutes: 15,
  baseBuyScore: 58,
  addBuyScore: 62,
  entryCooldownBars: 0,
  allowRepeatedBuys: true,
  maximumChartMinutes: 240,
  fastEmaLength: 9,
  slowEmaLength: 20,
  trendEmaLength: 50,
  atrLength: 14,
  volumeLength: 20,
  minimumRelativeVolume: 0.25,
  earlyMoveAtr: 0.12,
  breakBufferAtr: 0,
  maximumExtensionAtr: 2.4,
  accountCapital: 8000,
  riskPercent: 0.5,
  maximumAllocationPercent: 30,
  initialStopAtr: 1.15,
  initialTargetRR: 2,
  breakEvenAtR: 0.55,
  trailStartR: 0.85,
  trailAtrDistance: 0.85,
  emaTrailBufferAtr: 0.18,
  exitWeaknessScore: 3
});

function finite(value) {
  return Number.isFinite(value);
}

function points(condition, value) {
  return condition ? value : 0;
}

function average(values) {
  if (!values.length || values.some((value) => !finite(value))) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emaSeries(values, length) {
  const alpha = 2 / (length + 1);
  const output = new Array(values.length).fill(null);
  let ema = null;

  values.forEach((value, index) => {
    if (!finite(value)) return;
    ema = ema === null ? value : (value * alpha) + (ema * (1 - alpha));
    output[index] = ema;
  });

  return output;
}

function rmaSeries(values, length) {
  const output = new Array(values.length).fill(null);
  let seed = [];
  let rma = null;

  values.forEach((value, index) => {
    if (!finite(value)) return;
    if (rma === null) {
      seed.push(value);
      if (seed.length === length) {
        rma = average(seed);
        output[index] = rma;
      }
      return;
    }

    rma = ((rma * (length - 1)) + value) / length;
    output[index] = rma;
  });

  return output;
}

function rsiSeries(values, length = 14) {
  const gains = new Array(values.length).fill(null);
  const losses = new Array(values.length).fill(null);

  for (let index = 1; index < values.length; index += 1) {
    const change = values[index] - values[index - 1];
    gains[index] = Math.max(change, 0);
    losses[index] = Math.max(-change, 0);
  }

  const averageGains = rmaSeries(gains, length);
  const averageLosses = rmaSeries(losses, length);

  return values.map((_, index) => {
    const gain = averageGains[index];
    const loss = averageLosses[index];
    if (!finite(gain) || !finite(loss)) return null;
    if (loss === 0) return gain === 0 ? 50 : 100;
    return 100 - (100 / (1 + (gain / loss)));
  });
}

function atrSeries(bars, length) {
  const trueRanges = bars.map((bar, index) => {
    if (!index) return bar.h - bar.l;
    const previousClose = bars[index - 1].c;
    return Math.max(bar.h - bar.l, Math.abs(bar.h - previousClose), Math.abs(bar.l - previousClose));
  });
  return rmaSeries(trueRanges, length);
}

function sessionKey(timestamp) {
  const cacheKey = Math.floor(timestamp / MINUTE_MS);
  if (SESSION_KEY_CACHE.has(cacheKey)) return SESSION_KEY_CACHE.get(cacheKey);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const key = `${values.year}-${values.month}-${values.day}`;
  SESSION_KEY_CACHE.set(cacheKey, key);
  if (SESSION_KEY_CACHE.size > 5000) SESSION_KEY_CACHE.delete(SESSION_KEY_CACHE.keys().next().value);
  return key;
}

function currentVwap(bars) {
  if (!bars.length) return null;
  const currentSession = sessionKey(bars[bars.length - 1].t);
  let weighted = 0;
  let volume = 0;

  for (let index = bars.length - 1; index >= 0; index -= 1) {
    const bar = bars[index];
    if (sessionKey(bar.t) !== currentSession) break;
    if (!finite(bar.v) || bar.v <= 0) continue;
    weighted += ((bar.h + bar.l + bar.c) / 3) * bar.v;
    volume += bar.v;
  }

  return volume > 0 ? weighted / volume : null;
}

export function aggregateBars(bars, minutes = 15) {
  const bucketSize = minutes * MINUTE_MS;
  const aggregated = [];

  bars.forEach((bar) => {
    const bucket = Math.floor(bar.t / bucketSize) * bucketSize;
    const current = aggregated[aggregated.length - 1];
    if (!current || current.t !== bucket) {
      aggregated.push({ t: bucket, o: bar.o, h: bar.h, l: bar.l, c: bar.c, v: bar.v || 0 });
      return;
    }

    current.h = Math.max(current.h, bar.h);
    current.l = Math.min(current.l, bar.l);
    current.c = bar.c;
    current.v += bar.v || 0;
  });

  return aggregated;
}

export function parseFinnhubCandles(payload) {
  if (!payload || payload.s !== 'ok' || !Array.isArray(payload.t)) return [];
  const bars = payload.t.map((timestamp, index) => ({
    t: timestamp * 1000,
    o: Number(payload.o?.[index]),
    h: Number(payload.h?.[index]),
    l: Number(payload.l?.[index]),
    c: Number(payload.c?.[index]),
    v: Number(payload.v?.[index] || 0)
  }));

  return bars.filter((bar) => finite(bar.t) && finite(bar.o) && finite(bar.h) && finite(bar.l) && finite(bar.c));
}

export function ingestTrade(bars, trade, maxBars = 1200, minutes = 1) {
  if (!trade || !finite(trade.p) || !finite(trade.t)) return bars;
  const bucketSize = Math.max(1, minutes) * MINUTE_MS;
  const bucket = Math.floor(trade.t / bucketSize) * bucketSize;
  const volume = finite(trade.v) ? trade.v : 0;
  const next = bars.slice();
  const current = next[next.length - 1];

  if (!current || bucket > current.t) {
    next.push({ t: bucket, o: trade.p, h: trade.p, l: trade.p, c: trade.p, v: volume });
  } else if (bucket === current.t) {
    next[next.length - 1] = {
      ...current,
      h: Math.max(current.h, trade.p),
      l: Math.min(current.l, trade.p),
      c: trade.p,
      v: (current.v || 0) + volume
    };
  }

  return next.length > maxBars ? next.slice(-maxBars) : next;
}

export function createMoeState(saved = {}) {
  return {
    tradeActive: Boolean(saved.tradeActive),
    averageEntry: finite(saved.averageEntry) ? saved.averageEntry : null,
    initialRisk: finite(saved.initialRisk) ? saved.initialRisk : null,
    smartStop: finite(saved.smartStop) ? saved.smartStop : null,
    referenceTarget: finite(saved.referenceTarget) ? saved.referenceTarget : null,
    highWatermark: finite(saved.highWatermark) ? saved.highWatermark : null,
    entryCount: Number.isInteger(saved.entryCount) ? saved.entryCount : 0,
    lastBuyBarTime: finite(saved.lastBuyBarTime) ? saved.lastBuyBarTime : null,
    buyLatchedBarTime: finite(saved.buyLatchedBarTime) ? saved.buyLatchedBarTime : null,
    sellLatchedBarTime: finite(saved.sellLatchedBarTime) ? saved.sellLatchedBarTime : null,
    lastEvaluatedBarTime: finite(saved.lastEvaluatedBarTime) ? saved.lastEvaluatedBarTime : null,
    lastSetup: typeof saved.lastSetup === 'string' ? saved.lastSetup : '',
    displayEntry: finite(saved.displayEntry) ? saved.displayEntry : null,
    displayStop: finite(saved.displayStop) ? saved.displayStop : null,
    displayTarget: finite(saved.displayTarget) ? saved.displayTarget : null
  };
}

function grade(score) {
  if (score >= 88) return 'A+';
  if (score >= 80) return 'A';
  if (score >= 72) return 'B+';
  if (score >= 62) return 'B';
  if (score >= 52) return 'C';
  return 'D';
}

export function evaluateMoe(bars, previousState = createMoeState(), config = MOE_CONFIG) {
  const state = createMoeState(previousState);
  const primaryMinutes = Number(config.primaryTimeframeMinutes) || 1;
  const timeframe = primaryMinutes >= 60 ? `${primaryMinutes / 60}h` : `${primaryMinutes}m`;
  if (!Array.isArray(bars) || bars.length < 55) {
    return {
      state,
      event: null,
      snapshot: {
        ready: false,
        signal: 'WARMING UP',
        reason: `LOADING ${timeframe.toUpperCase()} HISTORY`,
        score: null,
        timeframe
      }
    };
  }

  const index = bars.length - 1;
  const current = bars[index];
  const previous = bars[index - 1];
  const closes = bars.map((bar) => bar.c);
  const volumes = bars.map((bar) => bar.v);
  const emaFastSeries = emaSeries(closes, config.fastEmaLength);
  const emaSlowSeries = emaSeries(closes, config.slowEmaLength);
  const atrValues = atrSeries(bars, config.atrLength);
  const rsiValues = rsiSeries(closes, 14);
  const macdFast = emaSeries(closes, 12);
  const macdSlow = emaSeries(closes, 26);
  const macdValues = closes.map((_, itemIndex) => macdFast[itemIndex] - macdSlow[itemIndex]);
  const macdSignals = emaSeries(macdValues, 9);
  const contextBars = aggregateBars(bars, config.preferredTimeframeMinutes);
  const contextCloses = contextBars.map((bar) => bar.c);
  const contextFast = emaSeries(contextCloses, config.fastEmaLength);
  const contextSlow = emaSeries(contextCloses, config.slowEmaLength);
  const contextRsi = rsiSeries(contextCloses, 14);
  const contextIndex = contextBars.length - 1;

  const atr = atrValues[index];
  const emaFast = emaFastSeries[index];
  const emaSlow = emaSlowSeries[index];
  const rsi = rsiValues[index];
  const macd = macdValues[index];
  const macdSignal = macdSignals[index];
  const preferredClose = contextCloses[contextIndex];
  const preferredFast = contextFast[contextIndex];
  const preferredSlow = contextSlow[contextIndex];
  const preferredRsi = contextRsi[contextIndex];

  if (![atr, emaFast, emaSlow, rsi, macd, macdSignal, preferredFast, preferredSlow, preferredRsi].every(finite)) {
    return {
      state,
      event: null,
      snapshot: {
        ready: false,
        signal: 'WARMING UP',
        reason: 'CALCULATING MOE INDICATORS',
        score: null,
        timeframe
      }
    };
  }

  const previousHighs = bars.slice(Math.max(0, index - 8), index).map((bar) => bar.h);
  const previousLows = bars.slice(Math.max(0, index - 6), index).map((bar) => bar.l);
  const priorHigh1 = previous.h;
  const priorHigh3 = Math.max(...previousHighs.slice(-3));
  const priorHigh8 = Math.max(...previousHighs.slice(-8));
  const priorLow3 = Math.min(...previousLows.slice(-3));
  const barRange = Math.max(current.h - current.l, MIN_TICK);
  const closeLocation = (current.c - current.l) / barRange;
  const averageVolume = average(volumes.slice(-config.volumeLength));
  const relativeVolume = averageVolume > 0 ? current.v / averageVolume : 0;
  const vwap = currentVwap(bars);

  const preferredBullish = preferredClose >= preferredSlow && preferredFast >= preferredSlow;
  const preferredStrong = preferredBullish && preferredRsi >= 51;
  const greenNow = current.c > current.o;
  const aboveFast = current.c >= emaFast;
  const aboveSlow = current.c >= emaSlow;
  const fastRising = emaFast >= emaFastSeries[index - 1];
  const slowRising = emaSlow >= emaSlowSeries[index - 1];
  const bullStack = emaFast >= emaSlow;
  const momentumPositive = rsi >= 49 && macd >= macdSignal;
  const volumeOk = relativeVolume >= config.minimumRelativeVolume || !finite(current.v);
  const currentBuyingPressure = greenNow && closeLocation >= 0.48;
  const earlyImpulse = greenNow && current.c >= current.o + (atr * config.earlyMoveAtr) && current.h >= previous.h;
  const microBreak = current.h >= priorHigh1 + (atr * config.breakBufferAtr);
  const structureBreak = current.h >= priorHigh3 + (atr * config.breakBufferAtr);
  const fullBreakout = current.h >= priorHigh8 + (atr * config.breakBufferAtr);
  const fastReclaim = current.l <= emaFast + (atr * 0.15) && current.c >= emaFast && greenNow;
  const slowReclaim = current.l <= emaSlow + (atr * 0.18) && current.c >= emaSlow && greenNow;
  const continuation = bullStack && fastRising && current.l >= emaSlow - (atr * 0.22) && current.h > priorHigh1;
  const extensionAtr = atr > 0 ? (current.c - emaFast) / atr : 0;
  const extensionOk = extensionAtr <= config.maximumExtensionAtr;

  const trendScore = points(aboveFast, 8) + points(aboveSlow, 7) + points(bullStack, 6) + points(fastRising, 5) + points(slowRising, 3);
  const momentumScore = points(greenNow, 5) + points(currentBuyingPressure, 6) + points(momentumPositive, 7) + points(earlyImpulse, 8);
  const triggerScore = points(microBreak, 8) + points(structureBreak, 8) + points(fullBreakout, 5) + points(fastReclaim, 7) + points(slowReclaim, 5) + points(continuation, 6);
  const contextScore = points(preferredBullish, 5) + points(preferredStrong, 4) + points(vwap === null || current.c >= vwap, 4);
  const qualityScore = points(volumeOk, 5) + points(extensionOk, 5) + points(current.c > priorLow3, 3);
  const opportunityScore = Math.min(100, trendScore + momentumScore + triggerScore + contextScore + qualityScore);

  const anyImmediateTrigger = earlyImpulse || microBreak || structureBreak || fastReclaim || slowReclaim || continuation;
  const rawBuyReady = currentBuyingPressure && anyImmediateTrigger && volumeOk && extensionOk && opportunityScore >= config.baseBuyScore;
  const rawAddReady = currentBuyingPressure && (microBreak || structureBreak || fastReclaim || continuation) && extensionOk && opportunityScore >= config.addBuyScore;
  const cooldownOk = state.lastBuyBarTime === null || current.t - state.lastBuyBarTime > config.entryCooldownBars * MINUTE_MS;
  const initialBuyPulse = !state.tradeActive && rawBuyReady && cooldownOk && state.buyLatchedBarTime !== current.t;
  const repeatedBuyPulse = state.tradeActive && config.allowRepeatedBuys && rawAddReady && cooldownOk && state.buyLatchedBarTime !== current.t;
  const anyBuyPulse = initialBuyPulse || repeatedBuyPulse;

  const structuralStopCandidate = Math.min(priorLow3, emaSlow) - (atr * 0.12);
  const atrStopCandidate = current.c - (atr * config.initialStopAtr);
  const newInitialStop = Math.max(structuralStopCandidate, atrStopCandidate);
  let setup = earlyImpulse ? 'EARLY IMPULSE' : fullBreakout ? 'BREAKOUT' : fastReclaim || slowReclaim ? 'RECLAIM' : continuation ? 'CONTINUATION' : 'MOMENTUM';

  if (anyBuyPulse) {
    state.buyLatchedBarTime = current.t;
    state.lastBuyBarTime = current.t;
    state.lastSetup = setup;
    if (!state.tradeActive) {
      state.tradeActive = true;
      state.averageEntry = current.c;
      state.smartStop = Math.min(newInitialStop, current.c - MIN_TICK);
      state.initialRisk = Math.max(state.averageEntry - state.smartStop, MIN_TICK);
      state.referenceTarget = state.averageEntry + (state.initialRisk * config.initialTargetRR);
      state.highWatermark = current.h;
      state.entryCount = 1;
    } else {
      state.averageEntry = ((state.averageEntry * state.entryCount) + current.c) / (state.entryCount + 1);
      state.entryCount += 1;
      state.highWatermark = Math.max(state.highWatermark, current.h);
    }
  }

  if (state.tradeActive) {
    state.highWatermark = Math.max(state.highWatermark ?? current.h, current.h);
    const openProfitR = state.initialRisk > 0 ? (state.highWatermark - state.averageEntry) / state.initialRisk : 0;
    const breakEvenStop = openProfitR >= config.breakEvenAtR ? state.averageEntry : state.smartStop;
    const atrTrail = openProfitR >= config.trailStartR ? state.highWatermark - (atr * config.trailAtrDistance) : state.smartStop;
    const emaTrail = openProfitR >= config.trailStartR ? emaFast - (atr * config.emaTrailBufferAtr) : state.smartStop;
    const nextStop = Math.max(state.smartStop, breakEvenStop, atrTrail, emaTrail);
    state.smartStop = Math.min(nextStop, current.c - MIN_TICK);
    state.referenceTarget = Math.max(state.referenceTarget, state.averageEntry + (state.initialRisk * config.initialTargetRR));
  }

  const weaknessCount = points(current.c < current.o, 1)
    + points(current.c < emaFast, 1)
    + points(closeLocation < 0.35, 1)
    + points(current.h < previous.h && current.l < previous.l, 1)
    + points(emaFast < emaFastSeries[index - 1], 1)
    + points(current.c < emaSlow, 1);
  const stopTouched = state.tradeActive && current.l <= state.smartStop;
  const smartWeakExit = state.tradeActive && weaknessCount >= config.exitWeaknessScore && current.c < emaFast;
  const sellPulse = state.tradeActive && (stopTouched || smartWeakExit) && state.sellLatchedBarTime !== current.t;

  let signal;
  let reason;
  let event = null;

  if (sellPulse) {
    state.sellLatchedBarTime = current.t;
    signal = 'SELL NOW';
    reason = stopTouched ? 'TRAILING STOP' : 'MOMENTUM FAILED';
  } else if (initialBuyPulse) {
    signal = 'BUY NOW';
    reason = setup;
  } else if (repeatedBuyPulse) {
    signal = 'BUY AGAIN';
    reason = setup;
  } else if (state.tradeActive) {
    signal = 'HOLD / ADD READY';
    reason = current.c >= state.averageEntry ? 'STOP RISING' : 'WATCH STOP';
  } else if (rawBuyReady) {
    signal = 'BUY READY';
    reason = earlyImpulse ? 'CANDLE ACCELERATING' : 'PRICE TRIGGER ACTIVE';
  } else {
    signal = opportunityScore >= config.baseBuyScore - 8 ? 'WATCH NOW' : 'WAIT';
    reason = !extensionOk ? 'PRICE EXTENDED' : !volumeOk ? 'LOW VOLUME' : !currentBuyingPressure ? 'NEED BUYING PRESSURE' : 'SCANNING ALL HOURS';
  }

  const eventEntry = state.averageEntry;
  const eventStop = state.smartStop;
  const eventTarget = state.referenceTarget;
  if (initialBuyPulse || repeatedBuyPulse || sellPulse) {
    event = {
      id: `${current.t}-${signal}`,
      type: signal,
      reason,
      timestamp: Date.now(),
      barTime: current.t,
      price: current.c,
      score: opportunityScore,
      entry: eventEntry,
      stop: eventStop,
      target: eventTarget,
      entryCount: state.entryCount
    };
  }

  state.displayEntry = eventEntry;
  state.displayStop = eventStop;
  state.displayTarget = eventTarget;

  if (sellPulse) {
    state.tradeActive = false;
    state.averageEntry = null;
    state.initialRisk = null;
    state.referenceTarget = null;
    state.highWatermark = null;
    state.entryCount = 0;
  }
  state.lastEvaluatedBarTime = current.t;

  const stopDistance = state.tradeActive && finite(state.averageEntry) && finite(state.smartStop)
    ? Math.max(state.averageEntry - state.smartStop, MIN_TICK)
    : Math.max(current.c - newInitialStop, MIN_TICK);
  const riskDollars = config.accountCapital * config.riskPercent / 100;
  const sharesByRisk = Math.floor(riskDollars / stopDistance);
  const sharesByAllocation = Math.floor((config.accountCapital * config.maximumAllocationPercent / 100) / current.c);
  const suggestedShares = Math.max(0, Math.min(sharesByRisk, sharesByAllocation));

  return {
    state,
    event,
    snapshot: {
      ready: true,
      signal,
      reason,
      score: opportunityScore,
      grade: grade(opportunityScore),
      timeframe,
      entry: eventEntry,
      stop: eventStop,
      target: eventTarget,
      tradeActive: state.tradeActive,
      entryCount: state.entryCount,
      suggestedShares,
      relativeVolume,
      atr,
      vwap
    }
  };
}
