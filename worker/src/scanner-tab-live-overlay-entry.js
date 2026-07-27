import worker, { AlertCoordinator } from './scanner-progress-finalizer-entry.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);

function responseHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

async function enhanceScannerTab(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  if (html.includes('moerandScannerTabLiveOverlay')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: responseHeaders(response),
    });
  }

  const style = `<style id="moerandScannerTabLiveStyles">
  #scannerLiveRuntime{display:block!important;visibility:visible!important;opacity:1!important;margin:14px 0;padding:14px;border:1px solid rgba(74,137,187,.72);border-radius:16px;background:linear-gradient(135deg,rgba(15,52,82,.78),rgba(5,19,33,.98));box-shadow:0 18px 48px rgba(0,0,0,.22)}
  .scanner-runtime-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.scanner-runtime-title{display:flex;align-items:center;gap:12px}.scanner-runtime-pulse{width:12px;height:12px;border-radius:50%;background:#54dfa0;box-shadow:0 0 20px rgba(84,223,160,.75);animation:scannerPulse 1.3s ease-in-out infinite}.scanner-runtime-symbol{font-size:28px;font-weight:950;letter-spacing:1px;color:#edf7ff}.scanner-runtime-price{font-size:20px;font-weight:950;color:#83e9b2;margin-top:3px}.scanner-runtime-phase{padding:7px 10px;border:1px solid #3d77a5;border-radius:999px;color:#a9d9ff;font-size:10px;font-weight:900;white-space:nowrap}
  .scanner-runtime-grid{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px;margin-top:13px}.scanner-runtime-metric{padding:10px;border:1px solid rgba(57,95,132,.48);border-radius:11px;background:rgba(5,18,31,.7)}.scanner-runtime-metric span{display:block;color:#829ab3;font-size:9px}.scanner-runtime-metric strong{display:block;margin-top:5px;color:#edf5ff;font-size:12px}
  .scanner-runtime-progress{height:7px;margin-top:13px;border-radius:999px;background:#102b43;overflow:hidden}.scanner-runtime-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2f91c9,#54dfa0);transition:width .35s ease}.scanner-runtime-meta{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:8px;color:#8fa4bf;font-size:10px}
  .scanner-batch-title{margin-top:14px;color:#bcd1e7;font-size:11px;font-weight:900}.scanner-batch-list{display:grid;grid-template-columns:repeat(auto-fill,minmax(94px,1fr));gap:7px;margin-top:8px;max-height:240px;overflow:auto;padding:2px}.scanner-batch-item{display:grid;gap:3px;justify-items:center;padding:9px 7px;border:1px solid rgba(55,94,132,.48);border-radius:10px;background:rgba(7,23,39,.78)}.scanner-batch-item.active{border-color:#66b8ff;background:rgba(26,76,112,.65);box-shadow:0 0 18px rgba(72,154,213,.22)}.scanner-batch-item.candidate{border-color:#d3a953;background:rgba(91,66,24,.38)}.scanner-batch-item.submitted{border-color:#3fba83;background:rgba(24,100,69,.38)}.scanner-batch-item strong{font-size:12px;color:#eaf4ff}.scanner-batch-item span{font-size:10px;color:#8fc9ef}.scanner-batch-item small{font-size:8px;color:#829ab3;text-transform:uppercase}.scanner-runtime-error{padding:11px;border:1px solid rgba(170,65,78,.65);border-radius:11px;background:rgba(112,35,48,.2);color:#ffabb5;font-size:11px}
  @keyframes scannerPulse{0%,100%{opacity:.45;transform:scale(.78)}50%{opacity:1;transform:scale(1.15)}}
  @media(max-width:900px){.scanner-runtime-grid{grid-template-columns:repeat(4,minmax(0,1fr))}}
  @media(max-width:520px){.scanner-runtime-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.scanner-runtime-symbol{font-size:24px}.scanner-batch-list{grid-template-columns:repeat(3,minmax(0,1fr))}}
  </style>`;

  const script = `<script id="moerandScannerTabLiveOverlay">
  (function(){
    let busy=false;
    const byId=id=>document.getElementById(id);
    const money=value=>Number.isFinite(Number(value))?'$'+Number(value).toFixed(2):'—';
    const compact=value=>Number.isFinite(Number(value))?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(value)):'—';
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const phaseArabic={STARTING:'بدء دورة الفحص',FETCHING_MARKET_DATA:'جلب بيانات الأسعار',EVALUATING_BATCH:'تقييم دفعة الأسهم',CHECKING_LIVE_PRICE:'فحص السعر المباشر',CHECKING_CANDIDATE_PRICE:'تأكيد سعر المرشح',WAITING_FOR_SCANNER_RESULT:'إنهاء نتيجة الماسح',COMPLETE:'اكتمل الفحص',FAILED:'فشل الفحص',WAITING:'بانتظار دورة الفحص',IDLE:'خامل',COMPLETING:'إكمال دورة الفحص'};

    function mount(){
      if(byId('scannerLiveRuntime'))return byId('scannerLiveRuntime');
      const scanner=byId('scanner');
      if(!scanner)return null;
      const card=document.createElement('div');
      card.id='scannerLiveRuntime';
      card.innerHTML='<div class="scanner-runtime-head"><div class="scanner-runtime-title"><span class="scanner-runtime-pulse" id="scannerRuntimePulse"></span><div><div class="scanner-runtime-symbol" id="scannerRuntimeSymbol" dir="ltr">—</div><div class="scanner-runtime-price" id="scannerRuntimePrice" dir="ltr">—</div></div></div><span class="scanner-runtime-phase" id="scannerRuntimePhase">بانتظار الماسح</span></div><div class="scanner-runtime-grid"><div class="scanner-runtime-metric"><span>OPEN</span><strong id="scannerRuntimeOpen" dir="ltr">—</strong></div><div class="scanner-runtime-metric"><span>HIGH</span><strong id="scannerRuntimeHigh" dir="ltr">—</strong></div><div class="scanner-runtime-metric"><span>LOW</span><strong id="scannerRuntimeLow" dir="ltr">—</strong></div><div class="scanner-runtime-metric"><span>CLOSE</span><strong id="scannerRuntimeClose" dir="ltr">—</strong></div><div class="scanner-runtime-metric"><span>BID</span><strong id="scannerRuntimeBid" dir="ltr">—</strong></div><div class="scanner-runtime-metric"><span>ASK</span><strong id="scannerRuntimeAsk" dir="ltr">—</strong></div><div class="scanner-runtime-metric"><span>VOLUME</span><strong id="scannerRuntimeVolume" dir="ltr">—</strong></div><div class="scanner-runtime-metric"><span>PROFILE</span><strong id="scannerRuntimeProfile" dir="ltr">—</strong></div></div><div class="scanner-runtime-progress"><i id="scannerRuntimeProgressBar"></i></div><div class="scanner-runtime-meta"><span id="scannerRuntimeProgressText">تم فحص 0 من 0</span><span id="scannerRuntimeUpdated">آخر تحديث: —</span></div><div class="scanner-batch-title">الدفعة التي يفحصها الماسح الآن</div><div class="scanner-batch-list" id="scannerRuntimeBatch"><div class="scanner-runtime-error">بانتظار أول دورة فحص...</div></div>';
      const heading=scanner.querySelector('.section-heading');
      if(heading)heading.insertAdjacentElement('afterend',card);else scanner.prepend(card);
      return card;
    }

    function rowMap(progress){return new Map((Array.isArray(progress.rows)?progress.rows:[]).map(row=>[String(row.symbol||'').toUpperCase(),row]));}

    function batchMarkup(progress,rows){
      const batch=Array.isArray(progress.currentBatch)&&progress.currentBatch.length?progress.currentBatch:(progress.currentSymbol?[progress.currentSymbol]:[]);
      if(!batch.length)return '<div class="scanner-runtime-error">لا توجد دفعة جارية الآن. ستظهر الأسهم عند بدء دورة الماسح التالية.</div>';
      const current=String(progress.currentSymbol||'').toUpperCase();
      return batch.map(raw=>{
        const symbol=String(raw||'').toUpperCase();
        const row=rows.get(symbol)||{};
        const status=String(row.status||'WAITING').toUpperCase();
        const className=symbol===current?' active':status==='SUBMITTED'?' submitted':['ACCEPTED','PRICE_CHECK','CHECKING_PRICE'].includes(status)?' candidate':'';
        return '<div class="scanner-batch-item'+className+'"><strong dir="ltr">'+esc(symbol)+'</strong><span dir="ltr">'+money(row.price??row.close)+'</span><small>'+esc(status.replaceAll('_',' '))+'</small></div>';
      }).join('');
    }

    function render(progress){
      mount();
      const rows=rowMap(progress);
      const symbol=String(progress.currentSymbol||'').toUpperCase();
      const row=rows.get(symbol)||{};
      byId('scannerRuntimeSymbol').textContent=symbol||'بانتظار سهم';
      byId('scannerRuntimePrice').textContent=money(row.price??row.close);
      byId('scannerRuntimePhase').textContent=phaseArabic[progress.phase]||String(progress.phase||progress.status||'بانتظار الماسح');
      byId('scannerRuntimeOpen').textContent=money(row.open);
      byId('scannerRuntimeHigh').textContent=money(row.high);
      byId('scannerRuntimeLow').textContent=money(row.low);
      byId('scannerRuntimeClose').textContent=money(row.close??row.price);
      byId('scannerRuntimeBid').textContent=money(row.bid);
      byId('scannerRuntimeAsk').textContent=money(row.ask);
      byId('scannerRuntimeVolume').textContent=compact(row.volume);
      byId('scannerRuntimeProfile').textContent=String(progress.currentProfile||row.profile||'—');
      const total=Number(progress.totalSymbols||0),scanned=Number(progress.scannedCount||0),percent=Math.max(0,Math.min(100,Number(progress.progressPercent||0)));
      byId('scannerRuntimeProgressBar').style.width=percent+'%';
      byId('scannerRuntimeProgressText').textContent='تم فحص '+scanned+' من '+total+' · '+percent.toFixed(1)+'%';
      byId('scannerRuntimeUpdated').textContent='آخر تحديث: '+(progress.updatedAt?new Date(progress.updatedAt).toLocaleTimeString('ar-US'):'—');
      byId('scannerRuntimeBatch').innerHTML=batchMarkup(progress,rows);
      const pulse=byId('scannerRuntimePulse');if(pulse)pulse.style.background=progress.status==='FAILED'?'#ff7f8c':progress.status==='RUNNING'||progress.status==='COMPLETING'?'#54dfa0':'#f5bf62';
    }

    async function load(){
      if(busy)return;busy=true;mount();
      try{
        const response=await fetch('/api/scanner/progress',{cache:'no-store'});
        const payload=await response.json();
        if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر قراءة تقدم الماسح');
        render(payload.progress||{});
      }catch(error){
        const phase=byId('scannerRuntimePhase');if(phase)phase.textContent='تعذر قراءة تقدم الماسح';
        const batch=byId('scannerRuntimeBatch');if(batch)batch.innerHTML='<div class="scanner-runtime-error">'+esc(error.message||String(error))+'</div>';
      }finally{busy=false;}
    }

    const start=()=>{mount();load();setInterval(load,3000);};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
    setTimeout(start,700);
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
    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhanceScannerTab(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
