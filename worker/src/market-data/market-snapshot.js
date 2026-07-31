import { finiteNumber, normalizeSymbol, normalizeTimeframe, timestampMilliseconds } from './provider-utils.js';

export class MarketDataQualityError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'MarketDataQualityError';
    this.details = Object.freeze({ ...details });
  }
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
  const spreadBps = Number.isFinite(spread) && spread >= 0 && Number.isFinite(last) && last > 0 ? (spread / last) * 10_000 : null;

  return Object.freeze({
    bid,
    ask,
    last,
    bidSize,
    askSize,
    spread,
    spreadBps,
    volume,
    timestamp,
    preMarketPrice,
    afterHoursPrice,
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
} = {}) {
  if (!raw || typeof raw !== 'object') throw new MarketDataQualityError('Market-data provider returned an invalid snapshot.');
  const normalizedSymbol = normalizeSymbol(symbol || raw.symbol);
  const normalizedTimeframe = normalizeTimeframe(timeframe || raw.timeframe);
  const bars = normalizeBars(raw.bars);
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

  return Object.freeze({
    symbol: normalizedSymbol,
    provider: String(provider || raw.provider || 'unknown'),
    timeframe: normalizedTimeframe,
    bars,
    quote,
    lastPrice,
    volume: finiteNumber(raw.volume, quote.volume || latestBar?.volume || 0),
    session: String(raw.session || 'unknown'),
    dataTimestamp,
    fetchedAt: new Date(fetchedAtMs).toISOString(),
    ageMs,
    stale,
    quality: Object.freeze({
      valid: true,
      score: qualityScore,
      warnings: Object.freeze(warnings),
    }),
    rawMetadata: raw.metadata && typeof raw.metadata === 'object' ? Object.freeze({ ...raw.metadata }) : Object.freeze({}),
  });
}
