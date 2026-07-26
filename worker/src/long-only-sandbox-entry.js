import worker, { AlertCoordinator } from './smart-money-observation-entry.js';
import { directionPolicySnapshot, evaluateOpeningDirection } from './trading-direction-policy.js';

const SIGNAL_PATH = '/api/tradingview/signal';
const DIRECTION_PATH = '/api/trading/direction-policy';
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);

function secureJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function longOnlyEnvironment(env = {}) {
  return {
    ...env,
    MOE_DIRECTION_POLICY: 'LONG_ONLY',
    MOE_ALLOW_SHORT_ENTRIES: 'false',
  };
}

async function rejectShortOpeningSignal(request, env) {
  let payload;
  try {
    payload = await request.clone().json();
  } catch {
    return null;
  }
  const policy = evaluateOpeningDirection(payload, env);
  if (policy.accepted) return null;
  return secureJson({
    ok: false,
    accepted: false,
    submitted: false,
    blocked: true,
    error: 'Short entries are disabled. MOERAND is configured for long-only trading.',
    reason: policy.reason,
    directionPolicy: directionPolicySnapshot(env),
  }, 423);
}

async function enhanceLongOnlyDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('longOnlyPlatformBanner')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const style = `<style id="longOnlyPlatformStyles">
  .long-only-platform-banner{display:flex;align-items:center;justify-content:space-between;gap:14px;flex-wrap:wrap;margin:12px 0;padding:13px 15px;border:1px solid rgba(40,119,82,.72);border-radius:15px;background:linear-gradient(100deg,rgba(30,111,75,.18),rgba(6,23,38,.9));color:#dbe8f5}.long-only-platform-banner strong{display:block;color:#83e9b2;font-size:13px}.long-only-platform-banner span{display:block;margin-top:4px;color:#8fa4bf;font-size:11px;line-height:1.5}.long-only-policy-pill{padding:7px 10px;border:1px solid #28684c;border-radius:999px;background:rgba(40,119,82,.18);color:#83e9b2!important;font-size:10px!important;font-weight:900;white-space:nowrap}.terminal-nav-link[href="#trading-intelligence"],.terminal-nav-link[href="#portfolio-risk"]{border-color:rgba(45,108,156,.36)}
  .production-audit-ready{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:12px 13px;border:1px solid rgba(45,108,156,.62);border-radius:12px;background:linear-gradient(100deg,rgba(28,78,119,.18),rgba(5,18,32,.84))}.production-audit-ready strong{display:block;color:#9cd3ff;font-size:12px}.production-audit-ready span{display:block;margin-top:4px;color:#8fa4bf;font-size:10px;line-height:1.55}.production-audit-lock-pill{padding:7px 10px!important;margin:0!important;border:1px solid #8d6a2e;border-radius:999px;background:rgba(141,106,46,.15);color:#f7cb7c!important;font-size:9px!important;font-weight:900;white-space:nowrap}.production-audit-lock-pill.ready{border-color:#28684c;background:rgba(40,119,82,.15);color:#83e9b2!important}.production-audit-lock-pill.error{border-color:#8a3b46;background:rgba(153,49,63,.18);color:#ff9da7!important}
  </style>`;
  const script = `<script id="longOnlyPlatformBanner">
  (function(){
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    const auditReadyMarkup=(state,message,type)=>'<div class="production-audit-ready" id="productionAuditLockNote"><div><strong>'+esc(state)+'</strong><span>'+esc(message)+'</span></div><span class="production-audit-lock-pill '+esc(type||'')+'">'+(type==='ready'?'PIN LOCKED':type==='error'?'NOT READY':'CHECKING PIN')+'</span></div>';
    const configureProductionAudit=async()=>{
      const button=document.getElementById('runProductionAudit');
      const results=document.getElementById('auditResults');
      if(button){button.textContent='فتح وتشغيل الفحص';button.setAttribute('aria-describedby','productionAuditLockNote');button.title='يتطلب رمز التحكم الصحيح. الفحص للقراءة فقط ولا يرسل أو يعدل أي أمر.';}
      if(results&&!results.dataset.auditStarted)results.innerHTML=auditReadyMarkup('PRODUCTION AUDIT READY','الفحص جاهز للقراءة فقط. أدخل الرمز السري الصحيح عند الضغط لتشغيله؛ لن يتغير وضع التداول ولن يتم إرسال أي أمر.','');
      try{
        const response=await fetch('/api/trading/live/readiness',{cache:'no-store'});
        const payload=await response.json();
        if(!response.ok||!payload.ok)throw new Error(payload.error||'Readiness unavailable');
        const pinConfigured=payload.control?.pinConfigured===true;
        if(results&&!results.dataset.auditStarted){
          results.innerHTML=pinConfigured
            ? auditReadyMarkup('AUDIT READY · PIN LOCKED','جاهز لقراءة حساب Production والمراكز والأوامر والسجل بعد التحقق من الرمز. التداول الحقيقي يبقى معطلاً ومفتاح الطوارئ يبقى نشطًا.','ready')
            : auditReadyMarkup('PIN SETUP REQUIRED','واجهة الفحص جاهزة، لكن يجب إعداد رمز التحكم في أسرار Cloudflare قبل تشغيلها.','error');
        }
        if(button){button.disabled=!pinConfigured;button.textContent=pinConfigured?'فتح وتشغيل الفحص':'إعداد PIN مطلوب';}
      }catch(error){
        if(results&&!results.dataset.auditStarted)results.innerHTML=auditReadyMarkup('READINESS CHECK FAILED',error.message||String(error),'error');
        if(button){button.disabled=true;button.textContent='الفحص غير متاح';}
      }
      if(button&&!button.dataset.auditLockBound){
        button.dataset.auditLockBound='true';
        button.addEventListener('click',()=>{if(results)results.dataset.auditStarted='true';},{capture:true});
      }
    };
    const insert=()=>{
      if(!document.getElementById('longOnlyBanner')){
        const banner=document.createElement('section');
        banner.id='longOnlyBanner';banner.className='long-only-platform-banner';
        banner.innerHTML='<div><strong>LONG-ONLY SANDBOX AUTOMATION</strong><span>BUY entries only. Short entries are blocked before broker submission. Stop Loss and Take Profit exits remain enabled for protected Long positions.</span></div><span class="long-only-policy-pill">SHORT ENTRY BLOCKED</span>';
        const anchor=document.getElementById('operatingBanner')||document.querySelector('.terminal-nav')||document.querySelector('main')||document.body;
        if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(banner,anchor.nextSibling);else document.body.prepend(banner);
      }
      const intelligence=document.getElementById('smartMoneyObservationPanel');if(intelligence)intelligence.id='trading-intelligence';
      const portfolio=document.getElementById('portfolio-risk')||document.getElementById('portfolioRiskPanel');if(portfolio)portfolio.id='portfolio-risk';
      const nav=document.querySelector('.terminal-nav');
      if(nav&&!nav.querySelector('[href="#trading-intelligence"]')){
        const risk=document.createElement('a');risk.className='terminal-nav-link';risk.href='#portfolio-risk';risk.textContent='مخاطر المحفظة';nav.appendChild(risk);
        const intel=document.createElement('a');intel.className='terminal-nav-link';intel.href='#trading-intelligence';intel.textContent='ذكاء التداول';nav.appendChild(intel);
      }
      configureProductionAudit();
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',insert);else insert();
    setTimeout(insert,500);
  })();
  </script>`;
  const enhanced = html.replace('</head>', `${style}</head>`).replace('</body>', `${script}</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const safeEnv = longOnlyEnvironment(env);
    const url = new URL(request.url);
    if (url.pathname === DIRECTION_PATH) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      return secureJson({ ok: true, directionPolicy: directionPolicySnapshot(safeEnv) });
    }
    if (url.pathname === SIGNAL_PATH && request.method === 'POST') {
      const blocked = await rejectShortOpeningSignal(request, safeEnv);
      if (blocked) return blocked;
    }
    const response = await worker.fetch(request, safeEnv, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhanceLongOnlyDashboard(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, longOnlyEnvironment(env), ctx);
  },
};