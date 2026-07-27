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
  .scanner-live-card{display:block!important;visibility:visible!important;opacity:1!important;margin-top:12px;padding:12px;border:1px solid rgba(56,103,142,.72);border-radius:12px;background:linear-gradient(120deg,rgba(18,54,83,.7),rgba(5,19,33,.96))}.scanner-live-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.scanner-live-symbol{font-size:25px;font-weight:950;color:#eaf5ff;letter-spacing:.8px}.scanner-live-price{margin-top:5px;font-size:18px;font-weight:900;color:#83e9b2}.scanner-live-phase{padding:6px 9px;border:1px solid #3b709a;border-radius:999px;color:#a7d8ff;font-size:9px;font-weight:900}.scanner-live-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:7px;margin-top:11px}.scanner-live-metric{padding:8px;border:1px solid rgba(55,91,124,.48);border-radius:9px;background:rgba(4,17,29,.65)}.scanner-live-metric span{display:block;color:#829ab3;font-size:8px}.scanner-live-metric strong{display:block;margin-top:4px;color:#eef6ff;font-size:10px}.scanner-live-progress{height:6px;margin-top:11px;border-radius:999px;background:#102b43;overflow:hidden}.scanner-live-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2b8e66,#57c996);transition:width .25s ease}.scanner-live-caption{margin-top:7px;color:#8fa4bf;font-size:9px;line-height:1.5}.scanner-live-batch{margin-top:7px;color:#718ba4;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .scanner-universe-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.scanner-universe-stat{padding:10px;border:1px solid rgba(54,89,124,.42);border-radius:10px;background:rgba(5,18,31,.68)}.scanner-universe-stat span{display:block;color:#8fa4bf;font-size:8px}.scanner-universe-stat strong{display:block;margin-top:5px;color:#edf4ff;font-size:12px}
  .scanner-universe-tools{display:grid;grid-template-columns:minmax(180px,1fr) auto;gap:8px;margin-top:11px}.scanner-universe-search,.scanner-universe-refresh{min-height:40px;border:1px solid #365a7a;border-radius:9px;background:#0c2136;color:#edf4ff;padding:8px 11px;font-weight:800}.scanner-universe-refresh{cursor:pointer;background:#173e61}.scanner-universe-refresh:disabled{opacity:.55;cursor:wait}
  .scanner-universe-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(76px,1fr));gap:7px;max-height:420px;overflow:auto;margin-top:11px;padding:4px}.scanner-symbol{display:grid!important;grid-template-columns:1fr!important;align-content:center!important;justify-items:center!important;gap:2px!important;min-height:54px!important;padding:7px;border:1px solid rgba(62,105,143,.52);border-radius:9px;background:rgba(9,31,51,.82);color:#dcecff;font-size:11px;font-weight:900;letter-spacing:.3px}.scanner-symbol small{font-size:8px;color:#8fa4bf;font-weight:700}.scanner-symbol .scan-status{font-size:7px;text-transform:uppercase}.scanner-symbol.hidden{display:none!important}.scanner-symbol.active{border-color:#65bdf7!important;box-shadow:0 0 0 1px rgba(101,189,247,.35),0 0 16px rgba(49,143,205,.25);background:rgba(17,68,103,.88)!important}.scanner-symbol.price-check,.scanner-symbol.accepted{border-color:#c89d43!important;background:rgba(96,69,21,.35)!important}.scanner-symbol.submitted{border-color:#39b77e!important;background:rgba(27,103,72,.38)!important}.scanner-symbol.rejected{border-color:rgba(153,74,84,.68)!important}.scanner-symbol.submitted .scan-status{color:#83e9b2}.scanner-symbol.accepted .scan-status,.scanner-symbol.price-check .scan-status{color:#f2ce82}.scanner-universe-empty{display:none;margin-top:10px;padding:10px;border:1px dashed #5c6f83;border-radius:9px;color:#9eb3ca;font-size:10px;text-align:center}.scanner-universe-empty.show{display:block}
  .scanner-universe-note{margin-top:10px;color:#91a8bf;font-size:9px;line-height:1.6}
  @media(max-width:760px){.scanner-universe-summary{grid-template-columns:repeat(2,minmax(0,1fr))}.scanner-universe-tools{grid-template-columns:1fr}.scanner-universe-list{grid-template-columns:repeat(auto-fill,minmax(70px,1fr));max-height:340px}.scanner-live-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.scanner-live-symbol{font-size:21px}}
  </style>`;

  const script = `<script id="moerandScannerUniversePanel">
  (function(){
    let latest=null;
    let loading=false;
    let progressLoading=false;
    const byId=id=>document.getElementById(id);
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const money=value=>Number.isFinite(Number(value))?'$'+Number(value).toFixed(2):'—';
    const compact=value=>Number.isFinite(Number(value))?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(value)):'—';
    const phaseLabels={STARTING:'بدء دورة الفحص',FETCHING_MARKET_DATA:'جلب بيانات الأسعار',EVALUATING_BATCH:'تقييم دفعة الأسهم',CHECKING_LIVE_PRICE:'فحص السعر المباشر',CHECKING_CANDIDATE_PRICE:'تأكيد سعر المرشح',WAITING_FOR_SCANNER_RESULT:'إنهاء نتيجة الماسح',COMPLETE:'اكتمل الفحص',FAILED:'فشل الفحص',WAITING:'بانتظار دورة الفحص',IDLE:'خامل'};
    function liveCardHtml(){return '<div class="scanner-live-card" id="scannerLiveCard"><div class="scanner-live-top"><div><div class="scanner-live-symbol" id="scannerLiveSymbol">—</div><div class="scanner-live-price" id="scannerLivePrice">—</div></div><span class="scanner-live-phase" id="scannerLivePhase">بانتظار الفحص</span></div><div class="scanner-live-grid"><div class="scanner-live-metric"><span>OPEN</span><strong id="scannerLiveOpen">—</strong></div><div class="scanner-live-metric"><span>HIGH</span><strong id="scannerLiveHigh">—</strong></div><div class="scanner-live-metric"><span>LOW</span><strong id="scannerLiveLow">—</strong></div><div class="scanner-live-metric"><span>CLOSE</span><strong id="scannerLiveClose">—</strong></div><div class="scanner-live-metric"><span>BID</span><strong id="scannerLiveBid">—</strong></div><div class="scanner-live-metric"><span>ASK</span><strong id="scannerLiveAsk">—</strong></div><div class="scanner-live-metric"><span>VOLUME</span><strong id="scannerLiveVolume">—</strong></div><div class="scanner-live-metric"><span>PROFILE</span><strong id="scannerLiveProfile">—</strong></div></div><div class="scanner-live-progress"><i id="scannerLiveProgressBar"></i></div><div class="scanner-live-caption" id="scannerLiveCaption">يعرض نفس بيانات الأسعار التي يستخدمها الماسح.</div><div class="scanner-live-batch" id="scannerLiveBatch">بانتظار أول دورة فحص...</div></div>';}
    function mount(){
      if(byId('scannerUniversePanel'))return byId('scannerUniversePanel');
      const parent=byId('sessionPolicyPanel');if(!parent)return null;
      const panel=document.createElement('section');panel.id='scannerUniversePanel';
      panel.innerHTML='<div class="scanner-universe-head"><div><strong>الأسهم التي يبحث فيها الماسح</strong><span>قائمة الرموز مع السهم الجاري فحصه وأسعاره الفعلية من دورة الماسح.</span></div><span class="scanner-universe-state" id="scannerUniverseState">تحميل...</span></div>'+liveCardHtml()+'<div class="scanner-universe-summary"><div class="scanner-universe-stat"><span>عدد الرموز</span><strong id="scannerUniverseCount">—</strong></div><div class="scanner-universe-stat"><span>الجلسة الحالية</span><strong id="scannerUniverseSession">—</strong></div><div class="scanner-universe-stat"><span>الفريمات</span><strong id="scannerUniverseProfiles">—</strong></div><div class="scanner-universe-stat"><span>الوضع</span><strong id="scannerUniverseMode">—</strong></div></div><div class="scanner-universe-tools"><input id="scannerUniverseSearch" class="scanner-universe-search" type="search" placeholder="ابحث عن سهم مثل AAPL أو NVDA" autocomplete="off"><button id="scannerUniverseRefresh" class="scanner-universe-refresh" type="button">تحديث القائمة</button></div><div class="scanner-universe-list" id="scannerUniverseList"></div><div class="scanner-universe-empty" id="scannerUniverseEmpty">لا يوجد رمز مطابق للبحث.</div><div class="scanner-universe-note" id="scannerUniverseNote">القائمة تعرض الأسهم المشمولة في البحث، وليست توصية شراء.</div>';
      parent.appendChild(panel);
      byId('scannerUniverseSearch').addEventListener('input',filter);
      byId('scannerUniverseRefresh').addEventListener('click',()=>{load();loadProgress();});
      return panel;
    }
    function filter(){
      const value=String(byId('scannerUniverseSearch')?.value||'').trim().toUpperCase();let visible=0;
      document.querySelectorAll('#scannerUniverseList .scanner-symbol').forEach(node=>{const show=!value||node.dataset.symbol.includes(value);node.classList.toggle('hidden',!show);if(show)visible+=1;});
      byId('scannerUniverseEmpty')?.classList.toggle('show',visible===0);
    }
    function paintRows(progress){
      const rows=new Map((progress.rows||[]).map(row=>[String(row.symbol||'').toUpperCase(),row]));
      document.querySelectorAll('#scannerUniverseList .scanner-symbol').forEach(node=>{
        const symbol=String(node.dataset.symbol||'').toUpperCase();const row=rows.get(symbol);const active=symbol===String(progress.currentSymbol||'').toUpperCase();
        node.classList.remove('active','price-check','accepted','submitted','rejected');if(active)node.classList.add('active');
        const status=String(row?.status||'WAITING').toLowerCase().replaceAll('_','-');if(['price-check','accepted','submitted','rejected'].includes(status))node.classList.add(status);
        node.innerHTML='<span>'+esc(symbol)+'</span><small>'+money(row?.price??row?.close)+'</small><small class="scan-status">'+esc(String(row?.status||'WAITING').replaceAll('_',' '))+'</small>';
        node.title=row?.reason||('آخر تحديث: '+(row?.updatedAt||'—'));
      });
      filter();
    }
    function renderProgress(progress){
      mount();
      const symbol=String(progress.currentSymbol||'—').toUpperCase();
      const row=(progress.rows||[]).find(item=>String(item.symbol||'').toUpperCase()===symbol)||{};
      byId('scannerLiveSymbol').textContent=symbol;
      byId('scannerLivePrice').textContent=money(row.price??row.close);
      byId('scannerLivePhase').textContent=phaseLabels[progress.phase]||String(progress.phase||progress.status||'بانتظار الفحص');
      byId('scannerLiveOpen').textContent=money(row.open);
      byId('scannerLiveHigh').textContent=money(row.high);
      byId('scannerLiveLow').textContent=money(row.low);
      byId('scannerLiveClose').textContent=money(row.close??row.price);
      byId('scannerLiveBid').textContent=money(row.bid);
      byId('scannerLiveAsk').textContent=money(row.ask);
      byId('scannerLiveVolume').textContent=compact(row.volume);
      byId('scannerLiveProfile').textContent=String(progress.currentProfile||row.profile||'—');
      const percent=Math.max(0,Math.min(100,Number(progress.progressPercent||0)));
      byId('scannerLiveProgressBar').style.width=percent+'%';
      byId('scannerLiveCaption').textContent='تم فحص '+Number(progress.scannedCount||0)+' من '+Number(progress.totalSymbols||0)+' · '+percent.toFixed(1)+'%';
      byId('scannerLiveBatch').textContent=(progress.currentBatch||[]).length?'الدفعة الجارية: '+progress.currentBatch.join(' · '):'آخر تحديث: '+(progress.updatedAt?new Date(progress.updatedAt).toLocaleTimeString('en-US'):'—');
      paintRows(progress);
    }
    function render(payload){
      latest=payload;mount();
      const list=byId('scannerUniverseList');
      list.innerHTML=payload.symbols.map(symbol=>'<div class="scanner-symbol" data-symbol="'+esc(symbol)+'"><span>'+esc(symbol)+'</span><small>—</small><small class="scan-status">WAITING</small></div>').join('');
      byId('scannerUniverseCount').textContent=String(payload.symbolCount||0);
      byId('scannerUniverseSession').textContent=payload.activeSession?.labelAr||payload.activeSession?.label||'مغلق';
      byId('scannerUniverseProfiles').textContent=(payload.profiles||[]).map(item=>item.label).join('، ')||'—';
      byId('scannerUniverseMode').textContent=String(payload.environment||'sandbox').toUpperCase();
      const state=byId('scannerUniverseState');state.className='scanner-universe-state '+(payload.readyToScanNow?'ready':'blocked');state.textContent=payload.readyToScanNow?'جاهز للبحث الآن':payload.sessionAllowedNow?'غير جاهز':'الجلسة غير مسموحة الآن';
      const note=byId('scannerUniverseNote');
      if(payload.policyError)note.textContent='تعذر قراءة سياسة الجلسات، لذلك اعتبر الماسح متوقفًا بأمان.';
      else if(!payload.scannerEnabled)note.textContent='الماسح متوقف حاليًا. القائمة لن تُفحص حتى تشغيله.';
      else if(!payload.sessionAllowedNow)note.textContent='الجلسة الحالية غير مسموحة. سيبدأ الفحص عند افتتاح جلسة مسموحة.';
      else note.textContent='الماسح مفعّل. فتح الصفقة لا يحدث إلا بعد اجتياز جميع شروط الإشارة والمخاطر.';
      filter();
    }
    async function load(){
      if(loading)return;loading=true;mount();const button=byId('scannerUniverseRefresh');if(button)button.disabled=true;
      try{const response=await fetch('/api/scanner/universe',{cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر تحميل قائمة الأسهم');render(payload);}catch(error){const state=byId('scannerUniverseState');if(state){state.className='scanner-universe-state blocked';state.textContent='خطأ في التحميل';}const note=byId('scannerUniverseNote');if(note)note.textContent=error.message||String(error);}finally{loading=false;if(button)button.disabled=false;}
    }
    async function loadProgress(){
      if(progressLoading)return;progressLoading=true;mount();
      try{const response=await fetch('/api/scanner/progress',{cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر قراءة تقدم الماسح');renderProgress(payload.progress||{});}catch(error){byId('scannerLivePhase').textContent='بانتظار نشر التحديث';byId('scannerLiveCaption').textContent=error.message||String(error);}finally{progressLoading=false;}
    }
    const start=()=>{mount();load();loadProgress();setInterval(load,60000);setInterval(loadProgress,3000);};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();setTimeout(start,900);
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
