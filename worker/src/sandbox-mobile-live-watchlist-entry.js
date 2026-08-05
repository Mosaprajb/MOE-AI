import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-moerand-clean-utbot-entry.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const WATCHLIST_QUOTES_PATH = '/api/mobile/watchlist/quotes';
const WATCHLIST_STATE_PATH = '/api/mobile/watchlist/state';
const SCAN_SOURCE_MODE_PATH = '/api/scanner/source-mode';
const ALPACA_SNAPSHOTS_URL = 'https://data.alpaca.markets/v2/stocks/snapshots';
const MAX_SYMBOLS = 30;
const CACHE_SECONDS = 2;

function json(payload, status = 200, extraHeaders = {}) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-mobile-watchlist': 'live-iex-v4',
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

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSymbols(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set();
  const symbols = [];
  for (const item of values) {
    const symbol = String(item || '').trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol) || seen.has(symbol)) continue;
    seen.add(symbol);
    symbols.push(symbol);
    if (symbols.length >= MAX_SYMBOLS) break;
  }
  return symbols;
}

function newYorkSession(timestamp = Date.now()) {
  const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  if (parts.weekday === 'Sat' || parts.weekday === 'Sun') return 'CLOSED';
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  if (minutes >= 4 * 60 && minutes < 9 * 60 + 30) return 'PREMARKET';
  if (minutes >= 9 * 60 + 30 && minutes < 16 * 60) return 'REGULAR';
  if (minutes >= 16 * 60 && minutes < 20 * 60) return 'AFTER_HOURS';
  return 'CLOSED';
}

function normalizedSnapshot(symbol, snapshot = {}, now = Date.now()) {
  const latestTrade = snapshot.latestTrade || snapshot.latest_trade || {};
  const latestQuote = snapshot.latestQuote || snapshot.latest_quote || {};
  const minuteBar = snapshot.minuteBar || snapshot.minute_bar || {};
  const dailyBar = snapshot.dailyBar || snapshot.daily_bar || {};
  const previousBar = snapshot.prevDailyBar || snapshot.prev_daily_bar || {};
  const price = number(latestTrade.p, number(minuteBar.c, number(dailyBar.c, null)));
  const regularPrice = number(dailyBar.c, price);
  const previousClose = number(previousBar.c, null);
  const timestamp = latestTrade.t || minuteBar.t || dailyBar.t || null;
  const session = newYorkSession(now);
  const change = price != null && previousClose != null ? price - previousClose : null;
  const changePercent = change != null && previousClose ? change / previousClose * 100 : null;
  const extended = session === 'PREMARKET' || session === 'AFTER_HOURS';
  const extendedChange = extended && price != null && regularPrice != null ? price - regularPrice : null;
  const extendedChangePercent = extendedChange != null && regularPrice ? extendedChange / regularPrice * 100 : null;
  return {
    symbol,
    price,
    regularPrice,
    previousClose,
    change,
    changePercent,
    extended,
    extendedChange,
    extendedChangePercent,
    bid: number(latestQuote.bp, null),
    ask: number(latestQuote.ap, null),
    bidSize: number(latestQuote.bs, null),
    askSize: number(latestQuote.as, null),
    open: number(dailyBar.o, null),
    high: number(dailyBar.h, null),
    low: number(dailyBar.l, null),
    volume: number(dailyBar.v, null),
    tradeTimestamp: timestamp,
    session,
    feed: 'IEX',
    available: price != null,
  };
}

async function fetchAlpacaSnapshots(symbols, env) {
  const keyId = String(env.ALPACA_KEY_ID || '').trim();
  const secret = String(env.ALPACA_SECRET_KEY || '').trim();
  if (!keyId || !secret) throw new Error('Alpaca market-data credentials are not configured.');
  const url = new URL(ALPACA_SNAPSHOTS_URL);
  url.searchParams.set('symbols', symbols.join(','));
  url.searchParams.set('feed', 'iex');
  url.searchParams.set('currency', 'USD');
  const response = await fetch(url, {
    headers: {
      'APCA-API-KEY-ID': keyId,
      'APCA-API-SECRET-KEY': secret,
      accept: 'application/json',
    },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error || `Alpaca snapshots request failed with HTTP ${response.status}.`);
  }
  return payload?.snapshots && typeof payload.snapshots === 'object' ? payload.snapshots : payload;
}

async function handleWatchlistQuotes(request, env, ctx) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!mobileRequestAllowed(request)) return json({ ok: false, error: 'Mobile watchlist access denied.' }, 403);
  const symbols = normalizeSymbols(new URL(request.url).searchParams.get('symbols'));
  if (!symbols.length) {
    return json({
      ok: true,
      symbols: [],
      quotes: [],
      feed: 'IEX',
      session: newYorkSession(),
      refreshAfterMs: 3000,
      updatedAt: new Date().toISOString(),
      liveTradingLocked: true,
      liveFundsUsed: false,
    });
  }

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(`https://moerand.internal/mobile-watchlist-quotes-v4?symbols=${encodeURIComponent([...symbols].sort().join(','))}`);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return json({ ...(await cached.json()), cached: true }, 200, { 'x-moe-watchlist-cache': 'HIT' });
  }

  try {
    const now = Date.now();
    const snapshots = await fetchAlpacaSnapshots(symbols, env);
    const quotes = symbols.map((symbol) => normalizedSnapshot(symbol, snapshots?.[symbol] || {}, now));
    const payload = {
      ok: true,
      symbols,
      quotes,
      feed: 'IEX',
      session: newYorkSession(now),
      refreshAfterMs: 3000,
      updatedAt: new Date(now).toISOString(),
      cached: false,
      liveTradingLocked: true,
      liveFundsUsed: false,
    };
    if (cache) {
      const task = cache.put(cacheKey, Response.json(payload, {
        headers: { 'cache-control': `public, max-age=${CACHE_SECONDS}` },
      })).catch(() => undefined);
      if (ctx?.waitUntil) ctx.waitUntil(task);
      else await task;
    }
    return json(payload, 200, { 'x-moe-watchlist-cache': 'MISS' });
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : 'Unable to load live watchlist prices.',
      symbols,
      quotes: symbols.map((symbol) => ({ symbol, available: false })),
      feed: 'IEX',
      updatedAt: new Date().toISOString(),
      liveTradingLocked: true,
      liveFundsUsed: false,
    }, 502);
  }
}

async function readWatchlistState(env) {
  const stub = coordinator(env);
  const [runtimeResult, scanModeResult] = await Promise.allSettled([
    stub.mobileDashboardRuntime(),
    stub.scanSourceMode(),
  ]);
  const runtime = runtimeResult.status === 'fulfilled' && runtimeResult.value
    ? runtimeResult.value
    : {};
  const rawScanMode = scanModeResult.status === 'fulfilled' && scanModeResult.value
    ? scanModeResult.value
    : {};
  const scanMode = rawScanMode?.scanMode && typeof rawScanMode.scanMode === 'object'
    ? rawScanMode.scanMode
    : rawScanMode;
  const armed = runtime?.armed === true;
  const runtimeSymbols = normalizeSymbols(runtime?.symbols || []);
  const mode = String(scanMode?.mode || '').trim().toUpperCase();
  const configuredSymbols = mode === 'FOCUSED_SCAN'
    ? normalizeSymbols(scanMode?.focusedSymbols || [])
    : mode === 'CURATED_UNIVERSE'
      ? normalizeSymbols(scanMode?.curatedSymbols || [])
      : [];
  const useRuntime = armed && runtimeSymbols.length > 0;
  const symbols = useRuntime
    ? runtimeSymbols
    : configuredSymbols.length
      ? configuredSymbols
      : runtimeSymbols;
  return {
    armed,
    locked: armed,
    symbols,
    symbolSource: useRuntime ? 'RUNTIME_LOCKED' : configuredSymbols.length ? 'SCAN_MODE' : 'RUNTIME',
    scanMode: mode || null,
    strategy: runtime?.strategy || null,
    updatedAt: useRuntime
      ? runtime?.updatedAt || null
      : scanMode?.updatedAt || runtime?.updatedAt || null,
  };
}

async function handleWatchlistState(request, env) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!mobileRequestAllowed(request)) return json({ ok: false, error: 'Mobile watchlist access denied.' }, 403);
  const state = await readWatchlistState(env);
  return json({
    ok: true,
    ...state,
    editPolicy: state.locked ? 'LOCKED_WHILE_SCANNER_RUNNING' : 'EDITABLE_BEFORE_START',
    maximumSymbols: MAX_SYMBOLS,
    liveTradingLocked: true,
    liveFundsUsed: false,
  });
}

async function blockSymbolMutationWhileRunning(request, env) {
  if (request.method !== 'PUT' || !sameOrigin(request)) return null;
  const state = await readWatchlistState(env);
  if (!state.locked) return null;
  return json({
    ok: false,
    code: 'SCANNER_RUNNING_SYMBOLS_LOCKED',
    error: 'Watchlist locked while scanner is running. Stop trading before adding or removing symbols.',
    alert: 'Stop trading first. The active scanner keeps the original symbol list frozen for safety.',
    scannerArmed: true,
    symbolsLocked: true,
    liveTradingLocked: true,
    liveFundsUsed: false,
  }, 409, { 'x-moe-symbol-lock': 'SCANNER_RUNNING' });
}

const WATCHLIST_ROOT = String.raw`
<div class="moe-watchlist-v3" data-moe-watchlist-root data-view="main" data-state="loading">
  <div class="moe-watchlist-head">
    <div><div class="moe-watchlist-title"><span class="moe-watchlist-pulse"></span>Live watchlist</div><div class="moe-watchlist-sub">Direct IEX market prices</div></div>
    <span class="moe-watchlist-session" data-watch-session>Connecting</span>
  </div>
  <div class="moe-watchlist-lock" data-watch-lock hidden><span>🔒</span><div><b>Symbol list locked</b><small>Stop trading before adding or removing symbols.</small></div></div>
  <div class="moe-watchlist-tools"><button type="button" data-watch-sort>Top movers</button><button type="button" data-watch-refresh>Refresh</button><span data-watch-count>0 / 30</span></div>
  <div class="moe-watchlist-list" data-watch-list><div class="moe-watchlist-empty"><b>Your live watchlist is ready</b><span>Add stocks above before starting the scanner.</span></div></div>
  <div class="moe-watchlist-foot"><span data-watch-updated>Waiting for symbols</span><span>IEX · read only</span></div>
</div>`;

const WATCHLIST_SHEET_ROOT = WATCHLIST_ROOT.replace('data-view="main"', 'data-view="sheet"')
  .replace('Live watchlist', 'Selected stocks')
  .replace('Direct IEX market prices', 'Live prices and quote details');

const WATCHLIST_STYLE = String.raw`
<style id="moe-live-watchlist-style">
#chips,#chips2{display:none!important}
.moe-watchlist-v3{margin-top:15px;border:1px solid var(--line);border-radius:20px;overflow:hidden;background:radial-gradient(circle at 92% 0,rgba(61,214,208,.12),transparent 38%),linear-gradient(180deg,rgba(255,255,255,.03),transparent),var(--panel-2);box-shadow:0 18px 48px rgba(0,0,0,.22)}
.moe-watchlist-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px;border-bottom:1px solid rgba(138,155,171,.18)}
.moe-watchlist-title{display:flex;align-items:center;gap:9px;font:900 14px 'Archivo',sans-serif;text-transform:uppercase;letter-spacing:.03em}.moe-watchlist-sub{margin-top:3px;color:var(--muted);font:600 11px 'IBM Plex Mono',monospace}
.moe-watchlist-pulse{width:9px;height:9px;border-radius:50%;background:var(--green);box-shadow:0 0 0 5px rgba(74,222,128,.10),0 0 18px rgba(74,222,128,.5);animation:watchPulse 1.8s infinite}.moe-watchlist-v3[data-state="loading"] .moe-watchlist-pulse{background:var(--amber)}.moe-watchlist-v3[data-state="error"] .moe-watchlist-pulse{background:var(--red);animation:none}@keyframes watchPulse{50%{opacity:.45;transform:scale(.76)}}
.moe-watchlist-session{padding:7px 10px;border:1px solid var(--line);border-radius:999px;background:rgba(11,15,20,.35);color:var(--accent);font:700 10px 'IBM Plex Mono',monospace;text-transform:uppercase;white-space:nowrap}
.moe-watchlist-lock{display:flex;align-items:center;gap:11px;margin:12px 12px 0;padding:12px;border:1px solid rgba(255,176,32,.48);border-radius:14px;background:rgba(255,176,32,.09);color:var(--amber)}.moe-watchlist-lock[hidden]{display:none}.moe-watchlist-lock>span{font-size:21px}.moe-watchlist-lock b{display:block;font-size:13px}.moe-watchlist-lock small{display:block;margin-top:2px;color:var(--muted);font:600 10px 'IBM Plex Mono',monospace}
.moe-watchlist-tools{display:grid;grid-template-columns:auto auto 1fr;gap:8px;align-items:center;padding:11px 12px;border-bottom:1px solid rgba(138,155,171,.15)}.moe-watchlist-tools button{appearance:none;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--text);padding:8px 11px;font:700 10px 'IBM Plex Mono',monospace}.moe-watchlist-tools span{justify-self:end;color:var(--muted);font:700 10px 'IBM Plex Mono',monospace}
.moe-watchlist-list{display:grid}.moe-watchlist-row{position:relative;display:grid;grid-template-columns:43px minmax(0,1fr) auto;gap:11px;align-items:center;padding:13px 45px 13px 12px;border-bottom:1px solid rgba(138,155,171,.14);cursor:pointer}.moe-watchlist-row:last-child{border-bottom:0}.moe-watchlist-row[data-open="true"]{background:rgba(61,214,208,.07)}
.moe-watchlist-logo{width:41px;height:41px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,var(--accent-dim),rgba(11,15,20,.72));border:1px solid var(--accent);color:var(--accent);font:900 11px 'Archivo',sans-serif;box-shadow:inset 0 1px 0 rgba(255,255,255,.08),0 8px 18px rgba(0,0,0,.18)}
.moe-watchlist-copy{min-width:0}.moe-watchlist-symbol{display:flex;align-items:center;gap:7px;font:900 18px 'Archivo',sans-serif}.moe-watchlist-feed{padding:2px 5px;border-radius:6px;background:var(--accent-dim);color:var(--accent);font:700 8px 'IBM Plex Mono',monospace}.moe-watchlist-company{margin-top:2px;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.moe-watchlist-price{text-align:right;font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}.moe-watchlist-last{font-size:17px;font-weight:700}.moe-watchlist-change{margin-top:3px;font-size:11px;font-weight:700}.moe-watchlist-change.up{color:var(--green)}.moe-watchlist-change.down{color:var(--red)}.moe-watchlist-change.flat{color:var(--muted)}.moe-watchlist-extended{display:block;margin-top:3px;color:var(--muted);font-size:9px}
.moe-watchlist-remove{position:absolute;right:8px;top:50%;transform:translateY(-50%);appearance:none;width:30px;height:30px;border:0;border-radius:50%;background:transparent;color:var(--muted);font-size:20px}.moe-watchlist-remove[data-locked="true"]{font-size:13px;color:var(--amber)}
.moe-watchlist-detail{grid-column:2/4;display:none;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:7px;padding-top:11px;border-top:1px solid rgba(138,155,171,.15)}.moe-watchlist-row[data-open="true"] .moe-watchlist-detail{display:grid}.moe-watchlist-stat span{display:block;color:var(--muted);font:600 8px 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.07em}.moe-watchlist-stat b{display:block;margin-top:3px;color:var(--text);font:700 10px 'IBM Plex Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.moe-watchlist-empty{display:grid;gap:6px;padding:28px 18px;text-align:center}.moe-watchlist-empty:before{content:'⌁';font-size:34px;color:var(--accent)}.moe-watchlist-empty b{font-size:15px}.moe-watchlist-empty span{color:var(--muted);font-size:12px}.moe-watchlist-foot{display:flex;justify-content:space-between;gap:12px;padding:10px 12px;border-top:1px solid rgba(138,155,171,.15);color:var(--muted);font:600 9px 'IBM Plex Mono',monospace}
.moe-symbol-lock-note{display:flex;align-items:center;gap:8px;margin-top:10px;padding:10px 12px;border:1px solid rgba(255,176,32,.42);border-radius:12px;background:rgba(255,176,32,.08);color:var(--amber);font:700 11px 'IBM Plex Mono',monospace}.moe-symbol-lock-note[hidden]{display:none}#symInput:disabled,#symInput2:disabled{opacity:.55;border-color:rgba(255,176,32,.5)}
.moe-watchlist-toast{position:fixed;left:50%;bottom:calc(112px + env(safe-area-inset-bottom));z-index:999;transform:translate(-50%,20px);width:min(92vw,470px);padding:14px 16px;border:1px solid rgba(255,176,32,.58);border-radius:15px;background:#21190a;color:#ffe5a8;box-shadow:0 18px 55px rgba(0,0,0,.48);font:700 13px/1.45 'Archivo',sans-serif;opacity:0;pointer-events:none;transition:.22s}.moe-watchlist-toast[data-show="true"]{opacity:1;transform:translate(-50%,0)}
@media(max-width:390px){.moe-watchlist-row{grid-template-columns:38px minmax(0,1fr) auto;padding-left:9px}.moe-watchlist-logo{width:37px;height:37px}.moe-watchlist-detail{grid-template-columns:repeat(2,minmax(0,1fr))}.moe-watchlist-foot{flex-direction:column;gap:3px}}
</style>`;

const WATCHLIST_SCRIPT = String.raw`
<script id="moe-live-watchlist-script">
(function(){
  if(window.__moeLiveWatchlistV4)return;
  window.__moeLiveWatchlistV4=true;
  var COMPANY={AAPL:'Apple Inc.',MSFT:'Microsoft Corp.',NVDA:'NVIDIA Corp.',AMZN:'Amazon.com, Inc.',GOOGL:'Alphabet Inc.',GOOG:'Alphabet Inc.',META:'Meta Platforms, Inc.',AMD:'Advanced Micro Devices',TSLA:'Tesla, Inc.',PATH:'UiPath, Inc.',SPY:'SPDR S&P 500 ETF',QQQ:'Invesco QQQ Trust',RIVN:'Rivian Automotive, Inc.',LYFT:'Lyft, Inc.',SOFI:'SoFi Technologies, Inc.',HIMS:'Hims & Hers Health, Inc.',SMCI:'Super Micro Computer, Inc.',CELH:'Celsius Holdings, Inc.',UBER:'Uber Technologies, Inc.'};
  var quotes={},oldPrices={},selectedSymbols=[],openSymbol='',sortMode='GAIN',locked=false,busy=false,lastUpdated=null,session='CLOSED',toastTimer=null;
  function esc(v){return String(v==null?'':v).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function normalizeList(values){var seen={};return (Array.isArray(values)?values:[]).map(function(s){return String(s||'').trim().toUpperCase();}).filter(function(s){if(!/^[A-Z][A-Z0-9.-]{0,9}$/.test(s)||seen[s])return false;seen[s]=true;return true;}).slice(0,30);}
  function roots(){return Array.from(document.querySelectorAll('[data-moe-watchlist-root]'));}
  function browserSelection(){try{if(typeof state!=='undefined'&&Array.isArray(state.symbols))return {known:true,symbols:normalizeList(state.symbols)};}catch(_){}var chips=document.getElementById('chips');if(chips)return {known:true,symbols:normalizeList(Array.from(chips.querySelectorAll('[data-rm]')).map(function(n){return n.dataset.rm;}))};return {known:false,symbols:[]};}
  function list(){var browser=browserSelection();if(browser.known)selectedSymbols=browser.symbols;return selectedSymbols.slice();}
  function setSelectedSymbols(values){var next=normalizeList(values);var changed=next.join(',')!==selectedSymbols.join(',');selectedSymbols=next;try{if(typeof state!=='undefined'&&Array.isArray(state.symbols)&&normalizeList(state.symbols).join(',')!==next.join(',')){state.symbols=next.slice();if(typeof renderChips==='function')renderChips();}}catch(_){}return changed;}
  function fmt(v){var n=Number(v);return Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:n<10?3:2}):'—';}
  function signed(v,d){var n=Number(v);return Number.isFinite(n)?(n>0?'+':'')+n.toFixed(d==null?2:d):'—';}
  function compact(v){var n=Number(v);if(!Number.isFinite(n))return '—';if(n>=1e9)return(n/1e9).toFixed(1)+'B';if(n>=1e6)return(n/1e6).toFixed(1)+'M';if(n>=1e3)return(n/1e3).toFixed(1)+'K';return String(Math.round(n));}
  function tone(v){var n=Number(v);return !Number.isFinite(n)||n===0?'flat':n>0?'up':'down';}
  function sessionText(v){return v==='REGULAR'?'Market live':v==='PREMARKET'?'Premarket':v==='AFTER_HOURS'?'After hours':'Market closed';}
  function company(s){return COMPANY[s]||s+' stock';}
  function order(symbols){if(sortMode==='GAIN')return symbols.slice().sort(function(a,b){return Number(quotes[b]&&quotes[b].changePercent||-999999)-Number(quotes[a]&&quotes[a].changePercent||-999999);});if(sortMode==='PRICE')return symbols.slice().sort(function(a,b){return Number(quotes[a]&&quotes[a].price||999999)-Number(quotes[b]&&quotes[b].price||999999);});if(sortMode==='SYMBOL')return symbols.slice().sort();return symbols.slice();}
  function spread(q){var b=Number(q&&q.bid),a=Number(q&&q.ask);return Number.isFinite(a)&&Number.isFinite(b)?'$'+fmt(a-b):'—';}
  function age(q){var t=Date.parse(q&&q.tradeTimestamp||'');if(!Number.isFinite(t))return '—';var s=Math.max(0,Math.floor((Date.now()-t)/1000));return s<60?s+'s':Math.floor(s/60)+'m';}
  function details(q){return '<div class="moe-watchlist-detail"><div class="moe-watchlist-stat"><span>Bid</span><b>$'+fmt(q.bid)+'</b></div><div class="moe-watchlist-stat"><span>Ask</span><b>$'+fmt(q.ask)+'</b></div><div class="moe-watchlist-stat"><span>Spread</span><b>'+spread(q)+'</b></div><div class="moe-watchlist-stat"><span>Day range</span><b>'+fmt(q.low)+'–'+fmt(q.high)+'</b></div><div class="moe-watchlist-stat"><span>Volume</span><b>'+compact(q.volume)+'</b></div><div class="moe-watchlist-stat"><span>Quote age</span><b>'+age(q)+'</b></div></div>';}
  function row(symbol){var q=quotes[symbol]||{symbol:symbol,available:false};var ext=q.extended&&Number.isFinite(Number(q.extendedChangePercent))?'<span class="moe-watchlist-extended">'+(q.session==='PREMARKET'?'Pre':'After')+': $'+fmt(q.price)+' '+signed(q.extendedChangePercent,2)+'%</span>':'';var action=locked?'<button type="button" class="moe-watchlist-remove" data-locked="true" data-watch-locked-action>🔒</button>':'<button type="button" class="moe-watchlist-remove" data-watch-remove="'+esc(symbol)+'">×</button>';return '<div class="moe-watchlist-row" data-symbol="'+esc(symbol)+'" data-open="'+String(openSymbol===symbol)+'"><div class="moe-watchlist-logo">'+esc(symbol.slice(0,3))+'</div><div class="moe-watchlist-copy"><div class="moe-watchlist-symbol">'+esc(symbol)+'<span class="moe-watchlist-feed">IEX</span></div><div class="moe-watchlist-company">'+esc(company(symbol))+'</div></div><div class="moe-watchlist-price"><div class="moe-watchlist-last">'+(q.available?'$'+fmt(q.price):'—')+'</div><div class="moe-watchlist-change '+tone(q.changePercent)+'">'+(q.available?signed(q.change,2)+' · '+signed(q.changePercent,2)+'%':'Waiting for quote')+'</div>'+ext+'</div>'+action+details(q)+'</div>';}
  function render(){var symbols=order(list());roots().forEach(function(root){var box=root.querySelector('[data-watch-list]');if(box)box.innerHTML=symbols.length?symbols.map(row).join(''):'<div class="moe-watchlist-empty"><b>No symbols selected</b><span>Add stocks before pressing Start trading. The list freezes while the scanner runs.</span></div>';var count=root.querySelector('[data-watch-count]');if(count)count.textContent=symbols.length+' / 30';var lock=root.querySelector('[data-watch-lock]');if(lock)lock.hidden=!locked;var badge=root.querySelector('[data-watch-session]');if(badge)badge.textContent=sessionText(session);var updated=root.querySelector('[data-watch-updated]');if(updated)updated.textContent=lastUpdated?'Updated '+lastUpdated.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'}):symbols.length?'Connecting to live prices':'Waiting for symbols';root.dataset.state=symbols.length&&!lastUpdated?'loading':'ready';});symbols.forEach(function(s){var p=Number(quotes[s]&&quotes[s].price);if(Number.isFinite(p))oldPrices[s]=p;});}
  function toast(message){var node=document.getElementById('moeWatchlistToast');if(!node){node=document.createElement('div');node.id='moeWatchlistToast';node.className='moe-watchlist-toast';node.setAttribute('role','alert');document.body.appendChild(node);}node.textContent=message;node.dataset.show='true';clearTimeout(toastTimer);toastTimer=setTimeout(function(){node.dataset.show='false';},3400);}
  function lockAlert(){toast('Scanner active: the original symbol list is frozen. Stop trading before adding or removing a stock.');}
  function applyLock(){['symInput','symInput2'].forEach(function(id){var input=document.getElementById(id);if(!input)return;input.disabled=locked;input.setAttribute('aria-disabled',String(locked));input.placeholder=locked?'Stop trading to edit':id==='symInput'?'NVDA':'AAPL';if(locked)input.value='';var note=document.getElementById(id+'MoeLock');if(!note){note=document.createElement('div');note.id=id+'MoeLock';note.className='moe-symbol-lock-note';note.innerHTML='<span>🔒</span><span>Scanner active — selected symbols are frozen.</span>';input.insertAdjacentElement('afterend',note);}note.hidden=!locked;});document.querySelectorAll('.symbol-suggestions').forEach(function(node){if(locked)node.hidden=true;});render();}
  function browserRunning(){try{return typeof state!=='undefined'&&state.running===true;}catch(_){return false;}}
  async function refreshState(){var next=browserRunning(),changed=false;try{var response=await fetch('/api/mobile/watchlist/state?t='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});var data=await response.json().catch(function(){return {};});if(response.ok&&data.ok===true){next=data.locked===true;changed=setSelectedSymbols(data.symbols||[]);}}catch(_){}locked=next;applyLock();if(changed)await refresh(true);}
  async function refresh(force){if(busy)return;var symbols=list();render();if(!symbols.length){lastUpdated=null;session='CLOSED';render();return;}busy=true;roots().forEach(function(root){root.dataset.state='loading';});try{var response=await fetch('/api/mobile/watchlist/quotes?symbols='+encodeURIComponent(symbols.join(','))+'&t='+(force?Date.now():''),{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});var data=await response.json().catch(function(){return {};});if(!response.ok||data.ok!==true)throw new Error(data.error||('HTTP '+response.status));(data.quotes||[]).forEach(function(q){if(q&&q.symbol)quotes[q.symbol]=q;});session=data.session||session;lastUpdated=data.updatedAt?new Date(data.updatedAt):new Date();render();}catch(error){roots().forEach(function(root){root.dataset.state='error';var label=root.querySelector('[data-watch-updated]');if(label)label.textContent=error&&error.message?error.message:'Prices unavailable';});}finally{busy=false;}}
  function remove(symbol){if(locked){lockAlert();return;}var chips=document.getElementById('chips');var button=chips&&chips.querySelector('[data-rm="'+String(symbol).replace(/"/g,'')+'"]');if(button){button.click();setTimeout(refreshState,100);return;}try{if(typeof state!=='undefined'&&Array.isArray(state.symbols)){state.symbols=state.symbols.filter(function(s){return s!==symbol;});if(typeof renderChips==='function')renderChips();if(typeof saveSymbols==='function')saveSymbols();setTimeout(refreshState,100);}}catch(_){}}
  function cycleSort(){var modes=['GAIN','PRICE','SYMBOL','LIST'],labels={GAIN:'Top movers',PRICE:'Lowest price',SYMBOL:'A–Z',LIST:'List order'};sortMode=modes[(modes.indexOf(sortMode)+1)%modes.length];document.querySelectorAll('[data-watch-sort]').forEach(function(node){node.textContent=labels[sortMode];});render();}
  document.addEventListener('click',function(event){var refreshButton=event.target.closest('[data-watch-refresh]');if(refreshButton){refreshState().then(function(){refresh(true);});return;}if(event.target.closest('[data-watch-sort]')){cycleSort();return;}if(event.target.closest('[data-watch-locked-action]')){lockAlert();return;}var removeButton=event.target.closest('[data-watch-remove]');if(removeButton){event.preventDefault();event.stopPropagation();remove(removeButton.dataset.watchRemove);return;}var rowNode=event.target.closest('.moe-watchlist-row');if(rowNode){openSymbol=openSymbol===rowNode.dataset.symbol?'':rowNode.dataset.symbol;render();}});
  function blockEdit(event){if(!locked)return;var target=event.target;if(target&&(target.id==='symInput'||target.id==='symInput2'||target.closest&&target.closest('[data-rm]'))){event.preventDefault();event.stopPropagation();event.stopImmediatePropagation();lockAlert();}}
  ['keydown','beforeinput','input','change','blur','mousedown','touchstart','pointerdown'].forEach(function(type){document.addEventListener(type,blockEdit,true);});
  ['chips','chips2'].forEach(function(id){var chips=document.getElementById(id);if(chips)new MutationObserver(function(){var browser=browserSelection();if(browser.known)selectedSymbols=browser.symbols;render();setTimeout(refreshState,80);}).observe(chips,{childList:true,subtree:true});});
  var start=document.getElementById('startBtn');if(start){start.addEventListener('click',function(){setTimeout(refreshState,80);setTimeout(refreshState,700);},true);new MutationObserver(refreshState).observe(start,{attributes:true,attributeFilter:['data-running','disabled','class']});}
  document.addEventListener('visibilitychange',function(){if(!document.hidden){refreshState().then(function(){refresh(true);});}});
  window.__moeRefreshSelectedWatchlist=function(){return refreshState().then(function(){return refresh(true);});};
  applyLock();render();setTimeout(function(){refreshState().then(function(){refresh(true);});},120);clearInterval(window.__moeLiveWatchlistTick);window.__moeLiveWatchlistTick=setInterval(function(){if(!document.hidden)refresh(false);},3000);clearInterval(window.__moeWatchlistLockTick);window.__moeWatchlistLockTick=setInterval(function(){if(!document.hidden)refreshState();},1200);
})();
</script>`;

function insertAfterElementById(html, id, addition) {
  const pattern = new RegExp(`(<div\\b[^>]*\\bid=["']${id}["'][^>]*>\\s*</div>)`, 'i');
  return pattern.test(html) ? html.replace(pattern, `$1\n${addition}`) : html;
}

function guaranteeRoots(html) {
  let output = insertAfterElementById(html, 'chips', WATCHLIST_ROOT);
  output = insertAfterElementById(output, 'chips2', WATCHLIST_SHEET_ROOT);
  if (!output.includes('data-view="main"')) {
    output = output.replace(
      /(<button\b[^>]*\bid=["']openSymbols["'][^>]*>[\s\S]*?<\/button>)/i,
      `$1\n${WATCHLIST_ROOT}`,
    );
  }
  if (!output.includes('data-view="sheet"')) {
    output = output.replace(
      /(<input\b[^>]*\bid=["']symInput2["'][^>]*>)/i,
      `$1\n${WATCHLIST_SHEET_ROOT}`,
    );
  }
  return output;
}

async function enhanceMobileWatchlist(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  let output = guaranteeRoots(html);
  if (!output.includes('id="moe-live-watchlist-style"')) {
    output = output.includes('</head>')
      ? output.replace('</head>', `${WATCHLIST_STYLE}\n</head>`)
      : `${WATCHLIST_STYLE}\n${output}`;
  }
  if (!output.includes('id="moe-live-watchlist-script"')) {
    output = output.includes('</body>')
      ? output.replace('</body>', `${WATCHLIST_SCRIPT}\n</body>`)
      : `${output}\n${WATCHLIST_SCRIPT}`;
  }
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-moe-mobile-watchlist-ui', 'guaranteed-live-v4');
  headers.set('x-moe-symbol-edit-policy', 'LOCKED_WHILE_SCANNER_RUNNING');
  headers.set('x-moe-watchlist-symbol-sync', 'authoritative-scan-mode');
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
    if (pathname === WATCHLIST_QUOTES_PATH) return handleWatchlistQuotes(request, env, ctx);
    if (pathname === WATCHLIST_STATE_PATH) return handleWatchlistState(request, env);
    if (pathname === SCAN_SOURCE_MODE_PATH) {
      const blocked = await blockSymbolMutationWhileRunning(request, env);
      if (blocked) return blocked;
    }
    const response = await baseWorker.fetch(request, env, ctx);
    return MOBILE_PATHS.has(pathname) ? enhanceMobileWatchlist(response, request) : response;
  },
};