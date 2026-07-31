export const MARKET_STATE_COMPONENTS = Object.freeze([
  'spy',
  'qqq',
  'vix',
  'dxy',
  'us10y',
  'breadth',
  'tick',
  'add',
  'trin',
  'advanceDecline',
]);

export const DEFAULT_MARKET_STATE_WEIGHTS = Object.freeze({
  spy: 18,
  qqq: 18,
  vix: 12,
  dxy: 7,
  us10y: 7,
  breadth: 12,
  tick: 6,
  add: 8,
  trin: 6,
  advanceDecline: 6,
});

const INVERSE_COMPONENTS = new Set(['vix', 'dxy', 'us10y']);

function clamp(value, minimum = -100, maximum = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
}

function finiteNumber(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function timestampMilliseconds(value, fallback = null) {
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

function freezeComponent(component) {
  return Object.freeze({
    ...component,
    warnings: Object.freeze([...(component.warnings || [])]),
  });
}

function unavailableComponent(name, reason, source = 'unavailable') {
  return freezeComponent({
    name,
    available: false,
    source,
    value: null,
    score: 0,
    direction: 'UNKNOWN',
    dataTimestamp: null,
    ageMs: null,
    stale: false,
    warnings: reason ? [String(reason)] : [],
  });
}

function changePctFromSnapshot(snapshot, lastPrice) {
  const metadata = snapshot?.rawMetadata && typeof snapshot.rawMetadata === 'object'
    ? snapshot.rawMetadata
    : {};
  const explicit = finiteNumber(
    snapshot?.changePct
      ?? snapshot?.percentChange
      ?? metadata.changePct
      ?? metadata.percentChange,
  );
  if (Number.isFinite(explicit)) return explicit;

  const bars = Array.isArray(snapshot?.bars) ? snapshot.bars : [];
  const reference = finiteNumber(
    snapshot?.previousClose
      ?? metadata.previousClose
      ?? (bars.length > 1 ? bars[bars.length - 2]?.close : bars[0]?.open),
  );
  if (!Number.isFinite(reference) || reference <= 0 || !Number.isFinite(lastPrice)) return 0;
  return ((lastPrice - reference) / reference) * 100;
}

export function normalizeInstrumentComponent(name, snapshot, {
  now = Date.now(),
  maxAgeMs = 900_000,
} = {}) {
  if (!snapshot || typeof snapshot !== 'object') return unavailableComponent(name, `${name}: snapshot unavailable`);

  const bars = Array.isArray(snapshot.bars) ? snapshot.bars : [];
  const lastPrice = finiteNumber(snapshot.lastPrice ?? snapshot.quote?.last ?? bars[bars.length - 1]?.close);
  if (!Number.isFinite(lastPrice) || lastPrice <= 0) return unavailableComponent(name, `${name}: no valid price`, snapshot.provider);

  const dataTimestamp = timestampMilliseconds(
    snapshot.dataTimestamp
      ?? snapshot.quote?.timestamp
      ?? bars[bars.length - 1]?.timestamp,
    now,
  );
  const ageMs = Math.max(0, now - dataTimestamp);
  const stale = snapshot.stale === true || (Number(maxAgeMs) > 0 && ageMs > Number(maxAgeMs));
  if (stale) return unavailableComponent(name, `${name}: stale market data`, snapshot.provider);

  const changePct = changePctFromSnapshot(snapshot, lastPrice);
  const polarity = INVERSE_COMPONENTS.has(name) ? -1 : 1;
  const score = clamp(changePct * 25 * polarity);
  const direction = score > 2 ? 'BULLISH' : score < -2 ? 'BEARISH' : 'NEUTRAL';

  return freezeComponent({
    name,
    available: true,
    source: String(snapshot.provider || 'market-data'),
    symbol: String(snapshot.symbol || '').toUpperCase(),
    value: lastPrice,
    changePct: Number(changePct.toFixed(4)),
    score: Number(score.toFixed(2)),
    direction,
    dataTimestamp,
    ageMs,
    stale: false,
    qualityScore: finiteNumber(snapshot.quality?.score),
    warnings: Array.isArray(snapshot.quality?.warnings) ? snapshot.quality.warnings.map(String) : [],
  });
}

function internalComponent(name, value, score, source, dataTimestamp, ageMs, extra = {}) {
  if (!Number.isFinite(value)) return unavailableComponent(name, `${name}: value unavailable`, source);
  const normalizedScore = clamp(score);
  return freezeComponent({
    name,
    available: true,
    source,
    value,
    score: Number(normalizedScore.toFixed(2)),
    direction: normalizedScore > 2 ? 'BULLISH' : normalizedScore < -2 ? 'BEARISH' : 'NEUTRAL',
    dataTimestamp,
    ageMs,
    stale: false,
    warnings: [],
    ...extra,
  });
}

export function normalizeMarketInternals(raw, {
  now = Date.now(),
  maxAgeMs = 300_000,
  source = 'market-internals',
} = {}) {
  if (!raw || typeof raw !== 'object') {
    return Object.freeze({
      breadth: unavailableComponent('breadth', 'breadth: provider unavailable', source),
      tick: unavailableComponent('tick', 'tick: provider unavailable', source),
      add: unavailableComponent('add', 'add: provider unavailable', source),
      trin: unavailableComponent('trin', 'trin: provider unavailable', source),
      advanceDecline: unavailableComponent('advanceDecline', 'advanceDecline: provider unavailable', source),
    });
  }

  const dataTimestamp = timestampMilliseconds(raw.dataTimestamp ?? raw.timestamp ?? raw.updatedAt, now);
  const ageMs = Math.max(0, now - dataTimestamp);
  const stale = Number(maxAgeMs) > 0 && ageMs > Number(maxAgeMs);
  if (stale) {
    const reason = `market internals are stale by ${ageMs}ms`;
    return Object.freeze({
      breadth: unavailableComponent('breadth', reason, source),
      tick: unavailableComponent('tick', reason, source),
      add: unavailableComponent('add', reason, source),
      trin: unavailableComponent('trin', reason, source),
      advanceDecline: unavailableComponent('advanceDecline', reason, source),
    });
  }

  const advances = finiteNumber(raw.advances ?? raw.advancing);
  const declines = finiteNumber(raw.declines ?? raw.declining);
  const unchanged = finiteNumber(raw.unchanged, 0);
  const totalDirectional = Number.isFinite(advances) && Number.isFinite(declines) ? advances + declines : null;
  const breadthValue = finiteNumber(
    raw.breadthPercent
      ?? raw.breadth
      ?? (Number.isFinite(totalDirectional) && totalDirectional > 0 ? (advances / totalDirectional) * 100 : null),
  );
  const advanceDeclineValue = finiteNumber(
    raw.advanceDecline
      ?? raw.advanceDeclineNet
      ?? raw.adLine
      ?? (Number.isFinite(advances) && Number.isFinite(declines) ? advances - declines : null),
  );
  const tickValue = finiteNumber(raw.tick ?? raw.nyseTick);
  const addValue = finiteNumber(raw.add ?? raw.nyseAdd ?? advanceDeclineValue);
  const trinValue = finiteNumber(raw.trin ?? raw.armsIndex);

  const breadthScore = Number.isFinite(breadthValue) ? clamp((breadthValue - 50) * 4) : 0;
  const tickScore = Number.isFinite(tickValue) ? clamp(tickValue / 10) : 0;
  const addScore = Number.isFinite(addValue) ? clamp(addValue / 20) : 0;
  const trinScore = Number.isFinite(trinValue) && trinValue > 0 ? clamp((1 - trinValue) * 100) : 0;
  const advanceDeclineScore = Number.isFinite(advanceDeclineValue) ? clamp(advanceDeclineValue / 20) : 0;

  return Object.freeze({
    breadth: internalComponent('breadth', breadthValue, breadthScore, source, dataTimestamp, ageMs, { advances, declines, unchanged }),
    tick: internalComponent('tick', tickValue, tickScore, source, dataTimestamp, ageMs),
    add: internalComponent('add', addValue, addScore, source, dataTimestamp, ageMs),
    trin: internalComponent('trin', trinValue, trinScore, source, dataTimestamp, ageMs),
    advanceDecline: internalComponent('advanceDecline', advanceDeclineValue, advanceDeclineScore, source, dataTimestamp, ageMs, { advances, declines, unchanged }),
  });
}

export function createMarketStateSnapshot({
  instruments = {},
  internals,
  errors = [],
} = {}, {
  now = Date.now(),
  instrumentMaxAgeMs = 900_000,
  internalsMaxAgeMs = 300_000,
  requiredComponents = MARKET_STATE_COMPONENTS,
  weights = {},
} = {}) {
  const internalComponents = normalizeMarketInternals(internals, {
    now,
    maxAgeMs: internalsMaxAgeMs,
    source: String(internals?.provider || internals?.source || 'market-internals'),
  });
  const components = Object.freeze({
    spy: normalizeInstrumentComponent('spy', instruments.spy, { now, maxAgeMs: instrumentMaxAgeMs }),
    qqq: normalizeInstrumentComponent('qqq', instruments.qqq, { now, maxAgeMs: instrumentMaxAgeMs }),
    vix: normalizeInstrumentComponent('vix', instruments.vix, { now, maxAgeMs: instrumentMaxAgeMs }),
    dxy: normalizeInstrumentComponent('dxy', instruments.dxy, { now, maxAgeMs: instrumentMaxAgeMs }),
    us10y: normalizeInstrumentComponent('us10y', instruments.us10y, { now, maxAgeMs: instrumentMaxAgeMs }),
    ...internalComponents,
  });

  const normalizedWeights = Object.freeze({ ...DEFAULT_MARKET_STATE_WEIGHTS, ...weights });
  const availableNames = MARKET_STATE_COMPONENTS.filter((name) => components[name]?.available === true);
  const totalAvailableWeight = availableNames.reduce((sum, name) => sum + Math.max(0, Number(normalizedWeights[name]) || 0), 0);
  const weightedScore = totalAvailableWeight > 0
    ? availableNames.reduce((sum, name) => sum + components[name].score * Math.max(0, Number(normalizedWeights[name]) || 0), 0) / totalAvailableWeight
    : 0;
  const score = Number(clamp(weightedScore).toFixed(2));
  const coverage = Number((availableNames.length / MARKET_STATE_COMPONENTS.length).toFixed(4));
  const required = [...new Set((Array.isArray(requiredComponents) ? requiredComponents : MARKET_STATE_COMPONENTS)
    .filter((name) => MARKET_STATE_COMPONENTS.includes(name)))];
  const missingRequired = required.filter((name) => components[name]?.available !== true);
  const regime = availableNames.length === 0
    ? 'UNKNOWN'
    : score >= 20
      ? 'RISK_ON'
      : score <= -20
        ? 'RISK_OFF'
        : 'MIXED';
  const status = availableNames.length === 0 ? 'UNAVAILABLE' : missingRequired.length === 0 ? 'READY' : 'DEGRADED';
  const confidence = Number(clamp(coverage * 100 * (0.5 + Math.abs(score) / 200), 0, 100).toFixed(2));
  const longAlignment = Number(clamp((score + 100) / 2, 0, 100).toFixed(2));
  const shortAlignment = Number((100 - longAlignment).toFixed(2));
  const dataTimestamps = availableNames.map((name) => components[name].dataTimestamp).filter(Number.isFinite);
  const normalizedErrors = (Array.isArray(errors) ? errors : []).map((error) => Object.freeze({
    component: String(error?.component || 'unknown'),
    message: String(error?.message || 'Unknown market-state failure.'),
  }));
  const blockers = [
    ...missingRequired.map((name) => `${name}: required market-state component unavailable`),
    ...normalizedErrors.map((error) => `${error.component}: ${error.message}`),
  ];

  return Object.freeze({
    version: 1,
    observationOnly: true,
    executionEnabled: false,
    status,
    regime,
    score,
    confidence,
    coverage,
    marketAlignment: Object.freeze({
      long: longAlignment,
      short: shortAlignment,
    }),
    components,
    availableComponents: Object.freeze(availableNames),
    missingRequired: Object.freeze(missingRequired),
    blockers: Object.freeze(blockers),
    errors: Object.freeze(normalizedErrors),
    dataTimestamp: dataTimestamps.length ? Math.min(...dataTimestamps) : null,
    generatedAt: new Date(now).toISOString(),
  });
}
