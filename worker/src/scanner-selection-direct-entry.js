import worker, { AlertCoordinator } from './scanner-selection-entry.js';

const SELECTION_PATH = '/api/scanner/selection';
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const ALLOWED_LEVELS = new Set(['DISCOVERY', 'ACTIVE', 'BALANCED', 'CONSERVATIVE']);
const UI_VERSION = 'scanner-selection-direct-v2';

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
  </style>`;

  const script = `<script id="${UI_VERSION}">
  (function(){
    let busy=false;
    const root=()=>document.getElementById('scannerSelectionControls');
    const buttons=()=>Array.from(document.querySelectorAll('#scannerSelectionControls .scanner-selection-buttons button[data-level]'));
    const message=(text,type)=>{const el=document.getElementById('scannerSelectionMessage');if(!el)return;el.textContent=text;el.className='scanner-selection-message '+(type||'');};
    const description=settings=>{const el=document.getElementById('scannerSelectionDescription');if(el)el.textContent=(settings.labelAr||settings.level)+' · الحد الأولي '+settings.minimumScore+' · '+(settings.descriptionAr||'');};
    function statusBox(){
      const panel=root();if(!panel)return null;let box=document.getElementById('scannerSelectionRuntimeStatus');
      if(box)return box;box=document.createElement('div');box.id='scannerSelectionRuntimeStatus';box.className='selection-runtime-status';box.innerHTML='<span>الحالة الفعلية</span><strong id="scannerSelectionRuntimeValue">جارٍ التحقق...</strong>';panel.appendChild(box);return box;
    }
    function paint(settings){
      const level=String(settings?.level||'').toUpperCase();buttons().forEach(button=>{button.classList.toggle('active',button.dataset.level===level);button.classList.remove('selection-pending');button.disabled=false;});
      const value=document.getElementById('scannerSelectionRuntimeValue');if(value)value.textContent=(settings?.labelAr||level||'—')+' · '+(settings?.minimumScore??'—')+' · محفوظ';description(settings||{});
    }
    async function load(){
      statusBox();
      try{const response=await fetch('/api/scanner/selection',{cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر قراءة درجة اختيار الأسهم');paint(payload.settings||{});}
      catch(error){const value=document.getElementById('scannerSelectionRuntimeValue');if(value)value.textContent='تعذر التحقق';message(error.message||String(error),'error');}
    }
    async function save(level,button){
      if(busy)return;busy=true;const panel=root();if(panel)panel.dataset.selectionSaving='true';buttons().forEach(item=>{item.disabled=true;item.classList.remove('selection-pending');});button.classList.add('selection-pending');message('جارٍ تطبيق درجة '+button.textContent.trim()+' على الماسح...','');
      try{
        const response=await fetch('/api/scanner/selection',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({level})});
        const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر حفظ درجة اختيار الأسهم');paint(payload.settings||{});message('تم تطبيق '+payload.settings.labelAr+' ('+payload.settings.minimumScore+'). ستستخدمها دورة الماسح القادمة.','success');
      }catch(error){message(error.message||String(error),'error');await load();}
      finally{busy=false;if(panel)delete panel.dataset.selectionSaving;buttons().forEach(item=>item.disabled=false);}
    }
    function bind(){
      const panel=root();if(!panel)return false;panel.dataset.selectionUiVersion='${UI_VERSION}';statusBox();buttons().forEach(button=>{button.onclick=event=>{event.preventDefault();event.stopPropagation();save(button.dataset.level,button);};});load();return true;
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
