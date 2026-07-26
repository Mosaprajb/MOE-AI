function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, value));
}

function integer(value, fallback, minimum, maximum) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function number(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function symbol(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : '';
}

function parseComparisonMap(value) {
  const source = String(value || '').trim();
  if (!source) return {};
  try {
    const parsed = JSON.parse(source);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return Object.fromEntries(Object.entries(parsed)
        .map(([primary, comparison]) => [symbol(primary), symbol(comparison)])
        .filter(([primary, comparison]) => primary && comparison && primary !== comparison));
    }
  } catch {
    // Fall through to the compact CSV format: AAPL:QQQ,MSFT:QQQ.
  }
  return Object.fromEntries(source.split(',')
    .map((pair) => pair.split(':').map(symbol))
    .filter(([primary, comparison]) => primary && comparison && primary !== comparison));
}

export function createSmtDivergenceConfig(env = {}) {
  return freeze({
    enabled: String(env.SMT_DIVERGENCE_ENABLED ?? 'true').toLowerCase() !== 'false',
    defaultComparisonSymbol: symbol(env.SMT_DEFAULT_COMPARISON_SYMBOL) || 'SPY',
    fallbackComparisonSymbol: symbol(env.SMT_FALLBACK_COMPARISON_SYMBOL) || 'QQQ',
    comparisonMap: parseComparisonMap(env.SMT_COMPARISON_MAP),
    minimumBars: integer(env.SMT_MINIMUM_BARS, 30, 20, 500),
    correlationLookback: integer(env.SMT_CORRELATION_LOOKBACK, 60, 20, 500),
    minimumCorrelation: number(env.SMT_MINIMUM_CORRELATION, 0.45, 0, 0.99),
    swingWindow: integer(env.SMT_SWING_WINDOW, 2, 1, 8),
    maximumEventAgeBars: integer(env.SMT_MAXIMUM_EVENT_AGE_BARS, 8, 1, 50),
    minimumPrimaryBreakPercent: number(env.SMT_MINIMUM_PRIMARY_BREAK_PERCENT, 0.05, 0, 10),
    comparisonTolerancePercent: number(env.SMT_COMPARISON_TOLERANCE_PERCENT, 0.02, 0, 5),
    minimumDivergenceMagnitudePercent: number(env.SMT_MINIMUM_DIVERGENCE_MAGNITUDE_PERCENT, 0.08, 0.001, 20),
  });
}

export function comparisonSymbolFor(primarySymbol, config = createSmtDivergenceConfig()) {
  const primary = symbol(primarySymbol);
  if (!primary) return null;
  const mapped = symbol(config.comparisonMap?.[primary]);
  if (mapped && mapped !== primary) return mapped;
  const preferred = symbol(config.defaultComparisonSymbol) || 'SPY';
  if (preferred !== primary) return preferred;
  const fallback = symbol(config.fallbackComparisonSymbol) || 'QQQ';
  return fallback !== primary ? fallback : null;
}

function normalizeBars(items = []) {
  const byTimestamp = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const timestampValue = item?.timestamp ?? item?.t;
    const timestamp = typeof timestampValue === 'string' ? Date.parse(timestampValue) : Number(timestampValue);
    const high = finite(item?.high ?? item?.h);
    const low = finite(item?.low ?? item?.l);
    const close = finite(item?.close ?? item?.c);
    if (!(timestamp > 0) || !(high > 0) || !(low > 0) || !(close > 0) || high < low) continue;
    byTimestamp.set(timestamp, { timestamp, high, low, close });
  }
  return [...byTimestamp.values()].sort((left, right) => left.timestamp - right.timestamp);
}

function alignSeries(primaryBars, comparisonBars, lookback) {
  const primary = normalizeBars(primaryBars);
  const comparisonByTime = new Map(normalizeBars(comparisonBars).map((bar) => [bar.timestamp, bar]));
  return primary
    .filter((bar) => comparisonByTime.has(bar.timestamp))
    .map((bar) => ({ primary: bar, comparison: comparisonByTime.get(bar.timestamp) }))
    .slice(-lookback);
}

function pearson(left, right) {
  if (left.length !== right.length || left.length < 3) return null;
  const leftMean = left.reduce((sum, value) => sum + value, 0) / left.length;
  const rightMean = right.reduce((sum, value) => sum + value, 0) / right.length;
  let numerator = 0;
  let leftVariance = 0;
  let rightVariance = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftDelta = left[index] - leftMean;
    const rightDelta = right[index] - rightMean;
    numerator += leftDelta * rightDelta;
    leftVariance += leftDelta ** 2;
    rightVariance += rightDelta ** 2;
  }
  const denominator = Math.sqrt(leftVariance * rightVariance);
  return denominator > 0 ? numerator / denominator : null;
}

function returns(values) {
  const output = [];
  for (let index = 1; index < values.length; index += 1) {
    const previous = values[index - 1];
    const current = values[index];
    if (previous > 0 && current > 0) output.push(Math.log(current / previous));
  }
  return output;
}

function swingIndexes(aligned, field, type, window) {
  const output = [];
  for (let index = window; index < aligned.length - window; index += 1) {
    const value = aligned[index].primary[field];
    const neighbors = aligned.slice(index - window, index + window + 1)
      .filter((_, offset) => offset !== window)
      .map((pair) => pair.primary[field]);
    const qualifies = type === 'HIGH'
      ? neighbors.every((neighbor) => value >= neighbor) && neighbors.some((neighbor) => value > neighbor)
      : neighbors.every((neighbor) => value <= neighbor) && neighbors.some((neighbor) => value < neighbor);
    if (qualifies) output.push(index);
  }
  return output;
}

function percentChange(previous, current) {
  return previous > 0 ? (current - previous) / previous * 100 : null;
}

function divergenceCandidate(aligned, type, config) {
  const field = type === 'HIGH' ? 'high' : 'low';
  const swings = swingIndexes(aligned, field, type, config.swingWindow);
  if (swings.length < 2) return null;
  const previousIndex = swings.at(-2);
  const latestIndex = swings.at(-1);
  const previous = aligned[previousIndex];
  const latest = aligned[latestIndex];
  const primaryChangePercent = percentChange(previous.primary[field], latest.primary[field]);
  const comparisonChangePercent = percentChange(previous.comparison[field], latest.comparison[field]);
  const ageBars = aligned.length - 1 - latestIndex;
  if (primaryChangePercent == null || comparisonChangePercent == null) return null;

  const primaryBreaks = type === 'HIGH'
    ? primaryChangePercent >= config.minimumPrimaryBreakPercent
    : primaryChangePercent <= -config.minimumPrimaryBreakPercent;
  const comparisonFails = type === 'HIGH'
    ? comparisonChangePercent <= config.comparisonTolerancePercent
    : comparisonChangePercent >= -config.comparisonTolerancePercent;
  const magnitudePercent = type === 'HIGH'
    ? primaryChangePercent - comparisonChangePercent
    : comparisonChangePercent - primaryChangePercent;

  return {
    type,
    direction: type === 'HIGH' ? 'SHORT' : 'LONG',
    classification: type === 'HIGH' ? 'BEARISH_SMT_DIVERGENCE' : 'BULLISH_SMT_DIVERGENCE',
    previousTimestamp: previous.primary.timestamp,
    latestTimestamp: latest.primary.timestamp,
    previousPrimaryPrice: previous.primary[field],
    latestPrimaryPrice: latest.primary[field],
    previousComparisonPrice: previous.comparison[field],
    latestComparisonPrice: latest.comparison[field],
    primaryChangePercent: Number(primaryChangePercent.toFixed(6)),
    comparisonChangePercent: Number(comparisonChangePercent.toFixed(6)),
    magnitudePercent: Number(magnitudePercent.toFixed(6)),
    ageBars,
    primaryBreaks,
    comparisonFails,
    detected: primaryBreaks && comparisonFails && magnitudePercent >= config.minimumDivergenceMagnitudePercent,
  };
}

function baseResult({ primarySymbol, comparisonSymbol, timeframe, classification, status, reason, correlation = null, alignedBars = 0 }) {
  return {
    engine: 'SMT_DIVERGENCE',
    primarySymbol,
    comparisonSymbol,
    timeframe: timeframe || null,
    classification,
    status,
    reason,
    correlation,
    alignedBars,
    score: null,
    confidence: null,
    direction: 'NEUTRAL',
    detected: false,
    expired: false,
    event: null,
    evidence: [],
    failedConditions: [],
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  };
}

export function evaluateSmtDivergence({
  primarySymbol,
  comparisonSymbol,
  primaryBars = [],
  comparisonBars = [],
  timeframe = null,
  config = createSmtDivergenceConfig(),
} = {}) {
  const primary = symbol(primarySymbol);
  const comparison = symbol(comparisonSymbol);
  if (!config.enabled) {
    return freeze(baseResult({ primarySymbol: primary || null, comparisonSymbol: comparison || null, timeframe, classification: 'DISABLED', status: 'DISABLED', reason: 'SMT_DIVERGENCE_DISABLED' }));
  }
  if (!primary || !comparison || primary === comparison) {
    const result = baseResult({ primarySymbol: primary || null, comparisonSymbol: comparison || null, timeframe, classification: 'INSUFFICIENT_DATA', status: 'UNAVAILABLE', reason: 'VALID_DISTINCT_SYMBOL_PAIR_REQUIRED' });
    result.failedConditions.push('VALID_DISTINCT_SYMBOL_PAIR_REQUIRED');
    return freeze(result);
  }

  const aligned = alignSeries(primaryBars, comparisonBars, Math.max(config.correlationLookback, config.minimumBars));
  if (aligned.length < config.minimumBars) {
    const result = baseResult({ primarySymbol: primary, comparisonSymbol: comparison, timeframe, classification: 'INSUFFICIENT_DATA', status: 'UNAVAILABLE', reason: 'INSUFFICIENT_ALIGNED_BARS', alignedBars: aligned.length });
    result.failedConditions.push('INSUFFICIENT_ALIGNED_BARS');
    return freeze(result);
  }

  const primaryReturns = returns(aligned.map((pair) => pair.primary.close));
  const comparisonReturns = returns(aligned.map((pair) => pair.comparison.close));
  const correlation = pearson(primaryReturns, comparisonReturns);
  if (correlation == null) {
    const result = baseResult({ primarySymbol: primary, comparisonSymbol: comparison, timeframe, classification: 'INSUFFICIENT_DATA', status: 'UNAVAILABLE', reason: 'CORRELATION_UNAVAILABLE', alignedBars: aligned.length });
    result.failedConditions.push('CORRELATION_UNAVAILABLE');
    return freeze(result);
  }

  const roundedCorrelation = Number(correlation.toFixed(6));
  const correlationConfidence = clamp(Math.round(Math.max(0, correlation) * 100));
  if (correlation < config.minimumCorrelation) {
    const result = baseResult({ primarySymbol: primary, comparisonSymbol: comparison, timeframe, classification: 'CORRELATION_BREAKDOWN', status: 'CONFLICTING', reason: 'PAIR_CORRELATION_BELOW_MINIMUM', correlation: roundedCorrelation, alignedBars: aligned.length });
    result.score = correlationConfidence;
    result.confidence = correlationConfidence;
    result.failedConditions.push('PAIR_CORRELATION_BELOW_MINIMUM');
    return freeze(result);
  }

  const candidates = [
    divergenceCandidate(aligned, 'HIGH', config),
    divergenceCandidate(aligned, 'LOW', config),
  ].filter(Boolean);
  const detected = candidates
    .filter((candidate) => candidate.detected)
    .sort((left, right) => left.ageBars - right.ageBars || right.magnitudePercent - left.magnitudePercent)[0] || null;

  if (!detected) {
    const result = baseResult({ primarySymbol: primary, comparisonSymbol: comparison, timeframe, classification: 'NO_DIVERGENCE', status: 'IDLE', reason: candidates.length ? 'NO_QUALIFYING_PRIMARY_LED_DIVERGENCE' : 'INSUFFICIENT_CONFIRMED_SWINGS', correlation: roundedCorrelation, alignedBars: aligned.length });
    result.score = 0;
    result.confidence = correlationConfidence;
    result.failedConditions.push(candidates.length ? 'NO_QUALIFYING_PRIMARY_LED_DIVERGENCE' : 'INSUFFICIENT_CONFIRMED_SWINGS');
    result.event = candidates.sort((left, right) => left.ageBars - right.ageBars)[0] || null;
    return freeze(result);
  }

  const expired = detected.ageBars > config.maximumEventAgeBars;
  const correlationComponent = clamp((correlation - config.minimumCorrelation) / Math.max(0.01, 1 - config.minimumCorrelation) * 35);
  const magnitudeComponent = clamp(detected.magnitudePercent / config.minimumDivergenceMagnitudePercent * 25, 0, 40);
  const freshnessComponent = clamp((config.maximumEventAgeBars - detected.ageBars) / config.maximumEventAgeBars * 25);
  const score = Math.round(correlationComponent + magnitudeComponent + freshnessComponent);
  const result = baseResult({
    primarySymbol: primary,
    comparisonSymbol: comparison,
    timeframe,
    classification: detected.classification,
    status: expired ? 'EXPIRED' : 'CONFIRMED',
    reason: expired ? 'SMT_DIVERGENCE_EXPIRED' : 'SMT_DIVERGENCE_CONFIRMED',
    correlation: roundedCorrelation,
    alignedBars: aligned.length,
  });
  result.score = clamp(score);
  result.confidence = clamp(Math.round(score * 0.65 + correlationConfidence * 0.35));
  result.direction = detected.direction;
  result.detected = !expired;
  result.expired = expired;
  result.event = detected;
  result.evidence.push(
    'PAIR_CORRELATION_VALIDATED',
    detected.type === 'HIGH' ? 'PRIMARY_MADE_HIGHER_HIGH' : 'PRIMARY_MADE_LOWER_LOW',
    detected.type === 'HIGH' ? 'COMPARISON_FAILED_HIGHER_HIGH' : 'COMPARISON_FAILED_LOWER_LOW',
    'DIVERGENCE_MAGNITUDE_CONFIRMED',
  );
  if (expired) result.failedConditions.push('SMT_DIVERGENCE_EXPIRED');
  return freeze(result);
}
