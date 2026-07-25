import { dashboardHtml as baseDashboardHtml } from './moe-dashboard-v3.js';

function unifiedMarkup() {
  return `
<nav class="unified-nav" aria-label="Main navigation">
  <a href="#overview">Overview</a>
  <a href="#scanner">Scanner</a>
  <a href="#trades">Trades</a>
  <a href="#analytics">Analytics</a>
  <a href="#certification">Readiness</a>
  <a href="/learning">Learning</a>
</nav>
<section id="scanner" class="section card unified-panel scanner-console">
  <div class="panel-head">
    <div>
      <h2>Automation Control Center</h2>
      <div class="muted">Live operational status for the 306-symbol scanner and protected Webull Sandbox execution.</div>
    </div>
    <div class="toolbar"><span class="badge watch" id="scannerState">Loading</span><button type="button" id="refreshScanner">Refresh status</button></div>
  </div>
  <div class="unified-grid status-grid">
    <div class="box"><div class="muted">Bot status</div><div class="value compact" id="botState">—</div></div>
    <div class="box"><div class="muted">Universe</div><div class="value" id="scannerSymbolCount">0</div></div>
    <div class="box"><div class="muted">Automation</div><div class="value compact" id="automationState">—</div></div>
    <div class="box"><div class="muted">Session</div><div class="value compact" id="scannerSession">—</div></div>
    <div class="box"><div class="muted">Last heartbeat</div><div class="value compact" id="scannerHeartbeat">—</div></div>
    <div class="box"><div class="muted">Last scan</div><div class="value compact" id="scannerLastCheck">—</div></div>
    <div class="box"><div class="muted">Candidates</div><div class="value" id="scannerCandidates">0</div></div>
    <div class="box"><div class="muted">Orders submitted</div><div class="value" id="scannerSubmitted">0</div></div>
  </div>
  <div class="operations-strip">
    <span><strong>Profiles:</strong> <span id="scannerProfiles">—</span></span>
    <span><strong>Hours:</strong> <span id="scannerHours">—</span></span>
    <span><strong>Open-position cap:</strong> <span id="scannerOpenCap">—</span></span>
    <span><strong>Daily-trade cap:</strong> <span id="scannerDailyCap">—</span></span>
  </div>
  <details class="symbol-details"><summary>View all scanned symbols</summary><div class="symbol-list" id="scannerSymbols"><span class="muted">No scanner data yet.</span></div></details>
  <div class="run-log" id="scannerRunLog"><div class="muted">Waiting for scanner heartbeat...</div></div>
  <div class="muted scanner-note" id="scannerNote"></div>
</section>
<section id="certification" class="section card unified-panel">
  <div class="panel-head"><div><h2>Production Readiness Preview</h2><div class="muted">Runs the complete production broker preview and safety pipeline without submitting a live order.</div></div><span class="badge watch" id="certState">Not run</span></div>
  <div class="cert-grid">
    <label>Symbol<input id="certSymbol" value="AAPL" maxlength="10"></label>
    <label>Entry price<input id="certEntry" type="number" min="0.01" step="0.01" value="100"></label>
    <label>Stop loss<input id="certStop" type="number" min="0.01" step="0.01" value="99"></label>
    <label>Take profit<input id="certTarget" type="number" min="0.01" step="0.01" value="102"></label>
    <label>Quantity<input id="certQty" type="number" min="1" step="1" value="1"></label>
    <label>Timeframe<input id="certTimeframe" value="5"></label>
  </div>
  <div class="cert-actions"><button type="button" id="runCertification">Run production preview</button><span class="muted">Webhook secret is requested once and is never stored.</span></div>
  <pre class="cert-output" id="certOutput">The readiness preview has not been run.</pre>
</section>`;
}

function unifiedStyle() {
  return `
html{scroll-behavior:smooth}.unified-nav{position:sticky;top:0;z-index:30;display:flex;gap:8px;overflow:auto;padding:10px;margin:-6px 0 14px;background:rgba(7,17,31,.94);backdrop-filter:blur(16px);border:1px solid #1d3552;border-radius:15px}.unified-nav a{white-space:nowrap;color:#dce9f8;text-decoration:none;border:1px solid #294564;background:#10233b;border-radius:10px;padding:9px 12px}.unified-nav a:hover{border-color:#66b8ff}.unified-panel{scroll-margin-top:82px}.panel-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.unified-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:14px}.status-grid{grid-template-columns:repeat(4,minmax(0,1fr))}.compact{font-size:15px;line-height:1.5}.symbol-list{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px;max-height:260px;overflow:auto}.symbol-chip{padding:7px 10px;border-radius:999px;background:#0c2035;border:1px solid #294564;font-weight:800}.scanner-note{margin-top:12px}.operations-strip{display:flex;gap:10px 18px;flex-wrap:wrap;margin-top:14px;padding:12px;border:1px solid #203a58;border-radius:13px;background:#081522;color:#cfe0f4}.symbol-details{margin-top:12px}.symbol-details summary{cursor:pointer;color:#9fc8f5;font-weight:800}.run-log{display:grid;gap:8px;margin-top:14px}.run-item{display:grid;grid-template-columns:150px 1fr auto;gap:12px;align-items:center;padding:10px 12px;border:1px solid #1c3550;border-radius:12px;background:#081522}.run-item strong{font-size:13px}.run-message{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#9fb3ca}.cert-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:10px;margin-top:14px}.cert-grid label{display:grid;gap:6px;color:#8fa4bf;font-size:12px}.cert-grid input{width:100%;border:1px solid #294564;background:#081522;color:#edf4ff;border-radius:10px;padding:10px}.cert-actions{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:14px}.cert-output{white-space:pre-wrap;word-break:break-word;max-height:390px;overflow:auto;background:#050d17;border:1px solid #1d3552;border-radius:13px;padding:13px;color:#cfe0f4;margin-top:12px}#trades,#analytics,#overview{scroll-margin-top:82px}@media(max-width:1000px){.unified-grid,.status-grid{grid-template-columns:repeat(2,1fr)}.cert-grid{grid-template-columns:repeat(3,1fr)}}@media(max-width:650px){.cert-grid{grid-template-columns:repeat(2,1fr)}.unified-nav{border-radius:0;margin-left:-13px;margin-right:-13px}.run-item{grid-template-columns:1fr}.run-message{white-space:normal}}`;
}

function unifiedScript() {
  return `
const scannerDate=new Intl.DateTimeFormat('en-US',{dateStyle:'short',timeStyle:'medium'});
function stateBadge(state){return state==='ONLINE'?'ok':state==='DISABLED'||state==='SAFETY_BLOCKED'?'no':'watch';}
function runSummary(run){if(!run)return 'No completed run';if(run.error)return run.error;if(run.skipped)return run.skipped;return (run.candidates||0)+' candidates · '+(run.attempted||0)+' attempted · '+(run.submitted||0)+' submitted';}
async function loadScanner(){scannerState.textContent='Loading';try{const r=await fetch('/api/scanner/status',{cache:'no-store'}),d=await r.json();if(!r.ok||!d.ok)throw new Error(d.error||('HTTP '+r.status));const s=d.scanner||{},run=s.lastRun||{};scannerState.textContent=s.state||'UNKNOWN';scannerState.className='badge '+stateBadge(s.state);botState.textContent=s.state||'UNKNOWN';scannerSymbolCount.textContent=s.universeSize||0;automationState.textContent=s.automationArmed?'ARMED':'DISARMED';automationState.className='value compact '+(s.automationArmed?'positive':'negative');scannerSession.textContent=(s.activeSession?.label||'CLOSED')+(s.activeSession?.open?' · OPEN':'');scannerHeartbeat.textContent=s.lastHeartbeat?scannerDate.format(new Date(s.lastHeartbeat)):'Waiting';scannerLastCheck.textContent=run.completedAt?scannerDate.format(new Date(run.completedAt)):'Not run';scannerCandidates.textContent=run.candidates||0;scannerSubmitted.textContent=run.submitted||0;scannerProfiles.textContent=(s.configuredProfiles||[]).join(', ')||'—';scannerHours.textContent=s.tradingHoursMode||'—';scannerOpenCap.textContent=s.limits?.maximumOpenPositions??'—';scannerDailyCap.textContent=s.limits?.maximumDailyTrades??'—';scannerSymbols.innerHTML=(s.symbols||[]).map(x=>'<span class="symbol-chip">'+esc(x)+'</span>').join('')||'<span class="muted">No symbols loaded.</span>';const runs=s.recentRuns||[];scannerRunLog.innerHTML=runs.slice(0,8).map(x=>'<div class="run-item"><strong>'+esc(x.completedAt?scannerDate.format(new Date(x.completedAt)):'Pending')+'</strong><span class="run-message">'+esc(runSummary(x))+'</span><span class="badge '+(x.error?'no':x.submitted>0?'ok':'watch')+'">'+esc(x.session||x.sessionWindow?.label||'—')+'</span></div>').join('')||'<div class="muted">No scanner runs recorded yet.</div>';scannerNote.textContent='Environment: '+(s.environment||'sandbox')+' · Sandbox safety lock: '+(s.sandboxSafetyLock?'active':'inactive')+' · Maximum submissions per scan: '+(s.limits?.maximumSubmissionsPerRun??'—');}catch(e){scannerState.textContent='ERROR';scannerState.className='badge no';scannerNote.textContent='Scanner status failed: '+e.message;}}
refreshScanner.addEventListener('click',loadScanner);loadScanner();setInterval(loadScanner,10000);
changeTradingMode=async function(mode){const secret=window.prompt('Enter MOE_WEBHOOK_SECRET. It will not be stored.');if(!secret)return;let confirmation='';if(mode==='LIVE'){confirmation=window.prompt('Type ENABLE_LIVE_TRADING exactly to continue.');if(confirmation!=='ENABLE_LIVE_TRADING'){setModeNote('Live mode was not enabled because the confirmation did not match.','error');return;}}setModeNote('Changing trading mode...');try{const response=await fetch('/api/trading/mode',{method:'PUT',headers:{'content-type':'application/json','x-moe-webhook-secret':secret},body:JSON.stringify({mode,confirmation,actor:'DASHBOARD_OWNER'})});const data=await response.json();if(!response.ok||!data.ok)throw new Error(data.error||('HTTP '+response.status));renderTradingMode(data.tradingMode);setModeNote('Trading mode changed to '+(modeLabels[data.tradingMode.effectiveMode]||data.tradingMode.effectiveMode)+'.','success');}catch(error){setModeNote('Trading mode was not changed: '+error.message,'error');}};
runCertification.addEventListener('click',async()=>{const secret=window.prompt('Enter MOE_WEBHOOK_SECRET to run a production preview only.');if(!secret)return;certState.textContent='Running';certState.className='badge watch';certOutput.textContent='Connecting and evaluating...';const body={certificationConfirmation:'RUN_LIVE_PREVIEW_ONLY',symbol:certSymbol.value.trim().toUpperCase(),side:'BUY',orderType:'LIMIT',session:'CORE',quantity:Number(certQty.value),limitPrice:Number(certEntry.value),stopLoss:Number(certStop.value),takeProfit:Number(certTarget.value),timeframe:certTimeframe.value,context:{marketPrice:Number(certEntry.value),signalScore:90,trendScore:88,momentumScore:86,relativeVolume:1.5,spreadPercent:.05,marketRegime:'TREND',sessionAllowed:true,riskPercent:.25},portfolio:{signalSector:'OTHER'}};try{const r=await fetch('/api/trading/live/certify',{method:'POST',headers:{'content-type':'application/json','x-moe-webhook-secret':secret},body:JSON.stringify(body)}),d=await r.json();certOutput.textContent=JSON.stringify(d,null,2);certState.textContent=d.ok?'Passed · No submission':'Incomplete';certState.className='badge '+(d.ok?'ok':'no');}catch(e){certState.textContent='Error';certState.className='badge no';certOutput.textContent=e.message;}});
`;
}

const translations = [
  ['<html lang="ar" dir="rtl">','<html lang="en" dir="ltr">'],
  ['لوحة سجل الصفقات والتحليلات الذكية','Automated trading operations, trade history, and analytics'],
  ['جاري الاتصال','Connecting'],['تحديث الآن','Refresh now'],['إجمالي الصفقات','Total trades'],['الصفقات المفتوحة','Open trades'],['الصفقات المغلقة','Closed trades'],['نسبة النجاح','Win rate'],['صافي الربح','Net profit'],['متوسط ثقة القرار','Average decision confidence'],['متوسط الربح','Average win'],['متوسط الخسارة','Average loss'],['قرارات محفوظة','Recorded decisions'],['منحنى الأرباح Equity Curve','Equity curve'],['ملخص MOE Brain','MOE Brain summary'],['قرارات اليوم','Today decisions'],['المقبولة اليوم','Accepted today'],['متوسط الدرجة','Average score'],['أعلى فرصة','Top opportunity'],['سجل الصفقات','Trade ledger'],['السهم','Symbol'],['الاتجاه','Direction'],['الحالة','Status'],['الفريم','Timeframe'],['الدخول','Entry'],['الخروج','Exit'],['الكمية','Quantity'],['الثقة','Confidence'],['التصنيف','Grade'],['الربح/الخسارة','P&L'],['القرار','Decision'],['وقت الدخول','Entry time'],['لا توجد صفقات مسجلة بعد','No trades recorded yet'],['فتح التقرير','Open report'],['تفاصيل القرار','Decision details'],['جاري التحميل','Loading'],['وضع التداول','Trading mode'],['اختر وضع التشغيل. وضع التداول الحقيقي يبقى مقفلاً حتى اكتمال جميع طبقات الحماية.','Select the operating mode. Live trading remains locked until every safety gate is approved.'],['يتم تحميل حالة النظام...','Loading system status...'],['معاينة فقط','Preview only'],['تداول حقيقي','Live trading'],['تحليل كامل دون إرسال أي أمر.','Complete analysis without submitting an order.'],['تنفيذ أوامر تجريبية محمية في حساب Sandbox.','Protected simulated orders in Webull Sandbox.'],['أوامر بأموال حقيقية. هذا الخيار مقفل حالياً.','Real-money orders. This option remains locked.'],['الوضع الحالي','Current mode'],['مقفل','Locked'],['اختيار هذا الوضع','Select mode'],['يعتمد هذا القسم على Trade History Engine وDecision Replay داخل Durable Object. يتم التحديث كل 10 ثوانٍ.','Powered by the Trade History Engine and Decision Replay. Data refreshes every 10 seconds.']
];

export function dashboardHtml() {
  let html = baseDashboardHtml()
    .replace('<header>', `<div id="overview"></div>${unifiedMarkup().split('<section id="scanner"')[0]}<header>`)
    .replace('<section class="section stats">', '<section id="analytics" class="section stats">')
    .replace('<section class="section card"><h2>سجل الصفقات</h2>', '<section id="trades" class="section card"><h2>Trade ledger</h2>')
    .replace('<div class="footer">', `${unifiedMarkup().slice(unifiedMarkup().indexOf('<section id="scanner"'))}<div class="footer">`)
    .replace('</style>', `${unifiedStyle()}</style>`)
    .replace('</script></body></html>', `${unifiedScript()}</script></body></html>`);
  for (const [source,target] of translations) html=html.split(source).join(target);
  return html;
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
