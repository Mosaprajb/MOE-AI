import {
  aggregateBars,
  createMoeState,
  evaluateMoe,
  MOE_CONFIG,
} from '../../lib/moeEngine.js';

export const MOBILE_SCANNER_MONITOR_PATH = '/api/scanner/monitor';

const ANALYSIS_CACHE_PREFIX = 'https://moerand.internal/mobile-scanner-analysis-v1/';
const QUOTE_CACHE_PREFIX = 'https://moerand.internal/mobile-scanner-quote-v1/';
const FIVE_MINUTES_MS = 5 * 60_000;

function numeric(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function firstPositive(...values) {
  for (const value of values) {
    const parsed = numeric(value, null);
    if (parsed != null && parsed > 0) return parsed;
  }
  return null;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, numeric(value, minimum)));
}

function roundPrice(value) {
  const parsed = numeric(value, null);
  return parsed == null ? null : Number(parsed.toFixed(2));
}

function symbol(value) {
  const normalized = String(value || '').trim().toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : null;
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-mobile-scanner-monitor': '1.0.0',
    },
  });
}

function mobileRequestAllowed(request) {
  if (request.headers.get('x-moe-mobile-client') !== '1') return false;
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

function parseBars(items = []) {
  return items.map((bar) => ({
    t: new Date(bar.t).getTime(),
    o: Number(bar.o),
    h: Number(bar.h),
    l: Number(bar.l),
    c: Number(bar.c),
    v: Number(bar.v || 0),
  })).filter((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite));
}

function emaLast(values, length) {
  if (!Array.isArray(values) || values.length < length) return null;
  const alpha = 2 / (length + 1);
  let ema = null;
  for (const value of values) {
    if (!Number.isFinite(value)) continue;
    ema = ema == null ? value : value * alpha + ema * (1 - alpha);
  }
  return ema;
}

function higherTimeframeAligned(bars, higherMinutes = 60) {
  const higherBars = aggregateBars(bars, higherMinutes).slice(-160);
  if (higherBars.length < 55) return false;
  const closes = higherBars.map((bar) => Number(bar.c));
  const latest = closes.at(-1);
  const fast = emaLast(closes, 20);
  const slow = emaLast(closes, 50);
  return [latest, fast, slow].every(Number.isFinite) && latest >= slow && fast >= slow;
}

function alpacaHeaders(env = {}) {
  return {
    'APCA-API-KEY-ID': String(env.ALPACA_KEY_ID || ''),
    'APCA-API-SECRET-KEY': String(env.ALPACA_SECRET_KEY || ''),
  };
}

async function cacheRead(key) {
  const cache = globalThis.caches?.default;
  if (!cache) return null;
  const response = await cache.match(new Request(key));
  return response ? response.json().catch(() => null) : null;
}

async function cacheWrite(key, value, seconds) {
  const cache = globalThis.caches?.default;
  if (!cache) return;
  await cache.put(new Request(key), Response.json(value, {
    headers: { 'cache-control': `public, max-age=${seconds}` },
  })).catch(() => undefined);
}

async function fetchFiveMinuteBars(selectedSymbol, env, now = Date.now()) {
  const start = new Date(now - 18 * 86_400_000).toISOString();
  const end = new Date(now).toISOString();
  const query = new URLSearchParams({
    symbols: selectedSymbol,
    timeframe: '5Min',
    start,
    end,
    limit: '10000',
    adjustment: 'raw',
    feed: 'iex',
    sort: 'asc',
  });
  const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
    headers: alpacaHeaders(env),
  });
  if (!response.ok) throw new Error(`Alpaca 5-minute bars failed: ${response.status}`);
  const payload = await response.json();
  return parseBars(payload?.bars?.[selectedSymbol] || []);
}

async function analyzeSelectedSymbol(selectedSymbol, env, now = Date.now()) {
  const cacheKey = `${ANALYSIS_CACHE_PREFIX}${selectedSymbol}`;
  const cached = await cacheRead(cacheKey);
  if (cached) return cached;

  const bars = await fetchFiveMinuteBars(selectedSymbol, env, now);
  const complete = bars.filter((bar) => bar.t + FIVE_MINUTES_MS <= now).slice(-1800);
  const result = evaluateMoe(complete, createMoeState(), {
    ...MOE_CONFIG,
    primaryTimeframeMinutes: 5,
    preferredTimeframeMinutes: 60,
    allowRepeatedBuys: false,
    baseBuyScore: numeric(env.AUTO_SCANNER_ENGINE_MIN_SCORE, 58),
    initialTargetRR: numeric(env.MOE_AI_MIN_RISK_REWARD, 2),
  });
  const snapshot = result?.snapshot || {};
  const minimumScore = numeric(env.AUTO_SCANNER_MIN_SCORE, 68);
  const minimumRelativeVolume = numeric(env.AUTO_SCANNER_MIN_RVOL_CORE, 0.25);
  const aligned = higherTimeframeAligned(complete, 60);
  const score = numeric(snapshot.score, null);
  const relativeVolume = numeric(snapshot.relativeVolume, null);
  const scorePassed = score != null && score >= minimumScore;
  const volumePassed = relativeVolume == null || relativeVolume >= minimumRelativeVolume;
  const event = result?.event && result.event.type === 'BUY NOW' ? result.event : null;
  const rawPlan = event ? {
    entryPrice: roundPrice(event.entry),
    stopLossPrice: roundPrice(event.stop),
    exitPrice: roundPrice(event.target),
  } : null;

  const analysis = {
    symbol: selectedSymbol,
    historyReady: complete.length >= 80,
    completedBars: complete.length,
    lastCompletedCandleAt: complete.at(-1)?.t ? new Date(complete.at(-1).t).toISOString() : null,
    higherTimeframeAligned: aligned,
    score,
    minimumScore,
    scorePassed,
    relativeVolume,
    minimumRelativeVolume,
    volumePassed,
    signal: String(snapshot.signal || 'WAIT'),
    reason: String(snapshot.reason || 'SCANNING'),
    timeframe: '5m',
    higherTimeframe: '60m',
    atr: numeric(snapshot.atr, null),
    rawPlan,
    analyzedAt: new Date(now).toISOString(),
  };
  await cacheWrite(cacheKey, analysis, 12);
  return analysis;
}

async function fetchLiveQuote(selectedSymbol, env) {
  const cacheKey = `${QUOTE_CACHE_PREFIX}${selectedSymbol}`;
  const cached = await cacheRead(cacheKey);
  if (cached) return cached;

  let response = await fetch(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(selectedSymbol)}/snapshot`, {
    headers: alpacaHeaders(env),
  });
  let feed = 'BEST_AVAILABLE';
  if (!response.ok) {
    response = await fetch(`https://data.alpaca.markets/v2/stocks/${encodeURIComponent(selectedSymbol)}/snapshot?feed=iex`, {
      headers: alpacaHeaders(env),
    });
    feed = 'IEX';
  }
  if (!response.ok) throw new Error(`Alpaca live quote failed: ${response.status}`);
  const snapshot = await response.json();
  const bid = firstPositive(snapshot?.latestQuote?.bp);
  const ask = firstPositive(snapshot?.latestQuote?.ap);
  const trade = firstPositive(snapshot?.latestTrade?.p);
  const minuteClose = firstPositive(snapshot?.minuteBar?.c);
  const price = firstPositive(trade, ask, minuteClose, bid);
  const spreadPercent = bid && ask ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
  const quote = {
    symbol: selectedSymbol,
    price: roundPrice(price),
    bid: roundPrice(bid),
    ask: roundPrice(ask),
    spreadPercent: spreadPercent == null ? null : Number(spreadPercent.toFixed(3)),
    feed,
    updatedAt: snapshot?.latestTrade?.t || snapshot?.latestQuote?.t || new Date().toISOString(),
  };
  await cacheWrite(cacheKey, quote, 2);
  return quote;
}

function preparePlan(analysis, quote, env = {}) {
  const raw = analysis?.rawPlan;
  if (!raw) return null;
  const rawEntry = firstPositive(raw.entryPrice);
  const rawStop = firstPositive(raw.stopLossPrice);
  const rawExit = firstPositive(raw.exitPrice);
  if (!(rawEntry && rawStop && rawExit && rawStop < rawEntry && rawExit > rawEntry)) return null;

  const originalRisk = Math.max(rawEntry - rawStop, 0.01);
  const rewardRisk = Math.max(2, (rawExit - rawEntry) / originalRisk);
  const entry = firstPositive(quote?.ask, quote?.price, rawEntry);
  const stopLoss = entry ? entry - originalRisk : rawStop;
  const exit = entry ? entry + originalRisk * rewardRisk : rawExit;
  const driftPercent = entry ? Math.abs(entry - rawEntry) / rawEntry * 100 : null;
  const maximumDrift = numeric(env.AUTO_SCANNER_MAX_DRIFT_CORE_PERCENT, 1);

  return {
    entryPrice: roundPrice(entry),
    exitPrice: roundPrice(exit),
    stopLossPrice: roundPrice(stopLoss),
    rawEntryPrice: roundPrice(rawEntry),
    riskPerShare: roundPrice(originalRisk),
    rewardRisk: Number(rewardRisk.toFixed(2)),
    driftPercent: driftPercent == null ? null : Number(driftPercent.toFixed(3)),
    maximumDriftPercent: maximumDrift,
    driftPassed: driftPercent == null || driftPercent <= maximumDrift,
  };
}

async function readScannerAudit(env = {}) {
  try {
    const binding = env.ALERT_COORDINATOR;
    if (!binding?.getByName) return null;
    return await binding.getByName('global').sandboxPilotAudit({ limit: 160 });
  } catch {
    return null;
  }
}

function actualSymbolState(audit, selectedSymbol) {
  const events = Array.isArray(audit?.events?.recent) ? audit.events.recent : [];
  const recentCutoff = Date.now() - 30 * 60_000;
  const event = events.find((item) => String(item?.symbol || '').toUpperCase() === selectedSymbol
    && Date.parse(item?.createdAt || 0) >= recentCutoff
    && ['SANDBOX_ORDER_SUBMITTED', 'SANDBOX_ORDER_REJECTED', 'SANDBOX_ORDER_BLOCKED', 'SANDBOX_ORDER_FAILED'].includes(String(item?.type || '').toUpperCase()));
  const submissions = Array.isArray(audit?.scanner?.lastRun?.submissions)
    ? audit.scanner.lastRun.submissions
    : [];
  const submission = submissions.find((item) => String(item?.symbol || '').toUpperCase() === selectedSymbol) || null;
  return { event: event || null, submission };
}

function readiness(analysis, plan, actual, audit) {
  let percent = 5;
  if (analysis?.historyReady) percent = 15;
  if (analysis?.higherTimeframeAligned) percent = 30;
  const scoreRatio = analysis?.score == null
    ? 0
    : clamp(analysis.score / Math.max(1, analysis.minimumScore), 0, 1);
  percent = Math.max(percent, 30 + scoreRatio * 30);
  if (analysis?.volumePassed) percent += 8;

  const signal = String(analysis?.signal || '').toUpperCase();
  if (signal === 'WATCH NOW') percent = Math.max(percent, 68);
  if (signal === 'BUY READY') percent = Math.max(percent, 80);
  if (signal === 'BUY NOW') percent = Math.max(percent, 90);
  if (plan?.driftPassed) percent = Math.max(percent, 93);
  if (actual?.submission?.accepted === true) percent = Math.max(percent, 97);
  if (actual?.submission?.submitted === true || actual?.event?.type === 'SANDBOX_ORDER_SUBMITTED') percent = 100;
  percent = Math.round(clamp(percent));

  const lastRun = audit?.scanner?.lastRun || {};
  let stage = 'Scanning the selected symbol';
  if (lastRun?.skipped === 'Waiting for a completed configured candle') stage = 'Waiting for a completed 5-minute candle';
  if (signal === 'WATCH NOW') stage = 'Setup is approaching the entry conditions';
  if (signal === 'BUY READY') stage = 'Buy trigger is forming';
  if (signal === 'BUY NOW' && !plan?.driftPassed) stage = 'Signal found, but price drift is too large';
  if (signal === 'BUY NOW' && plan?.driftPassed) stage = 'Candidate reached the final scanner gates';
  if (actual?.submission?.accepted === true) stage = 'Candidate accepted by the Paper order pipeline';
  if (actual?.submission?.submitted === true || actual?.event?.type === 'SANDBOX_ORDER_SUBMITTED') stage = 'Paper order submitted';

  return {
    percent,
    stage,
    color: percent >= 90 ? 'green' : percent >= 60 ? 'amber' : 'red',
    estimateOnly: true,
  };
}

export async function handleMobileScannerMonitor(request, env = {}) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  if (!mobileRequestAllowed(request)) return json({ ok: false, error: 'Mobile scanner access denied.' }, 403);
  const selectedSymbol = symbol(new URL(request.url).searchParams.get('symbol'));
  if (!selectedSymbol) return json({ ok: false, error: 'A valid symbol is required.' }, 400);
  if (!env.ALPACA_KEY_ID || !env.ALPACA_SECRET_KEY) {
    return json({ ok: false, error: 'Alpaca market-data credentials are not configured.' }, 503);
  }

  try {
    const [analysis, quote, audit] = await Promise.all([
      analyzeSelectedSymbol(selectedSymbol, env),
      fetchLiveQuote(selectedSymbol, env),
      readScannerAudit(env),
    ]);
    const plan = preparePlan(analysis, quote, env);
    const actual = actualSymbolState(audit, selectedSymbol);
    const progress = readiness(analysis, plan, actual, audit);
    const lastRun = audit?.scanner?.lastRun || {};

    return json({
      ok: true,
      symbol: selectedSymbol,
      quote,
      plan: plan ? {
        ...plan,
        score: analysis.score,
        minimumScore: analysis.minimumScore,
        relativeVolume: analysis.relativeVolume,
        minimumRelativeVolume: analysis.minimumRelativeVolume,
        timeframe: analysis.timeframe,
        higherTimeframe: analysis.higherTimeframe,
        signal: analysis.signal,
        reason: analysis.reason,
      } : null,
      readiness: progress,
      scanner: {
        signal: analysis.signal,
        reason: analysis.reason,
        score: analysis.score,
        minimumScore: analysis.minimumScore,
        relativeVolume: analysis.relativeVolume,
        minimumRelativeVolume: analysis.minimumRelativeVolume,
        higherTimeframeAligned: analysis.higherTimeframeAligned,
        lastCompletedCandleAt: analysis.lastCompletedCandleAt,
        lastRunAt: audit?.scanner?.lastRunAt || null,
        skipped: lastRun.skipped || null,
        scanned: numeric(lastRun.scanned, 0),
        accepted: numeric(lastRun.accepted, 0),
        submitted: numeric(lastRun.submitted, 0),
      },
      safety: {
        mode: 'PAPER',
        liveTradingLocked: true,
        liveFundsUsed: false,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return json({
      ok: false,
      symbol: selectedSymbol,
      error: error instanceof Error ? error.message : 'Scanner monitor failed.',
    }, 502);
  }
}

const MOBILE_SCANNER_MONITOR_STYLE = String.raw`
<style id="moe-mobile-scanner-monitor-style">
.moe-monitor{margin-bottom:18px;padding:16px;border:1px solid var(--line);border-radius:18px;background:var(--panel-2)}
.moe-monitor-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:14px}
.moe-monitor-title{font-size:14px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.moe-monitor-refresh{width:auto;padding:10px 13px;border-radius:12px;font-size:14px}
.moe-monitor-price{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:34px;font-weight:700;color:var(--accent);margin:12px 0 2px}
.moe-monitor-meta{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;color:var(--muted)}
.moe-monitor-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:15px}
.moe-monitor-cell{padding:12px 8px;border:1px solid var(--line);border-radius:13px;background:var(--panel);text-align:center;min-width:0}
.moe-monitor-cell span{display:block;font-size:9px;letter-spacing:.09em;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
.moe-monitor-cell b{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:15px;white-space:nowrap}
.moe-readiness{margin-top:16px}.moe-readiness-top{display:flex;justify-content:space-between;gap:10px;font-size:13px}.moe-readiness-top b{font-family:'IBM Plex Mono',ui-monospace,monospace}
.moe-readiness-track{height:13px;margin-top:8px;border-radius:99px;background:var(--panel);border:1px solid var(--line);overflow:hidden}
.moe-readiness-fill{height:100%;width:0;border-radius:99px;background:var(--red);transition:width .45s ease,background-color .45s ease}
.moe-readiness-note{margin-top:8px;font-size:12px;color:var(--muted)}
.moe-activity-tools{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.moe-activity-tools .btn{padding:13px;font-size:14px;justify-content:center}
@media(max-width:390px){.moe-monitor-grid{grid-template-columns:1fr}.moe-monitor-cell{text-align:left}.moe-monitor-cell span,.moe-monitor-cell b{display:inline}.moe-monitor-cell span{margin-right:8px}.moe-monitor-price{font-size:30px}}
</style>`;

const MOBILE_SCANNER_MONITOR_SCRIPT = String.raw`
<script id="moe-mobile-scanner-monitor-script">
(function(){
  if(window.__moeMobileScannerMonitor)return;
  window.__moeMobileScannerMonitor=true;
  const ENDPOINT='${MOBILE_SCANNER_MONITOR_PATH}';
  const CLEAR_KEY='moe-mobile-activity-cleared-at-v1';
  let selectedSymbol='';
  let loading=false;

  function node(id){return document.getElementById(id);}
  function money(value){const parsed=Number(value);return Number.isFinite(parsed)?'$'+parsed.toFixed(2):'—';}
  function safe(value){return String(value??'').replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}
  function symbols(){return typeof state==='undefined'||!Array.isArray(state.symbols)?[]:state.symbols.map(function(value){return String(value||'').toUpperCase();}).filter(Boolean);}

  function ensureMonitor(){
    let box=node('moeScannerMonitor');
    if(box)return box;
    const body=document.querySelector('#sheetScanner .sheet-body');
    if(!body)return null;
    box=document.createElement('section');
    box.id='moeScannerMonitor';
    box.className='moe-monitor';
    box.innerHTML='<div class="moe-monitor-head"><div class="moe-monitor-title">Selected symbol live monitor</div><button type="button" class="btn moe-monitor-refresh" id="moeMonitorRefresh">↻ Refresh</button></div>'+
      '<label class="fld" for="moeMonitorSymbol">Symbol</label><select class="big mono" id="moeMonitorSymbol"></select>'+
      '<div class="moe-monitor-price" id="moeMonitorPrice">—</div><div class="moe-monitor-meta" id="moeMonitorMeta">Waiting for live quote</div>'+
      '<div class="moe-monitor-grid"><div class="moe-monitor-cell"><span>Entry</span><b id="moeMonitorEntry">—</b></div><div class="moe-monitor-cell"><span>Target / exit</span><b id="moeMonitorExit">—</b></div><div class="moe-monitor-cell"><span>Stop loss</span><b id="moeMonitorStop">—</b></div></div>'+
      '<div class="moe-readiness"><div class="moe-readiness-top"><span id="moeMonitorStage">Scanning</span><b id="moeMonitorPercent">0%</b></div><div class="moe-readiness-track"><div class="moe-readiness-fill" id="moeMonitorFill"></div></div><div class="moe-readiness-note">Readiness is an estimate of scanner gates, not a guarantee that an order will execute.</div></div>';
    body.insertBefore(box,body.firstChild);
    node('moeMonitorRefresh').onclick=function(){refreshMonitor(true);};
    node('moeMonitorSymbol').onchange=function(event){
      selectedSymbol=String(event.target.value||'').toUpperCase();
      try{localStorage.setItem('moe-mobile-monitor-symbol-v1',selectedSymbol);}catch(_){}
      refreshMonitor(true);
    };
    return box;
  }

  function syncSymbolOptions(){
    const select=node('moeMonitorSymbol');if(!select)return;
    const list=symbols();
    let saved='';try{saved=localStorage.getItem('moe-mobile-monitor-symbol-v1')||'';}catch(_){}
    if(!list.includes(selectedSymbol)) selectedSymbol=list.includes(saved)?saved:(list[0]||'');
    const signature=list.join(',');
    if(select.dataset.signature!==signature){
      select.dataset.signature=signature;
      select.innerHTML=list.length?list.map(function(item){return '<option value="'+safe(item)+'">'+safe(item)+'</option>';}).join(''):'<option value="">No symbol selected</option>';
    }
    select.value=selectedSymbol;
  }

  function renderMonitor(payload){
    const quote=payload.quote||{},plan=payload.plan||null,ready=payload.readiness||{};
    node('moeMonitorPrice').textContent=money(quote.price);
    const updated=quote.updatedAt?new Date(quote.updatedAt).toLocaleTimeString('en-US',{hour12:false}):'—';
    node('moeMonitorMeta').textContent=(quote.feed||'ALPACA')+' · Bid '+money(quote.bid)+' · Ask '+money(quote.ask)+' · '+updated;
    node('moeMonitorEntry').textContent=money(plan?.entryPrice);
    node('moeMonitorExit').textContent=money(plan?.exitPrice);
    node('moeMonitorStop').textContent=money(plan?.stopLossPrice);
    node('moeMonitorStage').textContent=ready.stage||payload.scanner?.reason||'Scanning';
    const percent=Math.max(0,Math.min(100,Number(ready.percent)||0));
    node('moeMonitorPercent').textContent=Math.round(percent)+'%';
    const fill=node('moeMonitorFill');fill.style.width=percent+'%';
    fill.style.background=percent>=90?'var(--green)':percent>=60?'var(--amber)':'var(--red)';
  }

  async function refreshMonitor(force){
    ensureMonitor();syncSymbolOptions();
    if(!selectedSymbol||loading)return;
    if(!force&&node('sheetScanner')?.dataset.open!=='true')return;
    loading=true;
    const button=node('moeMonitorRefresh');if(button)button.disabled=true;
    try{
      const response=await fetch(ENDPOINT+'?symbol='+encodeURIComponent(selectedSymbol),{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});
      const payload=await response.json().catch(function(){return {};});
      if(!response.ok||payload.ok===false)throw new Error(payload.error||'Monitor unavailable');
      renderMonitor(payload);
    }catch(error){
      node('moeMonitorMeta').textContent=error.message||'Live monitor unavailable';
    }finally{
      loading=false;if(button)button.disabled=false;
    }
  }

  function ensureActivityTools(){
    if(node('moeActivityTools'))return;
    const body=document.querySelector('#sheetActivity .sheet-body');if(!body)return;
    const tools=document.createElement('div');tools.id='moeActivityTools';tools.className='moe-activity-tools';
    tools.innerHTML='<button type="button" class="btn" id="moeActivityRefresh">↻ Refresh</button><button type="button" class="btn ghost" id="moeActivityClear">Clear old</button>';
    body.insertBefore(tools,body.firstChild);
    node('moeActivityRefresh').onclick=function(){enhancedLoadActivity(true);};
    node('moeActivityClear').onclick=function(){
      try{localStorage.setItem(CLEAR_KEY,String(Date.now()));}catch(_){}
      node('activityList').innerHTML='<div class="empty">Old activity cleared from this screen. New scanner events will appear here.</div>';
    };
  }

  async function enhancedLoadActivity(manual){
    ensureActivityTools();
    const button=node('moeActivityRefresh');if(button&&manual){button.disabled=true;button.textContent='Refreshing…';}
    try{
      const response=await fetch(API.activity,{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});
      const payload=await response.json().catch(function(){return {};});
      if(!response.ok||payload.ok===false)throw new Error(payload.error||'Activity unavailable');
      let cutoff=0;try{cutoff=Number(localStorage.getItem(CLEAR_KEY)||0);}catch(_){}
      const items=(payload.events||payload.activity||payload.items||[]).filter(function(item){
        const time=Date.parse(item.createdAt||item.timestamp||0);return !cutoff||!Number.isFinite(time)||time>cutoff;
      }).slice(0,80);
      node('activityList').innerHTML=items.length?'<div class="log">'+items.map(function(item){
        const stamp=item.createdAt||item.timestamp;
        const time=stamp?new Date(stamp).toLocaleTimeString('en-US',{hour12:false}):'';
        return '<div><b>'+safe(time)+'</b> '+safe(item.type||item.event||'')+' '+safe(item.symbol||'')+' '+safe(item.reason||item.message||'')+'</div>';
      }).join('')+'</div>':'<div class="empty">No new activity after the last clear.</div>';
    }catch(_){node('activityList').innerHTML='<div class="empty">Activity is unavailable right now.</div>';}
    finally{if(button&&manual){button.disabled=false;button.textContent='↻ Refresh';}}
  }

  function install(){
    ensureMonitor();syncSymbolOptions();ensureActivityTools();
    try{loadActivity=enhancedLoadActivity;}catch(_){}
    node('openScanner')?.addEventListener('click',function(){setTimeout(function(){refreshMonitor(true);},0);});
    node('openActivity')?.addEventListener('click',function(){setTimeout(function(){enhancedLoadActivity(false);},0);});
    refreshMonitor(false);
    clearInterval(window.__moeScannerMonitorTick);
    window.__moeScannerMonitorTick=setInterval(function(){syncSymbolOptions();refreshMonitor(false);},3000);
    document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshMonitor(false);});
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
</script>`;

export async function enhanceMobileScannerMonitor(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('id="moe-mobile-scanner-monitor-script"')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const enhanced = html
    .replace('</head>', `${MOBILE_SCANNER_MONITOR_STYLE}\n</head>`)
    .replace('</body>', `${MOBILE_SCANNER_MONITOR_SCRIPT}\n</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-moe-mobile-scanner-monitor', 'enabled');
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
