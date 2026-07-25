import { buildDashboardSnapshot, dashboardHtml as baseDashboardHtml } from './moe-dashboard-v2.js';

export { buildDashboardSnapshot };

function modeControlMarkup() {
  return `
<section class="section card mode-control" aria-labelledby="tradingModeTitle">
  <div class="mode-head">
    <div>
      <h2 id="tradingModeTitle">وضع التداول</h2>
      <div class="muted">اختر وضع التشغيل. وضع التداول الحقيقي يبقى مقفلاً حتى اكتمال جميع طبقات الحماية.</div>
    </div>
    <span class="badge watch" id="modeEffective">جاري التحميل</span>
  </div>
  <div class="mode-grid" id="modeOptions"></div>
  <div class="mode-note" id="modeNote">يتم تحميل حالة النظام...</div>
</section>`;
}

function modeControlStyle() {
  return `
.mode-control{border-color:#294d72}.mode-head{display:flex;align-items:flex-start;justify-content:space-between;gap:14px}.mode-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}.mode-option{border:1px solid #294564;background:#0a1929;border-radius:15px;padding:14px;text-align:right;min-height:128px;display:flex;flex-direction:column;gap:8px}.mode-option.active{border-color:#39d98a;box-shadow:0 0 0 1px rgba(57,217,138,.3)}.mode-option.locked{opacity:.55;cursor:not-allowed}.mode-option strong{font-size:17px}.mode-option small{color:#8fa4bf;line-height:1.5}.mode-option button{margin-top:auto;width:100%}.mode-option button:disabled{cursor:not-allowed;opacity:.55}.mode-note{margin-top:12px;padding:11px 13px;border-radius:12px;background:#081522;border:1px solid #1c3550;color:#a9bdd4;line-height:1.55}.mode-note.error{border-color:#71383f;color:#ffabab;background:rgba(125,35,45,.16)}.mode-note.success{border-color:#245b46;color:#8ae4b1;background:rgba(35,120,78,.14)}@media(max-width:800px){.mode-grid{grid-template-columns:1fr}.mode-head{flex-direction:column}}`;
}

function modeControlScript() {
  return `
const modeLabels={DRY_RUN:'معاينة فقط',SANDBOX:'Webull Sandbox',LIVE:'تداول حقيقي'};
const modeDescriptions={DRY_RUN:'تحليل كامل دون إرسال أي أمر.',SANDBOX:'تنفيذ أوامر تجريبية محمية في حساب Sandbox.',LIVE:'أوامر بأموال حقيقية. هذا الخيار مقفل حالياً.'};
let currentTradingMode=null;
function modeClass(mode){return mode==='LIVE'?'no':mode==='SANDBOX'?'watch':'ok';}
function setModeNote(text,type=''){const el=document.getElementById('modeNote');if(!el)return;el.textContent=text;el.className='mode-note'+(type?' '+type:'');}
function renderTradingMode(mode){currentTradingMode=mode;const effective=document.getElementById('modeEffective');effective.textContent=modeLabels[mode.effectiveMode]||mode.effectiveMode;effective.className='badge '+modeClass(mode.effectiveMode);const root=document.getElementById('modeOptions');root.innerHTML=(mode.modes||[]).map(item=>{const active=item.id===mode.selectedMode;const locked=!item.available;const reason=locked&&item.reasons?.length?item.reasons.join(' • '):modeDescriptions[item.id];return '<div class="mode-option '+(active?'active ':'')+(locked?'locked':'')+'"><strong>'+esc(modeLabels[item.id]||item.label||item.id)+'</strong><small>'+esc(reason)+'</small><button type="button" data-mode="'+esc(item.id)+'" '+(locked||active?'disabled':'')+'>'+(active?'الوضع الحالي':locked?'مقفل':'اختيار هذا الوضع')+'</button></div>';}).join('');root.querySelectorAll('[data-mode]').forEach(button=>button.addEventListener('click',()=>changeTradingMode(button.dataset.mode)));const detail=mode.locked?'الوضع المطلوب غير متاح، لذلك أعاد النظام التشغيل إلى وضع المعاينة الآمن.':'الوضع الفعلي: '+(modeLabels[mode.effectiveMode]||mode.effectiveMode)+(mode.automationArmed?' • التنفيذ الآلي مفعّل':' • التنفيذ الآلي غير مفعّل');setModeNote(detail,mode.locked?'error':'');}
async function loadTradingMode(){try{const response=await fetch('/api/trading/mode',{cache:'no-store'});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||('HTTP '+response.status));renderTradingMode(data.tradingMode);}catch(error){setModeNote('تعذر تحميل وضع التداول: '+error.message,'error');}}
async function changeTradingMode(mode){if(mode==='LIVE'){setModeNote('التداول الحقيقي مقفل. لن يتم فتحه من لوحة التحكم قبل اكتمال منفذ الإنتاج واختبارات الحماية.','error');return;}const secret=window.prompt('أدخل MOE_WEBHOOK_SECRET لتأكيد تغيير وضع التداول. لن يتم حفظه في المتصفح.');if(!secret)return;setModeNote('جاري تغيير الوضع...');try{const response=await fetch('/api/trading/mode',{method:'PUT',headers:{'content-type':'application/json','x-moe-webhook-secret':secret},body:JSON.stringify({mode,actor:'DASHBOARD_OWNER'})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||('HTTP '+response.status));renderTradingMode(data.tradingMode);setModeNote('تم تغيير وضع التداول إلى '+(modeLabels[data.tradingMode.effectiveMode]||data.tradingMode.effectiveMode)+'.','success');}catch(error){setModeNote('لم يتم تغيير الوضع: '+error.message,'error');}}
loadTradingMode();setInterval(loadTradingMode,30000);`;
}

export function dashboardHtml() {
  return baseDashboardHtml()
    .replace('</style>', `${modeControlStyle()}</style>`)
    .replace('<section class="grid">', `${modeControlMarkup()}<section class="grid">`)
    .replace('</script></body></html>', `${modeControlScript()}</script></body></html>`);
}

export function htmlResponse() {
  return new Response(dashboardHtml(), {
    headers: {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'",
    },
  });
}
