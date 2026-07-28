import worker, { AlertCoordinator as BaseAlertCoordinator } from './scanner-tab-live-overlay-entry.js';
import { AUTO_SCANNER_SYMBOLS, activeTradingWindow } from './auto-scanner.js';
import {
  applyScannerSelectionSettings,
  getScannerSelectionSettings,
  SCANNER_SELECTION_LEVELS,
  updateScannerSelectionSettings,
} from './scanner-selection-service.js';

const SELECTION_PATH = '/api/scanner/selection';
const DIAGNOSTIC_PATH = '/api/scanner/diagnostic';
const LIVE_ACTIVITY_PATH = '/api/scanner/live-activity';
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const ACTIVITY_BATCH_SIZE = 12;
const ACTIVITY_BUCKET_MS = 12_000;

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function headers(response) {
  const result = new Headers(response.headers);
  result.delete('content-length');
  return result;
}

function runtimeEnv(env, settings) {
  const overrides = applyScannerSelectionSettings(env, settings);
  return new Proxy(env, {
    get(target, property, receiver) {
      if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
      return Reflect.get(target, property, receiver);
    },
  });
}

function activityPosition(now = Date.now(), size = ACTIVITY_BATCH_SIZE) {
  const total = AUTO_SCANNER_SYMBOLS.length;
  const batches = Math.ceil(total / size);
  const cycle = Math.floor(now / ACTIVITY_BUCKET_MS) % batches;
  const start = cycle * size;
  const batch = AUTO_SCANNER_SYMBOLS.slice(start, Math.min(total, start + size));
  return {
    cycle,
    batches,
    start,
    batch,
    scannedCount: Math.min(total, start + batch.length),
  };
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function rowFromBar(symbol, latest, status = 'SCANNED') {
  if (!latest) return { symbol, status: 'NO_RECENT_BAR', profile: '1m LIVE DATA', reason: 'No recent bar returned for this symbol' };
  return {
    symbol,
    status,
    profile: '1m LIVE DATA',
    price: positive(latest.c),
    open: positive(latest.o),
    high: positive(latest.h),
    low: positive(latest.l),
    close: positive(latest.c),
    volume: Number.isFinite(Number(latest.v)) ? Number(latest.v) : null,
    barTime: latest.t || null,
  };
}

async function diagnosticProbe(env, stub, now = Date.now(), { source = 'MANUAL_DIAGNOSTIC' } = {}) {
  const window = activeTradingWindow(new Date(now), env);
  const position = activityPosition(now);
  const batch = position.batch;
  const start = new Date(now - 6 * 60 * 60_000).toISOString();
  const end = new Date(now).toISOString();
  const feed = window.dataFeed || 'iex';
  const query = new URLSearchParams({
    symbols: batch.join(','),
    timeframe: '1Min',
    start,
    end,
    limit: '10000',
    adjustment: 'raw',
    feed,
    sort: 'asc',
  });

  await stub.recordScannerProgress({
    status: 'RUNNING',
    phase: source === 'LIVE_ACTIVITY' ? 'LIVE_MARKET_SCAN' : 'DIAGNOSTIC_DATA_CHECK',
    totalSymbols: AUTO_SCANNER_SYMBOLS.length,
    scannedCount: position.start,
    currentBatch: batch,
    currentSymbol: batch[0] || null,
    currentProfile: '1m LIVE DATA',
    session: window.label || 'UNKNOWN',
    rows: batch.map((symbol) => ({ symbol, status: 'CHECKING_DATA', profile: '1m LIVE DATA' })),
    reason: source,
  });

  try {
    const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
      headers: {
        'APCA-API-KEY-ID': env.ALPACA_KEY_ID,
        'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY,
      },
    });
    if (!response.ok) throw new Error(`Market data returned ${response.status}`);
    const payload = await response.json();
    const rows = batch.map((symbol) => {
      const bars = Array.isArray(payload.bars?.[symbol]) ? payload.bars[symbol] : [];
      return rowFromBar(symbol, bars.at(-1) || null, 'SCANNED');
    });
    const withPrice = rows.filter((row) => Number.isFinite(row.price));
    const current = withPrice[0] || rows[0] || null;
    await stub.recordScannerProgress({
      status: 'RUNNING',
      phase: source === 'LIVE_ACTIVITY' ? 'LIVE_MARKET_SCAN' : 'DIAGNOSTIC_COMPLETE',
      totalSymbols: AUTO_SCANNER_SYMBOLS.length,
      scannedCount: position.scannedCount,
      currentBatch: batch,
      currentSymbol: current?.symbol || batch[0] || null,
      currentProfile: '1m LIVE DATA',
      session: window.label || 'UNKNOWN',
      rows,
      reason: withPrice.length
        ? `Real market data received for ${withPrice.length}/${batch.length} symbols`
        : 'The scan ran, but no recent bars were returned for this batch',
      completedAt: new Date().toISOString(),
    });
    return {
      ok: true,
      source,
      feed,
      session: window.label || 'UNKNOWN',
      cycle: position.cycle + 1,
      cycles: position.batches,
      scannedCount: position.scannedCount,
      totalSymbols: AUTO_SCANNER_SYMBOLS.length,
      batch,
      symbolsWithPrices: withPrice.length,
      rows,
      updatedAt: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Market-data request failed';
    const rows = batch.map((symbol) => ({ symbol, status: 'DATA_ERROR', profile: '1m LIVE DATA', reason: message }));
    await stub.recordScannerProgress({
      status: 'FAILED',
      phase: 'LIVE_MARKET_SCAN_FAILED',
      totalSymbols: AUTO_SCANNER_SYMBOLS.length,
      scannedCount: position.scannedCount,
      currentBatch: batch,
      currentSymbol: batch[0] || null,
      currentProfile: '1m LIVE DATA',
      session: window.label || 'UNKNOWN',
      rows,
      reason: message,
      completedAt: new Date().toISOString(),
    });
    return {
      ok: false,
      source,
      error: message,
      feed,
      session: window.label || 'UNKNOWN',
      cycle: position.cycle + 1,
      cycles: position.batches,
      scannedCount: position.scannedCount,
      totalSymbols: AUTO_SCANNER_SYMBOLS.length,
      batch,
      rows,
      updatedAt: new Date().toISOString(),
    };
  }
}

function controlsMarkup() {
  return `<div id="scannerSelectionControls" class="scanner-selection-controls">
    <div class="scanner-selection-copy"><strong>درجة اختيار الأسهم</strong><span id="scannerSelectionDescription">تحميل الإعداد...</span></div>
    <div class="scanner-selection-buttons">
      <button type="button" data-level="DISCOVERY">استكشاف <small>58</small></button>
      <button type="button" data-level="ACTIVE">نشط <small>65</small></button>
      <button type="button" data-level="BALANCED">متوازن <small>70</small></button>
      <button type="button" data-level="CONSERVATIVE">حذر <small>75</small></button>
    </div>
    <button type="button" id="scannerDiagnosticNow" class="scanner-diagnostic-button">فحص البيانات الآن</button>
    <div id="scannerSelectionMessage" class="scanner-selection-message">يعمل فحص مرئي حقيقي للأسعار تلقائيًا أثناء وجودك في قسم السكانر. عدد الفرص المطابقة منفصل عن عدد الأسهم المفحوصة.</div>
  </div>`;
}

async function enhance(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  let html = await response.text();
  if (html.includes('scannerSelectionControls')) return new Response(html, { status: response.status, statusText: response.statusText, headers: headers(response) });

  const style = `<style id="scannerSelectionStyles">
  .scanner-selection-controls{display:grid;grid-template-columns:minmax(220px,1fr) minmax(320px,1.5fr) auto;gap:10px;align-items:center;margin:12px 0;padding:13px;border:1px solid rgba(67,111,150,.58);border-radius:14px;background:rgba(5,18,31,.72)}.scanner-selection-copy strong{display:block;color:#eaf4ff;font-size:13px}.scanner-selection-copy span{display:block;margin-top:5px;color:#8fa4bf;font-size:10px;line-height:1.5}.scanner-selection-buttons{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.scanner-selection-buttons button,.scanner-diagnostic-button{min-height:42px;border:1px solid #365f82;border-radius:10px;background:#102d48;color:#eaf4ff;font-weight:900;cursor:pointer}.scanner-selection-buttons button small{display:block;margin-top:2px;color:#86a4be}.scanner-selection-buttons button.active{border-color:#54dfa0;background:#17553f;color:#fff;box-shadow:0 0 18px rgba(84,223,160,.18)}.scanner-diagnostic-button{background:#173e61}.scanner-selection-buttons button:disabled,.scanner-diagnostic-button:disabled{opacity:.55;cursor:wait}.scanner-selection-message{grid-column:1/-1;color:#8fa4bf;font-size:9px;line-height:1.55}.scanner-selection-message.success{color:#83e9b2}.scanner-selection-message.error{color:#ffabb5}
  @media(max-width:900px){.scanner-selection-controls{grid-template-columns:1fr}.scanner-selection-buttons{grid-template-columns:repeat(2,minmax(0,1fr))}.scanner-selection-message{grid-column:1}}
  </style>`;

  const script = `<script id="scannerSelectionControlsScript">
  (function(){
    let cachedPin='',settingsBusy=false,activityBusy=false,scannerVisible=false,cycleTimer=null;
    const byId=id=>document.getElementById(id);
    const money=value=>Number.isFinite(Number(value))?'$'+Number(value).toFixed(2):'—';
    const compact=value=>Number.isFinite(Number(value))?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(value)):'—';
    const message=(text,type)=>{const el=byId('scannerSelectionMessage');if(el){el.textContent=text;el.className='scanner-selection-message '+(type||'');}};
    const pin=()=>cachedPin||(cachedPin=window.prompt('أدخل رمز التحكم لتعديل حساسية السكانر. سيبقى في ذاكرة الصفحة فقط.')||'');

    function showRow(row,index,total,activity){
      if(!row)return;const phase=byId('scannerRuntimePhase');if(phase)phase.textContent='جارٍ فحص '+(index+1)+' من '+total;
      if(byId('scannerRuntimeSymbol'))byId('scannerRuntimeSymbol').textContent=String(row.symbol||'—').toUpperCase();
      if(byId('scannerRuntimePrice'))byId('scannerRuntimePrice').textContent=money(row.price??row.close);
      if(byId('scannerRuntimeOpen'))byId('scannerRuntimeOpen').textContent=money(row.open);
      if(byId('scannerRuntimeHigh'))byId('scannerRuntimeHigh').textContent=money(row.high);
      if(byId('scannerRuntimeLow'))byId('scannerRuntimeLow').textContent=money(row.low);
      if(byId('scannerRuntimeClose'))byId('scannerRuntimeClose').textContent=money(row.close??row.price);
      if(byId('scannerRuntimeBid'))byId('scannerRuntimeBid').textContent='—';
      if(byId('scannerRuntimeAsk'))byId('scannerRuntimeAsk').textContent='—';
      if(byId('scannerRuntimeVolume'))byId('scannerRuntimeVolume').textContent=compact(row.volume);
      if(byId('scannerRuntimeProfile'))byId('scannerRuntimeProfile').textContent='1m LIVE';
      if(byId('scannerRuntimeProgressText'))byId('scannerRuntimeProgressText').textContent='تمت مراجعة '+activity.scannedCount+' من '+activity.totalSymbols+' · الدورة '+activity.cycle+' من '+activity.cycles;
      if(byId('scannerRuntimeProgressBar'))byId('scannerRuntimeProgressBar').style.width=Math.min(100,(activity.scannedCount/activity.totalSymbols)*100)+'%';
      if(byId('scannerRuntimeUpdated'))byId('scannerRuntimeUpdated').textContent='آخر تحديث: '+new Date(activity.updatedAt).toLocaleTimeString('ar-US');
      document.querySelectorAll('#scannerRuntimeBatch .scanner-batch-item').forEach(item=>item.classList.toggle('active',item.dataset.symbol===String(row.symbol||'').toUpperCase()));
    }

    function renderActivity(activity){
      const rows=Array.isArray(activity.rows)?activity.rows:[];const batch=byId('scannerRuntimeBatch');
      if(batch)batch.innerHTML=rows.map(row=>'<div class="scanner-batch-item" data-symbol="'+String(row.symbol||'').toUpperCase()+'"><strong dir="ltr">'+String(row.symbol||'—').toUpperCase()+'</strong><span dir="ltr">'+money(row.price??row.close)+'</span><small>'+String(row.status||'SCANNED').replaceAll('_',' ')+'</small></div>').join('');
      if(cycleTimer)clearInterval(cycleTimer);let index=0;if(rows.length){showRow(rows[0],0,rows.length,activity);cycleTimer=setInterval(()=>{index=(index+1)%rows.length;showRow(rows[index],index,rows.length,activity);},850);}else if(byId('scannerRuntimePhase'))byId('scannerRuntimePhase').textContent='لم تُرجع الدفعة بيانات';
      message(activity.ok?'المسح المرئي يعمل الآن: تم استلام أسعار '+activity.symbolsWithPrices+' من '+activity.batch.length+' أسهم.':'تم تشغيل المسح، لكن مصدر البيانات أعاد خطأ: '+(activity.error||'غير معروف'),activity.ok?'success':'error');
    }

    async function loadSettings(){try{const response=await fetch('/api/scanner/selection',{cache:'no-store'}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر تحميل الإعداد');const settings=payload.settings||{};document.querySelectorAll('[data-level]').forEach(button=>button.classList.toggle('active',button.dataset.level===settings.level));byId('scannerSelectionDescription').textContent=(settings.labelAr||settings.level)+' · الحد الأولي '+settings.minimumScore+' · '+(settings.descriptionAr||'');}catch(error){message(error.message||String(error),'error');}}

    async function update(level){if(settingsBusy)return;const controlPin=pin();if(!controlPin)return;settingsBusy=true;document.querySelectorAll('[data-level]').forEach(button=>button.disabled=true);try{const response=await fetch('/api/scanner/selection',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({pin:controlPin,level})}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر حفظ الإعداد');message('تم ضبط درجة اختيار الأسهم على '+payload.settings.labelAr+' ('+payload.settings.minimumScore+'). سيستخدمها الفحص القادم.','success');await loadSettings();}catch(error){if(/incorrect pin|invalid pin/i.test(error.message))cachedPin='';message(error.message||String(error),'error');}finally{settingsBusy=false;document.querySelectorAll('[data-level]').forEach(button=>button.disabled=false);}}

    async function activity(force=false){
      if(activityBusy||document.hidden||(!scannerVisible&&!force))return;activityBusy=true;const button=byId('scannerDiagnosticNow');if(force&&button){button.disabled=true;button.textContent='جارٍ فحص الأسعار...';}
      try{const response=await fetch('/api/scanner/live-activity',{cache:'no-store'}),payload=await response.json();if(!response.ok&&!payload.activity)throw new Error(payload.error||'فشل المسح المرئي');renderActivity(payload.activity||{});}catch(error){message(error.message||String(error),'error');if(byId('scannerRuntimePhase'))byId('scannerRuntimePhase').textContent='خطأ في بيانات السوق';}finally{activityBusy=false;if(button){button.disabled=false;button.textContent='فحص البيانات الآن';}}
    }

    const start=()=>{
      document.querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>update(button.dataset.level));const test=byId('scannerDiagnosticNow');if(test)test.onclick=()=>activity(true);loadSettings();
      const scanner=byId('scanner');if(scanner&&'IntersectionObserver' in window){new IntersectionObserver(entries=>{scannerVisible=entries.some(entry=>entry.isIntersecting);if(scannerVisible)activity(true);},{threshold:.05}).observe(scanner);}else scannerVisible=true;
      setInterval(()=>activity(false),12000);
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  })();
  </script>`;

  const marker = '<div class="terminal-grid scanner-grid">';
  if (html.includes(marker)) html = html.replace(marker, `${controlsMarkup()}${marker}`);
  html = html.replace('</head>', `${style}</head>`).replace('</body>', `${script}</body>`);
  return new Response(html, { status: response.status, statusText: response.statusText, headers: headers(response) });
}

export class AlertCoordinator extends BaseAlertCoordinator {
  getScannerSelectionSettings() { return getScannerSelectionSettings(this.ctx.storage); }
  updateScannerSelectionSettings(patch = {}) { return updateScannerSelectionSettings(this.ctx.storage, patch); }
}

function coordinator(env) { return env.ALERT_COORDINATOR.getByName('global'); }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const stub = coordinator(env);
    if (url.pathname === SELECTION_PATH) {
      if (request.method === 'GET') return json({ ok: true, settings: await stub.getScannerSelectionSettings(), levels: SCANNER_SELECTION_LEVELS });
      if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const payload = await request.json();
        await stub.verifyLiveControlPin(payload.pin);
        return json({ ok: true, settings: await stub.updateScannerSelectionSettings({ level: payload.level, updatedBy: 'DASHBOARD_OWNER' }) });
      } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'Scanner setting update failed' }, 400); }
    }
    if (url.pathname === DIAGNOSTIC_PATH) {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const diagnostic = await diagnosticProbe(env, stub, Date.now(), { source: 'MANUAL_DIAGNOSTIC' });
        return json({ ok: diagnostic.ok, diagnostic }, diagnostic.ok ? 200 : 502);
      } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'Scanner diagnostic failed' }, 400); }
    }
    if (url.pathname === LIVE_ACTIVITY_PATH) {
      if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const activity = await diagnosticProbe(env, stub, Date.now(), { source: 'LIVE_ACTIVITY' });
        return json({ ok: activity.ok, activity }, activity.ok ? 200 : 502);
      } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'Live scanner activity failed' }, 500); }
    }
    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhance(response) : response;
  },

  async scheduled(controller, env, ctx) {
    const stub = coordinator(env);
    let settings;
    try { settings = await stub.getScannerSelectionSettings(); }
    catch { settings = SCANNER_SELECTION_LEVELS.ACTIVE; }
    const adjusted = runtimeEnv(env, settings);
    const result = worker.scheduled(controller, adjusted, ctx);
    const probeTask = Promise.resolve(result).catch(() => null).then(() => diagnosticProbe(adjusted, stub, Number(controller?.scheduledTime) || Date.now(), { source: 'LIVE_ACTIVITY' }));
    if (ctx?.waitUntil) ctx.waitUntil(probeTask);
    return result;
  },
};
