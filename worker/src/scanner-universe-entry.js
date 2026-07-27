import worker, { AlertCoordinator } from './session-controls-visibility-entry.js';
import { AUTO_SCANNER_SYMBOLS } from './auto-scanner.js';
import { currentTradingSession, sessionAllowed } from './trading-session-service.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const UNIVERSE_PATH = '/api/scanner/universe';

function secureJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function scannerProfiles(env = {}) {
  const raw = String(env.AUTO_SCANNER_PROFILES || '1:15,5:60').trim();
  return raw.split(',').map((item) => {
    const [primary, higher] = item.trim().split(':').map(Number);
    if (!Number.isFinite(primary) || !Number.isFinite(higher)) return null;
    const label = `${primary >= 60 ? `${primary / 60}h` : `${primary}m`} → ${higher >= 60 ? `${higher / 60}h` : `${higher}m`}`;
    return { primaryMinutes: primary, higherMinutes: higher, label };
  }).filter(Boolean);
}

async function universeStatus(env) {
  const activeSession = currentTradingSession();
  let policy = null;
  let policyError = null;
  try {
    policy = await env.ALERT_COORDINATOR.getByName('global').getTradingSessionPolicy();
  } catch (error) {
    policyError = error instanceof Error ? error.message : 'Session policy unavailable';
  }

  const requirements = {
    alpacaKeyConfigured: Boolean(env.ALPACA_KEY_ID),
    alpacaSecretConfigured: Boolean(env.ALPACA_SECRET_KEY),
    webhookSecretConfigured: Boolean(env.MOE_WEBHOOK_SECRET),
  };
  const scannerEnabled = env.AUTO_SCANNER_ENABLED === 'true';
  const sandboxSafetyActive = env.WEBULL_ENVIRONMENT === 'sandbox' && env.WEBULL_LIVE_TRADING !== 'true';
  const allowedNow = policy ? sessionAllowed(policy, activeSession) : false;
  const ready = scannerEnabled
    && sandboxSafetyActive
    && allowedNow
    && Object.values(requirements).every(Boolean);

  return {
    ok: true,
    source: 'AUTO_SCANNER_SYMBOLS',
    symbolCount: AUTO_SCANNER_SYMBOLS.length,
    symbols: [...AUTO_SCANNER_SYMBOLS],
    profiles: scannerProfiles(env),
    scannerEnabled,
    sandboxSafetyActive,
    automationArmed: env.WEBULL_AUTOMATION_ARMED === 'true',
    environment: env.WEBULL_ENVIRONMENT || 'sandbox',
    activeSession,
    sessionPolicy: policy,
    sessionAllowedNow: allowedNow,
    policyError,
    requirements,
    readyToScanNow: ready,
    refreshedAt: new Date().toISOString(),
  };
}

async function enhanceDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('moerandScannerUniversePanel')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: secureHeaders(response),
    });
  }

  const style = `<style id="moerandScannerUniverseStyles">
  #scannerUniversePanel{display:block!important;margin-top:12px;padding:14px;border:1px solid rgba(55,100,139,.58);border-radius:14px;background:linear-gradient(145deg,rgba(8,27,45,.95),rgba(4,14,26,.98));color:#dbe8f5;visibility:visible!important;opacity:1!important}
  .scanner-universe-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.scanner-universe-head strong{display:block;font-size:14px}.scanner-universe-head span{display:block;margin-top:5px;color:#8fa4bf;font-size:10px;line-height:1.55}.scanner-universe-state{padding:7px 10px;border:1px solid #38678e;border-radius:999px;color:#9bd2ff;font-size:9px;font-weight:900;white-space:nowrap}.scanner-universe-state.ready{border-color:#2b8e66;color:#88edb7}.scanner-universe-state.blocked{border-color:#8a3b46;color:#ffabb5}
  .scanner-universe-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.scanner-universe-stat{padding:10px;border:1px solid rgba(54,89,124,.42);border-radius:10px;background:rgba(5,18,31,.68)}.scanner-universe-stat span{display:block;color:#8fa4bf;font-size:8px}.scanner-universe-stat strong{display:block;margin-top:5px;color:#edf4ff;font-size:12px}
  .scanner-universe-tools{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:8px;margin-top:11px}.scanner-universe-search,.scanner-universe-refresh{min-height:40px;border:1px solid #365a7a;border-radius:9px;background:#0c2136;color:#edf4ff;padding:8px 11px;font-weight:800}.scanner-universe-refresh{cursor:pointer;background:#173e61}.scanner-universe-refresh:disabled{opacity:.55;cursor:wait}
  .scanner-universe-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(72px,1fr));gap:7px;max-height:360px;overflow:auto;margin-top:11px;padding:4px}.scanner-symbol{display:flex;align-items:center;justify-content:center;min-height:38px;padding:7px;border:1px solid rgba(62,105,143,.52);border-radius:9px;background:rgba(9,31,51,.82);color:#dcecff;font-size:11px;font-weight:900;letter-spacing:.3px}.scanner-symbol.hidden{display:none}.scanner-universe-empty{display:none;margin-top:10px;padding:10px;border:1px dashed #5c6f83;border-radius:9px;color:#9eb3ca;font-size:10px;text-align:center}.scanner-universe-empty.show{display:block}
  .scanner-universe-note{margin-top:10px;color:#91a8bf;font-size:9px;line-height:1.6}
  @media(max-width:760px){.scanner-universe-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.scanner-universe-tools{grid-template-columns:1fr}.scanner-universe-list{grid-template-columns:repeat(auto-fill,minmax(64px,1fr));max-height:300px}}
  </style>`;

  const script = `<script id="moerandScannerUniversePanel">
  (function(){
    let latest=null;
    let loading=false;
    const byId=id=>document.getElementById(id);
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    function mount(){
      if(byId('scannerUniversePanel'))return byId('scannerUniversePanel');
      const parent=byId('sessionPolicyPanel');if(!parent)return null;
      const panel=document.createElement('section');panel.id='scannerUniversePanel';
      panel.innerHTML='<div class="scanner-universe-head"><div><strong>الأسهم التي يبحث فيها الماسح</strong><span>هذه هي قائمة الرموز التي يفحصها MOERAND بحثًا عن فرصة شراء مطابقة للشروط.</span></div><span class="scanner-universe-state" id="scannerUniverseState">تحميل...</span></div><div class="scanner-universe-summary"><div class="scanner-universe-stat"><span>عدد الرموز</span><strong id="scannerUniverseCount">—</strong></div><div class="scanner-universe-stat"><span>الجلسة الحالية</span><strong id="scannerUniverseSession">—</strong></div><div class="scanner-universe-stat"><span>الفريمات</span><strong id="scannerUniverseProfiles">—</strong></div><div class="scanner-universe-stat"><span>الوضع</span><strong id="scannerUniverseMode">—</strong></div></div><div class="scanner-universe-tools"><input id="scannerUniverseSearch" class="scanner-universe-search" type="search" placeholder="ابحث عن سهم مثل AAPL أو NVDA" autocomplete="off"><button id="scannerUniverseRefresh" class="scanner-universe-refresh" type="button">تحديث القائمة</button></div><div class="scanner-universe-list" id="scannerUniverseList"></div><div class="scanner-universe-empty" id="scannerUniverseEmpty">لا يوجد رمز مطابق للبحث.</div><div class="scanner-universe-note" id="scannerUniverseNote">القائمة تعرض الأسهم المشمولة في البحث، وليست توصية شراء. فتح الصفقة لا يحدث إلا بعد اجتياز جميع شروط الإشارة والمخاطر.</div>';
      parent.appendChild(panel);
      byId('scannerUniverseSearch').addEventListener('input',filter);
      byId('scannerUniverseRefresh').addEventListener('click',load);
      return panel;
    }
    function filter(){
      const value=String(byId('scannerUniverseSearch')?.value||'').trim().toUpperCase();let visible=0;
      document.querySelectorAll('#scannerUniverseList .scanner-symbol').forEach(node=>{const show=!value||node.dataset.symbol.includes(value);node.classList.toggle('hidden',!show);if(show)visible+=1;});
      byId('scannerUniverseEmpty')?.classList.toggle('show',visible===0);
    }
    function render(payload){
      latest=payload;mount();
      const list=byId('scannerUniverseList');
      list.innerHTML=payload.symbols.map(symbol=>'<div class="scanner-symbol" data-symbol="'+esc(symbol)+'">'+esc(symbol)+'</div>').join('');
      byId('scannerUniverseCount').textContent=String(payload.symbolCount||0);
      byId('scannerUniverseSession').textContent=payload.activeSession?.labelAr||payload.activeSession?.label||'مغلق';
      byId('scannerUniverseProfiles').textContent=(payload.profiles||[]).map(item=>item.label).join('، ')||'—';
      byId('scannerUniverseMode').textContent=String(payload.environment||'sandbox').toUpperCase();
      const state=byId('scannerUniverseState');state.className='scanner-universe-state '+(payload.readyToScanNow?'ready':'blocked');state.textContent=payload.readyToScanNow?'جاهز للبحث الآن':payload.sessionAllowedNow?'غير جاهز':'الجلسة غير مسموحة الآن';
      const note=byId('scannerUniverseNote');
      if(payload.policyError)note.textContent='تعذر قراءة سياسة الجلسات، لذلك اعتبر الماسح متوقفًا بأمان. القائمة أدناه هي قائمة البحث المبرمجة فقط.';
      else if(!payload.scannerEnabled)note.textContent='الماسح متوقف حاليًا. القائمة أدناه هي قائمة البحث المبرمجة ولن تُفحص حتى تشغيل الماسح.';
      else if(!payload.sessionAllowedNow)note.textContent='الجلسة الحالية غير مسموحة وفق اختيارك. ستبدأ هذه الأسهم بالدخول في البحث عند افتتاح جلسة مسموحة.';
      else note.textContent='الماسح مفعّل لهذه الجلسة. يتم فحص القائمة على الفريمات الموضحة، لكن فتح الصفقة لا يحدث إلا بعد اجتياز جميع شروط الإشارة والمخاطر.';
      filter();
    }
    async function load(){
      if(loading)return;loading=true;mount();const button=byId('scannerUniverseRefresh');if(button)button.disabled=true;
      try{const response=await fetch('/api/scanner/universe',{cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر تحميل قائمة الأسهم');render(payload);}catch(error){const state=byId('scannerUniverseState');if(state){state.className='scanner-universe-state blocked';state.textContent='خطأ في التحميل';}const note=byId('scannerUniverseNote');if(note)note.textContent=error.message||String(error);}finally{loading=false;if(button)button.disabled=false;}
    }
    const start=()=>{mount();load();setInterval(load,60000);};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();setTimeout(start,1100);
  })();
  </script>`;

  const enhanced = html.replace('</head>', `${style}</head>`).replace('</body>', `${script}</body>`);
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers: secureHeaders(response),
  });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === UNIVERSE_PATH) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      try { return secureJson(await universeStatus(env)); }
      catch (error) { return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Scanner universe unavailable' }, 500); }
    }

    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhanceDashboard(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
