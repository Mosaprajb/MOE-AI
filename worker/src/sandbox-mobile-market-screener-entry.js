import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-live-watchlist-entry.js';
import { AUTO_SCANNER_SYMBOLS } from './auto-scanner.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const MARKET_SCREENER_PATH = '/api/mobile/market-screener';
const WATCHLIST_QUOTES_PATH = '/api/mobile/watchlist/quotes';
const MAX_SCANNER_SYMBOLS = 30;
const SCREENER_BATCH_SIZE = 30;
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
      'x-moe-market-screener': 'mobile-v1',
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

async function handleMarketScreener(request, env, ctx) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!mobileRequestAllowed(request)) return json({ ok: false, error: 'Mobile screener access denied.' }, 403);

  const symbols = screenerUniverse();
  try {
    const batches = await Promise.all(chunks(symbols, SCREENER_BATCH_SIZE)
      .map((batch) => readQuoteBatch(request, env, ctx, batch)));
    const quoteBySymbol = new Map(batches.flat().map((quote) => [quote.symbol, quote]));
    const rows = filterRows(symbols.map((symbol) => rowFromQuote(symbol, quoteBySymbol.get(symbol))), new URL(request.url).searchParams);
    return json({
      ok: true,
      rows,
      totalUniverse: symbols.length,
      resultCount: rows.length,
      maximumScannerSymbols: MAX_SCANNER_SYMBOLS,
      feed: 'IEX',
      updatedAt: new Date().toISOString(),
      liveTradingLocked: true,
      liveFundsUsed: false,
    });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to load the market screener.',
      rows: [],
      maximumScannerSymbols: MAX_SCANNER_SYMBOLS,
      feed: 'IEX',
      updatedAt: new Date().toISOString(),
      liveTradingLocked: true,
      liveFundsUsed: false,
    }, 502);
  }
}

const SCREENER_STYLE = String.raw`
<style id="moe-market-screener-style">
.moe-screener-overlay{position:fixed;inset:0;z-index:1200;display:none;background:#080d13;color:#edf5fb;font-family:'Archivo',system-ui,sans-serif}.moe-screener-overlay[data-open="true"]{display:flex;flex-direction:column}
.moe-screener-header{display:grid;grid-template-columns:46px minmax(0,1fr) auto;gap:10px;align-items:center;padding:calc(14px + env(safe-area-inset-top)) 16px 13px;border-bottom:1px solid #24313d;background:rgba(8,13,19,.96);backdrop-filter:blur(18px)}
.moe-screener-close,.moe-screener-refresh{appearance:none;border:1px solid #2a3947;border-radius:14px;background:#111a24;color:#dbe8f2;height:42px;min-width:42px;font-size:20px}.moe-screener-refresh{padding:0 13px;font:800 11px 'IBM Plex Mono',monospace;color:#42d6d0}
.moe-screener-heading b{display:block;font-size:22px}.moe-screener-heading span{display:block;margin-top:2px;color:#8fa2b5;font:700 10px 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.08em}
.moe-screener-body{flex:1;min-height:0;overflow:auto;padding:15px 14px calc(118px + env(safe-area-inset-bottom))}
.moe-screener-search{position:relative;margin-bottom:13px}.moe-screener-search input{width:100%;box-sizing:border-box;border:1px solid #2a3947;border-radius:16px;background:#111a24;color:#edf5fb;padding:14px 42px 14px 15px;font-size:16px;outline:none}.moe-screener-search input:focus{border-color:#42d6d0;box-shadow:0 0 0 3px rgba(66,214,208,.11)}.moe-screener-search span{position:absolute;right:15px;top:50%;transform:translateY(-50%);color:#8fa2b5}
.moe-screener-filters{margin-bottom:14px;border:1px solid #263440;border-radius:18px;background:#0f1720;overflow:hidden}.moe-screener-filter-head{display:flex;align-items:center;justify-content:space-between;padding:13px 14px;border-bottom:1px solid #24313d}.moe-screener-filter-head b{font-size:15px}.moe-screener-filter-head span{color:#42d6d0;font:800 10px 'IBM Plex Mono',monospace}
.moe-screener-chip-row{display:flex;gap:8px;overflow:auto;padding:11px 12px;scrollbar-width:none}.moe-screener-chip-row+ .moe-screener-chip-row{padding-top:0}.moe-screener-chip{flex:none;appearance:none;border:1px solid #2a3947;border-radius:999px;background:#121c27;color:#aebdca;padding:8px 11px;font:800 10px 'IBM Plex Mono',monospace}.moe-screener-chip[data-active="true"]{border-color:#42d6d0;background:rgba(66,214,208,.15);color:#54e6df}
.moe-screener-sort{display:grid;grid-template-columns:1fr auto;gap:10px;align-items:center;padding:0 12px 12px;color:#8fa2b5;font:700 10px 'IBM Plex Mono',monospace}.moe-screener-sort select{appearance:none;border:1px solid #2a3947;border-radius:11px;background:#121c27;color:#edf5fb;padding:8px 28px 8px 10px;font:800 10px 'IBM Plex Mono',monospace}
.moe-screener-status{display:flex;justify-content:space-between;gap:10px;align-items:center;margin:0 2px 9px;color:#8fa2b5;font:700 10px 'IBM Plex Mono',monospace}.moe-screener-status strong{color:#42d6d0}.moe-screener-lock{display:none;margin-bottom:12px;padding:12px 13px;border:1px solid rgba(255,176,32,.45);border-radius:14px;background:rgba(255,176,32,.09);color:#ffd27a;font-size:12px;font-weight:800}.moe-screener-lock[data-show="true"]{display:block}
.moe-screener-table{border:1px solid #263440;border-radius:18px;overflow:hidden;background:#0f1720}.moe-screener-columns,.moe-screener-row{display:grid;grid-template-columns:38px minmax(112px,1.4fr) minmax(78px,.8fr) minmax(72px,.72fr) minmax(76px,.8fr);align-items:center;column-gap:8px}.moe-screener-columns{padding:10px 11px;border-bottom:1px solid #24313d;color:#8295a8;font:700 9px 'IBM Plex Mono',monospace;text-transform:uppercase}.moe-screener-row{position:relative;padding:12px 11px;border-bottom:1px solid rgba(36,49,61,.86);cursor:pointer;touch-action:manipulation}.moe-screener-row:last-child{border-bottom:0}.moe-screener-row[data-selected="true"]{background:rgba(66,214,208,.075)}.moe-screener-row[data-saved="true"]{background:rgba(74,222,128,.055)}
.moe-screener-check{width:25px;height:25px;border:1.5px solid #526575;border-radius:50%;display:grid;place-items:center;color:#061016;font-size:14px;font-weight:1000}.moe-screener-row[data-selected="true"] .moe-screener-check{border-color:#42d6d0;background:#42d6d0}.moe-screener-row[data-saved="true"] .moe-screener-check{border-color:#4ade80;background:#4ade80}.moe-screener-row[data-locked="true"]{opacity:.65}
.moe-screener-symbol{min-width:0}.moe-screener-symbol b{display:block;font-size:16px}.moe-screener-symbol span{display:block;margin-top:3px;color:#8fa2b5;font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.moe-screener-price,.moe-screener-change,.moe-screener-volume{font:800 11px 'IBM Plex Mono',monospace;text-align:right;font-variant-numeric:tabular-nums}.moe-screener-change.up{color:#42d994}.moe-screener-change.down{color:#ff5f70}.moe-screener-change.flat{color:#8fa2b5}.moe-screener-saved{display:inline-flex;margin-top:4px;padding:2px 5px;border-radius:6px;background:rgba(74,222,128,.12);color:#4ade80!important;font:800 8px 'IBM Plex Mono',monospace;text-transform:uppercase}
.moe-screener-empty{padding:42px 20px;text-align:center;color:#8fa2b5}.moe-screener-empty b{display:block;color:#edf5fb;font-size:16px;margin-bottom:6px}.moe-screener-loading{padding:38px 20px;text-align:center;color:#42d6d0;font:800 11px 'IBM Plex Mono',monospace}
.moe-screener-footer{position:fixed;left:0;right:0;bottom:0;z-index:2;display:grid;grid-template-columns:1fr 1.45fr;gap:10px;padding:12px 14px calc(12px + env(safe-area-inset-bottom));border-top:1px solid #263440;background:rgba(8,13,19,.96);backdrop-filter:blur(18px)}.moe-screener-footer button{appearance:none;border-radius:15px;height:54px;font-size:14px;font-weight:900}.moe-screener-select-visible{border:1px solid #2a3947;background:#121c27;color:#dbe8f2}.moe-screener-add{border:1px solid #42d6d0;background:#42d6d0;color:#071114}.moe-screener-add:disabled,.moe-screener-select-visible:disabled{opacity:.42}
.moe-screener-toast{position:fixed;left:50%;bottom:calc(90px + env(safe-area-inset-bottom));z-index:3;transform:translate(-50%,18px);width:min(90vw,480px);box-sizing:border-box;padding:13px 15px;border:1px solid #376077;border-radius:14px;background:#10202c;color:#eaf7ff;box-shadow:0 18px 55px rgba(0,0,0,.48);font-size:12px;font-weight:800;opacity:0;pointer-events:none;transition:.2s}.moe-screener-toast[data-show="true"]{opacity:1;transform:translate(-50%,0)}
@media(max-width:430px){.moe-screener-columns,.moe-screener-row{grid-template-columns:34px minmax(104px,1.3fr) 72px 68px 70px;column-gap:5px}.moe-screener-body{padding-left:10px;padding-right:10px}.moe-screener-columns,.moe-screener-row{padding-left:8px;padding-right:8px}}
</style>`;

const SCREENER_SHELL = String.raw`
<section class="moe-screener-overlay" id="moeMarketScreener" data-open="false" aria-hidden="true">
  <header class="moe-screener-header">
    <button type="button" class="moe-screener-close" data-screener-close aria-label="Close">×</button>
    <div class="moe-screener-heading"><b>Market Screener</b><span>Live IEX prices · choose stocks for the scanner</span></div>
    <button type="button" class="moe-screener-refresh" data-screener-refresh>Refresh</button>
  </header>
  <div class="moe-screener-body">
    <div class="moe-screener-search"><input id="moeScreenerSearch" type="search" placeholder="Search ticker or company" autocomplete="off"><span>⌕</span></div>
    <section class="moe-screener-filters">
      <div class="moe-screener-filter-head"><b>Screener filters</b><span data-screener-filter-summary>United States · IEX</span></div>
      <div class="moe-screener-chip-row" data-filter-group="price">
        <button class="moe-screener-chip" data-filter-value="ALL" data-active="true">All prices</button>
        <button class="moe-screener-chip" data-filter-value="UNDER_10">Under $10</button>
        <button class="moe-screener-chip" data-filter-value="10_50">$10–$50</button>
        <button class="moe-screener-chip" data-filter-value="50_200">$50–$200</button>
        <button class="moe-screener-chip" data-filter-value="OVER_200">Over $200</button>
      </div>
      <div class="moe-screener-chip-row" data-filter-group="movement">
        <button class="moe-screener-chip" data-filter-value="ALL" data-active="true">All moves</button>
        <button class="moe-screener-chip" data-filter-value="GAINERS">Gainers</button>
        <button class="moe-screener-chip" data-filter-value="LOSERS">Losers</button>
      </div>
      <label class="moe-screener-sort"><span>Sort results</span><select id="moeScreenerSort"><option value="VOLUME">Highest volume</option><option value="CHANGE">Top gainers</option><option value="PRICE_ASC">Lowest price</option><option value="PRICE_DESC">Highest price</option><option value="SYMBOL">Symbol A–Z</option></select></label>
    </section>
    <div class="moe-screener-lock" data-screener-lock>🔒 Scanner active. Stop trading before changing the selected stocks.</div>
    <div class="moe-screener-status"><span><strong data-screener-results>0</strong> results</span><span data-screener-updated>Waiting for market data</span></div>
    <section class="moe-screener-table">
      <div class="moe-screener-columns"><span></span><span>Symbol</span><span style="text-align:right">Price</span><span style="text-align:right">Change</span><span style="text-align:right">Volume</span></div>
      <div data-screener-list><div class="moe-screener-loading">Loading live market data…</div></div>
    </section>
  </div>
  <footer class="moe-screener-footer">
    <button type="button" class="moe-screener-select-visible" data-screener-select-visible>Select visible</button>
    <button type="button" class="moe-screener-add" data-screener-add disabled>Add to scanner (0)</button>
  </footer>
  <div class="moe-screener-toast" data-screener-toast role="status" aria-live="polite"></div>
</section>`;

const SCREENER_SCRIPT = String.raw`
<script id="moe-market-screener-script">
(function(){
  if(window.__moeMarketScreenerV1)return;
  window.__moeMarketScreenerV1=true;
  var root=document.getElementById('moeMarketScreener');
  if(!root)return;
  var rows=[],saved=new Set(),pending=new Set(),locked=false,loading=false,price='ALL',movement='ALL',sort='VOLUME',search='',refreshTimer=null,searchTimer=null,toastTimer=null;
  function qs(selector){return root.querySelector(selector);}
  function qsa(selector){return Array.from(root.querySelectorAll(selector));}
  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}
  function num(value){var parsed=Number(value);return Number.isFinite(parsed)?parsed:null;}
  function money(value){var parsed=num(value);return parsed==null?'—':'$'+parsed.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:parsed<10?3:2});}
  function signed(value){var parsed=num(value);return parsed==null?'—':(parsed>0?'+':'')+parsed.toFixed(2)+'%';}
  function volume(value){var parsed=num(value);if(parsed==null)return '—';if(parsed>=1e9)return (parsed/1e9).toFixed(1)+'B';if(parsed>=1e6)return (parsed/1e6).toFixed(1)+'M';if(parsed>=1e3)return (parsed/1e3).toFixed(1)+'K';return String(Math.round(parsed));}
  function tone(value){var parsed=num(value);return parsed==null||parsed===0?'flat':parsed>0?'up':'down';}
  function toast(message){var node=qs('[data-screener-toast]');node.textContent=message;node.dataset.show='true';clearTimeout(toastTimer);toastTimer=setTimeout(function(){node.dataset.show='false';},3300);}
  function visibleRows(){return rows;}
  function renderFooter(){var add=qs('[data-screener-add]'),select=qs('[data-screener-select-visible]');add.textContent='Add to scanner ('+pending.size+')';add.disabled=locked||loading||pending.size===0;select.disabled=locked||loading||visibleRows().every(function(row){return saved.has(row.symbol)||pending.has(row.symbol);});}
  function render(){var list=qs('[data-screener-list]');qs('[data-screener-results]').textContent=String(rows.length);qs('[data-screener-lock]').dataset.show=String(locked);if(loading){list.innerHTML='<div class="moe-screener-loading">Loading live market data…</div>';renderFooter();return;}if(!rows.length){list.innerHTML='<div class="moe-screener-empty"><b>No matching stocks</b><span>Change the filters or search for another ticker.</span></div>';renderFooter();return;}list.innerHTML=rows.map(function(row){var isSaved=saved.has(row.symbol),isPending=pending.has(row.symbol),isSelected=isSaved||isPending;var savedLabel=isSaved?'<span class="moe-screener-saved">In scanner</span>':'';return '<div class="moe-screener-row" data-screener-symbol="'+esc(row.symbol)+'" data-selected="'+String(isPending)+'" data-saved="'+String(isSaved)+'" data-locked="'+String(locked)+'"><span class="moe-screener-check">'+(isSelected?'✓':'')+'</span><span class="moe-screener-symbol"><b>'+esc(row.symbol)+'</b><span>'+esc(row.name)+'</span>'+savedLabel+'</span><span class="moe-screener-price">'+money(row.price)+'</span><span class="moe-screener-change '+tone(row.changePercent)+'">'+signed(row.changePercent)+'</span><span class="moe-screener-volume">'+volume(row.volume)+'</span></div>';}).join('');renderFooter();}
  async function api(url,options){var response=await fetch(url,Object.assign({cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}},options||{}));var payload=await response.json().catch(function(){return {};});if(!response.ok||payload.ok===false)throw new Error(payload.alert||payload.error||('HTTP '+response.status));return payload;}
  async function loadState(){var payload=await api('/api/mobile/watchlist/state?t='+Date.now());locked=payload.locked===true;saved=new Set((payload.symbols||[]).map(function(symbol){return String(symbol).toUpperCase();}));Array.from(pending).forEach(function(symbol){if(saved.has(symbol))pending.delete(symbol);});render();}
  function query(){var params=new URLSearchParams({price:price,movement:movement,sort:sort,search:search,t:String(Date.now())});return '/api/mobile/market-screener?'+params.toString();}
  async function loadRows(force){if(loading&&!force)return;loading=true;render();try{var payload=await api(query());rows=Array.isArray(payload.rows)?payload.rows:[];var updated=payload.updatedAt?new Date(payload.updatedAt):new Date();qs('[data-screener-updated]').textContent='Updated '+updated.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'});render();}catch(error){rows=[];qs('[data-screener-list]').innerHTML='<div class="moe-screener-empty"><b>Market data unavailable</b><span>'+esc(error.message||'Try again.')+'</span></div>';toast(error.message||'Unable to load the screener.');}finally{loading=false;render();}}
  async function open(){root.dataset.open='true';root.setAttribute('aria-hidden','false');document.body.style.overflow='hidden';pending.clear();try{await loadState();await loadRows(true);}catch(error){toast(error.message||'Unable to open the screener.');}clearInterval(refreshTimer);refreshTimer=setInterval(function(){if(root.dataset.open==='true'&&!document.hidden)loadRows(false);},5000);}
  function close(){root.dataset.open='false';root.setAttribute('aria-hidden','true');document.body.style.overflow='';clearInterval(refreshTimer);}
  function toggle(symbol){if(locked){toast('Scanner active. Stop trading before adding stocks.');return;}if(saved.has(symbol)){toast(symbol+' is already in the scanner.');return;}if(pending.has(symbol))pending.delete(symbol);else{if(saved.size+pending.size>=30){toast('The mobile scanner supports up to 30 selected stocks.');return;}pending.add(symbol);}render();}
  function selectVisible(){if(locked){toast('Scanner active. Stop trading before changing stocks.');return;}var available=30-saved.size-pending.size;visibleRows().forEach(function(row){if(available>0&&!saved.has(row.symbol)&&!pending.has(row.symbol)){pending.add(row.symbol);available-=1;}});render();}
  async function save(){if(locked||pending.size===0)return;var symbols=Array.from(new Set(Array.from(saved).concat(Array.from(pending)))).slice(0,30);var button=qs('[data-screener-add]');button.disabled=true;button.textContent='Saving…';try{var response=await fetch('/api/scanner/source-mode',{method:'PUT',cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','content-type':'application/json','x-moe-mobile-client':'1'},body:JSON.stringify({mode:'CURATED_UNIVERSE',symbols:symbols})});var payload=await response.json().catch(function(){return {};});if(!response.ok)throw new Error(payload.alert||payload.error||('HTTP '+response.status));saved=new Set(symbols);pending.clear();try{if(typeof state!=='undefined'&&Array.isArray(state.symbols)){state.symbols=symbols.slice();if(typeof renderChips==='function')renderChips();}}catch(_){}if(typeof window.__moeRefreshSelectedWatchlist==='function')await window.__moeRefreshSelectedWatchlist();window.dispatchEvent(new CustomEvent('moe:screener-symbols-saved',{detail:{symbols:symbols}}));toast(symbols.length+' stocks saved to the scanner.');render();}catch(error){toast(error.message||'Could not save the selected stocks.');try{await loadState();}catch(_){}render();}}
  qsa('[data-filter-group]').forEach(function(group){group.addEventListener('click',function(event){var button=event.target.closest('[data-filter-value]');if(!button)return;group.querySelectorAll('[data-filter-value]').forEach(function(node){node.dataset.active='false';});button.dataset.active='true';if(group.dataset.filterGroup==='price')price=button.dataset.filterValue;else movement=button.dataset.filterValue;loadRows(true);});});
  qs('#moeScreenerSort').addEventListener('change',function(event){sort=event.target.value;loadRows(true);});
  qs('#moeScreenerSearch').addEventListener('input',function(event){search=String(event.target.value||'').trim();clearTimeout(searchTimer);searchTimer=setTimeout(function(){loadRows(true);},260);});
  qs('[data-screener-list]').addEventListener('click',function(event){var row=event.target.closest('[data-screener-symbol]');if(row)toggle(row.dataset.screenerSymbol);});
  qs('[data-screener-select-visible]').addEventListener('click',selectVisible);
  qs('[data-screener-add]').addEventListener('click',save);
  qs('[data-screener-refresh]').addEventListener('click',function(){Promise.all([loadState(),loadRows(true)]);});
  qsa('[data-screener-close]').forEach(function(button){button.addEventListener('click',close);});
  document.addEventListener('keydown',function(event){if(event.key==='Escape'&&root.dataset.open==='true')close();});
  function wireButton(){var button=document.getElementById('openSymbols');if(!button||button.dataset.marketScreenerReady==='true')return;button.dataset.marketScreenerReady='true';button.innerHTML='<span>Open market screener</span><span aria-hidden="true">›</span>';button.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();open();},true);}
  wireButton();new MutationObserver(wireButton).observe(document.body,{childList:true,subtree:true});window.__moeOpenMarketScreener=open;
})();
</script>`;

async function enhanceMobileScreener(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  let output = html;
  if (!output.includes('id="moe-market-screener-style"')) {
    output = output.includes('</head>')
      ? output.replace('</head>', `${SCREENER_STYLE}\n</head>`)
      : `${SCREENER_STYLE}\n${output}`;
  }
  if (!output.includes('id="moeMarketScreener"')) {
    output = output.includes('</body>')
      ? output.replace('</body>', `${SCREENER_SHELL}\n${SCREENER_SCRIPT}\n</body>`)
      : `${output}\n${SCREENER_SHELL}\n${SCREENER_SCRIPT}`;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-moe-mobile-market-screener', 'live-multi-select-v1');
  headers.set('x-moe-screener-selection-policy', 'EDITABLE_BEFORE_START_LOCKED_WHILE_RUNNING');
  return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === MARKET_SCREENER_PATH) return handleMarketScreener(request, env, ctx);
    const response = await baseWorker.fetch(request, env, ctx);
    return MOBILE_PATHS.has(pathname) ? enhanceMobileScreener(response, request) : response;
  },
};
