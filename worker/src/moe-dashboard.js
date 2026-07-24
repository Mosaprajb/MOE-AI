function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

export function buildDashboardSnapshot(decisions = []) {
  const normalized = Array.isArray(decisions) ? decisions : [];
  const accepted = normalized.filter((item) => item.accepted === true);
  const submitted = normalized.filter((item) => item.submitted === true);
  const rejected = normalized.filter((item) => item.accepted !== true);
  const ranked = normalized
    .map((item) => ({
      ...item,
      displayScore: Number(item.brain?.brainScore ?? item.score ?? 0),
      marketScore: Number(item.brain?.marketScore ?? item.marketScore ?? 0),
      sectorScore: Number(item.brain?.sectorScore ?? item.sectorScore ?? 0),
      sector: item.brain?.sector ?? item.sector ?? 'OTHER',
      marketRegime: item.brain?.marketRegime ?? item.marketRegime ?? 'UNKNOWN',
    }))
    .sort((a, b) => (b.displayScore - a.displayScore) || (new Date(b.createdAt) - new Date(a.createdAt)));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      decisions: normalized.length,
      accepted: accepted.length,
      rejected: rejected.length,
      submitted: submitted.length,
      acceptanceRate: normalized.length ? Number((accepted.length / normalized.length * 100).toFixed(1)) : 0,
    },
    topOpportunities: ranked.slice(0, 10),
    recentDecisions: normalized.slice(0, 50),
  };
}

export function dashboardHtml() {
  return `<!doctype html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <title>MOE AI Control Center</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, system-ui, -apple-system, sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; background: #07111f; color: #e8eef8; }
    .wrap { max-width: 1280px; margin: auto; padding: 24px; }
    header { display:flex; justify-content:space-between; gap:16px; align-items:center; margin-bottom:20px; }
    h1 { margin:0; font-size:clamp(24px,4vw,38px); }
    .muted { color:#8fa4bf; }
    .live { display:flex; align-items:center; gap:8px; color:#7ee2a8; }
    .dot { width:10px; height:10px; border-radius:50%; background:#39d98a; box-shadow:0 0 16px #39d98a; }
    .grid { display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:14px; }
    .card { background:linear-gradient(145deg,#0d1b2d,#0a1524); border:1px solid #1c304a; border-radius:18px; padding:18px; box-shadow:0 18px 50px rgba(0,0,0,.22); }
    .metric { font-size:30px; font-weight:800; margin-top:8px; }
    .section { margin-top:18px; }
    .section h2 { margin:0 0 12px; font-size:20px; }
    .table-wrap { overflow:auto; border-radius:16px; border:1px solid #1c304a; }
    table { width:100%; border-collapse:collapse; min-width:850px; background:#0a1524; }
    th,td { padding:13px 14px; text-align:right; border-bottom:1px solid #172a41; }
    th { color:#8fa4bf; font-size:12px; letter-spacing:.04em; background:#0d1b2d; position:sticky; top:0; }
    .badge { display:inline-flex; align-items:center; border-radius:999px; padding:5px 10px; font-size:12px; font-weight:700; }
    .ok { background:rgba(57,217,138,.14); color:#7ee2a8; }
    .no { background:rgba(255,99,99,.14); color:#ff8c8c; }
    .watch { background:rgba(255,191,71,.14); color:#ffd07a; }
    .score { font-weight:800; font-variant-numeric:tabular-nums; }
    .reason { max-width:380px; white-space:normal; color:#aebdd0; }
    button { border:1px solid #2b4566; background:#10233b; color:#e8eef8; border-radius:12px; padding:10px 14px; cursor:pointer; }
    button:hover { background:#16304f; }
    .empty { padding:30px; text-align:center; color:#8fa4bf; }
    @media(max-width:850px){ .grid{grid-template-columns:repeat(2,1fr)} header{align-items:flex-start;flex-direction:column} }
  </style>
</head>
<body>
  <main class="wrap">
    <header>
      <div><h1>MOE AI Control Center</h1><div class="muted">MOERAND + Brain + Risk + Webull Sandbox</div></div>
      <div><div class="live"><span class="dot"></span><span id="status">جاري الاتصال</span></div><button id="refresh">تحديث الآن</button></div>
    </header>
    <section class="grid">
      <div class="card"><div class="muted">القرارات</div><div class="metric" id="decisions">0</div></div>
      <div class="card"><div class="muted">المقبولة</div><div class="metric" id="accepted">0</div></div>
      <div class="card"><div class="muted">المرفوضة</div><div class="metric" id="rejected">0</div></div>
      <div class="card"><div class="muted">نسبة القبول</div><div class="metric" id="rate">0%</div></div>
    </section>
    <section class="section card">
      <h2>أفضل الفرص والقرارات</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>#</th><th>السهم</th><th>الحالة</th><th>الدرجة</th><th>الدخول</th><th>وقف الخسارة</th><th>الهدف</th><th>R:R</th><th>السبب</th><th>الوقت</th></tr></thead>
        <tbody id="opportunities"><tr><td colspan="10" class="empty">لا توجد بيانات بعد</td></tr></tbody>
      </table></div>
    </section>
  </main>
<script>
const money = new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
const date = new Intl.DateTimeFormat('ar-US',{dateStyle:'short',timeStyle:'short'});
function esc(v){return String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));}
function price(v){const n=Number(v);return Number.isFinite(n)&&n>0?money.format(n):'—';}
function state(item){if(item.submitted)return '<span class="badge ok">تم الإرسال</span>';if(item.accepted)return '<span class="badge ok">مقبولة</span>';return '<span class="badge no">مرفوضة</span>';}
async function load(){
  const status=document.getElementById('status'); status.textContent='جاري التحديث';
  try{
    const response=await fetch('/api/moe-ai/dashboard',{cache:'no-store'});
    if(!response.ok)throw new Error('HTTP '+response.status);
    const data=await response.json(); const t=data.totals||{};
    decisions.textContent=t.decisions||0; accepted.textContent=t.accepted||0; rejected.textContent=t.rejected||0; rate.textContent=(t.acceptanceRate||0)+'%';
    const rows=(data.topOpportunities||[]).map((item,index)=>{
      const reasons=[...(item.brain?.reasons||[]),...(item.brain?.rejectionReasons||[]),...(item.reasons||[])];
      return '<tr><td>'+(index+1)+'</td><td><strong>'+esc(item.symbol||'—')+'</strong></td><td>'+state(item)+'</td><td class="score">'+esc(item.displayScore||item.score||0)+'</td><td>'+price(item.entry)+'</td><td>'+price(item.stopLoss)+'</td><td>'+price(item.takeProfit)+'</td><td>'+esc(item.riskReward??item.brain?.riskReward??'—')+'</td><td class="reason">'+esc(reasons[0]||item.message||'لا يوجد سبب مسجل')+'</td><td>'+esc(item.createdAt?date.format(new Date(item.createdAt)):'—')+'</td></tr>';
    }).join('');
    opportunities.innerHTML=rows||'<tr><td colspan="10" class="empty">لا توجد قرارات مسجلة بعد. ستظهر النتائج بعد أول إشارة.</td></tr>';
    status.textContent='متصل • '+date.format(new Date(data.generatedAt));
  }catch(error){ status.textContent='تعذر تحميل البيانات'; console.error(error); }
}
refresh.addEventListener('click',load); load(); setInterval(load,30000);
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
