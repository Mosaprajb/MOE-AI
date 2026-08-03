import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-moerand-clean-utbot-entry.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const WATCHLIST_QUOTES_PATH = '/api/mobile/watchlist/quotes';
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
      'x-moe-mobile-watchlist': 'live-iex-v1',
      ...extraHeaders,
    },
  });
}

function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSymbols(value) {
  const seen = new Set();
  const symbols = [];
  for (const item of String(value || '').split(',')) {
    const symbol = item.trim().toUpperCase();
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
    const message = payload?.message || payload?.error || `Alpaca snapshots request failed with HTTP ${response.status}.`;
    throw new Error(message);
  }
  return payload?.snapshots && typeof payload.snapshots === 'object' ? payload.snapshots : payload;
}

async function handleWatchlistQuotes(request, env, ctx) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!sameOrigin(request) || request.headers.get('x-moe-mobile-client') !== '1') {
    return json({ ok: false, error: 'Mobile watchlist access denied.' }, 403);
  }

  const symbols = normalizeSymbols(new URL(request.url).searchParams.get('symbols'));
  if (!symbols.length) return json({ ok: true, symbols: [], quotes: [], feed: 'IEX', updatedAt: new Date().toISOString() });

  const cache = globalThis.caches?.default;
  const cacheUrl = `https://moerand.internal/mobile-watchlist-quotes-v1?symbols=${encodeURIComponent([...symbols].sort().join(','))}`;
  const cacheKey = new Request(cacheUrl);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) {
      const payload = await cached.json();
      return json({ ...payload, cached: true }, 200, { 'x-moe-watchlist-cache': 'HIT' });
    }
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

const WATCHLIST_STYLE = String.raw`
<style id="moe-live-watchlist-style">
#chips{display:none!important}
.moe-watchlist{margin-top:14px;border:1px solid var(--line);border-radius:18px;overflow:hidden;background:linear-gradient(180deg,rgba(255,255,255,.025),transparent),var(--panel-2)}
.moe-watchlist-head{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 14px 12px;border-bottom:1px solid var(--line)}
.moe-watchlist-live{display:flex;align-items:center;gap:8px;min-width:0;font:700 12px 'IBM Plex Mono',monospace;color:var(--muted);letter-spacing:.04em;text-transform:uppercase}
.moe-watchlist-dot{width:8px;height:8px;border-radius:50%;background:var(--green);box-shadow:0 0 0 4px rgba(74,222,128,.12);animation:moeWatchPulse 1.8s infinite}
.moe-watchlist[data-state="error"] .moe-watchlist-dot{background:var(--red);box-shadow:0 0 0 4px rgba(229,72,77,.12);animation:none}
.moe-watchlist[data-state="loading"] .moe-watchlist-dot{background:var(--amber);box-shadow:0 0 0 4px rgba(255,176,32,.12)}
@keyframes moeWatchPulse{50%{opacity:.45;transform:scale(.78)}}
.moe-watchlist-actions{display:flex;align-items:center;gap:8px}
.moe-watchlist-time{font:600 10px 'IBM Plex Mono',monospace;color:var(--muted);white-space:nowrap}
.moe-watchlist-sort{appearance:none;border:1px solid var(--line);border-radius:999px;background:var(--panel);color:var(--text);padding:7px 10px;font:700 11px 'IBM Plex Mono',monospace;cursor:pointer}
.moe-watchlist-list{display:grid}
.moe-watch-row{position:relative;display:grid;grid-template-columns:44px minmax(0,1fr) auto;gap:11px;align-items:center;padding:13px 44px 13px 13px;border-bottom:1px solid rgba(138,155,171,.16);cursor:pointer;transition:background .18s}
.moe-watch-row:last-child{border-bottom:0}
.moe-watch-row:active,.moe-watch-row[data-open="true"]{background:rgba(61,214,208,.08)}
.moe-watch-logo{width:42px;height:42px;border-radius:50%;display:grid;place-items:center;background:linear-gradient(145deg,var(--accent-dim),var(--panel));border:1px solid color-mix(in srgb,var(--accent) 55%,var(--line));color:var(--accent);font:900 12px 'Archivo',sans-serif;letter-spacing:-.03em;box-shadow:inset 0 1px 0 rgba(255,255,255,.08)}
.moe-watch-name{min-width:0}
.moe-watch-symbol{display:flex;align-items:center;gap:7px;font:900 18px 'Archivo',sans-serif;letter-spacing:-.01em}
.moe-watch-feed{padding:2px 5px;border-radius:6px;background:var(--accent-dim);color:var(--accent);font:700 8px 'IBM Plex Mono',monospace;letter-spacing:.05em}
.moe-watch-company{margin-top:2px;color:var(--muted);font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.moe-watch-price{text-align:right;font-family:'IBM Plex Mono',monospace;font-variant-numeric:tabular-nums}
.moe-watch-last{font-size:17px;font-weight:700;letter-spacing:-.02em}
.moe-watch-change{margin-top:3px;font-size:11px;font-weight:700}
.moe-watch-change.up{color:var(--green)}.moe-watch-change.down{color:var(--red)}.moe-watch-change.flat{color:var(--muted)}
.moe-watch-after{display:block;margin-top:3px;font-size:9px;color:var(--muted)}
.moe-watch-remove{position:absolute;right:9px;top:50%;transform:translateY(-50%);appearance:none;width:29px;height:29px;border:0;border-radius:50%;background:transparent;color:var(--muted);font-size:20px;line-height:1;cursor:pointer}
.moe-watch-remove:active{background:rgba(229,72,77,.16);color:var(--red)}
.moe-watch-detail{grid-column:2/4;display:none;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px;margin-top:6px;padding-top:10px;border-top:1px solid rgba(138,155,171,.16)}
.moe-watch-row[data-open="true"] .moe-watch-detail{display:grid}
.moe-watch-stat{min-width:0}
.moe-watch-stat span{display:block;color:var(--muted);font:600 8px 'IBM Plex Mono',monospace;text-transform:uppercase;letter-spacing:.08em}
.moe-watch-stat b{display:block;margin-top:3px;color:var(--text);font:700 10px 'IBM Plex Mono',monospace;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.moe-watch-empty{padding:24px 16px;text-align:center;color:var(--muted);font-size:14px}
.moe-watch-foot{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:10px 13px;border-top:1px solid var(--line);color:var(--muted);font:600 10px/1.4 'IBM Plex Mono',monospace}
.moe-watch-refresh{appearance:none;border:0;background:transparent;color:var(--accent);font:700 11px 'IBM Plex Mono',monospace;cursor:pointer;padding:5px}
.moe-watch-tick-up .moe-watch-last{animation:moeTickUp .7s}.moe-watch-tick-down .moe-watch-last{animation:moeTickDown .7s}
@keyframes moeTickUp{0%{background:rgba(74,222,128,.28)}100%{background:transparent}}@keyframes moeTickDown{0%{background:rgba(229,72,77,.28)}100%{background:transparent}}
@media(max-width:390px){.moe-watch-row{grid-template-columns:40px minmax(0,1fr) auto;padding-left:10px}.moe-watch-logo{width:38px;height:38px}.moe-watch-detail{grid-template-columns:repeat(2,minmax(0,1fr))}.moe-watch-time{display:none}}
</style>`;

const WATCHLIST_SCRIPT = String.raw`
<script id="moe-live-watchlist-script">
(function(){
  if(window.__moeLiveWatchlistInstalled)return;
  window.__moeLiveWatchlistInstalled=true;
  var chips=document.getElementById('chips');
  if(!chips)return;

  var COMPANY={PATH:'UiPath, Inc.',AAPL:'Apple Inc.',MSFT:'Microsoft Corp.',NVDA:'NVIDIA Corp.',AMZN:'Amazon.com, Inc.',GOOGL:'Alphabet Inc.',GOOG:'Alphabet Inc.',FDX:'FedEx Corp.',UPS:'United Parcel Service',HMC:'Honda Motor Co.',GD:'General Dynamics',NVO:'Novo Nordisk',UBER:'Uber Technologies',QS:'QuantumScape Corp.',RIVN:'Rivian Automotive, Inc.',LYFT:'Lyft, Inc.',SOFI:'SoFi Technologies, Inc.',BTU:'Peabody Energy',CHWY:'Chewy, Inc.',KGC:'Kinross Gold',CELH:'Celsius Holdings, Inc.',SMCI:'Super Micro Computer, Inc.',U:'Unity Software Inc.',ASTS:'AST SpaceMobile, Inc.',HIMS:'Hims & Hers Health, Inc.',TSLA:'Tesla, Inc.',META:'Meta Platforms, Inc.',AMD:'Advanced Micro Devices',SPY:'SPDR S&P 500 ETF',QQQ:'Invesco QQQ Trust'};
  var quotes={};
  var oldPrices={};
  var busy=false;
  var sortMode='LIST';
  var openSymbol='';
  var refreshTimer=null;

  var root=document.createElement('div');
  root.id='moeLiveWatchlist';
  root.className='moe-watchlist';
  root.dataset.state='loading';
  root.innerHTML='<div class="moe-watchlist-head"><div class="moe-watchlist-live"><span class="moe-watchlist-dot"></span><span id="moeWatchStatus">Live prices · IEX</span></div><div class="moe-watchlist-actions"><span class="moe-watchlist-time" id="moeWatchTime">Connecting…</span><button type="button" class="moe-watchlist-sort" id="moeWatchSort">List order</button></div></div><div class="moe-watchlist-list" id="moeWatchList"></div><div class="moe-watch-foot"><span>Tap a symbol for bid, ask, range and volume.</span><button type="button" class="moe-watch-refresh" id="moeWatchRefresh">Refresh</button></div>';
  chips.insertAdjacentElement('afterend',root);

  function esc(value){return String(value==null?'':value).replace(/[&<>"']/g,function(ch){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch];});}
  function symbols(){
    try{if(typeof state!=='undefined'&&Array.isArray(state.symbols))return state.symbols.slice();}catch(_){}
    return Array.from(chips.querySelectorAll('[data-rm]')).map(function(node){return String(node.dataset.rm||'').toUpperCase();}).filter(Boolean);
  }
  function price(value){var n=Number(value);return Number.isFinite(n)?n.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:n<10?3:2}):'—';}
  function signed(value,digits){var n=Number(value);if(!Number.isFinite(n))return '—';return (n>0?'+':'')+n.toFixed(digits==null?2:digits);}
  function volume(value){var n=Number(value);if(!Number.isFinite(n))return '—';if(n>=1e9)return (n/1e9).toFixed(1)+'B';if(n>=1e6)return (n/1e6).toFixed(1)+'M';if(n>=1e3)return (n/1e3).toFixed(1)+'K';return String(Math.round(n));}
  function tone(value){var n=Number(value);return !Number.isFinite(n)||n===0?'flat':n>0?'up':'down';}
  function company(symbol){return COMPANY[symbol]||symbol+' stock';}
  function initials(symbol){return symbol.length<=3?symbol:symbol.slice(0,3);}
  function ordered(list){
    if(sortMode==='GAIN')return list.slice().sort(function(a,b){return Number(quotes[b]?.changePercent??-Infinity)-Number(quotes[a]?.changePercent??-Infinity);});
    if(sortMode==='PRICE')return list.slice().sort(function(a,b){return Number(quotes[a]?.price??Infinity)-Number(quotes[b]?.price??Infinity);});
    if(sortMode==='SYMBOL')return list.slice().sort();
    return list;
  }
  function detail(q){return '<div class="moe-watch-detail"><div class="moe-watch-stat"><span>Bid</span><b>$'+price(q.bid)+'</b></div><div class="moe-watch-stat"><span>Ask</span><b>$'+price(q.ask)+'</b></div><div class="moe-watch-stat"><span>Day range</span><b>'+price(q.low)+'–'+price(q.high)+'</b></div><div class="moe-watch-stat"><span>Volume</span><b>'+volume(q.volume)+'</b></div></div>';}
  function row(symbol){
    var q=quotes[symbol]||{symbol:symbol,available:false};
    var changeTone=tone(q.changePercent);
    var old=Number(oldPrices[symbol]);
    var current=Number(q.price);
    var tick=Number.isFinite(old)&&Number.isFinite(current)&&current!==old?(current>old?' moe-watch-tick-up':' moe-watch-tick-down'):'';
    var after=q.extended&&Number.isFinite(Number(q.extendedChangePercent))?'<span class="moe-watch-after">'+(q.session==='PREMARKET'?'Pre':'After')+': $'+price(q.price)+' '+signed(q.extendedChangePercent,2)+'%</span>':'';
    var mainPrice=q.available?'$'+price(q.price):'—';
    var change=q.available?signed(q.change,2)+' · '+signed(q.changePercent,2)+'%':'Waiting for quote';
    return '<div class="moe-watch-row'+tick+'" data-symbol="'+esc(symbol)+'" data-open="'+String(openSymbol===symbol)+'"><div class="moe-watch-logo">'+esc(initials(symbol))+'</div><div class="moe-watch-name"><div class="moe-watch-symbol">'+esc(symbol)+'<span class="moe-watch-feed">IEX</span></div><div class="moe-watch-company">'+esc(company(symbol))+'</div></div><div class="moe-watch-price"><div class="moe-watch-last">'+mainPrice+'</div><div class="moe-watch-change '+changeTone+'">'+change+'</div>'+after+'</div><button type="button" class="moe-watch-remove" data-watch-remove="'+esc(symbol)+'" aria-label="Remove '+esc(symbol)+'">×</button>'+detail(q)+'</div>';
  }
  function render(){
    var list=ordered(symbols());
    var container=document.getElementById('moeWatchList');
    if(!container)return;
    container.innerHTML=list.length?list.map(row).join(''):'<div class="moe-watch-empty">Add a ticker above to build your live watchlist.</div>';
    list.forEach(function(symbol){var n=Number(quotes[symbol]?.price);if(Number.isFinite(n))oldPrices[symbol]=n;});
    container.querySelectorAll('.moe-watch-row').forEach(function(node){node.addEventListener('click',function(event){if(event.target.closest('[data-watch-remove]'))return;openSymbol=openSymbol===node.dataset.symbol?'':node.dataset.symbol;render();});});
    container.querySelectorAll('[data-watch-remove]').forEach(function(button){button.addEventListener('click',function(event){event.preventDefault();event.stopPropagation();var target=chips.querySelector('[data-rm="'+CSS.escape(button.dataset.watchRemove)+'"]');if(target)target.click();});});
  }
  function setStatus(text,stateName){var node=document.getElementById('moeWatchStatus');if(node)node.textContent=text;root.dataset.state=stateName||'ready';}
  function setTime(value){var node=document.getElementById('moeWatchTime');if(node)node.textContent=value;}
  async function refresh(force){
    if(busy)return;
    var list=symbols();
    render();
    if(!list.length){setStatus('Live prices · IEX','ready');setTime('No symbols');return;}
    busy=true;
    if(force||!Object.keys(quotes).length)setStatus('Updating prices…','loading');
    try{
      var response=await fetch('/api/mobile/watchlist/quotes?symbols='+encodeURIComponent(list.join(','))+'&t='+(force?Date.now():''),{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});
      var data=await response.json().catch(function(){return {};});
      if(!response.ok||data.ok!==true)throw new Error(data.error||('HTTP '+response.status));
      (data.quotes||[]).forEach(function(q){if(q&&q.symbol)quotes[q.symbol]=q;});
      setStatus((data.session==='PREMARKET'?'Premarket':data.session==='AFTER_HOURS'?'After hours':data.session==='REGULAR'?'Market live':'Latest prices')+' · IEX','ready');
      var stamp=data.updatedAt?new Date(data.updatedAt):new Date();
      setTime('Updated '+stamp.toLocaleTimeString([],{hour:'numeric',minute:'2-digit',second:'2-digit'}));
      render();
    }catch(error){setStatus('Prices unavailable · retrying','error');setTime(error&&error.message?error.message:'Connection error');}
    finally{busy=false;}
  }
  function cycleSort(){var order=['LIST','GAIN','PRICE','SYMBOL'];var labels={LIST:'List order',GAIN:'Top movers',PRICE:'Lowest price',SYMBOL:'A–Z'};sortMode=order[(order.indexOf(sortMode)+1)%order.length];document.getElementById('moeWatchSort').textContent=labels[sortMode];render();}
  function scheduleRefresh(){clearTimeout(refreshTimer);refreshTimer=setTimeout(function(){refresh(true);},180);}

  document.getElementById('moeWatchSort').addEventListener('click',cycleSort);
  document.getElementById('moeWatchRefresh').addEventListener('click',function(){refresh(true);});
  new MutationObserver(scheduleRefresh).observe(chips,{childList:true,subtree:true});
  document.addEventListener('visibilitychange',function(){if(!document.hidden)refresh(true);});
  setTimeout(function(){refresh(true);},250);
  clearInterval(window.__moeLiveWatchlistTick);
  window.__moeLiveWatchlistTick=setInterval(function(){if(!document.hidden)refresh(false);},3000);
})();
</script>`;

async function enhanceMobileWatchlist(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('id="moe-live-watchlist-script"')) return response;
  let output = html.includes('</head>')
    ? html.replace('</head>', `${WATCHLIST_STYLE}\n</head>`)
    : `${WATCHLIST_STYLE}\n${html}`;
  output = output.includes('</body>')
    ? output.replace('</body>', `${WATCHLIST_SCRIPT}\n</body>`)
    : `${output}\n${WATCHLIST_SCRIPT}`;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-moe-mobile-watchlist-ui', 'modern-live-v1');
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
    const response = await baseWorker.fetch(request, env, ctx);
    return MOBILE_PATHS.has(pathname)
      ? enhanceMobileWatchlist(response, request)
      : response;
  },
};
