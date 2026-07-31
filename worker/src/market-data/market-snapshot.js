import { finiteNumber, normalizeSymbol, normalizeTimeframe, timestampMilliseconds } from './provider-utils.js';

export const MARKET_SNAPSHOT_SCHEMA = 'MOE.MarketSnapshot';
export const MARKET_SNAPSHOT_VERSION = '2.0.0';

export class MarketDataQualityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MarketDataQualityError';
    this.details = Object.freeze({ ...details });
  }
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function text(value, fallback = null) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

function normalizedRatio(value) {
  const number = finiteNumber(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function normalizeBar(row, index) {
  const timestamp = timestampMilliseconds(row?.timestamp ?? row?.time ?? row?.t ?? row?.start ?? row?.datetime);
  const open = finiteNumber(row?.open ?? row?.o);
  const high = finiteNumber(row?.high ?? row?.h);
  const low = finiteNumber(row?.low ?? row?.l);
  const close = finiteNumber(row?.close ?? row?.c);
  const volume = finiteNumber(row?.volume ?? row?.v, 0);
  const vwap = finiteNumber(row?.vwap ?? row?.vw);
  const trades = finiteNumber(row?.trades ?? row?.n);

  if (!timestamp) throw new MarketDataQualityError(`Bar ${index} has no valid timestamp.`);
  if (![open, high, low, close].every((value) => Number.isFinite(value) && value > 0)) {
    throw new MarketDataQualityError(`Bar ${index} has invalid OHLC values.`);
  }
  if (high < Math.max(open, close) || low > Math.min(open, close) || high < low) {
    throw new MarketDataQualityError(`Bar ${index} has inconsistent OHLC values.`);
  }
  if (!Number.isFinite(volume) || volume < 0) throw new MarketDataQualityError(`Bar ${index} has invalid volume.`);

  return Object.freeze({ timestamp, open, high, low, close, volume, vwap, trades });
}

export function normalizeBars(rows) {
  const bars = (Array.isArray(rows) ? rows : []).map(normalizeBar).sort((left, right) => left.timestamp - right.timestamp);
  for (let index = 1; index < bars.length; index += 1) {
    if (bars[index].timestamp <= bars[index - 1].timestamp) {
      throw new MarketDataQualityError('Market-data bars contain duplicate or non-increasing timestamps.');
    }
  }
  return Object.freeze(bars);
}

function normalizeQuote(raw = {}) {
  const bid = finiteNumber(raw.bid ?? raw.bidPrice ?? raw.bp);
  const ask = finiteNumber(raw.ask ?? raw.askPrice ?? raw.ap);
  const last = finiteNumber(raw.last ?? raw.lastPrice ?? raw.price ?? raw.current ?? raw.c);
  const bidSize = finiteNumber(raw.bidSize ?? raw.bs, 0);
  const askSize = finiteNumber(raw.askSize ?? raw.as, 0);
  const volume = finiteNumber(raw.volume ?? raw.dayVolume ?? raw.v, 0);
  const timestamp = timestampMilliseconds(raw.timestamp ?? raw.time ?? raw.t);
  const preMarketPrice = finiteNumber(raw.preMarketPrice ?? raw.premarketPrice ?? raw.pre_market_price);
  const afterHoursPrice = finiteNumber(raw.afterHoursPrice ?? raw.postMarketPrice ?? raw.after_hours_price);
  const spread = Number.isFinite(bid) && Number.isFinite(ask) ? ask - bid : null;
  const midpoint = Number.isFinite(bid) && Number.isFinite(ask) ? (bid + ask) / 2 : null;
  const spreadBps = Number.isFinite(spread) && spread >= 0 && Number.isFinite(midpoint) && midpoint > 0
    ? (spread / midpoint) * 10_000
    : null;
  const spreadPercent = Number.isFinite(spreadBps) ? spreadBps / 100 : null;

  return Object.freeze({
    bid,
    ask,
    last,
    midpoint,
    bidSize,
    askSize,
    spread,
    spreadBps,
    spreadPercent,
    volume,
    timestamp,
    preMarketPrice,
    afterHoursPrice,
  });
}

function average(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

export function calculateAtr(bars, period = 14) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const trueRanges = [];
  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index];
    const previous = bars[index - 1];
    trueRanges.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close),
    ));
  }
  return average(trueRanges.slice(-Math.max(1, Number(period) || 14)));
}

export function calculateVwap(bars) {
  if (!Array.isArray(bars) || !bars.length) return null;
  let weighted = 0;
  let volume = 0;
  for (const bar of bars) {
    if (!Number.isFinite(bar.volume) || bar.volume <= 0) continue;
    const price = Number.isFinite(bar.vwap) ? bar.vwap : (bar.high + bar.low + bar.close) / 3;
    weighted += price * bar.volume;
    volume += bar.volume;
  }
  return volume > 0 ? weighted / volume : finiteNumber(bars.at(-1)?.vwap);
}

export function calculatePoc(bars, bucketCount = 24) {
  if (!Array.isArray(bars) || !bars.length) return null;
  const lows = bars.map((bar) => bar.low).filter(Number.isFinite);
  const highs = bars.map((bar) => bar.high).filter(Number.isFinite);
  if (!lows.length || !highs.length) return null;
  const minimum = Math.min(...lows);
  const maximum = Math.max(...highs);
  if (!(maximum > minimum)) return bars.at(-1)?.close ?? null;
  const count = Math.max(4, Math.min(100, Math.floor(Number(bucketCount) || 24)));
  const width = (maximum - minimum) / count;
  const buckets = new Array(count).fill(0);
  for (const bar of bars) {
    const price = Number.isFinite(bar.vwap) ? bar.vwap : (bar.high + bar.low + bar.close) / 3;
    const index = Math.max(0, Math.min(count - 1, Math.floor((price - minimum) / width)));
    buckets[index] += Math.max(0, finiteNumber(bar.volume, 0));
  }
  let best = 0;
  for (let index = 1; index < buckets.length; index += 1) {
    if (buckets[index] > buckets[best]) best = index;
  }
  return minimum + width * (best + 0.5);
}

export function calculateRelativeVolume(bars, lookback = 20) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const latest = finiteNumber(bars.at(-1)?.volume);
  const history = bars.slice(0, -1).slice(-Math.max(1, Number(lookback) || 20)).map((bar) => finiteNumber(bar.volume));
  const baseline = average(history);
  return Number.isFinite(latest) && Number.isFinite(baseline) && baseline > 0 ? latest / baseline : null;
}

function normalizeCompany(raw = {}) {
  const source = { ...(raw.asset || {}), ...(raw.fundamentals || {}), ...(raw.company || {}), ...(raw.profile || {}) };
  const metadata = raw.metadata || {};
  const floatShares = finiteNumber(
    source.float ?? source.floatShares ?? source.shareFloat ?? raw.float ?? raw.floatShares ?? metadata.float ?? metadata.floatShares,
  );
  return Object.freeze({
    name: text(source.name ?? source.companyName ?? raw.companyName),
    exchange: text(source.exchange ?? raw.exchange),
    country: text(source.country),
    currency: text(source.currency ?? raw.currency),
    sector: text(source.sector ?? raw.sector ?? metadata.sector),
    industry: text(source.industry ?? raw.industry ?? metadata.industry),
    marketCap: finiteNumber(source.marketCap ?? raw.marketCap),
    sharesOutstanding: finiteNumber(source.sharesOutstanding ?? raw.sharesOutstanding),
    float: Number.isFinite(floatShares) && floatShares >= 0 ? floatShares : null,
  });
}

function normalizeSessionKey(value) {
  const normalized = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  if (['PRE', 'PREMARKET', 'PRE_MARKET'].includes(normalized)) return 'PRE_MARKET';
  if (['CORE', 'REGULAR', 'RTH', 'MARKET_OPEN'].includes(normalized)) return 'REGULAR';
  if (['AFTER', 'AFTERHOURS', 'AFTER_HOURS', 'POSTMARKET', 'POST_MARKET'].includes(normalized)) return 'AFTER_HOURS';
  if (['NIGHT', 'OVERNIGHT'].includes(normalized)) return 'OVERNIGHT';
  if (['ALL', 'EXTENDED', 'EXTENDED_HOURS'].includes(normalized)) return 'EXTENDED';
  if (normalized === 'CLOSED') return 'CLOSED';
  return normalized || 'UNKNOWN';
}

function normalizeSession(raw, quote) {
  const source = raw.sessionInfo || raw.marketSession || (raw.session && typeof raw.session === 'object' ? raw.session : {});
  const declared = typeof raw.session === 'string' ? raw.session : source.key ?? source.name ?? source.label;
  const key = normalizeSessionKey(declared);
  return Object.freeze({
    key,
    label: text(source.label, key),
    isExtendedHours: ['PRE_MARKET', 'AFTER_HOURS', 'OVERNIGHT', 'EXTENDED'].includes(key),
    isOpen: source.isOpen === undefined ? !['CLOSED', 'UNKNOWN'].includes(key) : Boolean(source.isOpen),
    localTime: text(source.localTime),
    timezone: text(source.timezone, 'America/New_York'),
    preMarketPrice: finiteNumber(source.preMarketPrice, quote.preMarketPrice),
    afterHoursPrice: finiteNumber(source.afterHoursPrice, quote.afterHoursPrice),
  });
}

function normalizeNewsItem(item, index) {
  if (!item || typeof item !== 'object') return null;
  const headline = text(item.headline ?? item.title ?? item.name);
  if (!headline) return null;
  const publishedMs = timestampMilliseconds(item.publishedAt ?? item.datetime ?? item.timestamp ?? item.time);
  return Object.freeze({
    id: text(item.id ?? item.uuid, `news-${index + 1}`),
    headline,
    summary: text(item.summary ?? item.description),
    source: text(item.source ?? item.publisher),
    url: text(item.url ?? item.link),
    publishedAt: publishedMs ? new Date(publishedMs).toISOString() : null,
    sentiment: text(item.sentiment)?.toUpperCase() || null,
    sentimentScore: finiteNumber(item.sentimentScore ?? item.score),
    relevance: finiteNumber(item.relevance ?? item.relevanceScore),
    symbols: Object.freeze((Array.isArray(item.symbols) ? item.symbols : []).map((symbol) => String(symbol).trim().toUpperCase()).filter(Boolean)),
  });
}

function normalizeNews(raw) {
  const rows = raw.news ?? raw.headlines ?? raw.events?.news ?? [];
  return Object.freeze((Array.isArray(rows) ? rows : []).map(normalizeNewsItem).filter(Boolean));
}

function normalizeOptions(raw = {}) {
  const source = raw.options || raw.optionsFlow || raw.derivatives || {};
  const callVolume = finiteNumber(source.callVolume ?? source.calls?.volume, 0);
  const putVolume = finiteNumber(source.putVolume ?? source.puts?.volume, 0);
  const totalVolume = finiteNumber(source.totalVolume, Math.max(0, callVolume || 0) + Math.max(0, putVolume || 0));
  const putCallRatio = normalizedRatio(source.putCallRatio)
    ?? (Number.isFinite(callVolume) && callVolume > 0 && Number.isFinite(putVolume) ? putVolume / callVolume : null);
  const unusual = Array.isArray(source.unusualActivity ?? source.unusual)
    ? (source.unusualActivity ?? source.unusual).filter((item) => item && typeof item === 'object').map((item) => Object.freeze({ ...item }))
    : [];
  const available = Object.keys(source).length > 0;
  return Object.freeze({
    available,
    callVolume: Number.isFinite(callVolume) ? callVolume : 0,
    putVolume: Number.isFinite(putVolume) ? putVolume : 0,
    totalVolume: Number.isFinite(totalVolume) ? totalVolume : 0,
    putCallRatio,
    impliedVolatility: finiteNumber(source.impliedVolatility ?? source.iv),
    openInterest: finiteNumber(source.openInterest),
    gammaExposure: finiteNumber(source.gammaExposure ?? source.gex),
    deltaExposure: finiteNumber(source.deltaExposure ?? source.dex),
    nearestExpiration: text(source.nearestExpiration ?? source.expiration),
    unusualActivity: Object.freeze(unusual),
  });
}

function newestTimestamp(raw, bars, quote, fallback) {
  return Math.max(
    0,
    timestampMilliseconds(raw?.dataTimestamp ?? raw?.timestamp ?? raw?.updatedAt, 0),
    quote.timestamp || 0,
    bars.length ? bars[bars.length - 1].timestamp : 0,
  ) || fallback;
}

function buildCompleteness(snapshot) {
  const checks = {
    OHLCV: snapshot.ohlcv.count > 0,
    ATR: Number.isFinite(snapshot.atr),
    VWAP: Number.isFinite(snapshot.vwap),
    POC: Number.isFinite(snapshot.poc),
    Spread: Number.isFinite(snapshot.spread),
    Float: Number.isFinite(snapshot.float),
    Sector: Boolean(snapshot.sector),
    Industry: Boolean(snapshot.industry),
    RVOL: Number.isFinite(snapshot.rvol),
    Session: snapshot.session !== 'UNKNOWN',
    News: snapshot.news.length > 0,
    Options: snapshot.options.available,
  };
  const present = Object.entries(checks).filter(([, value]) => value).map(([key]) => key);
  const missing = Object.entries(checks).filter(([, value]) => !value).map(([key]) => key);
  return Object.freeze({
    score: Math.round((present.length / Object.keys(checks).length) * 100),
    present: Object.freeze(present),
    missing: Object.freeze(missing),
  });
}

export function validateUnifiedMarketSnapshot(snapshot) {
  const blockers = [];
  const warnings = [];
  if (!snapshot || typeof snapshot !== 'object') blockers.push('snapshot: object required');
  if (snapshot?.schema !== MARKET_SNAPSHOT_SCHEMA) blockers.push('schema: unsupported market snapshot schema');
  if (snapshot?.schemaVersion !== MARKET_SNAPSHOT_VERSION) blockers.push('schemaVersion: unsupported market snapshot version');
  if (!snapshot?.symbol) blockers.push('symbol: required');
  if (!Array.isArray(snapshot?.bars)) blockers.push('bars: array required');
  if (!snapshot?.ohlcv || snapshot.ohlcv.bars !== snapshot.bars) blockers.push('ohlcv: normalized bars required');
  if (!snapshot?.technicals || typeof snapshot.technicals !== 'object') blockers.push('technicals: object required');
  if (!snapshot?.company || typeof snapshot.company !== 'object') blockers.push('company: object required');
  if (!snapshot?.sessionInfo || typeof snapshot.sessionInfo !== 'object') blockers.push('sessionInfo: object required');
  if (!Array.isArray(snapshot?.news)) blockers.push('news: array required');
  if (!snapshot?.options || typeof snapshot.options !== 'object') blockers.push('options: object required');
  if (snapshot?.stale) warnings.push('snapshot: stale');
  if (snapshot?.completeness?.score < 50) warnings.push('snapshot: low optional-data completeness');
  return Object.freeze({ valid: blockers.length === 0, blockers: Object.freeze(blockers), warnings: Object.freeze(warnings) });
}

export function createMarketSnapshot(raw, {
  symbol,
  provider,
  timeframe = '5m',
  now = Date.now(),
  maxAgeMs = 900_000,
  minimumBars = 1,
  requirePrice = true,
  rejectStale = true,
  minimumQualityScore = 60,
  atrPeriod = 14,
  relativeVolumeLookback = 20,
  pocBuckets = 24,
} = {}) {
  if (!raw || typeof raw !== 'object') throw new MarketDataQualityError('Market-data provider returned an invalid snapshot.');
  const normalizedSymbol = normalizeSymbol(symbol || raw.symbol);
  const normalizedTimeframe = normalizeTimeframe(timeframe || raw.timeframe);
  const bars = normalizeBars(raw.bars ?? raw.ohlcv?.bars);
  const quote = normalizeQuote(raw.quote || raw);
  const latestBar = bars.length ? bars[bars.length - 1] : null;
  const lastPrice = quote.last ?? latestBar?.close ?? null;
  const fetchedAtMs = timestampMilliseconds(raw.fetchedAt, now) || now;
  const dataTimestamp = newestTimestamp(raw, bars, quote, fetchedAtMs);
  const ageMs = Math.max(0, now - dataTimestamp);
  const stale = Number(maxAgeMs) > 0 && ageMs > Number(maxAgeMs);
  const blockers = [];
  const warnings = [];

  if (bars.length < Number(minimumBars)) blockers.push(`bars: ${bars.length} is below required minimum ${Number(minimumBars)}`);
  if (requirePrice && (!Number.isFinite(lastPrice) || lastPrice <= 0)) blockers.push('price: no valid latest price');
  if (Number.isFinite(quote.bid) && Number.isFinite(quote.ask) && quote.ask < quote.bid) blockers.push('quote: crossed bid/ask');
  if (stale) {
    const message = `timestamp: market data is stale by ${ageMs}ms`;
    if (rejectStale) blockers.push(message);
    else warnings.push(message);
  }
  if (!bars.length) warnings.push('bars: no OHLCV bars supplied');
  if (!Number.isFinite(quote.bid) || !Number.isFinite(quote.ask)) warnings.push('quote: spread unavailable');

  let qualityScore = 100;
  qualityScore -= Math.min(45, blockers.length * 25);
  qualityScore -= Math.min(30, warnings.length * 10);
  if (bars.length && bars.length < 20) qualityScore -= 5;
  if (Number.isFinite(quote.spreadBps) && quote.spreadBps > 100) qualityScore -= 15;
  qualityScore = Math.max(0, Math.min(100, qualityScore));
  if (qualityScore < Number(minimumQualityScore)) blockers.push(`quality: ${qualityScore} is below minimum ${Number(minimumQualityScore)}`);

  if (blockers.length) {
    throw new MarketDataQualityError(`Market-data quality validation failed for ${normalizedSymbol}.`, {
      symbol: normalizedSymbol,
      provider: String(provider || raw.provider || 'unknown'),
      blockers,
      warnings,
      qualityScore,
      ageMs,
    });
  }

  const company = normalizeCompany(raw);
  const sessionInfo = normalizeSession(raw, quote);
  const news = normalizeNews(raw);
  const options = normalizeOptions(raw);
  const technicalSource = raw.technicals || raw.indicators || {};
  const atr = finiteNumber(raw.atr ?? technicalSource.atr) ?? calculateAtr(bars, atrPeriod);
  const vwap = finiteNumber(raw.vwap ?? technicalSource.vwap) ?? calculateVwap(bars);
  const poc = finiteNumber(raw.poc ?? raw.pointOfControl ?? technicalSource.poc) ?? calculatePoc(bars, pocBuckets);
  const rvol = normalizedRatio(raw.rvol ?? raw.relativeVolume ?? technicalSource.rvol) ?? calculateRelativeVolume(bars, relativeVolumeLookback);
  const technicals = Object.freeze({
    atr,
    atrPeriod: Math.max(1, Math.floor(Number(atrPeriod) || 14)),
    vwap,
    poc,
    pocMethod: finiteNumber(raw.poc ?? raw.pointOfControl ?? technicalSource.poc) === null ? 'BAR_VOLUME_PROFILE' : 'PROVIDER',
    rvol,
    relativeVolumeLookback: Math.max(1, Math.floor(Number(relativeVolumeLookback) || 20)),
  });
  const ohlcv = Object.freeze({
    timeframe: normalizedTimeframe,
    count: bars.length,
    bars,
    latest: latestBar,
  });
  const liquidity = Object.freeze({
    spread: quote.spread,
    spreadBps: quote.spreadBps,
    spreadPercent: quote.spreadPercent,
    bidSize: quote.bidSize,
    askSize: quote.askSize,
    relativeVolume: rvol,
    float: company.float,
  });

  const snapshot = {
    schema: MARKET_SNAPSHOT_SCHEMA,
    schemaVersion: MARKET_SNAPSHOT_VERSION,
    symbol: normalizedSymbol,
    provider: String(provider || raw.provider || 'unknown'),
    timeframe: normalizedTimeframe,
    bars,
    ohlcv,
    quote,
    lastPrice,
    volume: finiteNumber(raw.volume, quote.volume || latestBar?.volume || 0),
    technicals,
    liquidity,
    company,
    session: sessionInfo.key,
    sessionInfo,
    news,
    options,
    atr,
    vwap,
    poc,
    spread: quote.spread,
    spreadBps: quote.spreadBps,
    float: company.float,
    sector: company.sector,
    industry: company.industry,
    rvol,
    dataTimestamp,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    ageMs,
    stale,
    observationOnly: true,
    executionEnabled: false,
    quality: Object.freeze({
      valid: true,
      score: qualityScore,
      warnings: Object.freeze(warnings),
    }),
    rawMetadata: raw.metadata && typeof raw.metadata === 'object' ? Object.freeze({ ...raw.metadata }) : Object.freeze({}),
  };
  snapshot.completeness = buildCompleteness(snapshot);
  const validation = validateUnifiedMarketSnapshot(snapshot);
  if (!validation.valid) {
    throw new MarketDataQualityError(`Unified MarketSnapshot validation failed for ${normalizedSymbol}.`, validation);
  }
  snapshot.validation = validation;
  return deepFreeze(snapshot);
}
