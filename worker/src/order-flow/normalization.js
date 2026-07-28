import { createOrderFlowConfig } from './config.js';

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function timestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : NaN;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function normalizeQuote(raw, index) {
  return {
    quoteId: String(raw.quoteId ?? raw.id ?? `quote-${index}`),
    timestamp: timestamp(raw.timestamp ?? raw.t),
    bid: number(raw.bid ?? raw.bp),
    ask: number(raw.ask ?? raw.ap),
    bidSize: Math.max(0, number(raw.bidSize ?? raw.bs ?? 0)),
    askSize: Math.max(0, number(raw.askSize ?? raw.as ?? 0)),
    exchange: String(raw.exchange ?? raw.x ?? ''),
  };
}

function normalizeTrade(raw, index) {
  const providerSide = String(raw.aggressorSide ?? raw.side ?? raw.takerSide ?? '').toUpperCase();
  return {
    tradeId: String(raw.tradeId ?? raw.id ?? `trade-${index}`),
    timestamp: timestamp(raw.timestamp ?? raw.t),
    receivedAt: timestamp(raw.receivedAt ?? raw.reportedAt ?? raw.timestamp ?? raw.t),
    price: number(raw.price ?? raw.p),
    size: number(raw.size ?? raw.s),
    exchange: String(raw.exchange ?? raw.x ?? ''),
    providerSide: ['BUY', 'SELL'].includes(providerSide) ? providerSide : null,
    conditions: Array.isArray(raw.conditions ?? raw.c) ? [...(raw.conditions ?? raw.c)] : [],
  };
}

export function normalizeOrderFlowData({ trades = [], quotes = [], now = Date.now(), tickSize = 0.01, config = null } = {}) {
  const validatedConfig = config || createOrderFlowConfig();
  const normalizedTick = Math.max(Number(tickSize) || 0.01, Number.EPSILON);
  const validQuotes = [];
  const rejectedQuotes = [];
  for (const [index, raw] of quotes.entries()) {
    const quote = normalizeQuote(raw, index);
    const reasons = [];
    if (![quote.timestamp, quote.bid, quote.ask].every(Number.isFinite)) reasons.push('INVALID_QUOTE_FIELDS');
    if (quote.bid <= 0 || quote.ask <= 0 || quote.ask < quote.bid) reasons.push('CROSSED_OR_INVALID_QUOTE');
    const midpoint = (quote.bid + quote.ask) / 2;
    const spreadPercent = midpoint > 0 ? (quote.ask - quote.bid) / midpoint * 100 : Infinity;
    if (spreadPercent > validatedConfig.validation.maximumSpreadPercent) reasons.push('QUOTE_SPREAD_TOO_WIDE');
    if (quote.timestamp > Number(now) + validatedConfig.validation.maximumFutureSkewMs) reasons.push('FUTURE_QUOTE_TIMESTAMP');
    if (reasons.length) rejectedQuotes.push({ quoteId: quote.quoteId, reasons });
    else validQuotes.push(freeze({ ...quote, spreadPercent }));
  }
  validQuotes.sort((left, right) => left.timestamp - right.timestamp);

  const validTrades = [];
  const rejectedTrades = [];
  for (const [index, raw] of trades.entries()) {
    const trade = normalizeTrade(raw, index);
    const reasons = [];
    if (![trade.timestamp, trade.receivedAt, trade.price, trade.size].every(Number.isFinite)) reasons.push('INVALID_TRADE_FIELDS');
    if (trade.price < validatedConfig.validation.minimumPrice) reasons.push('TRADE_PRICE_BELOW_MINIMUM');
    if (trade.size < validatedConfig.validation.minimumTradeSize) reasons.push('TRADE_SIZE_BELOW_MINIMUM');
    if (trade.timestamp > Number(now) + validatedConfig.validation.maximumFutureSkewMs) reasons.push('FUTURE_TRADE_TIMESTAMP');
    const reportDelayMs = trade.receivedAt - trade.timestamp;
    if (reportDelayMs > validatedConfig.validation.maximumTradeReportDelayMs) reasons.push('DELAYED_TRADE_PRINT');
    if (reasons.length) rejectedTrades.push({ tradeId: trade.tradeId, reasons, reportDelayMs });
    else validTrades.push(freeze({ ...trade, reportDelayMs }));
  }
  validTrades.sort((left, right) => left.timestamp - right.timestamp || left.tradeId.localeCompare(right.tradeId));

  return freeze({
    trades: validTrades,
    quotes: validQuotes,
    rejectedTrades,
    rejectedQuotes,
    tickSize: normalizedTick,
    evaluatedAt: Number(now),
    dataMode: validTrades.length ? 'TRADE_LEVEL_ORDER_FLOW' : 'INSUFFICIENT_DATA',
    observationOnly: true,
    executionAllowed: false,
  });
}
