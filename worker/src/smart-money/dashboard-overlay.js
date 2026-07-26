const OVERLAY_STYLE = `
<style id="smartMoneyObservationStyles">
.sm-observation-panel{margin-top:14px;padding:14px;border:1px solid rgba(67,121,161,.48);border-radius:14px;background:linear-gradient(145deg,rgba(8,29,47,.86),rgba(5,17,30,.92))}
.sm-observation-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.sm-observation-head h3{margin:4px 0 0;font-size:17px}.sm-observation-lock{padding:6px 9px;border-radius:999px;border:1px solid #28684c;background:rgba(40,119,82,.15);color:#83e9b2;font-size:10px;font-weight:900}
.sm-observation-summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.sm-observation-metric{padding:10px;border:1px solid rgba(52,88,124,.4);border-radius:11px;background:rgba(7,21,37,.68)}.sm-observation-metric span{display:block;color:#8fa4bf;font-size:10px}.sm-observation-metric strong{display:block;margin-top:5px;font-size:13px}
.sm-opportunity-list{display:grid;gap:8px;margin-top:12px}.sm-opportunity{display:grid;grid-template-columns:90px minmax(150px,1fr) repeat(4,minmax(80px,.55fr));gap:8px;align-items:center;padding:10px;border:1px solid rgba(52,88,124,.4);border-radius:11px;background:rgba(5,18,32,.7)}.sm-opportunity-symbol{font-size:16px;font-weight:950}.sm-opportunity-family{font-size:11px;color:#a9bdd4}.sm-opportunity-cell span{display:block;color:#7890aa;font-size:9px}.sm-opportunity-cell strong{display:block;margin-top:3px;font-size:11px}.sm-observation-empty{padding:14px;text-align:center;color:#8fa4bf;border:1px dashed rgba(60,96,131,.45);border-radius:11px}
@media(max-width:1000px){.sm-observation-summary{grid-template-columns:repeat(2,1fr)}.sm-opportunity{grid-template-columns:80px 1fr repeat(2,minmax(75px,.55fr))}.sm-opportunity-cell:nth-last-child(-n+2){display:none}}
@media(max-width:620px){.sm-observation-summary{grid-template-columns:1fr}.sm-opportunity{grid-template-columns:72px 1fr}.sm-opportunity-cell{display:none}}
</style>`;

const OVERLAY_SCRIPT = `
<script id="smartMoneyObservationScript">
(function(){
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const cash=value=>Number.isFinite(Number(value))?money.format(Number(value)):'—';
  const number=(value,digits=1)=>Number.isFinite(Number(value))?Number(value).toFixed(digits):'—';
  function ensurePanel(){
    if(document.getElementById('smartMoneyObservationPanel'))return document.getElementById('smartMoneyObservationPanel');
    const scanner=document.getElementById('scanner');if(!scanner)return null;
    const panel=document.createElement('div');panel.id='smartMoneyObservationPanel';panel.className='sm-observation-panel';
    panel.innerHTML='<div class="sm-observation-head"><div><span class="eyebrow">SMART MONEY ENGINE</span><h3>أفضل فرص المراقبة المؤسسية</h3><p class="muted">تحليل فقط — لا يتم إرسال أي أمر من هذه النتائج.</p></div><span class="sm-observation-lock">OBSERVATION ONLY</span></div><div id="smartMoneyObservationContent"><div class="sm-observation-empty">بانتظار أول فحص Smart Money.</div></div>';
    scanner.appendChild(panel);return panel;
  }
  function render(status){
    ensurePanel();const content=document.getElementById('smartMoneyObservationContent');if(!content)return;
    const latest=status?.latest||null;const items=Array.isArray(latest?.topOpportunities)?latest.topOpportunities:[];
    const lastRun=latest?.recordedAt||latest?.evaluatedAt;const summary='<div class="sm-observation-summary"><div class="sm-observation-metric"><span>الحالة</span><strong>'+(status?.enabled?'ENABLED':'DISABLED')+'</strong></div><div class="sm-observation-metric"><span>الفريم</span><strong>'+esc(latest?.timeframe||'—')+'</strong></div><div class="sm-observation-metric"><span>الأسهم المحللة</span><strong>'+esc(latest?.evaluatedSymbols??0)+'</strong></div><div class="sm-observation-metric"><span>آخر تحليل</span><strong>'+esc(lastRun?new Date(lastRun).toLocaleTimeString('en-US'):'—')+'</strong></div></div>';
    if(!items.length){content.innerHTML=summary+'<div class="sm-observation-empty">لا توجد فرصة Smart Money مؤهلة في آخر فحص.</div>';return;}
    const rows=items.map(item=>'<div class="sm-opportunity"><div><div class="sm-opportunity-symbol" dir="ltr">'+esc(item.symbol)+'</div><div class="sm-opportunity-family">'+esc(item.direction||'—')+'</div></div><div><strong>'+esc(item.setupFamily||'UNCLASSIFIED')+'</strong><div class="sm-opportunity-family">'+esc(item.candidateState||'OBSERVATION')+'</div></div><div class="sm-opportunity-cell"><span>SCORE</span><strong>'+number(item.setupScore,1)+'</strong></div><div class="sm-opportunity-cell"><span>ENTRY</span><strong dir="ltr">'+cash(item.entry)+'</strong></div><div class="sm-opportunity-cell"><span>SL</span><strong dir="ltr">'+cash(item.stopLoss)+'</strong></div><div class="sm-opportunity-cell"><span>TP / RR</span><strong dir="ltr">'+cash(item.takeProfit)+' · '+number(item.rewardRisk,2)+'</strong></div></div>').join('');
    content.innerHTML=summary+'<div class="sm-opportunity-list">'+rows+'</div>';
  }
  async function load(){try{const response=await fetch('/api/scanner/status',{cache:'no-store'});const data=await response.json();if(response.ok&&data.ok)render(data.scanner?.smartMoneyObservation||null);}catch{ensurePanel();}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>{ensurePanel();load();});else{ensurePanel();load();}
  setInterval(load,60000);
})();
</script>`;

export async function enhanceSmartMoneyDashboard(response) {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('smartMoneyObservationScript')) return new Response(html, response);
  const withStyle = html.includes('</head>') ? html.replace('</head>', `${OVERLAY_STYLE}</head>`) : `${OVERLAY_STYLE}${html}`;
  const enhanced = withStyle.includes('</body>') ? withStyle.replace('</body>', `${OVERLAY_SCRIPT}</body>`) : `${withStyle}${OVERLAY_SCRIPT}`;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers });
}
