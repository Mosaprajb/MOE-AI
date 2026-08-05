import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-market-screener-entry.js';
import { AUTO_SCANNER_SYMBOLS } from './auto-scanner.js';

export { AlertCoordinator, SimulationDriver };

const MARKET_SCREENER_PATH = '/api/mobile/market-screener';
const WATCHLIST_QUOTES_PATH = '/api/mobile/watchlist/quotes';
const MAX_SCANNER_SYMBOLS = 30;
const PRIMARY_BATCH_SIZE = 20;
const RETRY_BATCH_SIZE = 5;
const SCREENER_RESULT_LIMIT = 60;

const PREFERRED_SYMBOLS = [
  'NVDA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'GOOG', 'TSLA', 'AMD', 'INTC',
  'AVGO', 'NFLX', 'PLTR', 'SMCI', 'SOFI', 'PATH', 'RIVN', 'UBER', 'LYFT', 'HIMS',
  'CELH', 'U', 'IONQ', 'RBLX', 'SNAP', 'AMC', 'F', 'GM', 'COIN', 'HOOD',
  'SPY', 'QQQ', 'IWM', 'DIA', 'XLF', 'XLE', 'XLK', 'JPM', 'BAC', 'C',
  'WFC', 'V', 'MA', 'PYPL', 'SHOP', 'CRM', 'ORCL', 'ADBE', 'MU', 'QCOM',
  'ARM', 'DELL', 'NVO', 'LLY', 'UNH', 'PFE', 'MRNA', 'XOM', 'CVX', 'SLB',
  'BA', 'CAT', 'FDX', 'UPS', 'DIS', 'NKE', 'SBUX', 'WMT', 'COST', 'TGT',
];

const COMPANY_NAMES = Object.freeze({
  NVDA: 'NVIDIA Corporation', AAPL: 'Apple Inc.', MSFT: 'Microsoft Corporation',
  AMZN: 'Amazon.com, Inc.', META: 'Meta Platforms, Inc.', GOOGL: 'Alphabet Inc.',
  GOOG: 'Alphabet Inc.', TSLA: 'Tesla, Inc.', AMD: 'Advanced Micro Devices, Inc.',
  INTC: 'Intel Corporation', AVGO: 'Broadcom Inc.', NFLX: 'Netflix, Inc.',
  PLTR: 'Palantir Technologies Inc.', SMCI: 'Super Micro Computer, Inc.',
  SOFI: 'SoFi Technologies, Inc.', PATH: 'UiPath Inc.', RIVN: 'Rivian Automotive, Inc.',
  UBER: 'Uber Technologies, Inc.', LYFT: 'Lyft, Inc.', HIMS: 'Hims & Hers Health, Inc.',
  CELH: 'Celsius Holdings, Inc.', U: 'Unity Software Inc.', IONQ: 'IonQ, Inc.',
  RBLX: 'Roblox Corporation', SNAP: 'Snap Inc.', AMC: 'AMC Entertainment Holdings, Inc.',
  F: 'Ford Motor Company', GM: 'General Motors Company', COIN: 'Coinbase Global, Inc.',
  HOOD: 'Robinhood Markets, Inc.', SPY: 'SPDR S&P 500 ETF Trust',
  QQQ: 'Invesco QQQ Trust', IWM: 'iShares Russell 2000 ETF', DIA: 'SPDR Dow Jones ETF',
  XLF: 'Financial Select Sector SPDR Fund', XLE: 'Energy Select Sector SPDR Fund',
  XLK: 'Technology Select Sector SPDR Fund', JPM: 'JPMorgan Chase & Co.',
  BAC: 'Bank of America Corporation', C: 'Citigroup Inc.', WFC: 'Wells Fargo & Company',
  V: 'Visa Inc.', MA: 'Mastercard Incorporated', PYPL: 'PayPal Holdings, Inc.',
  SHOP: 'Shopify Inc.', CRM: 'Salesforce, Inc.', ORCL: 'Oracle Corporation',
  ADBE: 'Adobe Inc.', MU: 'Micron Technology, Inc.', QCOM: 'QUALCOMM Incorporated',
  ARM: 'Arm Holdings plc', DELL: 'Dell Technologies Inc.', NVO: 'Novo Nordisk A/S',
  LLY: 'Eli Lilly and Company', UNH: 'UnitedHealth Group Incorporated',
  PFE: 'Pfizer Inc.', MRNA: 'Moderna, Inc.', XOM: 'Exxon Mobil Corporation',
  CVX: 'Chevron Corporation', SLB: 'SLB', BA: 'The Boeing Company',
  CAT: 'Caterpillar Inc.', FDX: 'FedEx Corporation', UPS: 'United Parcel Service, Inc.',
  DIS: 'The Walt Disney Company', NKE: 'NIKE, Inc.', SBUX: 'Starbucks Corporation',
  WMT: 'Walmart Inc.', COST: 'Costco Wholesale Corporation', TGT: 'Target Corporation',
});

const SECTORS = Object.freeze({
  NVDA: 'Technology', AAPL: 'Technology', MSFT: 'Technology', AMZN: 'Consumer',
  META: 'Communication', GOOGL: 'Communication', GOOG: 'Communication', TSLA: 'Automotive',
  AMD: 'Technology', INTC: 'Technology', AVGO: 'Technology', NFLX: 'Communication',
  PLTR: 'Technology', SMCI: 'Technology', SOFI: 'Financial', PATH: 'Technology',
  RIVN: 'Automotive', UBER: 'Industrials', LYFT: 'Industrials', HIMS: 'Healthcare',
  CELH: 'Consumer', U: 'Technology', IONQ: 'Technology', RBLX: 'Communication',
  SNAP: 'Communication', AMC: 'Communication', F: 'Automotive', GM: 'Automotive',
  COIN: 'Financial', HOOD: 'Financial', JPM: 'Financial', BAC: 'Financial',
  C: 'Financial', WFC: 'Financial', V: 'Financial', MA: 'Financial', PYPL: 'Financial',
  SHOP: 'Technology', CRM: 'Technology', ORCL: 'Technology', ADBE: 'Technology',
  MU: 'Technology', QCOM: 'Technology', ARM: 'Technology', DELL: 'Technology',
  NVO: 'Healthcare', LLY: 'Healthcare', UNH: 'Healthcare', PFE: 'Healthcare',
  MRNA: 'Healthcare', XOM: 'Energy', CVX: 'Energy', SLB: 'Energy', BA: 'Industrials',
  CAT: 'Industrials', FDX: 'Industrials', UPS: 'Industrials', DIS: 'Communication',
  NKE: 'Consumer', SBUX: 'Consumer', WMT: 'Consumer', COST: 'Consumer', TGT: 'Consumer',
});

function json(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-market-screener': 'mobile-resilient-v2',
      ...extraHeaders,
    },
  });
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function mobileRequestAllowed(request) {
  return sameOrigin(request) && request.headers.get('x-moe-mobile-client') === '1';
}

function normalizedSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) ? symbol : null;
}

function screenerUniverse() {
  const supported = new Set((Array.isArray(AUTO_SCANNER_SYMBOLS) ? AUTO_SCANNER_SYMBOLS : [])
    .map(normalizedSymbol)
    .filter(Boolean));
  const preferred = PREFERRED_SYMBOLS.filter((symbol) => supported.has(symbol));
  const remainder = [...supported].filter((symbol) => !preferred.includes(symbol));
  return [...preferred, ...remainder].slice(0, SCREENER_RESULT_LIMIT);
}

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size) output.push(values.slice(index, index + size));
  return output;
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function rowFromQuote(symbol, quote = {}) {
  return {
    symbol,
    name: COMPANY_NAMES[symbol] || `${symbol} stock`,
    sector: SECTORS[symbol] || 'United States',
    price: number(quote.price),
    change: number(quote.change),
    changePercent: number(quote.changePercent),
    volume: number(quote.volume),
    bid: number(quote.bid),
    ask: number(quote.ask),
    high: number(quote.high),
    low: number(quote.low),
    session: quote.session || 'CLOSED',
    tradeTimestamp: quote.tradeTimestamp || null,
    available: quote.available === true && number(quote.price) != null,
  };
}

function filterRows(rows, searchParams) {
  const search = String(searchParams.get('search') || '').trim().toUpperCase();
  const priceBand = String(searchParams.get('price') || 'ALL').trim().toUpperCase();
  const movement = String(searchParams.get('movement') || 'ALL').trim().toUpperCase();
  const sector = String(searchParams.get('sector') || 'ALL').trim().toUpperCase();
  const sort = String(searchParams.get('sort') || 'VOLUME').trim().toUpperCase();

  const filtered = rows.filter((row) => {
    if (search && !row.symbol.includes(search) && !row.name.toUpperCase().includes(search)) return false;
    if (sector !== 'ALL' && row.sector.toUpperCase() !== sector) return false;
    if (movement === 'GAINERS' && !(number(row.changePercent, 0) > 0)) return false;
    if (movement === 'LOSERS' && !(number(row.changePercent, 0) < 0)) return false;
    if (priceBand === 'UNDER_10' && !(number(row.price, Infinity) < 10)) return false;
    if (priceBand === '10_50' && !(number(row.price, -1) >= 10 && number(row.price, Infinity) <= 50)) return false;
    if (priceBand === '50_200' && !(number(row.price, -1) > 50 && number(row.price, Infinity) <= 200)) return false;
    if (priceBand === 'OVER_200' && !(number(row.price, -1) > 200)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    if (sort === 'CHANGE') return number(b.changePercent, -Infinity) - number(a.changePercent, -Infinity);
    if (sort === 'PRICE_ASC') return number(a.price, Infinity) - number(b.price, Infinity);
    if (sort === 'PRICE_DESC') return number(b.price, -Infinity) - number(a.price, -Infinity);
    if (sort === 'SYMBOL') return a.symbol.localeCompare(b.symbol);
    return number(b.volume, -Infinity) - number(a.volume, -Infinity);
  });
  return filtered;
}

function errorText(reason) {
  if (reason instanceof Error && reason.message) return reason.message;
  return String(reason || 'Unknown quote error.');
}

async function readQuoteBatch(request, env, ctx, symbols) {
  const url = new URL(WATCHLIST_QUOTES_PATH, request.url);
  url.searchParams.set('symbols', symbols.join(','));
  url.searchParams.set('t', String(Date.now()));
  const internalRequest = new Request(url.toString(), {
    method: 'GET',
    headers: {
      accept: 'application/json',
      'x-moe-mobile-client': '1',
    },
  });
  const response = await baseWorker.fetch(internalRequest, env, ctx);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok !== true) {
    throw new Error(payload?.error || `Quote batch failed with HTTP ${response.status}.`);
  }
  return Array.isArray(payload.quotes) ? payload.quotes : [];
}

async function settleQuoteBatches(request, env, ctx, batches) {
  const settled = await Promise.allSettled(
    batches.map((batch) => readQuoteBatch(request, env, ctx, batch)),
  );
  return settled.map((result, index) => ({
    batch: batches[index],
    result,
  }));
}

async function readQuotesResiliently(request, env, ctx, symbols) {
  const quoteBySymbol = new Map();
  const warnings = [];
  const failedPrimarySymbols = [];
  let successfulBatches = 0;
  let failedBatches = 0;

  const primaryResults = await settleQuoteBatches(
    request,
    env,
    ctx,
    chunks(symbols, PRIMARY_BATCH_SIZE),
  );

  for (const item of primaryResults) {
    if (item.result.status === 'fulfilled') {
      successfulBatches += 1;
      for (const quote of item.result.value) {
        const symbol = normalizedSymbol(quote?.symbol);
        if (symbol) quoteBySymbol.set(symbol, quote);
      }
    } else {
      failedBatches += 1;
      failedPrimarySymbols.push(...item.batch);
      warnings.push(`Primary quote batch failed: ${errorText(item.result.reason)}`);
    }
  }

  if (failedPrimarySymbols.length) {
    const retryResults = await settleQuoteBatches(
      request,
      env,
      ctx,
      chunks(failedPrimarySymbols, RETRY_BATCH_SIZE),
    );
    for (const item of retryResults) {
      if (item.result.status === 'fulfilled') {
        successfulBatches += 1;
        for (const quote of item.result.value) {
          const symbol = normalizedSymbol(quote?.symbol);
          if (symbol) quoteBySymbol.set(symbol, quote);
        }
      } else {
        failedBatches += 1;
        warnings.push(`Retry quote batch failed for ${item.batch.join(',')}: ${errorText(item.result.reason)}`);
      }
    }
  }

  const failedSymbols = symbols.filter((symbol) => !quoteBySymbol.has(symbol));
  const availableCount = symbols.reduce((count, symbol) => {
    const quote = quoteBySymbol.get(symbol);
    return count + (quote?.available === true && number(quote?.price) != null ? 1 : 0);
  }, 0);

  return {
    quoteBySymbol,
    warnings,
    failedSymbols,
    availableCount,
    successfulBatches,
    failedBatches,
  };
}

async function handleMarketScreener(request, env, ctx) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!mobileRequestAllowed(request)) return json({ ok: false, error: 'Mobile screener access denied.' }, 403);

  const symbols = screenerUniverse();
  const result = await readQuotesResiliently(request, env, ctx, symbols);
  const rows = filterRows(
    symbols.map((symbol) => rowFromQuote(symbol, result.quoteBySymbol.get(symbol))),
    new URL(request.url).searchParams,
  );
  const degraded = result.failedSymbols.length > 0 || result.availableCount < symbols.length;
  const warning = result.availableCount === 0
    ? 'Live prices are temporarily unavailable. The stock list remains available for selection.'
    : degraded
      ? `${result.availableCount} of ${symbols.length} live prices loaded. Remaining symbols stay selectable.`
      : null;

  return json({
    ok: true,
    degraded,
    partial: result.availableCount > 0 && degraded,
    warning,
    rows,
    totalUniverse: symbols.length,
    resultCount: rows.length,
    availableCount: result.availableCount,
    unavailableCount: symbols.length - result.availableCount,
    failedSymbols: result.failedSymbols,
    batchSummary: {
      successful: result.successfulBatches,
      failed: result.failedBatches,
      primaryBatchSize: PRIMARY_BATCH_SIZE,
      retryBatchSize: RETRY_BATCH_SIZE,
    },
    maximumScannerSymbols: MAX_SCANNER_SYMBOLS,
    feed: 'IEX',
    updatedAt: new Date().toISOString(),
    liveTradingLocked: true,
    liveFundsUsed: false,
  }, 200, {
    'x-moe-market-screener-degraded': String(degraded),
    'x-moe-market-screener-available': String(result.availableCount),
  });
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === MARKET_SCREENER_PATH) return handleMarketScreener(request, env, ctx);
    return baseWorker.fetch(request, env, ctx);
  },
};
