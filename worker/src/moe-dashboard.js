function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isToday(value) {
  const date = validDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function tradeMetrics(item) {
  const entry = number(item.entry ?? item.brain?.entry);
  const stopLoss = number(item.stopLoss ?? item.brain?.stopLoss);
  const takeProfit = number(item.takeProfit ?? item.brain?.takeProfit);
  const quantity = Math.max(0, number(item.quantity ?? item.qty ?? item.order?.quantity));
  const side = String(item.side || 'BUY').toUpperCase();
  const riskPerShare = entry && stopLoss ? Math.abs(entry - stopLoss) : 0;
  const rewardPerShare = entry && takeProfit ? Math.abs(takeProfit - entry) : 0;
  const plannedRisk = riskPerShare * quantity;
  const plannedReward = rewardPerShare * quantity;
  const notional = entry * quantity;
  const riskReward = riskPerShare ? rewardPerShare / riskPerShare : number(item.riskReward ?? item.brain?.riskReward);
  return { entry, stopLoss, takeProfit, quantity, side, riskPerShare, rewardPerShare, plannedRisk, plannedReward, notional, riskReward };
}

function aggregateBy(items, keySelector) {
  const groups = new Map();
  for (const item of items) {
    const key = String(keySelector(item) || 'OTHER').toUpperCase();
    const current = groups.get(key) || { key, count: 0, accepted: 0, submitted: 0, scoreTotal: 0, plannedRisk: 0, plannedReward: 0 };
    current.count += 1;
    current.accepted += item.accepted === true ? 1 : 0;
    current.submitted += item.submitted === true ? 1 : 0;
    current.scoreTotal += item.displayScore;
    current.plannedRisk += item.metrics.plannedRisk;
    current.plannedReward += item.metrics.plannedReward;
    groups.set(key, current);
  }
  return [...groups.values()].map((group) => ({
    ...group,
    averageScore: group.count ? Number((group.scoreTotal / group.count).toFixed(1)) : 0,
    acceptanceRate: group.count ? Number((group.accepted / group.count * 100).toFixed(1)) : 0,
    plannedRisk: Number(group.plannedRisk.toFixed(2)),
    plannedReward: Number(group.plannedReward.toFixed(2)),
  })).sort((a, b) => (b.averageScore - a.averageScore) || (b.count - a.count));
}

export function buildDashboardSnapshot(decisions = []) {
  const normalized = (Array.isArray(decisions) ? decisions : []).map((item) => ({
    ...item,
    displayScore: number(item.brain?.brainScore ?? item.score),
    marketScore: number(item.brain?.marketScore ?? item.marketScore),
    sectorScore: number(item.brain?.sectorScore ?? item.sectorScore),
    sector: item.brain?.sector ?? item.sector ?? 'OTHER',
    marketRegime: item.brain?.marketRegime ?? item.marketRegime ?? 'UNKNOWN',
    metrics: tradeMetrics(item),
  }));

  const accepted = normalized.filter((item) => item.accepted === true);
  const submitted = normalized.filter((item) => item.submitted === true);
  const rejected = normalized.filter((item) => item.accepted !== true);
  const today = normalized.filter((item) => isToday(item.createdAt));
  const ranked = [...normalized].sort((a, b) =>
    (b.displayScore - a.displayScore)
    || ((validDate(b.createdAt)?.getTime() || 0) - (validDate(a.createdAt)?.getTime() || 0))
  );
  const chronological = [...normalized].sort((a, b) =>
    (validDate(a.createdAt)?.getTime() || 0) - (validDate(b.createdAt)?.getTime() || 0)
  );

  const totals = normalized.reduce((acc, item) => {
    acc.plannedRisk += item.metrics.plannedRisk;
    acc.plannedReward += item.metrics.plannedReward;
    acc.notional += item.metrics.notional;
    return acc;
  }, { plannedRisk: 0, plannedReward: 0, notional: 0 });

  const latestRegime = normalized.find((item) => item.marketRegime && item.marketRegime !== 'UNKNOWN')?.marketRegime || 'UNKNOWN';
  const averageScore = normalized.length
    ? Number((normalized.reduce((sum, item) => sum + item.displayScore, 0) / normalized.length).toFixed(1))
    : 0;
  const sectors = aggregateBy(normalized, (item) => item.sector);
  const symbols = aggregateBy(normalized, (item) => item.symbol);

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      decisions: normalized.length,
      accepted: accepted.length,
      rejected: rejected.length,
      submitted: submitted.length,
      acceptanceRate: normalized.length ? Number((accepted.length / normalized.length * 100).toFixed(1)) : 0,
      todayDecisions: today.length,
      todayAccepted: today.filter((item) => item.accepted === true).length,
      averageScore,
      plannedRisk: Number(totals.plannedRisk.toFixed(2)),
      plannedReward: Number(totals.plannedReward.toFixed(2)),
      notional: Number(totals.notional.toFixed(2)),
      plannedEdge: Number((totals.plannedReward - totals.plannedRisk).toFixed(2)),
    },
    intelligence: {
      latestRegime,
      strongestSector: sectors[0]?.key || 'OTHER',
      topScore: ranked[0]?.displayScore || 0,
    },
    analytics: {
      scoreTimeline: chronological.slice(-40).map((item) => ({
        at: item.createdAt,
        symbol: item.symbol || '—',
        score: item.displayScore,
        accepted: item.accepted === true,
      })),
      sectors: sectors.slice(0, 12),
      symbols: symbols.slice(0, 18),
    },
    openSignals: submitted.slice(0, 25),
    acceptedSignals: accepted.slice(0, 25),
    rejectedSignals: rejected.slice(0, 25),
    topOpportunities: ranked.slice(0, 25),
    recentDecisions: normalized.slice(0, 100),
  };
}

export function dashboardHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><meta name="theme-color" content="#07111f">
<title>MOERAND AI Control Center</title>
<style>
:root{color-scheme:dark;font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}*{box-sizing:border-box}body{margin:0;min-height:100vh;background:radial-gradient(circle at top,#10243d 0,#07111f 38%,#050b14 100%);color:#edf4ff}.wrap{max-width:1500px;margin:auto;padding:20px}header{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:16px}h1{margin:0;font-size:clamp(27px,4vw,42px);letter-spacing:-.04em}h2{margin:0 0 12px;font-size:19px}.muted{color:#8fa4bf}.toolbar,.live,.tabs,.account-head{display:flex;gap:9px;align-items:center;flex-wrap:wrap}.account-head{justify-content:space-between;margin-bottom:12px}.live{color:#7ee2a8;font-weight:800}.dot{width:10px;height:10px;border-radius:50%;background:#39d98a;box-shadow:0 0 18px #39d98a}button{border:1px solid #2b4566;background:#10233b;color:#edf4ff;border-radius:12px;padding:10px 13px;cursor:pointer}.grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:12px}.card{background:linear-gradient(145deg,rgba(16,35,59,.96),rgba(7,17,31,.96));border:1px solid #1d3552;border-radius:18px;padding:16px;box-shadow:0 18px 60px rgba(0,0,0,.22)}.metric{margin-top:7px;font-size:clamp(23px,3vw,33px);font-weight:900;font-variant-numeric:tabular-nums}.section{margin-top:14px}.intel{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px}.analytics{display:grid;grid-template-columns:1.3fr .7fr;gap:14px}.risk-grid,.account-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:10px}.risk-box,.account-box{padding:13px;border:1px solid #203a58;border-radius:14px;background:#0a1726}.risk-value,.account-value{font-size:23px;font-weight:900;margin-top:6px}.positive{color:#7ee2a8}.negative{color:#ff9696}.neutral-text{color:#ffd07a}.pill,.badge{display:inline-flex;align-items:center;border-radius:999px;font-size:11px;font-weight:800}.pill{padding:6px 10px}.badge{padding:5px 9px}.bull,.ok{background:rgba(57,217,138,.14);color:#7ee2a8}.bear,.no{background:rgba(255,99,99,.14);color:#ff9696}.neutral,.watch{background:rgba(255,191,71,.14);color:#ffd07a}.chart-shell{height:250px;position:relative}.chart-shell canvas{width:100%;height:100%}.heatmap{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.heat{border-radius:13px;padding:12px;min-height:79px;border:1px solid rgba(255,255,255,.08);display:flex;flex-direction:column;justify-content:space-between}.heat strong{font-size:17px}.heat small{color:#d5dfec}.portfolio{display:grid;grid-template-columns:repeat(3,1fr);gap:9px}.position{padding:13px;border:1px solid #203a58;border-radius:14px;background:#091523}.position-head{display:flex;justify-content:space-between;gap:8px}.position-line{display:flex;justify-content:space-between;color:#a9bbd1;font-size:12px;margin-top:8px}.account-note{font-size:12px;color:#8fa4bf;margin-top:10px}.error-box{display:none;margin-top:10px;padding:10px 12px;border-radius:12px;background:rgba(255,99,99,.12);color:#ffaaaa;border:1px solid rgba(255,99,99,.3)}.table-wrap{overflow:auto;border-radius:15px;border:1px solid #1c304a}table{width:100%;border-collapse:collapse;min-width:1160px;background:#091523}th,td{padding:12px 13px;text-align:right;border-bottom:1px solid #172a41;vertical-align:middle}th{color:#8fa4bf;font-size:11px;background:#0d1b2d;position:sticky;top:0;z-index:1}.score{font-weight:900}.reason{max-width:310px;white-space:normal;color:#b5c4d8}.empty{padding:30px;text-align:center;color:#8fa4bf}.tab.active{background:#1a4069;border-color:#3e6f9f}.footer{padding:16px 4px 0;color:#748aa6;font-size:12px;text-align:center}@media(max-width:1100px){.grid{grid-template-columns:repeat(3,1fr)}.intel{grid-template-columns:repeat(2,1fr)}.analytics{grid-template-columns:1fr}.portfolio{grid-template-columns:repeat(2,1fr)}.account-grid{grid-template-columns:repeat(2,1fr)}}@media(max-width:700px){.wrap{padding:13px}header{align-items:flex-start;flex-direction:column}.grid{grid-template-columns:repeat(2,1fr)}.intel,.risk-grid,.account-grid{grid-template-columns:repeat(2,1fr)}.portfolio{grid-template-columns:1fr}.heatmap{grid-template-columns:repeat(2,1fr)}}
</style>
</head><body><main class="wrap">
<header><div><h1>MOERAND AI</h1><div class="muted">مركز المراقبة والتحليل الذكي • Brain 2.0</div></div><div class="toolbar"><div class="live"><span class="dot"></span><span id="status">جاري الاتصال</span></div><button id="refresh">تحديث الآن</button></div></header>
<section class="grid"><div class="card"><div class="muted">قرارات اليوم</div><div class="metric" id="todayDecisions">0</div></div><div class="card"><div class="muted">مقبولة اليوم</div><div class="metric" id="todayAccepted">0</div></div><div class="card"><div class="muted">تم إرسالها</div><div class="metric" id="submitted">0</div></div><div class="card"><div class="muted">نسبة القبول</div><div class="metric" id="rate">0%</div></div><div class="card"><div class="muted">متوسط الدرجة</div><div class="metric" id="averageScore">0</div></div><div class="card"><div class="muted">أعلى فرصة</div><div class="metric" id="topScore">0</div></div></section>
<section class="section intel"><div class="card"><div class="muted">حالة السوق</div><div class="metric" id="regime">—</div></div><div class="card"><div class="muted">أقوى قطاع</div><div class="metric" id="sector">—</div></div><div class="card"><div class="muted">بيئة التنفيذ</div><div class="metric" id="environment">—</div></div><div class="card"><div class="muted">التداول الحقيقي</div><div class="metric" id="liveTrading">—</div></div></section>
<section class="section card"><div class="account-head"><h2>حساب Webull المباشر</h2><div id="accountStatus" class="pill neutral">غير متصل</div></div><div class="account-grid"><div class="account-box"><div class="muted">صافي قيمة الحساب</div><div class="account-value" id="accountEquity">—</div></div><div class="account-box"><div class="muted">النقد المتاح</div><div class="account-value" id="accountCash">—</div></div><div class="account-box"><div class="muted">القوة الشرائية اليومية</div><div class="account-value" id="dayBuyingPower">—</div></div><div class="account-box"><div class="muted">القوة الشرائية الليلية</div><div class="account-value" id="overnightBuyingPower">—</div></div><div class="account-box"><div class="muted">القيمة السوقية</div><div class="account-value" id="marketValue">—</div></div><div class="account-box"><div class="muted">الربح والخسارة غير المحققة</div><div class="account-value" id="unrealizedPnl">—</div></div><div class="account-box"><div class="muted">هامش الصيانة</div><div class="account-value" id="maintenanceMargin">—</div></div><div class="account-box"><div class="muted">عدد المراكز</div><div class="account-value" id="positionCount">0</div></div></div><div id="accountError" class="error-box"></div><div id="accountMeta" class="account-note">الاتصال للقراءة فقط، ولا يسمح بإرسال أوامر.</div></section>
<section class="section card"><h2>المراكز الحية في Webull</h2><div id="livePositions" class="portfolio"><div class="empty">لا توجد مراكز حية أو لم يتم الاتصال بعد</div></div></section>
<section class="section card"><h2>مراقبة المخاطر والعائد المخطط</h2><div class="risk-grid"><div class="risk-box"><div class="muted">القيمة الاسمية</div><div class="risk-value" id="notional">$0.00</div></div><div class="risk-box"><div class="muted">المخاطرة المخططة</div><div class="risk-value negative" id="plannedRisk">$0.00</div></div><div class="risk-box"><div class="muted">العائد المستهدف</div><div class="risk-value positive" id="plannedReward">$0.00</div></div><div class="risk-box"><div class="muted">الحافة المخططة</div><div class="risk-value" id="plannedEdge">$0.00</div></div></div></section>
<section class="section analytics"><div class="card"><h2>تطور درجات MOE Brain</h2><div class="chart-shell"><canvas id="scoreChart"></canvas></div></div><div class="card"><h2>خريطة حرارة الأسهم</h2><div id="symbolHeatmap" class="heatmap"><div class="empty">لا توجد بيانات</div></div></div></section>
<section class="section card"><h2>خريطة القطاعات</h2><div id="sectorHeatmap" class="heatmap"><div class="empty">لا توجد بيانات</div></div></section>
<section class="section card"><h2>مراقبة الصفقات المرسلة</h2><div id="portfolio" class="portfolio"><div class="empty">لا توجد صفقات مرسلة</div></div></section>
<section class="section card"><div class="tabs"><button class="tab active" data-filter="all">كل القرارات</button><button class="tab" data-filter="submitted">تم إرسالها</button><button class="tab" data-filter="accepted">المقبولة</button><button class="tab" data-filter="rejected">المرفوضة</button></div><h2>الفرص والقرارات</h2><div class="table-wrap"><table><thead><tr><th>#</th><th>السهم</th><th>الاتجاه</th><th>الحالة</th><th>الدرجة</th><th>السوق</th><th>القطاع</th><th>الدخول</th><th>وقف الخسارة</th><th>الهدف</th><th>R:R</th><th>المخاطرة</th><th>العائد</th><th>السبب</th><th>الوقت</th></tr></thead><tbody id="opportunities"><tr><td colspan="15" class="empty">لا توجد بيانات بعد</td></tr></tbody></table></div></section>
<div class="footer">بيانات حساب Webull والمراكز الحية للقراءة فقط. المخاطرة والعائد في قسم التخطيط تقديرات مبنية على إشارات MOERAND. يتم التحديث كل 10 ثوانٍ.</div>
</main><script>
const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});const dateFmt=new Intl.DateTimeFormat('ar-US',{dateStyle:'short',timeStyle:'short'});let latestData=null,activeFilter='all';
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}function cash(v){const n=Number(v);return Number.isFinite(n)?money.format(n):'—';}function price(v){const n=Number(v);return Number.isFinite(n)&&n>0?money.format(n):'—';}function state(i){if(i.submitted)return '<span class="badge ok">تم الإرسال</span>';if(i.accepted)return '<span class="badge watch">مقبولة</span>';return '<span class="badge no">مرفوضة</span>';}function regimeBadge(v){v=String(v||'UNKNOWN').toUpperCase();const c=v.includes('BULL')?'bull':v.includes('BEAR')?'bear':'neutral';return '<span class="pill '+c+'">'+esc(v)+'</span>';}function rowsFor(d){if(activeFilter==='submitted')return d.openSignals||[];if(activeFilter==='accepted')return d.acceptedSignals||[];if(activeFilter==='rejected')return d.rejectedSignals||[];return d.topOpportunities||[];}
function heatColor(score,rate){const strength=Math.max(0,Math.min(1,(Number(score)||0)/100));if((Number(rate)||0)>=50)return 'linear-gradient(145deg,rgba(31,129,87,'+(0.3+strength*.45)+'),rgba(10,38,31,.95))';return 'linear-gradient(145deg,rgba(137,54,54,'+(0.25+strength*.35)+'),rgba(42,18,24,.95))';}
function renderHeat(target,items){target.innerHTML=(items||[]).map(x=>'<div class="heat" style="background:'+heatColor(x.averageScore,x.acceptanceRate)+'"><strong>'+esc(x.key)+'</strong><small>الدرجة '+esc(x.averageScore)+' • قبول '+esc(x.acceptanceRate)+'%</small><small>'+esc(x.count)+' قرارات</small></div>').join('')||'<div class="empty">لا توجد بيانات بعد</div>';}
function renderPortfolio(items){portfolio.innerHTML=(items||[]).map(i=>{const m=i.metrics||{};return '<div class="position"><div class="position-head"><strong>'+esc(i.symbol||'—')+'</strong>'+state(i)+'</div><div class="position-line"><span>الكمية</span><b>'+esc(m.quantity||'—')+'</b></div><div class="position-line"><span>الدخول</span><b>'+price(m.entry)+'</b></div><div class="position-line"><span>المخاطرة</span><b class="negative">'+cash(m.plannedRisk)+'</b></div><div class="position-line"><span>العائد المستهدف</span><b class="positive">'+cash(m.plannedReward)+'</b></div></div>';}).join('')||'<div class="empty">لا توجد صفقات مرسلة حتى الآن</div>';}
function renderLivePositions(items){livePositions.innerHTML=(items||[]).map(p=>{const pnl=Number(p.unrealizedPnl)||0;return '<div class="position"><div class="position-head"><strong>'+esc(p.symbol||'—')+'</strong><span class="badge '+(String(p.side||'LONG').toUpperCase()==='SHORT'?'no':'ok')+'">'+esc(p.side||'LONG')+'</span></div><div class="position-line"><span>الكمية</span><b>'+esc(p.quantity??'—')+'</b></div><div class="position-line"><span>متوسط السعر</span><b>'+price(p.averagePrice)+'</b></div><div class="position-line"><span>آخر سعر</span><b>'+price(p.lastPrice)+'</b></div><div class="position-line"><span>القيمة السوقية</span><b>'+cash(p.marketValue)+'</b></div><div class="position-line"><span>الربح/الخسارة</span><b class="'+(pnl>=0?'positive':'negative')+'">'+cash(pnl)+'</b></div></div>';}).join('')||'<div class="empty">لا توجد مراكز حية</div>';}
function renderAccount(data){const a=data.account||{};accountEquity.textContent=cash(a.equity);accountCash.textContent=cash(a.cash);dayBuyingPower.textContent=cash(a.dayBuyingPower);overnightBuyingPower.textContent=cash(a.overnightBuyingPower);marketValue.textContent=cash(a.marketValue);maintenanceMargin.textContent=cash(a.maintenanceMargin);positionCount.textContent=Number(a.positionCount)||0;const pnl=Number(a.unrealizedPnl)||0;unrealizedPnl.textContent=cash(a.unrealizedPnl);unrealizedPnl.className='account-value '+(pnl>=0?'positive':'negative');if(a.connected){accountStatus.className='pill bull';accountStatus.textContent='متصل • قراءة فقط';}else if(a.enabled){accountStatus.className='pill bear';accountStatus.textContent='تعذر الاتصال';}else{accountStatus.className='pill neutral';accountStatus.textContent='غير مفعّل';}const fetched=a.fetchedAt?dateFmt.format(new Date(a.fetchedAt)):'—';accountMeta.textContent='الحساب '+esc(a.accountIdMasked||'—')+' • آخر مزامنة '+fetched+' • قراءة فقط';accountError.style.display=data.accountError?'block':'none';accountError.textContent=data.accountError?'خطأ مزامنة Webull: '+String(data.accountError):'';renderLivePositions(a.positions||[]);}
function drawChart(points){const canvas=scoreChart,rect=canvas.getBoundingClientRect(),dpr=window.devicePixelRatio||1;canvas.width=Math.max(300,rect.width*dpr);canvas.height=Math.max(180,rect.height*dpr);const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);const w=rect.width,h=rect.height,p=28;ctx.clearRect(0,0,w,h);ctx.strokeStyle='rgba(143,164,191,.18)';ctx.lineWidth=1;for(let y=0;y<=4;y++){const yy=p+(h-p*2)*y/4;ctx.beginPath();ctx.moveTo(p,yy);ctx.lineTo(w-p,yy);ctx.stroke();}if(!points||!points.length){ctx.fillStyle='#8fa4bf';ctx.textAlign='center';ctx.fillText('لا توجد نقاط كافية للرسم',w/2,h/2);return;}const values=points.map(x=>Number(x.score)||0),min=Math.min(0,...values),max=Math.max(100,...values),range=max-min||1;const xy=points.map((x,n)=>({x:p+(w-p*2)*(points.length===1?0.5:n/(points.length-1)),y:h-p-(h-p*2)*((Number(x.score)||0)-min)/range,accepted:x.accepted}));ctx.strokeStyle='#66b8ff';ctx.lineWidth=2.5;ctx.beginPath();xy.forEach((q,n)=>n?ctx.lineTo(q.x,q.y):ctx.moveTo(q.x,q.y));ctx.stroke();xy.forEach(q=>{ctx.beginPath();ctx.fillStyle=q.accepted?'#39d98a':'#ff7d7d';ctx.arc(q.x,q.y,3.5,0,Math.PI*2);ctx.fill();});}
function render(data){latestData=data;const t=data.totals||{},i=data.intelligence||{},a=data.analytics||{};todayDecisions.textContent=t.todayDecisions||0;todayAccepted.textContent=t.todayAccepted||0;submitted.textContent=t.submitted||0;rate.textContent=(t.acceptanceRate||0)+'%';averageScore.textContent=t.averageScore||0;topScore.textContent=i.topScore||0;regime.innerHTML=regimeBadge(i.latestRegime);sector.textContent=i.strongestSector||'OTHER';environment.textContent=String(data.environment||'sandbox').toUpperCase();liveTrading.innerHTML=data.liveTrading?'<span class="pill bear">مفعّل</span>':'<span class="pill bull">متوقف</span>';notional.textContent=cash(t.notional);plannedRisk.textContent=cash(t.plannedRisk);plannedReward.textContent=cash(t.plannedReward);plannedEdge.textContent=cash(t.plannedEdge);plannedEdge.className='risk-value '+((Number(t.plannedEdge)||0)>=0?'positive':'negative');renderAccount(data);renderHeat(symbolHeatmap,a.symbols);renderHeat(sectorHeatmap,a.sectors);renderPortfolio(data.openSignals);drawChart(a.scoreTimeline);const rows=rowsFor(data).map((item,index)=>{const m=item.metrics||{},reasons=[...(item.brain?.reasons||[]),...(item.brain?.rejectionReasons||[]),...(item.reasons||[])];return '<tr><td>'+(index+1)+'</td><td><strong>'+esc(item.symbol||'—')+'</strong></td><td>'+esc(m.side||item.side||'—')+'</td><td>'+state(item)+'</td><td class="score">'+esc(item.displayScore||item.score||0)+'</td><td>'+regimeBadge(item.marketRegime)+'</td><td>'+esc(item.sector||'OTHER')+'</td><td>'+price(m.entry||item.entry)+'</td><td>'+price(m.stopLoss||item.stopLoss)+'</td><td>'+price(m.takeProfit||item.takeProfit)+'</td><td>'+esc(Number(m.riskReward||0).toFixed(2))+'</td><td class="negative">'+cash(m.plannedRisk)+'</td><td class="positive">'+cash(m.plannedReward)+'</td><td class="reason">'+esc(reasons[0]||item.message||'لا يوجد سبب مسجل')+'</td><td>'+esc(item.createdAt?dateFmt.format(new Date(item.createdAt)):'—')+'</td></tr>';}).join('');opportunities.innerHTML=rows||'<tr><td colspan="15" class="empty">لا توجد نتائج ضمن هذا التصنيف.</td></tr>';}
async function load(){status.textContent='جاري التحديث';try{const r=await fetch('/api/moe-ai/dashboard',{cache:'no-store'});if(!r.ok)throw new Error('HTTP '+r.status);const d=await r.json();render(d);status.textContent='متصل • '+dateFmt.format(new Date(d.generatedAt));}catch(e){status.textContent='تعذر تحميل البيانات';console.error(e);}}document.querySelectorAll('.tab').forEach(b=>b.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));b.classList.add('active');activeFilter=b.dataset.filter;if(latestData)render(latestData);}));refresh.addEventListener('click',load);window.addEventListener('resize',()=>latestData&&drawChart(latestData.analytics?.scoreTimeline));load();setInterval(load,10000);
</script></body></html>`;
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
