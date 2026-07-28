import worker, { AlertCoordinator } from './scanner-progress-finalizer-entry.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const UI_BUILD = 'scanner-nav-20260727-v3';

function responseHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function scannerCardMarkup() {
  return `<div id="scannerLiveRuntime" class="scanner-live-runtime" data-ui-build="${UI_BUILD}">
    <div class="scanner-runtime-label-row"><span class="scanner-runtime-eyebrow">LIVE SCANNER</span><span class="scanner-runtime-build">${UI_BUILD}</span></div>
    <div class="scanner-runtime-head">
      <div class="scanner-runtime-title"><span class="scanner-runtime-pulse" id="scannerRuntimePulse"></span><div><div class="scanner-runtime-caption">السهم الجاري فحصه الآن</div><div class="scanner-runtime-symbol" id="scannerRuntimeSymbol" dir="ltr">بانتظار سهم</div><div class="scanner-runtime-price" id="scannerRuntimePrice" dir="ltr">—</div></div></div>
      <span class="scanner-runtime-phase" id="scannerRuntimePhase">بانتظار دورة الماسح</span>
    </div>
    <div class="scanner-runtime-grid">
      <div class="scanner-runtime-metric"><span>OPEN</span><strong id="scannerRuntimeOpen" dir="ltr">—</strong></div>
      <div class="scanner-runtime-metric"><span>HIGH</span><strong id="scannerRuntimeHigh" dir="ltr">—</strong></div>
      <div class="scanner-runtime-metric"><span>LOW</span><strong id="scannerRuntimeLow" dir="ltr">—</strong></div>
      <div class="scanner-runtime-metric"><span>CLOSE</span><strong id="scannerRuntimeClose" dir="ltr">—</strong></div>
      <div class="scanner-runtime-metric"><span>BID</span><strong id="scannerRuntimeBid" dir="ltr">—</strong></div>
      <div class="scanner-runtime-metric"><span>ASK</span><strong id="scannerRuntimeAsk" dir="ltr">—</strong></div>
      <div class="scanner-runtime-metric"><span>VOLUME</span><strong id="scannerRuntimeVolume" dir="ltr">—</strong></div>
      <div class="scanner-runtime-metric"><span>PROFILE</span><strong id="scannerRuntimeProfile" dir="ltr">—</strong></div>
    </div>
    <div class="scanner-runtime-progress"><i id="scannerRuntimeProgressBar"></i></div>
    <div class="scanner-runtime-meta"><span id="scannerRuntimeProgressText">تم فحص 0 من 0</span><span id="scannerRuntimeUpdated">آخر تحديث: —</span></div>
    <div class="scanner-batch-title">الأسهم الموجودة في دفعة الفحص الحالية</div>
    <div class="scanner-batch-list" id="scannerRuntimeBatch"><div class="scanner-runtime-message">بانتظار أول دورة فحص...</div></div>
  </div>`;
}

async function enhanceScannerTab(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  let html = await response.text();
  if (html.includes(`data-ui-build="${UI_BUILD}"`)) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders(response),
    });
  }

  const style = `<style id="moerandScannerPersistentUiStyles">
  .terminal-nav{position:sticky!important;top:calc(env(safe-area-inset-top,0px) + 6px)!important;z-index:9000!important}
  .persistent-section-nav{position:fixed;top:calc(env(safe-area-inset-top,0px) + 7px);left:max(10px,calc((100vw - 1720px)/2 + 22px));right:max(10px,calc((100vw - 1720px)/2 + 22px));z-index:10000;display:none;gap:7px;overflow-x:auto;overscroll-behavior-x:contain;padding:8px;background:rgba(5,14,25,.96);border:1px solid rgba(72,119,160,.72);border-radius:15px;backdrop-filter:blur(20px);box-shadow:0 16px 45px rgba(0,0,0,.42);scrollbar-width:none}.persistent-section-nav.visible{display:flex}.persistent-section-nav::-webkit-scrollbar{display:none}.persistent-section-nav a{white-space:nowrap;color:#c8d8ea;text-decoration:none;padding:10px 14px;border-radius:10px;border:1px solid transparent;font-weight:800;font-size:13px}.persistent-section-nav a.active{background:#123d62;border-color:#4f93c8;color:#fff}
  #scannerLiveRuntime.scanner-live-runtime{display:block!important;visibility:visible!important;opacity:1!important;margin:14px 0;padding:15px;border:1px solid rgba(74,137,187,.82);border-radius:16px;background:linear-gradient(135deg,rgba(15,52,82,.86),rgba(5,19,33,.99));box-shadow:0 18px 48px rgba(0,0,0,.25)}
  .scanner-runtime-label-row{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:9px}.scanner-runtime-eyebrow{font-size:9px;letter-spacing:1.5px;color:#78c8ff;font-weight:950}.scanner-runtime-build{font-size:8px;color:#66839e}.scanner-runtime-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.scanner-runtime-title{display:flex;align-items:center;gap:12px}.scanner-runtime-pulse{width:13px;height:13px;border-radius:50%;background:#54dfa0;box-shadow:0 0 20px rgba(84,223,160,.8);animation:scannerPulseV3 1.3s ease-in-out infinite}.scanner-runtime-caption{font-size:11px;color:#9eb8d0;font-weight:850}.scanner-runtime-symbol{font-size:31px;font-weight:950;letter-spacing:1px;color:#edf7ff;margin-top:3px}.scanner-runtime-price{font-size:21px;font-weight:950;color:#83e9b2;margin-top:2px}.scanner-runtime-phase{padding:7px 10px;border:1px solid #3d77a5;border-radius:999px;color:#a9d9ff;font-size:10px;font-weight:900;white-space:nowrap}
  .scanner-runtime-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;margin-top:13px}.scanner-runtime-metric{padding:10px;border:1px solid rgba(57,95,132,.52);border-radius:11px;background:rgba(5,18,31,.74)}.scanner-runtime-metric span{display:block;color:#829ab3;font-size:9px}.scanner-runtime-metric strong{display:block;margin-top:5px;color:#edf5ff;font-size:12px}.scanner-runtime-progress{height:7px;margin-top:13px;border-radius:999px;background:#102b43;overflow:hidden}.scanner-runtime-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2f91c9,#54dfa0);transition:width .35s ease}.scanner-runtime-meta{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px;color:#8fa4bf;font-size:10px}.scanner-batch-title{margin-top:14px;color:#bcd1e7;font-size:11px;font-weight:900}.scanner-batch-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:7px;margin-top:8px;max-height:250px;overflow:auto;padding:2px}.scanner-batch-item{display:grid;gap:3px;justify-items:center;padding:9px 7px;border:1px solid rgba(55,94,132,.5);border-radius:10px;background:rgba(7,23,39,.82)}.scanner-batch-item.active{border-color:#66b8ff;background:rgba(26,76,112,.68);box-shadow:0 0 18px rgba(72,154,213,.25)}.scanner-batch-item.candidate{border-color:#d3a953;background:rgba(91,66,24,.4)}.scanner-batch-item.submitted{border-color:#3fba83;background:rgba(24,100,69,.4)}.scanner-batch-item strong{font-size:12px;color:#eaf4ff}.scanner-batch-item span{font-size:10px;color:#8fc9ef}.scanner-batch-item small{font-size:8px;color:#829ab3;text-transform:uppercase}.scanner-runtime-message{grid-column:1/-1;padding:11px;border:1px dashed rgba(91,128,160,.65);border-radius:11px;color:#9eb7ce;font-size:11px;text-align:center}.scanner-runtime-message.error{border-color:rgba(170,65,78,.7);background:rgba(112,35,48,.2);color:#ffabb5}
  @keyframes scannerPulseV3{0%,100%{opacity:.45;transform:scale(.78)}50%{opacity:1;transform:scale(1.15)}}
  @media(max-width:900px){.persistent-section-nav{left:10px;right:10px}.scanner-runtime-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
  @media(max-width:520px){.persistent-section-nav a{padding:9px 12px;font-size:12px}.scanner-runtime-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.scanner-runtime-symbol{font-size:26px}.scanner-batch-list{grid-template-columns:repeat(3,minmax(0,1fr))}}
  </style>`;

  const script = `<script id="moerandScannerPersistentUiV3">
  (function(){
    let progressBusy=false;
    let navThreshold=180;
    const byId=id=>document.getElementById(id);
    const money=value=>Number.isFinite(Number(value))?'$'+Number(value).toFixed(2):'—';
    const compact=value=>Number.isFinite(Number(value))?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(value)):'—';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const phaseArabic={STARTING:'بدء دورة الفحص',FETCHING_MARKET_DATA:'جلب بيانات الأسعار',EVALUATING_BATCH:'تقييم دفعة الأسهم',CHECKING_LIVE_PRICE:'فحص السعر المباشر',CHECKING_CANDIDATE_PRICE:'تأكيد سعر المرشح',WAITING_FOR_SCANNER_RESULT:'إنهاء نتيجة الماسح',COMPLETE:'اكتمل الفحص',FAILED:'فشل الفحص',WAITING:'بانتظار دورة الفحص',IDLE:'خامل',COMPLETING:'إكمال دورة الفحص'};

    function ensureScannerCard(){
      if(byId('scannerLiveRuntime'))return byId('scannerLiveRuntime');
      const scanner=byId('scanner');if(!scanner)return null;
      const holder=document.createElement('div');holder.innerHTML=${JSON.stringify(scannerCardMarkup())};
      const card=holder.firstElementChild;const grid=scanner.querySelector('.scanner-grid');
      if(grid)grid.insertAdjacentElement('beforebegin',card);else scanner.appendChild(card);
      return card;
    }

    function setupPersistentNavigation(){
      if(byId('persistentSectionNav'))return;
      const original=document.querySelector('.terminal-nav');if(!original)return;
      const floating=document.createElement('nav');floating.id='persistentSectionNav';floating.className='persistent-section-nav';floating.setAttribute('aria-label','التنقل السريع الثابت');
      floating.innerHTML=Array.from(original.querySelectorAll('a')).map(link=>'<a href="'+esc(link.getAttribute('href')||'#overview')+'">'+esc(link.textContent||'')+'</a>').join('');
      document.body.appendChild(floating);
      navThreshold=Math.max(160,original.getBoundingClientRect().top+window.scrollY+original.offsetHeight);
      const allLinks=Array.from(document.querySelectorAll('.terminal-nav a[href^="#"],#persistentSectionNav a[href^="#"]'));
      const setActive=href=>{allLinks.forEach(link=>link.classList.toggle('active',link.getAttribute('href')===href));};
      floating.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',()=>setActive(link.getAttribute('href'))));
      const sections=Array.from(document.querySelectorAll('#overview,#active-trade,#scanner,#trades,#analytics,#live-control'));
      if('IntersectionObserver' in window){const observer=new IntersectionObserver(entries=>{const visible=entries.filter(entry=>entry.isIntersecting).sort((a,b)=>b.intersectionRatio-a.intersectionRatio)[0];if(visible)setActive('#'+visible.target.id);},{rootMargin:'-20% 0px -65% 0px',threshold:[0.01,.2,.5]});sections.forEach(section=>observer.observe(section));}
      let ticking=false;const update=()=>{floating.classList.toggle('visible',window.scrollY>navThreshold);ticking=false;};
      window.addEventListener('scroll',()=>{if(!ticking){ticking=true;requestAnimationFrame(update);}},{passive:true});update();
    }

    function rowMap(progress){return new Map((Array.isArray(progress.rows)?progress.rows:[]).map(row=>[String(row.symbol||'').toUpperCase(),row]));}
    function latestRow(progress){return [...(Array.isArray(progress.rows)?progress.rows:[])].sort((a,b)=>Date.parse(b?.updatedAt||0)-Date.parse(a?.updatedAt||0))[0]||null;}

    function batchMarkup(progress,rows,currentSymbol){
      let batch=Array.isArray(progress.currentBatch)&&progress.currentBatch.length?progress.currentBatch:[];
      if(!batch.length&&currentSymbol)batch=[currentSymbol];
      if(!batch.length)batch=[...(Array.isArray(progress.rows)?progress.rows:[])].sort((a,b)=>Date.parse(b?.updatedAt||0)-Date.parse(a?.updatedAt||0)).slice(0,12).map(row=>row.symbol);
      if(!batch.length)return '<div class="scanner-runtime-message">لا توجد بيانات أسعار محفوظة بعد. ستظهر أول دفعة تلقائيًا عند دورة الفحص التالية.</div>';
      return batch.map(raw=>{const symbol=String(raw||'').toUpperCase();const row=rows.get(symbol)||{};const status=String(row.status||'WAITING').toUpperCase();const className=symbol===currentSymbol?' active':status==='SUBMITTED'?' submitted':['ACCEPTED','PRICE_CHECK','CHECKING_PRICE'].includes(status)?' candidate':'';return '<div class="scanner-batch-item'+className+'"><strong dir="ltr">'+esc(symbol)+'</strong><span dir="ltr">'+money(row.price??row.close)+'</span><small>'+esc(status.replaceAll('_',' '))+'</small></div>';}).join('');
    }

    function renderProgress(progress){
      if(!ensureScannerCard())return;
      const rows=rowMap(progress);const fallback=latestRow(progress);const currentSymbol=String(progress.currentSymbol||fallback?.symbol||'').toUpperCase();const row=rows.get(currentSymbol)||fallback||{};
      byId('scannerRuntimeSymbol').textContent=currentSymbol||'بانتظار سهم';byId('scannerRuntimePrice').textContent=money(row.price??row.close);
      byId('scannerRuntimePhase').textContent=phaseArabic[progress.phase]||String(progress.phase||progress.status||'بانتظار دورة الماسح');
      byId('scannerRuntimeOpen').textContent=money(row.open);byId('scannerRuntimeHigh').textContent=money(row.high);byId('scannerRuntimeLow').textContent=money(row.low);byId('scannerRuntimeClose').textContent=money(row.close??row.price);byId('scannerRuntimeBid').textContent=money(row.bid);byId('scannerRuntimeAsk').textContent=money(row.ask);byId('scannerRuntimeVolume').textContent=compact(row.volume);byId('scannerRuntimeProfile').textContent=String(progress.currentProfile||row.profile||'—');
      const total=Number(progress.totalSymbols||0),scanned=Number(progress.scannedCount||0),percent=Math.max(0,Math.min(100,Number(progress.progressPercent||0)));byId('scannerRuntimeProgressBar').style.width=percent+'%';byId('scannerRuntimeProgressText').textContent='تم فحص '+scanned+' من '+total+' · '+percent.toFixed(1)+'%';byId('scannerRuntimeUpdated').textContent='آخر تحديث: '+(progress.updatedAt?new Date(progress.updatedAt).toLocaleTimeString('ar-US'):'—');byId('scannerRuntimeBatch').innerHTML=batchMarkup(progress,rows,currentSymbol);
      const pulse=byId('scannerRuntimePulse');if(pulse)pulse.style.background=progress.status==='FAILED'?'#ff7f8c':progress.status==='RUNNING'||progress.status==='COMPLETING'?'#54dfa0':'#f5bf62';
    }

    async function loadProgress(){
      if(progressBusy)return;progressBusy=true;ensureScannerCard();
      try{const response=await fetch('/api/scanner/progress',{cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر قراءة تقدم الماسح');renderProgress(payload.progress||{});}catch(error){const phase=byId('scannerRuntimePhase');if(phase)phase.textContent='تعذر قراءة تقدم الماسح';const batch=byId('scannerRuntimeBatch');if(batch)batch.innerHTML='<div class="scanner-runtime-message error">'+esc(error.message||String(error))+'</div>';}finally{progressBusy=false;}
    }

    const start=()=>{ensureScannerCard();setupPersistentNavigation();loadProgress();setInterval(loadProgress,3000);};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();setTimeout(start,700);
  })();
  </script>`;

  if (!html.includes('id="scannerLiveRuntime"')) {
    const gridMarker = '<div class="terminal-grid scanner-grid">';
    if (html.includes(gridMarker)) html = html.replace(gridMarker, `${scannerCardMarkup()}${gridMarker}`);
  }

  html = html
    .replace('</head>', `${style}</head>`)
    .replace('</body>', `${script}</body>`);

  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders(response),
  });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhanceScannerTab(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
