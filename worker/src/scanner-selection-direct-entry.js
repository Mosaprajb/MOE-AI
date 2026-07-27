import worker, { AlertCoordinator } from './scanner-selection-entry.js';

const SELECTION_PATH = '/api/scanner/selection';
const LIVE_ACTIVITY_PATH = '/api/scanner/live-activity';
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const ALLOWED_LEVELS = new Set(['DISCOVERY', 'ACTIVE', 'BALANCED', 'CONSERVATIVE']);
const UI_VERSION = 'scanner-selection-direct-v3';

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function responseHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function sandboxSelectionAllowed(env = {}) {
  return String(env.WEBULL_ENVIRONMENT || '').toLowerCase() === 'sandbox'
    && String(env.WEBULL_LIVE_TRADING || '').toLowerCase() !== 'true';
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

async function updateSelection(request, env) {
  if (!sandboxSelectionAllowed(env)) {
    return json({ ok: false, error: 'Scanner selection changes are allowed only while Sandbox is active.' }, 409);
  }

  let payload;
  try { payload = await request.json(); }
  catch { return json({ ok: false, error: 'Invalid JSON payload' }, 400); }

  const level = String(payload?.level || '').trim().toUpperCase();
  if (!ALLOWED_LEVELS.has(level)) {
    return json({ ok: false, error: 'Unsupported scanner selection level' }, 400);
  }

  try {
    const settings = await coordinator(env).updateScannerSelectionSettings({
      level,
      updatedBy: 'DASHBOARD_OWNER_DIRECT_CONTROL',
    });
    return json({
      ok: true,
      settings,
      effectiveFrom: 'NEXT_SCANNER_RUN',
      sandboxOnly: true,
      uiVersion: UI_VERSION,
    });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : 'Scanner selection update failed' }, 500);
  }
}

async function enhanceDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes(UI_VERSION)) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders(response),
    });
  }

  const style = `<style id="${UI_VERSION}-styles">
  #scannerSelectionControls[data-selection-saving="true"] .scanner-selection-buttons button{opacity:.58;cursor:wait}
  #scannerSelectionControls .scanner-selection-buttons button.selection-pending{border-color:#78c8ff!important;box-shadow:0 0 0 1px rgba(120,200,255,.4),0 0 18px rgba(120,200,255,.18)!important}
  #scannerSelectionControls .scanner-selection-buttons button.active{border-color:#54dfa0!important;background:#17553f!important;color:#fff!important;box-shadow:0 0 18px rgba(84,223,160,.25)!important}
  #scannerSelectionControls .selection-runtime-status{display:flex;align-items:center;justify-content:space-between;gap:8px;grid-column:1/-1;padding:8px 10px;border:1px solid rgba(65,108,147,.45);border-radius:10px;background:rgba(6,21,36,.62);color:#91a8bf;font-size:9px}
  #scannerSelectionControls .selection-runtime-status strong{color:#dcecff;font-size:10px}
  #scannerLiveRuntime[data-live-state="loading"]{border-color:#4d88b7!important}
  #scannerLiveRuntime[data-live-state="running"]{border-color:#54dfa0!important;box-shadow:0 0 0 1px rgba(84,223,160,.18),0 18px 48px rgba(0,0,0,.25)!important}
  #scannerLiveRuntime[data-live-state="error"]{border-color:#d06373!important;box-shadow:0 0 0 1px rgba(208,99,115,.22),0 18px 48px rgba(0,0,0,.25)!important}
  #scannerLiveRuntime .scanner-direct-error{grid-column:1/-1;padding:10px;border:1px solid rgba(208,99,115,.55);border-radius:10px;background:rgba(111,34,47,.24);color:#ffb2bd;font-size:10px;line-height:1.55;text-align:center}
  </style>`;

  const script = `<script id="${UI_VERSION}">
  (function(){
    let selectionBusy=false,activityBusy=false,rowTimer=null;
    const root=()=>document.getElementById('scannerSelectionControls');
    const liveRoot=()=>document.getElementById('scannerLiveRuntime');
    const buttons=()=>Array.from(document.querySelectorAll('#scannerSelectionControls .scanner-selection-buttons button[data-level]'));
    const byId=id=>document.getElementById(id);
    const money=value=>Number.isFinite(Number(value))?'$'+Number(value).toFixed(2):'—';
    const compact=value=>Number.isFinite(Number(value))?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(value)):'—';
    const safeText=value=>String(value??'');
    const message=(text,type)=>{const el=byId('scannerSelectionMessage');if(!el)return;el.textContent=text;el.className='scanner-selection-message '+(type||'');};
    const description=settings=>{const el=byId('scannerSelectionDescription');if(el)el.textContent=(settings.labelAr||settings.level)+' · الحد الأولي '+settings.minimumScore+' · '+(settings.descriptionAr||'');};

    function statusBox(){
      const panel=root();if(!panel)return null;let box=byId('scannerSelectionRuntimeStatus');
      if(box)return box;box=document.createElement('div');box.id='scannerSelectionRuntimeStatus';box.className='selection-runtime-status';box.innerHTML='<span>الحالة الفعلية</span><strong id="scannerSelectionRuntimeValue">جارٍ التحقق...</strong>';panel.appendChild(box);return box;
    }

    function paint(settings){
      const level=String(settings?.level||'').toUpperCase();buttons().forEach(button=>{button.classList.toggle('active',button.dataset.level===level);button.classList.remove('selection-pending');button.disabled=false;});
      const value=byId('scannerSelectionRuntimeValue');if(value)value.textContent=(settings?.labelAr||level||'—')+' · '+(settings?.minimumScore??'—')+' · محفوظ';description(settings||{});
    }

    async function loadSelection(){
      statusBox();
      try{const response=await fetch('/api/scanner/selection',{cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر قراءة درجة اختيار الأسهم');paint(payload.settings||{});}
      catch(error){const value=byId('scannerSelectionRuntimeValue');if(value)value.textContent='تعذر التحقق';message(error.message||String(error),'error');}
    }

    async function saveSelection(level,button){
      if(selectionBusy)return;selectionBusy=true;const panel=root();if(panel)panel.dataset.selectionSaving='true';buttons().forEach(item=>{item.disabled=true;item.classList.remove('selection-pending');});button.classList.add('selection-pending');message('جارٍ تطبيق درجة '+button.textContent.trim()+' على الماسح...','');
      try{
        const response=await fetch('/api/scanner/selection',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({level})});
        const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر حفظ درجة اختيار الأسهم');paint(payload.settings||{});message('تم تطبيق '+payload.settings.labelAr+' ('+payload.settings.minimumScore+'). ستستخدمها دورة الماسح القادمة.','success');
      }catch(error){message(error.message||String(error),'error');await loadSelection();}
      finally{selectionBusy=false;if(panel)delete panel.dataset.selectionSaving;buttons().forEach(item=>item.disabled=false);}
    }

    function setLiveState(state,label){
      const card=liveRoot();if(card)card.dataset.liveState=state;
      const phase=byId('scannerRuntimePhase');if(phase)phase.textContent=label;
      const pulse=byId('scannerRuntimePulse');if(pulse)pulse.style.background=state==='error'?'#ff7f8c':state==='running'?'#54dfa0':'#78c8ff';
    }

    function showRow(row,index,total,activity){
      if(!row)return;setLiveState('running','جارٍ فحص '+(index+1)+' من '+total);
      if(byId('scannerRuntimeSymbol'))byId('scannerRuntimeSymbol').textContent=safeText(row.symbol||'—').toUpperCase();
      if(byId('scannerRuntimePrice'))byId('scannerRuntimePrice').textContent=money(row.price??row.close);
      if(byId('scannerRuntimeOpen'))byId('scannerRuntimeOpen').textContent=money(row.open);
      if(byId('scannerRuntimeHigh'))byId('scannerRuntimeHigh').textContent=money(row.high);
      if(byId('scannerRuntimeLow'))byId('scannerRuntimeLow').textContent=money(row.low);
      if(byId('scannerRuntimeClose'))byId('scannerRuntimeClose').textContent=money(row.close??row.price);
      if(byId('scannerRuntimeBid'))byId('scannerRuntimeBid').textContent=money(row.bid);
      if(byId('scannerRuntimeAsk'))byId('scannerRuntimeAsk').textContent=money(row.ask);
      if(byId('scannerRuntimeVolume'))byId('scannerRuntimeVolume').textContent=compact(row.volume);
      if(byId('scannerRuntimeProfile'))byId('scannerRuntimeProfile').textContent=safeText(row.profile||'1m LIVE');
      if(byId('scannerRuntimeProgressText'))byId('scannerRuntimeProgressText').textContent='تم فحص '+Number(activity.scannedCount||0)+' من '+Number(activity.totalSymbols||0)+' · الدفعة '+Number(activity.cycle||0)+' من '+Number(activity.cycles||0);
      if(byId('scannerRuntimeProgressBar'))byId('scannerRuntimeProgressBar').style.width=Math.min(100,(Number(activity.scannedCount||0)/Math.max(1,Number(activity.totalSymbols||1)))*100)+'%';
      if(byId('scannerRuntimeUpdated'))byId('scannerRuntimeUpdated').textContent='آخر تحديث: '+new Date(activity.updatedAt||Date.now()).toLocaleTimeString('ar-US');
      document.querySelectorAll('#scannerRuntimeBatch .scanner-batch-item').forEach(item=>item.classList.toggle('active',item.dataset.symbol===safeText(row.symbol).toUpperCase()));
    }

    function renderActivity(activity){
      const rows=Array.isArray(activity.rows)?activity.rows:[];const batch=byId('scannerRuntimeBatch');
      if(batch)batch.innerHTML=rows.length?rows.map(row=>'<div class="scanner-batch-item" data-symbol="'+safeText(row.symbol).toUpperCase()+'"><strong dir="ltr">'+safeText(row.symbol||'—').toUpperCase()+'</strong><span dir="ltr">'+money(row.price??row.close)+'</span><small>'+safeText(row.status||'SCANNED').replaceAll('_',' ')+'</small></div>').join(''):'<div class="scanner-direct-error">لم يعُد مصدر البيانات بأي أسهم في هذه الدفعة.</div>';
      if(rowTimer)clearInterval(rowTimer);let index=0;
      if(rows.length){showRow(rows[0],0,rows.length,activity);rowTimer=setInterval(()=>{index=(index+1)%rows.length;showRow(rows[index],index,rows.length,activity);},900);}
      else setLiveState('error','لا توجد بيانات في الدفعة');
      message(activity.ok?'المسح يعمل: استلم أسعار '+Number(activity.symbolsWithPrices||0)+' من '+Number(activity.batch?.length||rows.length)+' أسهم. عدد الفرص المطابقة مستقل عن عدد الأسهم المفحوصة.':'المسح بدأ لكن مصدر البيانات أعاد خطأ: '+safeText(activity.error||'خطأ غير معروف'),activity.ok?'success':'error');
    }

    function renderActivityError(error,status){
      setLiveState('error','توقف اتصال بيانات الماسح');
      if(byId('scannerRuntimeSymbol'))byId('scannerRuntimeSymbol').textContent='خطأ بيانات';
      if(byId('scannerRuntimePrice'))byId('scannerRuntimePrice').textContent='—';
      const batch=byId('scannerRuntimeBatch');if(batch)batch.innerHTML='<div class="scanner-direct-error">HTTP '+status+' · '+safeText(error.message||error)+'</div>';
      if(byId('scannerRuntimeProgressText'))byId('scannerRuntimeProgressText').textContent='لم تبدأ دورة الأسعار بسبب خطأ الاتصال';
      if(byId('scannerRuntimeUpdated'))byId('scannerRuntimeUpdated').textContent='آخر محاولة: '+new Date().toLocaleTimeString('ar-US');
      message('سبب توقف عرض الأسهم: '+safeText(error.message||error),'error');
    }

    async function runActivity(force=false){
      if(activityBusy||document.hidden)return;activityBusy=true;setLiveState('loading','جارٍ الاتصال بمصدر بيانات الأسهم...');
      const button=byId('scannerDiagnosticNow');if(force&&button){button.disabled=true;button.textContent='جارٍ فحص الأسعار...';}
      let status=0;
      try{
        const response=await fetch('${LIVE_ACTIVITY_PATH}?t='+Date.now(),{cache:'no-store'});status=response.status;
        const text=await response.text();let payload;try{payload=JSON.parse(text);}catch{throw new Error('استجابة الماسح ليست JSON: '+text.slice(0,120));}
        const activity=payload.activity;if(!activity)throw new Error(payload.error||'لم تصل بيانات نشاط الماسح');
        if(!response.ok||activity.ok===false){renderActivity(activity);if(!response.ok)throw new Error(activity.error||payload.error||'فشل مصدر بيانات الماسح');}
        else renderActivity(activity);
      }catch(error){renderActivityError(error,status||'NETWORK');}
      finally{activityBusy=false;if(button){button.disabled=false;button.textContent='فحص البيانات الآن';}}
    }

    function bind(){
      const panel=root();if(!panel)return false;panel.dataset.selectionUiVersion='${UI_VERSION}';statusBox();buttons().forEach(button=>{button.onclick=event=>{event.preventDefault();event.stopPropagation();saveSelection(button.dataset.level,button);};});
      const diagnostic=byId('scannerDiagnosticNow');if(diagnostic)diagnostic.onclick=event=>{event.preventDefault();runActivity(true);};
      loadSelection();runActivity(true);setInterval(()=>runActivity(false),15000);return true;
    }

    const start=()=>{if(!bind())setTimeout(start,500);};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
    setTimeout(start,900);
  })();
  </script>`;

  const enhanced = html
    .replace('</head>', `${style}</head>`)
    .replace('</body>', `${script}</body>`);

  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response),
  });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === SELECTION_PATH && request.method === 'PUT') {
      return updateSelection(request, env);
    }

    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhanceDashboard(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
