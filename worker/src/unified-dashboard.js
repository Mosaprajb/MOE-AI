import { dashboardHtml as baseDashboardHtml } from './moe-dashboard-v3.js';

function unifiedMarkup() {
  return `
<nav class="unified-nav" aria-label="التنقل الرئيسي">
  <a href="#overview">الرئيسية</a>
  <a href="#scanner">السكانر</a>
  <a href="#trades">سجل الصفقات</a>
  <a href="#analytics">التحليلات</a>
  <a href="#certification">اختبار الجاهزية</a>
  <a href="/learning">التعلم الذكي</a>
</nav>
<section id="scanner" class="section card unified-panel">
  <div class="panel-head"><div><h2>السكانر الذكي</h2><div class="muted">يعرض الاشتراكات النشطة والأسهم التي يفحصها النظام وحالة آخر فحص.</div></div><button type="button" id="refreshScanner">تحديث السكانر</button></div>
  <div class="unified-grid">
    <div class="box"><div class="muted">عدد الأسهم</div><div class="value" id="scannerSymbolCount">0</div></div>
    <div class="box"><div class="muted">الاشتراكات النشطة</div><div class="value" id="scannerSubscriptions">0</div></div>
    <div class="box"><div class="muted">آخر فحص</div><div class="value compact" id="scannerLastCheck">—</div></div>
    <div class="box"><div class="muted">حالة التشغيل</div><div class="value compact" id="scannerState">—</div></div>
  </div>
  <div class="symbol-list" id="scannerSymbols"><span class="muted">لا توجد بيانات بعد</span></div>
  <div class="muted scanner-note" id="scannerNote"></div>
</section>
<section id="certification" class="section card unified-panel">
  <div class="panel-head"><div><h2>اختبار جاهزية التداول الحقيقي</h2><div class="muted">يشغّل جميع طبقات التحليل ومعاينة Webull Production فقط، ولا يرسل أي أمر.</div></div><span class="badge watch" id="certState">غير منفذ</span></div>
  <div class="cert-grid">
    <label>السهم<input id="certSymbol" value="AAPL" maxlength="10"></label>
    <label>سعر الدخول<input id="certEntry" type="number" min="0.01" step="0.01" value="100"></label>
    <label>وقف الخسارة<input id="certStop" type="number" min="0.01" step="0.01" value="99"></label>
    <label>الهدف<input id="certTarget" type="number" min="0.01" step="0.01" value="102"></label>
    <label>الكمية<input id="certQty" type="number" min="1" step="1" value="1"></label>
    <label>الفريم<input id="certTimeframe" value="5"></label>
  </div>
  <div class="cert-actions"><button type="button" id="runCertification">تشغيل اختبار Production Preview</button><span class="muted">سيتطلب كلمة سر Webhook، ولن يتم حفظها.</span></div>
  <pre class="cert-output" id="certOutput">لم يتم تشغيل الاختبار بعد.</pre>
</section>`;
}

function unifiedStyle() {
  return `
html{scroll-behavior:smooth}.unified-nav{position:sticky;top:0;z-index:30;display:flex;gap:8px;overflow:auto;padding:10px;margin:-6px 0 14px;background:rgba(7,17,31,.94);backdrop-filter:blur(16px);border:1px solid #1d3552;border-radius:15px}.unified-nav a{white-space:nowrap;color:#dce9f8;text-decoration:none;border:1px solid #294564;background:#10233b;border-radius:10px;padding:9px 12px}.unified-nav a:hover{border-color:#66b8ff}.unified-panel{scroll-margin-top:82px}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.unified-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.compact{font-size:15px;line-height:1.5}.symbol-list{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}.symbol-chip{padding:7px 10px;border-radius:999px;background:#0c2035;border:1px solid #294564;font-weight:800}.scanner-note{margin-top:12px}.cert-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:14px}.cert-grid label{display:grid;gap:6px;color:#8fa4bf;font-size:12px}.cert-grid input{width:100%;border:1px solid #294564;background:#081522;color:#edf4ff;border-radius:10px;padding:10px}.cert-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}.cert-output{white-space:pre-wrap;word-break:break-word;max-height:390px;overflow:auto;background:#050d17;border:1px solid #1d3552;border-radius:13px;padding:13px;color:#cfe0f4;margin-top:12px}#trades,#analytics,#overview{scroll-margin-top:82px}@media(max-width:1000px){.unified-grid{grid-template-columns:repeat(2,1fr)}.cert-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:650px){.cert-grid{grid-template-columns:repeat(2,1fr)}.unified-nav{border-radius:0;margin-left:-13px;margin-right:-13px}}`;
}

function unifiedScript() {
  return `
const scannerDate=new Intl.DateTimeFormat('ar-US',{dateStyle:'short',timeStyle:'short'});
async function loadScanner(){scannerState.textContent='جاري الفحص';try{const r=await fetch('/api/scanner/status',{cache:'no-store'}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||('HTTP '+r.status));const s=d.scanner||{};scannerSymbolCount.textContent=s.symbolCount||0;scannerSubscriptions.textContent=s.activeSubscriptions||0;scannerLastCheck.textContent=s.lastCheckedAt?scannerDate.format(new Date(s.lastCheckedAt)):'لم يبدأ';scannerState.textContent=s.enabled?'مفعّل':'متوقف';scannerSymbols.innerHTML=(s.symbols||[]).map(x=>'<span class="symbol-chip">'+esc(x)+'</span>').join('')||'<span class="muted">لا توجد أسهم مشتركة في السكانر</span>';scannerNote.textContent=(s.timeframes?.length?'الفريمات: '+s.timeframes.join('، ')+' • ':'')+(s.activityCount||0)+' نشاط محفوظ';}catch(e){scannerState.textContent='خطأ';scannerNote.textContent='تعذر تحميل حالة السكانر: '+e.message;}}
refreshScanner.addEventListener('click',loadScanner);loadScanner();setInterval(loadScanner,30000);
changeTradingMode=async function(mode){const secret=window.prompt('أدخل MOE_WEBHOOK_SECRET. لن يتم حفظه في المتصفح.');if(!secret)return;let confirmation='';if(mode==='LIVE'){confirmation=window.prompt('للتأكيد اكتب حرفياً ENABLE_LIVE_TRADING');if(confirmation!=='ENABLE_LIVE_TRADING'){setModeNote('لم يتم فتح التداول الحقيقي لأن التأكيد غير صحيح.','error');return;}}setModeNote('جاري تغيير الوضع...');try{const response=await fetch('/api/trading/mode',{method:'PUT',headers:{'content-type':'application/json','x-moe-webhook-secret':secret},body:JSON.stringify({mode,confirmation,actor:'DASHBOARD_OWNER'})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||('HTTP '+response.status));renderTradingMode(data.tradingMode);setModeNote('تم تغيير الوضع إلى '+(modeLabels[data.tradingMode.effectiveMode]||data.tradingMode.effectiveMode)+'.','success');}catch(error){setModeNote('لم يتم تغيير الوضع: '+error.message,'error');}};
runCertification.addEventListener('click',async()=>{const secret=window.prompt('أدخل MOE_WEBHOOK_SECRET لتشغيل معاينة Production فقط.');if(!secret)return;certState.textContent='جاري الاختبار';certState.className='badge watch';certOutput.textContent='جاري الاتصال والتحليل...';const body={certificationConfirmation:'RUN_LIVE_PREVIEW_ONLY',symbol:certSymbol.value.trim().toUpperCase(),side:'BUY',orderType:'LIMIT',session:'CORE',quantity:Number(certQty.value),limitPrice:Number(certEntry.value),stopLoss:Number(certStop.value),takeProfit:Number(certTarget.value),timeframe:certTimeframe.value,context:{marketPrice:Number(certEntry.value),signalScore:90,trendScore:88,momentumScore:86,relativeVolume:1.5,spreadPercent:.05,marketRegime:'TREND',sessionAllowed:true,riskPercent:.25},portfolio:{signalSector:'OTHER'}};try{const r=await fetch('/api/trading/live/certify',{method:'POST',headers:{'content-type':'application/json','x-moe-webhook-secret':secret},body:JSON.stringify(body)}),d=await r.json();certOutput.textContent=JSON.stringify(d,null,2);certState.textContent=d.ok?'نجح بدون إرسال':'لم يكتمل';certState.className='badge '+(d.ok?'ok':'no');}catch(e){certState.textContent='خطأ';certState.className='badge no';certOutput.textContent=e.message;}});
`;
}

export function dashboardHtml() {
  return baseDashboardHtml()
    .replace('<header>', `<div id="overview"></div>${unifiedMarkup().split('<section id="scanner"')[0]}<header>`)
    .replace('<section class="section stats">', '<section id="analytics" class="section stats">')
    .replace('<section class="section card"><h2>سجل الصفقات</h2>', '<section id="trades" class="section card"><h2>سجل الصفقات</h2>')
    .replace('<div class="footer">', `${unifiedMarkup().slice(unifiedMarkup().indexOf('<section id="scanner"'))}<div class="footer">`)
    .replace('</style>', `${unifiedStyle()}</style>`)
    .replace('</script></body></html>', `${unifiedScript()}</script></body></html>`);
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
