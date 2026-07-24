function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function validDate(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function isToday(value) {
  const date = validDate(value);
  if (!date) return false;
  const now = new Date();
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

export function buildDashboardSnapshot(decisions = []) {
  const normalized = (Array.isArray(decisions) ? decisions : []).map((item) => ({
    ...item,
    displayScore: Number(item.brain?.brainScore ?? item.score ?? 0),
    marketScore: Number(item.brain?.marketScore ?? item.marketScore ?? 0),
    sectorScore: Number(item.brain?.sectorScore ?? item.sectorScore ?? 0),
    sector: item.brain?.sector ?? item.sector ?? 'OTHER',
    marketRegime: item.brain?.marketRegime ?? item.marketRegime ?? 'UNKNOWN',
  }));

  const accepted = normalized.filter((item) => item.accepted === true);
  const submitted = normalized.filter((item) => item.submitted === true);
  const rejected = normalized.filter((item) => item.accepted !== true);
  const today = normalized.filter((item) => isToday(item.createdAt));
  const todayAccepted = today.filter((item) => item.accepted === true);
  const ranked = [...normalized].sort((a, b) =>
    (b.displayScore - a.displayScore)
    || ((validDate(b.createdAt)?.getTime() || 0) - (validDate(a.createdAt)?.getTime() || 0))
  );

  const regimes = normalized.reduce((acc, item) => {
    const key = String(item.marketRegime || 'UNKNOWN').toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});

  const latestRegime = normalized.find((item) => item.marketRegime && item.marketRegime !== 'UNKNOWN')?.marketRegime || 'UNKNOWN';
  const averageScore = normalized.length
    ? Number((normalized.reduce((sum, item) => sum + item.displayScore, 0) / normalized.length).toFixed(1))
    : 0;

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      decisions: normalized.length,
      accepted: accepted.length,
      rejected: rejected.length,
      submitted: submitted.length,
      acceptanceRate: normalized.length ? Number((accepted.length / normalized.length * 100).toFixed(1)) : 0,
      todayDecisions: today.length,
      todayAccepted: todayAccepted.length,
      averageScore,
    },
    intelligence: {
      latestRegime,
      regimes,
      strongestSector: ranked.find((item) => item.sector && item.sector !== 'OTHER')?.sector || 'OTHER',
      topScore: ranked[0]?.displayScore || 0,
    },
    openSignals: submitted.slice(0, 20),
    acceptedSignals: accepted.slice(0, 20),
    rejectedSignals: rejected.slice(0, 20),
    topOpportunities: ranked.slice(0, 20),
    recentDecisions: normalized.slice(0, 100),
  };
}

export function dashboardHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover" />
  <meta name="theme-color" content="#07111f" />
  <title>MOERAND AI Control Center</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin:0; background:radial-gradient(circle at top,#10243d 0,#07111f 38%,#050b14 100%); color:#edf4ff; min-height:100vh; }
    .wrap { max-width:1440px; margin:auto; padding:22px; }
    header { display:flex; align-items:center; justify-content:space-between; gap:18px; margin-bottom:18px; }
    h1 { margin:0; font-size:clamp(26px,4vw,42px); letter-spacing:-.04em; }
    h2 { margin:0 0 12px; font-size:19px; }
    .muted { color:#8fa4bf; }
    .toolbar { display:flex; gap:10px; align-items:center; flex-wrap:wrap; }
    .live { display:flex; align-items:center; gap:8px; color:#7ee2a8; font-weight:700; }
    .dot { width:10px; height:10px; border-radius:50%; background:#39d98a; box-shadow:0 0 18px #39d98a; }
    button,select { border:1px solid #2b4566; background:#10233b; color:#edf4ff; border-radius:12px; padding:10px 13px; }
    button { cursor:pointer; }
    .grid { display:grid; grid-template-columns:repeat(6,minmax(0,1fr)); gap:12px; }
    .card { background:linear-gradient(145deg,rgba(16,35,59,.96),rgba(7,17,31,.96)); border:1px solid #1d3552; border-radius:18px; padding:17px; box-shadow:0 18px 60px rgba(0,0,0,.22); }
    .metric { margin-top:7px; font-size:clamp(25px,3vw,34px); font-weight:900; font-variant-numeric:tabular-nums; }
    .section { margin-top:14px; }
    .intelligence { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:12px; }
    .pill { display:inline-flex; align-items:center; padding:6px 11px; border-radius:999px; font-size:12px; font-weight:800; }
    .bull { background:rgba(57,217,138,.14); color:#7ee2a8; }
    .bear { background:rgba(255,99,99,.14); color:#ff9696; }
    .neutral { background:rgba(255,191,71,.14); color:#ffd07a; }
    .table-wrap { overflow:auto; border-radius:15px; border:1px solid #1c304a; }
    table { width:100%; border-collapse:collapse; min-width:1080px; background:#091523; }
    th,td { padding:12px 13px; text-align:right; border-bottom:1px solid #172a41; vertical-align:middle; }
    th { color:#8fa4bf; font-size:11px; letter-spacing:.04em; background:#0d1b2d; position:sticky; top:0; z-index:1; }
    .badge { display:inline-flex; border-radius:999px; padding:5px 9px; font-size:11px; font-weight:800; }
    .ok { background:rgba(57,217,138,.14); color:#7ee2a8; }
    .no { background:rgba(255,99,99,.14); color:#ff9696; }
    .watch { background:rgba(255,191,71,.14); color:#ffd07a; }
    .score { font-weight:900; }
    .reason { max-width:330px; white-space:normal; color:#b5c4d8; }
    .empty { padding:32px; text-align:center; color:#8fa4bf; }
    .tabs { display:flex; gap:8px; margin-bottom:12px; flex-wrap:wrap; }
    .tab.active { background:#1a4069; border-color:#3e6f9f; }
    .footer { padding:16px 4px 0; color:#748aa6; font-size:12px; text-align:center; }
    @media(max-width:1100px){ .grid{grid-template-columns:repeat(3,1fr)} .intelligence{grid-template-columns:repeat(2,1fr)} }
    @media(max-width:700px){ .wrap{padding:14px} header{align-items:flex-start;flex-direction:column} .grid{grid-template-columns:repeat(2,1fr)} .intelligence{grid-template-columns:1fr 1fr} .card{padding:14px} }
  </style>
</head>
<body>
  <main class="wrap">
    <header>
      <div><h1>MOERAND AI</h1><div class="muted">مركز المراقبة الذكي • Brain 2.0 • Webull Sandbox</div></div>
      <div class="toolbar"><div class="live"><span class="dot"></span><span id="status">جاري الاتصال</span></div><button id="refresh">تحديث الآن</button></div>
    </header>

    <section class="grid">
      <div class="card"><div class="muted">قرارات اليوم</div><div class="metric" id="todayDecisions">0</div></div>
      <div class="card"><div class="muted">مقبولة اليوم</div><div class="metric" id="todayAccepted">0</div></div>
      <div class="card"><div class="muted">تم إرسالها</div><div class="metric" id="submitted">0</div></div>
      <div class="card"><div class="muted">نسبة القبول</div><div class="metric" id="rate">0%</div></div>
      <div class="card"><div class="muted">متوسط الدرجة</div><div class="metric" id="averageScore">0</div></div>
      <div class="card"><div class="muted">أعلى فرصة</div><div class="metric" id="topScore">0</div></div>
    </section>

    <section class="section intelligence">
      <div class="card"><div class="muted">حالة السوق</div><div class="metric" id="regime">—</div></div>
      <div class="card"><div class="muted">أقوى قطاع</div><div class="metric" id="sector">—</div></div>
      <div class="card"><div class="muted">بيئة التنفيذ</div><div class="metric" id="environment">—</div></div>
      <div class="card"><div class="muted">التداول الحقيقي</div><div class="metric" id="liveTrading">—</div></div>
    </section>

    <section class="section card">
      <div class="tabs">
        <button class="tab active" data-filter="all">كل القرارات</button>
        <button class="tab" data-filter="submitted">تم إرسالها</button>
        <button class="tab" data-filter="accepted">المقبولة</button>
        <button class="tab" data-filter="rejected">المرفوضة</button>
      </div>
      <h2>الفرص والقرارات</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>السهم</th><th>الاتجاه</th><th>الحالة</th><th>الدرجة</th><th>السوق</th><th>القطاع</th><th>الدخول</th><th>وقف الخسارة</th><th>الهدف</th><th>R:R</th><th>السبب</th><th>الوقت</th></tr></thead>
        <tbody id="opportunities"><tr><td colspan="13" class="empty">لا توجد بيانات بعد</td></tr></tbody>
      </table></div>
    </section>
    <div class="footer">يتم التحديث تلقائيًا كل 10 ثوانٍ. الصفقات المعروضة هي قرارات النظام المسجلة وليست تأكيدًا على التنفيذ النهائي لدى الوسيط.</div>
  </main>
<script>
const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const dateFmt=new Intl.DateTimeFormat('ar-US',{dateStyle:'short',timeStyle:'short'});
let latestData=null; let activeFilter='all';
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function price(v){const n=Number(v);return Number.isFinite(n)&&n>0?money.format(n):'—';}
function state(item){if(item.submitted)return '<span class="badge ok">تم الإرسال</span>';if(item.accepted)return '<span class="badge watch">مقبولة</span>';return '<span class="badge no">مرفوضة</span>';}
function regimeBadge(value){const v=String(value||'UNKNOWN').toUpperCase();const cls=v.includes('BULL')?'bull':v.includes('BEAR')?'bear':'neutral';return '<span class="pill '+cls+'">'+esc(v)+'</span>';}
function rowsFor(data){if(activeFilter==='submitted')return data.openSignals||[];if(activeFilter==='accepted')return data.acceptedSignals||[];if(activeFilter==='rejected')return data.rejectedSignals||[];return data.topOpportunities||[];}
function render(data){latestData=data;const t=data.totals||{},i=data.intelligence||{};
  todayDecisions.textContent=t.todayDecisions||0; todayAccepted.textContent=t.todayAccepted||0; submitted.textContent=t.submitted||0; rate.textContent=(t.acceptanceRate||0)+'%'; averageScore.textContent=t.averageScore||0; topScore.textContent=i.topScore||0;
  regime.innerHTML=regimeBadge(i.latestRegime); sector.textContent=i.strongestSector||'OTHER'; environment.textContent=String(data.environment||'sandbox').toUpperCase(); liveTrading.innerHTML=data.liveTrading?'<span class="pill bear">مفعّل</span>':'<span class="pill bull">متوقف</span>';
  const rows=rowsFor(data).map((item,index)=>{const reasons=[...(item.brain?.reasons||[]),...(item.brain?.rejectionReasons||[]),...(item.reasons||[])];return '<tr><td>'+(index+1)+'</td><td><strong>'+esc(item.symbol||'—')+'</strong></td><td>'+esc(item.side||'—')+'</td><td>'+state(item)+'</td><td class="score">'+esc(item.displayScore||item.score||0)+'</td><td>'+regimeBadge(item.marketRegime)+'</td><td>'+esc(item.sector||'OTHER')+'</td><td>'+price(item.entry)+'</td><td>'+price(item.stopLoss)+'</td><td>'+price(item.takeProfit)+'</td><td>'+esc(item.riskReward??item.brain?.riskReward??'—')+'</td><td class="reason">'+esc(reasons[0]||item.message||'لا يوجد سبب مسجل')+'</td><td>'+esc(item.createdAt?dateFmt.format(new Date(item.createdAt)):'—')+'</td></tr>';}).join('');
  opportunities.innerHTML=rows||'<tr><td colspan="13" class="empty">لا توجد نتائج ضمن هذا التصنيف.</td></tr>';
}
async function load(){status.textContent='جاري التحديث';try{const response=await fetch('/api/moe-ai/dashboard',{cache:'no-store'});if(!response.ok)throw new Error('HTTP '+response.status);const data=await response.json();render(data);status.textContent='متصل • '+dateFmt.format(new Date(data.generatedAt));}catch(error){status.textContent='تعذر تحميل البيانات';console.error(error);}}
document.querySelectorAll('.tab').forEach(btn=>btn.addEventListener('click',()=>{document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));btn.classList.add('active');activeFilter=btn.dataset.filter; if(latestData)render(latestData);}));
refresh.addEventListener('click',load);load();setInterval(load,10000);
</script>
</body></html>`;
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
