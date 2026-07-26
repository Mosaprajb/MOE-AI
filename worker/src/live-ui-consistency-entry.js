import worker, { AlertCoordinator } from './long-only-sandbox-entry.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

async function enhanceDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  if (html.includes('liveUiConsistencyPatch')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: secureHeaders(response),
    });
  }

  const patch = `<script id="liveUiConsistencyPatch">
  (function(){
    const text=value=>String(value??'').trim();
    const gates=()=>Array.from(document.querySelectorAll('#liveGateList .gate-item'));
    const gateByLabel=label=>gates().find(row=>text(row.querySelector('strong')?.textContent)===label);
    const paintGate=(label,passed,description,badgeText)=>{
      const row=gateByLabel(label);if(!row)return;
      const detail=row.querySelector('.muted');const badge=row.querySelector('.badge');
      if(detail)detail.textContent=description;
      if(badge){badge.textContent=badgeText||(passed?'PASS':'LOCKED');badge.className='badge '+(passed?'ok':'no');}
    };
    const paintLearning=()=>{
      const row=gateByLabel('بوابة التعلم')||gateByLabel('التعلم الآلي (مستقل)');if(!row)return;
      const title=row.querySelector('strong');const detail=row.querySelector('.muted');const badge=row.querySelector('.badge');
      if(title)title.textContent='التعلم الآلي (مستقل)';
      if(detail)detail.textContent='لا يمنع تشغيل Live؛ تطبيق تغييرات التعلم على التداول الحقيقي معطّل.';
      if(badge){badge.textContent='ISOLATED';badge.className='badge watch';}
    };
    const sync=async()=>{
      try{
        const response=await fetch('/api/trading/live/readiness',{cache:'no-store'});
        const payload=await response.json();
        if(!response.ok||!payload.ok)return;
        const control=payload.control||{};
        const liveActive=control.liveTradingEnabled===true;
        const liveArmed=control.effectiveLiveAutomationArmed===true;

        paintGate('مفتاح Live الرئيسي',liveActive,liveActive?'مفعّل بواسطة Runtime بعد التحقق من PIN.':'المتطلب ما زال مقفلًا',liveActive?'PASS':'LOCKED');
        paintGate('إرسال الأوامر الحقيقي',liveActive,liveActive?'الإرسال الحقيقي مفعّل ضمن حدود الحماية.':'المتطلب ما زال مقفلًا',liveActive?'PASS':'LOCKED');
        paintLearning();

        const system=document.getElementById('topSystemStatus');
        const broker=document.getElementById('topBrokerStatus');
        const note=document.getElementById('liveControlNote');
        const scannerState=document.getElementById('scannerState');
        const automation=document.getElementById('automationState');
        const scannerNote=document.getElementById('scannerNote');
        const activate=document.getElementById('activateLiveFully');
        const back=document.getElementById('returnToSandbox');

        if(liveActive){
          if(system){system.textContent=liveArmed?'LIVE ARMED':'LIVE MANUAL';system.className='negative';}
          if(broker)broker.textContent='متصل بالإنتاج';
          if(note)note.textContent=liveArmed?'التداول الحقيقي نشط، الأتمتة مسلحة، وSandbox متوقف.':'التداول الحقيقي نشط يدويًا، والأتمتة غير مسلحة.';
          if(scannerState){scannerState.textContent=liveArmed?'LIVE ARMED':'LIVE MANUAL';scannerState.className='badge '+(liveArmed?'ok':'watch');}
          if(automation)automation.textContent=liveArmed?'ARMED':'DISARMED';
          if(scannerNote)scannerNote.textContent='البيئة: production · سياسة التنفيذ: LONG ONLY · حالة Live: '+(liveArmed?'ARMED':'MANUAL');
          if(activate){activate.disabled=true;activate.textContent='Live مفعّل';}
          if(back)back.disabled=false;
        }else{
          if(activate){activate.disabled=false;activate.textContent='تفعيل Live بالكامل';}
        }
      }catch{}
    };
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',sync);else sync();
    setTimeout(sync,700);setInterval(sync,5000);
  })();
  </script>`;

  const enhanced = html.replace('</body>', `${patch}</body>`);
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers: secureHeaders(response),
  });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const response = await worker.fetch(request, env, ctx);
    const path = new URL(request.url).pathname;
    return DASHBOARD_PATHS.has(path) ? enhanceDashboard(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
