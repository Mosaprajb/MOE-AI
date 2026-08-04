import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-market-screener-resilient-entry.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const SOURCE_MODE_PATH = '/api/scanner/source-mode';
const SELECTION_PATH = '/api/mobile/scanner/selection';
const WATCHLIST_STATE_PATH = '/api/mobile/watchlist/state';
const MARKET_SCREENER_PATH = '/api/mobile/market-screener';
const ACCOUNT_OVERVIEW_PATH = '/api/mobile/account/overview';
const PLATFORM_OVERVIEW_PATH = '/api/mobile/platform/overview';
const PLATFORM_SOURCES_PATH = '/api/mobile/platform/sources';
const MACRO_OVERVIEW_PATH = '/api/mobile/macro/overview';
const PORTFOLIO_PATH = '/api/trading-intelligence/portfolio-risk';
const HEALTH_PATH = '/api/health';
const MODE_PATH = '/api/trading/mode';
const MAX_SELECTED_SYMBOLS = 30;
const FRED_API_URL = 'https://api.stlouisfed.org/fred/series/observations';
const FRED_CACHE_URL = 'https://moerand.internal/mobile-fred-macro-v1';
const FRED_CACHE_SECONDS = 900;

const FRED_SERIES = Object.freeze([
  Object.freeze({ id: 'DFF', label: 'Effective Federal Funds Rate', unit: 'percent' }),
  Object.freeze({ id: 'DGS10', label: '10-Year Treasury Yield', unit: 'percent' }),
  Object.freeze({ id: 'VIXCLS', label: 'CBOE Volatility Index', unit: 'index' }),
  Object.freeze({ id: 'UNRATE', label: 'US Unemployment Rate', unit: 'percent' }),
]);

const SOURCE_CATALOG = Object.freeze([
  Object.freeze({ name: 'Finviz', role: 'Stock filtering and screener UX reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'Fiscal AI', role: 'AI-assisted company research reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'Koyfin', role: 'Professional dashboard and comparison UX reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'Capitol Trades', role: 'Political transaction research reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'TradingView', role: 'Charting and technical-analysis UX reference', policy: 'LICENSED_INTEGRATION_CANDIDATE' }),
  Object.freeze({ name: 'StockAnalysis', role: 'Company fundamentals presentation reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'Macrotrends', role: 'Long-term financial trend reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'FRED', role: 'Official macroeconomic data', policy: 'OFFICIAL_API_OPTIONAL', integratedEndpoint: MACRO_OVERVIEW_PATH }),
  Object.freeze({ name: 'OneInsider', role: 'Insider activity research reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'Simply Wall St', role: 'Visual company-analysis UX reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'Finchat', role: 'Earnings and AI research UX reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'Investing.com', role: 'News and market-movement research reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'Investopedia', role: 'Financial education and strategy terminology reference', policy: 'REFERENCE_ONLY' }),
  Object.freeze({ name: 'Quiver Quantitative', role: 'Alternative-data integration candidate', policy: 'LICENSED_API_CANDIDATE' }),
  Object.freeze({ name: 'WhaleWisdom', role: 'Fund-holdings research reference', policy: 'REFERENCE_ONLY_SEC_EDGAR_PREFERRED' }),
]);

function json(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-market-platform': '1.0.0',
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

function normalizeSymbols(value) {
  const source = Array.isArray(value) ? value : String(value || '').split(/[\s,;]+/g);
  const seen = new Set();
  const symbols = [];
  for (const item of source) {
    const symbol = normalizedSymbol(item);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
    if (symbols.length >= MAX_SELECTED_SYMBOLS) break;
  }
  return symbols;
}

function sameSymbols(left, right) {
  const a = normalizeSymbols(left);
  const b = normalizeSymbols(right);
  return a.length === b.length && a.every((symbol, index) => symbol === b[index]);
}

function forwardedHeaders(request, additions = {}) {
  const headers = new Headers({
    accept: 'application/json',
    'x-moe-mobile-client': '1',
  });
  for (const name of ['cookie', 'authorization']) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  for (const [name, value] of Object.entries(additions)) {
    if (value != null) headers.set(name, String(value));
  }
  return headers;
}

async function callBase(request, env, ctx, path, init = {}) {
  const url = new URL(path, request.url);
  const response = await baseWorker.fetch(new Request(url.toString(), {
    method: init.method || 'GET',
    headers: forwardedHeaders(request, init.headers || {}),
    body: init.body,
    cache: 'no-store',
  }), env, ctx);
  const payload = await response.clone().json().catch(() => ({}));
  return { response, payload };
}

function errorMessage(payload, fallback) {
  return String(payload?.alert || payload?.error || fallback || 'Request failed.');
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readSelection(request, env, ctx) {
  const result = await callBase(request, env, ctx, WATCHLIST_STATE_PATH);
  if (!result.response.ok || result.payload?.ok !== true) {
    return {
      ok: false,
      status: result.response.status || 502,
      error: errorMessage(result.payload, 'Unable to read the selected scanner stocks.'),
      payload: result.payload,
    };
  }
  return {
    ok: true,
    status: 200,
    payload: {
      ...result.payload,
      symbols: normalizeSymbols(result.payload.symbols),
      maximumSymbols: MAX_SELECTED_SYMBOLS,
    },
  };
}

async function commitSelection(request, env, ctx, body = {}) {
  const symbols = normalizeSymbols(body.symbols ?? body.curatedSymbols);
  if (!symbols.length) {
    return json({
      ok: false,
      code: 'SCANNER_SYMBOLS_REQUIRED',
      error: 'Select at least one valid stock before saving the scanner list.',
      maximumSymbols: MAX_SELECTED_SYMBOLS,
      liveTradingLocked: true,
      liveFundsUsed: false,
    }, 400);
  }
  if (Array.isArray(body.symbols) && body.symbols.length > MAX_SELECTED_SYMBOLS) {
    return json({
      ok: false,
      code: 'SCANNER_SYMBOL_LIMIT',
      error: `The mobile scanner supports up to ${MAX_SELECTED_SYMBOLS} selected stocks.`,
      maximumSymbols: MAX_SELECTED_SYMBOLS,
      liveTradingLocked: true,
      liveFundsUsed: false,
    }, 400);
  }

  const before = await readSelection(request, env, ctx);
  if (!before.ok) {
    return json({
      ok: false,
      code: 'SCANNER_STATE_UNAVAILABLE',
      error: before.error,
      liveTradingLocked: true,
      liveFundsUsed: false,
    }, before.status);
  }
  if (before.payload.locked === true || before.payload.armed === true) {
    return json({
      ok: false,
      code: 'SCANNER_RUNNING_SYMBOLS_LOCKED',
      error: 'Stop trading before changing the selected stocks.',
      alert: 'The scanner is active. Its original stock list is frozen for safety.',
      symbols: before.payload.symbols,
      scannerArmed: true,
      symbolsLocked: true,
      liveTradingLocked: true,
      liveFundsUsed: false,
    }, 409);
  }

  const write = await callBase(request, env, ctx, SOURCE_MODE_PATH, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mode: 'CURATED_UNIVERSE', symbols }),
  });
  if (!write.response.ok || write.payload?.ok !== true) {
    return json({
      ok: false,
      code: write.payload?.code || 'SCANNER_SELECTION_SAVE_FAILED',
      error: errorMessage(write.payload, 'The selected stocks could not be saved.'),
      liveTradingLocked: true,
      liveFundsUsed: false,
    }, write.response.status || 502);
  }

  let verifiedState = null;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const current = await readSelection(request, env, ctx);
    if (current.ok) {
      verifiedState = current.payload;
      if (sameSymbols(verifiedState.symbols, symbols)) break;
    }
    await wait(attempt * 60);
  }

  if (!verifiedState || !sameSymbols(verifiedState.symbols, symbols)) {
    return json({
      ok: false,
      code: 'SCANNER_SELECTION_NOT_PERSISTED',
      error: 'The server accepted the update but read-back verification did not match. Nothing was reported as saved.',
      requestedSymbols: symbols,
      persistedSymbols: normalizeSymbols(verifiedState?.symbols),
      verified: false,
      liveTradingLocked: true,
      liveFundsUsed: false,
    }, 502);
  }

  return json({
    ok: true,
    verified: true,
    mode: 'CURATED_UNIVERSE',
    symbols,
    symbolCount: symbols.length,
    locked: false,
    maximumSymbols: MAX_SELECTED_SYMBOLS,
    scanMode: write.payload?.scanMode || write.payload?.result?.scanMode || null,
    updatedAt: verifiedState.updatedAt || new Date().toISOString(),
    liveTradingLocked: true,
    liveFundsUsed: false,
  }, 200, { 'x-moe-scanner-selection-verified': 'true' });
}

async function handleSelection(request, env, ctx) {
  if (!mobileRequestAllowed(request)) {
    return json({ ok: false, error: 'Mobile scanner selection access denied.' }, 403);
  }
  if (request.method === 'GET') {
    const state = await readSelection(request, env, ctx);
    return state.ok
      ? json({ ...state.payload, verified: true, liveTradingLocked: true, liveFundsUsed: false })
      : json({ ok: false, error: state.error, liveTradingLocked: true, liveFundsUsed: false }, state.status);
  }
  if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed.' }, 405);
  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Valid JSON is required.' }, 400); }
  return commitSelection(request, env, ctx, body);
}

function safeAccount(account = {}) {
  return {
    mode: account.mode || null,
    configured: account.configured === true,
    connected: account.connected === true,
    readOnly: account.readOnly !== false,
    tradingLocked: account.tradingLocked !== false,
    status: account.status || null,
    cashBalance: Number.isFinite(Number(account.cashBalance)) ? Number(account.cashBalance) : null,
    marginBalance: Number.isFinite(Number(account.marginBalance)) ? Number(account.marginBalance) : null,
    accountValue: Number.isFinite(Number(account.accountValue)) ? Number(account.accountValue) : null,
    totalBalance: Number.isFinite(Number(account.totalBalance)) ? Number(account.totalBalance) : null,
    updatedAt: account.updatedAt || null,
  };
}

async function loadAccountOverview(request, env, ctx) {
  const [portfolioResult, healthResult, modeResult] = await Promise.all([
    callBase(request, env, ctx, PORTFOLIO_PATH),
    callBase(request, env, ctx, HEALTH_PATH),
    callBase(request, env, ctx, MODE_PATH),
  ]);
  const portfolio = portfolioResult.payload || {};
  const health = healthResult.payload || {};
  const mode = modeResult.payload || {};
  const paper = safeAccount(portfolio?.accounts?.paper || portfolio?.paperAccount || {});
  const live = safeAccount(portfolio?.accounts?.live || portfolio?.liveAccount || {});
  const failures = [];
  if (!portfolioResult.response.ok) failures.push('portfolio');
  if (!healthResult.response.ok) failures.push('health');
  if (!modeResult.response.ok) failures.push('mode');
  return {
    ok: true,
    degraded: failures.length > 0,
    failures,
    accounts: { paper, live },
    selectedMode: String(mode?.mode || mode?.control?.mode || 'PAPER').toUpperCase(),
    broker: {
      connected: health?.broker?.connected === true || String(health?.broker?.status || '').toUpperCase() === 'CONNECTED',
      status: health?.broker?.status || null,
    },
    risk: {
      openPositions: portfolio?.openPositions ?? portfolio?.portfolio?.openPositions ?? null,
      dailyLossPercent: portfolio?.dailyLossPercent ?? portfolio?.portfolio?.dailyLossPercent ?? null,
      maxDailyLossPercent: portfolio?.maxDailyLossPercent ?? portfolio?.limits?.maxDailyLossPercent ?? null,
      openRiskPercent: portfolio?.openRiskPercent ?? portfolio?.portfolio?.openRiskPercent ?? null,
    },
    liveTradingLocked: true,
    liveFundsUsed: false,
    updatedAt: new Date().toISOString(),
  };
}

async function handleAccountOverview(request, env, ctx) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!mobileRequestAllowed(request)) return json({ ok: false, error: 'Mobile account overview access denied.' }, 403);
  return json(await loadAccountOverview(request, env, ctx));
}

async function fetchFredSeries(series, apiKey) {
  const url = new URL(FRED_API_URL);
  url.searchParams.set('series_id', series.id);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('file_type', 'json');
  url.searchParams.set('sort_order', 'desc');
  url.searchParams.set('limit', '10');
  const response = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload?.error_message || `FRED ${series.id} failed with HTTP ${response.status}.`);
  const observation = (Array.isArray(payload.observations) ? payload.observations : [])
    .find((item) => item && item.value !== '.' && Number.isFinite(Number(item.value)));
  return {
    id: series.id,
    label: series.label,
    unit: series.unit,
    value: observation ? Number(observation.value) : null,
    date: observation?.date || null,
  };
}

async function loadMacroOverview(env) {
  const enabled = String(env.MOE_FRED_MACRO_ENABLED || 'false').toLowerCase() === 'true';
  const apiKey = String(env.FRED_API_KEY || '').trim();
  if (!enabled || !apiKey) {
    return {
      ok: true,
      configured: false,
      enabled,
      source: 'FRED',
      series: FRED_SERIES.map((series) => ({ ...series, value: null, date: null })),
      message: enabled ? 'FRED_API_KEY is not configured.' : 'FRED macro integration is disabled.',
      executionSignal: false,
      liveTradingLocked: true,
      liveFundsUsed: false,
      updatedAt: new Date().toISOString(),
    };
  }

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(FRED_CACHE_URL);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return { ...(await cached.json()), cached: true };
  }

  const settled = await Promise.allSettled(FRED_SERIES.map((series) => fetchFredSeries(series, apiKey)));
  const series = settled.map((result, index) => result.status === 'fulfilled'
    ? result.value
    : { ...FRED_SERIES[index], value: null, date: null, error: String(result.reason?.message || result.reason || 'Unavailable') });
  const failures = series.filter((item) => item.error).map((item) => item.id);
  const payload = {
    ok: true,
    configured: true,
    enabled: true,
    degraded: failures.length > 0,
    failures,
    source: 'FRED',
    series,
    executionSignal: false,
    liveTradingLocked: true,
    liveFundsUsed: false,
    cached: false,
    updatedAt: new Date().toISOString(),
  };
  if (cache) {
    const task = cache.put(cacheKey, Response.json(payload, {
      headers: { 'cache-control': `public, max-age=${FRED_CACHE_SECONDS}` },
    })).catch(() => undefined);
    await task;
  }
  return payload;
}

async function handleMacroOverview(request, env) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!mobileRequestAllowed(request)) return json({ ok: false, error: 'Mobile macro overview access denied.' }, 403);
  return json(await loadMacroOverview(env));
}

async function handlePlatformOverview(request, env, ctx) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!mobileRequestAllowed(request)) return json({ ok: false, error: 'Mobile platform overview access denied.' }, 403);
  const [selection, screener, account, macro] = await Promise.allSettled([
    readSelection(request, env, ctx),
    callBase(request, env, ctx, `${MARKET_SCREENER_PATH}?sort=VOLUME`),
    loadAccountOverview(request, env, ctx),
    loadMacroOverview(env),
  ]);
  const failures = [];
  if (selection.status === 'rejected' || selection.value?.ok !== true) failures.push('selection');
  if (screener.status === 'rejected' || !screener.value?.response?.ok) failures.push('screener');
  if (account.status === 'rejected') failures.push('account');
  if (macro.status === 'rejected') failures.push('macro');
  return json({
    ok: true,
    degraded: failures.length > 0,
    failures,
    scanner: selection.status === 'fulfilled' && selection.value?.ok ? selection.value.payload : null,
    market: screener.status === 'fulfilled' ? screener.value.payload : null,
    account: account.status === 'fulfilled' ? account.value : null,
    macro: macro.status === 'fulfilled' ? macro.value : null,
    sources: {
      count: SOURCE_CATALOG.length,
      catalogEndpoint: PLATFORM_SOURCES_PATH,
      policy: 'OFFICIAL_OR_LICENSED_DATA_ONLY',
    },
    liveTradingLocked: true,
    liveFundsUsed: false,
    updatedAt: new Date().toISOString(),
  });
}

function handleSources(request) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!mobileRequestAllowed(request)) return json({ ok: false, error: 'Mobile source catalog access denied.' }, 403);
  return json({
    ok: true,
    sources: SOURCE_CATALOG,
    rule: 'Public sites are used as product and research references. Automated data ingestion requires an official API or explicit license.',
    realTimeMarketData: 'Alpaca IEX',
    macroData: 'FRED optional official API',
    liveTradingLocked: true,
    liveFundsUsed: false,
    updatedAt: new Date().toISOString(),
  });
}

const PLATFORM_STYLE = String.raw`
<style id="moe-market-platform-style">
.moe-screener-row{touch-action:manipulation;-webkit-tap-highlight-color:rgba(66,214,208,.16);user-select:none}
.moe-screener-row:active{transform:scale(.995);background:rgba(66,214,208,.09)}
</style>`;

const PLATFORM_SCRIPT = String.raw`
<script id="moe-market-platform-script">
(function(){
  if(window.__moeMarketPlatformReady)return;
  window.__moeMarketPlatformReady=true;
  document.documentElement.dataset.moeMarketPlatform='1.0.0';
  const nativeFetch=window.fetch.bind(window);
  window.fetch=async function(input,init){
    const response=await nativeFetch(input,init);
    try{
      const url=new URL(typeof input==='string'?input:input.url,location.href);
      const method=String(init?.method||(typeof input==='object'&&input?.method)||'GET').toUpperCase();
      if(method==='PUT'&&(url.pathname==='/api/scanner/source-mode'||url.pathname==='/api/mobile/scanner/selection')&&response.ok){
        const payload=await response.clone().json().catch(function(){return {};});
        const symbols=Array.isArray(payload.symbols)?payload.symbols:Array.isArray(payload.scanMode?.curatedSymbols)?payload.scanMode.curatedSymbols:[];
        window.dispatchEvent(new CustomEvent('moe:screener-symbols-saved',{detail:{symbols:symbols,verified:payload.verified===true}}));
        if(typeof window.__moeRefreshSelectedWatchlist==='function'){
          Promise.resolve(window.__moeRefreshSelectedWatchlist()).catch(function(){});
        }
      }
    }catch(_){}
    return response;
  };
})();
</script>`;

async function enhanceMobilePlatform(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  let output = html;
  if (!output.includes('id="moe-market-platform-style"')) output = output.replace('</head>', `${PLATFORM_STYLE}\n</head>`);
  if (!output.includes('id="moe-market-platform-script"')) output = output.replace('</body>', `${PLATFORM_SCRIPT}\n</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-moe-market-platform', '1.0.0');
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
    if (pathname === SELECTION_PATH) return handleSelection(request, env, ctx);
    if (pathname === SOURCE_MODE_PATH && request.method === 'PUT' && mobileRequestAllowed(request)) {
      let body;
      try { body = await request.clone().json(); }
      catch { return json({ ok: false, error: 'Valid JSON is required.' }, 400); }
      if (String(body?.mode || '').toUpperCase() === 'CURATED_UNIVERSE') {
        return commitSelection(request, env, ctx, body);
      }
    }
    if (pathname === ACCOUNT_OVERVIEW_PATH) return handleAccountOverview(request, env, ctx);
    if (pathname === PLATFORM_OVERVIEW_PATH) return handlePlatformOverview(request, env, ctx);
    if (pathname === PLATFORM_SOURCES_PATH) return handleSources(request);
    if (pathname === MACRO_OVERVIEW_PATH) return handleMacroOverview(request, env);
    const response = await baseWorker.fetch(request, env, ctx);
    return MOBILE_PATHS.has(pathname) ? enhanceMobilePlatform(response, request) : response;
  },
};
