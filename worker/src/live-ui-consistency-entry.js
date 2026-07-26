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
  if (html.includes('simpleTradingControlsPatch')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: secureHeaders(response),
    });
  }

  const style = `<style id="simpleTradingControlsStyles">
  #liveGateList,.audit-panel,#liveActionWarning{display:none!important}
  .live-actions{display:block!important;margin-top:16px!important}
  .live-actions>:not(#simpleTradingControls){display:none!important}
  #simpleTradingControls{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;width:100%}
  .simple-control-button{min-height:82px;padding:14px 16px;border-radius:16px;border:1px solid rgba(88,132,174,.58);display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:right;font-weight:900;cursor:pointer;transition:transform .15s ease,border-color .15s ease,box-shadow .15s ease;background:linear-gradient(145deg,rgba(14,34,56,.98),rgba(7,20,35,.98));color:#edf4ff}
  .simple-control-button:hover:not(:disabled){transform:translateY(-2px);border-color:#66b8ff;box-shadow:0 12px 30px rgba(0,0,0,.25)}
  .simple-control-button:disabled{opacity:.58;cursor:wait}
  .simple-control-copy{display:grid;gap:5px}.simple-control-title{font-size:15px}.simple-control-subtitle{font-size:10px;color:#8fa4bf;font-weight:650;line-height:1.55}
  .simple-control-state{padding:7px 10px;border-radius:999px;border:1px solid currentColor;font-size:10px;white-space:nowrap}
  .simple-control-button.live-on{border-color:#d85668;background:linear-gradient(145deg,rgba(119,38,54,.9),rgba(54,18,30,.96))}.simple-control-button.live-on .simple-control-state{color:#ffb0b8}
  .simple-control-button.live-off .simple-control-state{color:#83e9b2}
  .simple-control-button.sandbox-on{border-color:#2ba879;background:linear-gradient(145deg,rgba(20,95,70,.9),rgba(8,47,35,.96))}.simple-control-button.sandbox-on .simple-control-state{color:#9bf0c1}
  .simple-control-button.sandbox-off .simple-control-state{color:#8fa4bf}
  .simple-control-button.stop-all{border-color:#e05b6d;background:linear-gradient(145deg,rgba(141,38,53,.96),rgba(73,20,31,.98))}.simple-control-button.stop-all .simple-control-state{color:#ffd4d9}
  .simple-control-summary{grid-column:1/-1;display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:11px 13px;border:1px solid rgba(65,103,140,.45);border-radius:13px;background:rgba(5,17,30,.72);color:#9eb3ca;font-size:11px}
  .simple-control-summary strong{color:#edf4ff}
  .simple-control-note{margin-top:12px!important;padding:11px 13px;border:1px solid rgba(54,89,124,.42);border-radius:12px;background:rgba(6,18,32,.62);color:#9eb3ca!important;font-size:11px!important}
  @media(max-width:900px){#simpleTradingControls{grid-template-columns:1fr}.simple-control-summary{grid-column:1}.simple-control-button{min-height:72px}}
  </style>`;

  const patch = `<script id="simpleTradingControlsPatch">
  (function(){
    let cachedControlPin='';
    let currentControl={liveTradingEnabled:false,effectiveLiveAutomationArmed:false,sandboxAutomationEnabled:false,killSwitch:true};
    let busy=false;

    const byId=id=>document.getElementById(id);
    const notify=(message,type)=>{
      const toast=byId('controlToast');
      if(!toast){window.alert(message);return;}
      toast.textContent=message;
      toast.className='control-toast show '+(type||'success');
      setTimeout(()=>{toast.className='control-toast';},8000);
    };
    const pin=()=>{
      if(cachedControlPin)return cachedControlPin;
      cachedControlPin=window.prompt('أدخل رمز التحكم السري لـ MOERAND. سيبقى في ذاكرة الصفحة فقط.')||'';
      return cachedControlPin;
    };
    const requestControl=async(action,confirmation)=>{
      const controlPin=pin();
      if(!controlPin)throw new Error('تم إلغاء العملية: لم يتم إدخال PIN.');
      const response=await fetch('/api/trading/live/control',{
        method:'PUT',
        headers:{'content-type':'application/json'},
        body:JSON.stringify({pin:controlPin,action,confirmation,actor:'SIMPLE_DASHBOARD_CONTROL'})
      });
      const payload=await response.json();
      if(!response.ok||!payload.ok){
        const error=new Error(payload.error||'تعذر تنفيذ أمر التحكم.');
        if(/incorrect pin|invalid pin|PIN controls/i.test(error.message))cachedControlPin='';
        throw error;
      }
      currentControl=payload.control||currentControl;
      return currentControl;
    };
    const setBusy=value=>{
      busy=value;
      ['simpleLiveToggle','simpleSandboxToggle','simpleStopAll'].forEach(id=>{const button=byId(id);if(button)button.disabled=value;});
    };
    const controlMarkup=()=>{
      const actions=document.querySelector('.live-actions');
      if(!actions)return null;
      let panel=byId('simpleTradingControls');
      if(panel)return panel;
      panel=document.createElement('div');
      panel.id='simpleTradingControls';
      panel.innerHTML='\
        <button type="button" id="simpleLiveToggle" class="simple-control-button live-off">\
          <span class="simple-control-copy"><span class="simple-control-title">تشغيل التداول الحقيقي</span><span class="simple-control-subtitle">يوقف Sandbox تلقائيًا ويشغّل Live المحمي.</span></span><span class="simple-control-state">OFF</span>\
        </button>\
        <button type="button" id="simpleSandboxToggle" class="simple-control-button sandbox-off">\
          <span class="simple-control-copy"><span class="simple-control-title">تشغيل Sandbox</span><span class="simple-control-subtitle">تشغيل أو إيقاف التداول التجريبي.</span></span><span class="simple-control-state">OFF</span>\
        </button>\
        <button type="button" id="simpleStopAll" class="simple-control-button stop-all">\
          <span class="simple-control-copy"><span class="simple-control-title">إيقاف كل شيء</span><span class="simple-control-subtitle">يقفل Live وSandbox ويفعّل Kill Switch فورًا.</span></span><span class="simple-control-state">STOP</span>\
        </button>\
        <div class="simple-control-summary"><span>الوضع الحالي: <strong id="simpleCurrentMode">تحميل...</strong></span><span>Kill Switch: <strong id="simpleKillState">تحميل...</strong></span></div>';
      actions.prepend(panel);
      byId('simpleLiveToggle').onclick=toggleLive;
      byId('simpleSandboxToggle').onclick=toggleSandbox;
      byId('simpleStopAll').onclick=stopEverything;
      return panel;
    };
    const render=()=>{
      controlMarkup();
      const live=currentControl.liveTradingEnabled===true;
      const armed=currentControl.effectiveLiveAutomationArmed===true;
      const sandbox=currentControl.sandboxAutomationEnabled===true;
      const kill=currentControl.killSwitch!==false;
      const liveButton=byId('simpleLiveToggle');
      const sandboxButton=byId('simpleSandboxToggle');
      if(liveButton){
        liveButton.className='simple-control-button '+(live?'live-on':'live-off');
        liveButton.querySelector('.simple-control-title').textContent=live?'إيقاف التداول الحقيقي':'تشغيل التداول الحقيقي';
        liveButton.querySelector('.simple-control-subtitle').textContent=live?(armed?'Live يعمل والأتمتة مسلحة. اضغط لإيقافه.':'Live يعمل يدويًا. اضغط لإيقافه.'):'يوقف Sandbox تلقائيًا ويشغّل Live المحمي.';
        liveButton.querySelector('.simple-control-state').textContent=live?'ON':'OFF';
      }
      if(sandboxButton){
        sandboxButton.className='simple-control-button '+(sandbox?'sandbox-on':'sandbox-off');
        sandboxButton.querySelector('.simple-control-title').textContent=sandbox?'إيقاف Sandbox':'تشغيل Sandbox';
        sandboxButton.querySelector('.simple-control-subtitle').textContent=sandbox?'التداول التجريبي يعمل. اضغط لإيقافه.':live?'تشغيله سيوقف Live ويعيد Kill Switch.':'تشغيل التداول التجريبي الآمن.';
        sandboxButton.querySelector('.simple-control-state').textContent=sandbox?'ON':'OFF';
      }
      const mode=byId('simpleCurrentMode');if(mode)mode.textContent=live?(armed?'LIVE · ARMED':'LIVE · MANUAL'):sandbox?'SANDBOX · ACTIVE':'ALL STOPPED';
      const killState=byId('simpleKillState');if(killState)killState.textContent=kill?'ACTIVE':'CLEAR';
      const note=byId('liveControlNote');if(note){note.className='simple-control-note';note.textContent=live?'التداول الحقيقي نشط. زر Live نفسه يوقفه، وزر Sandbox ينقل النظام إلى الوضع التجريبي بأمان.':sandbox?'Sandbox نشط. زر Sandbox نفسه يوقفه، وزر Live ينقل النظام إلى التداول الحقيقي بعد التحقق.':'كل أنظمة التداول متوقفة وKill Switch نشط.';}
      const warning=byId('liveActionWarning');if(warning)warning.style.display='none';
    };
    const refresh=async()=>{
      controlMarkup();
      try{
        const response=await fetch('/api/trading/live/readiness',{cache:'no-store'});
        const payload=await response.json();
        if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر تحميل حالة التداول.');
        currentControl=payload.control||currentControl;
        render();
      }catch(error){notify(error.message||String(error),'error');}
    };
    async function toggleLive(){
      if(busy)return;
      const live=currentControl.liveTradingEnabled===true;
      const message=live?'سيتم إيقاف التداول الحقيقي وتفعيل Kill Switch. متابعة؟':'سيتم إيقاف Sandbox وتشغيل التداول الحقيقي الآلي Long فقط. متابعة؟';
      if(!window.confirm(message))return;
      setBusy(true);
      try{
        if(live)await requestControl('LOCK_LIVE_CONTROLS');
        else await requestControl('ACTIVATE_LIVE_FULLY','ACTIVATE_LIVE_TRADING');
        notify(live?'تم إيقاف التداول الحقيقي وتفعيل Kill Switch.':'تم تشغيل التداول الحقيقي وإيقاف Sandbox.','success');
        await refresh();
      }catch(error){notify('تم منع العملية: '+(error.message||error),'error');}
      finally{setBusy(false);render();}
    }
    async function toggleSandbox(){
      if(busy)return;
      const sandbox=currentControl.sandboxAutomationEnabled===true;
      const live=currentControl.liveTradingEnabled===true;
      const message=sandbox?'سيتم إيقاف Sandbox. متابعة؟':live?'سيتم إيقاف Live وتفعيل Kill Switch ثم تشغيل Sandbox. متابعة؟':'سيتم تشغيل Sandbox. متابعة؟';
      if(!window.confirm(message))return;
      setBusy(true);
      try{
        if(sandbox)await requestControl('DISABLE_SANDBOX_AUTOMATION');
        else if(live)await requestControl('RETURN_TO_SANDBOX','RETURN_TO_SANDBOX');
        else await requestControl('ENABLE_SANDBOX_AUTOMATION');
        notify(sandbox?'تم إيقاف Sandbox.':'تم تشغيل Sandbox وإبقاء Live مقفلًا.','success');
        await refresh();
      }catch(error){notify('تم منع العملية: '+(error.message||error),'error');}
      finally{setBusy(false);render();}
    }
    async function stopEverything(){
      if(busy||!window.confirm('سيتم إيقاف Live وSandbox وتفعيل Kill Switch فورًا. متابعة؟'))return;
      setBusy(true);
      try{
        await requestControl('LOCK_ALL');
        notify('تم إيقاف كل شيء وتفعيل Kill Switch.','success');
        await refresh();
      }catch(error){notify('تعذر إيقاف الأنظمة: '+(error.message||error),'error');}
      finally{setBusy(false);render();}
    }
    const start=()=>{controlMarkup();refresh();setInterval(refresh,5000);};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
    setTimeout(controlMarkup,700);
  })();
  </script>`;

  const enhanced = html
    .replace('</head>', `${style}</head>`)
    .replace('</body>', `${patch}</body>`);
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
