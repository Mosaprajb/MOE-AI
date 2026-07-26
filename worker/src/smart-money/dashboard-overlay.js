const OVERLAY_STYLE = `
<style id="smartMoneyObservationStyles">
.sm-observation-panel{margin-top:14px;padding:14px;border:1px solid rgba(67,121,161,.48);border-radius:14px;background:linear-gradient(145deg,rgba(8,29,47,.86),rgba(5,17,30,.92))}
.sm-observation-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}
.sm-observation-head h3{margin:4px 0 0;font-size:17px}.sm-observation-lock{padding:6px 9px;border-radius:999px;border:1px solid #28684c;background:rgba(40,119,82,.15);color:#83e9b2;font-size:10px;font-weight:900}
.sm-observation-summary{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:8px;margin-top:12px}.sm-observation-metric{padding:10px;border:1px solid rgba(52,88,124,.4);border-radius:11px;background:rgba(7,21,37,.68)}.sm-observation-metric span{display:block;color:#8fa4bf;font-size:10px}.sm-observation-metric strong{display:block;margin-top:5px;font-size:13px}
.sm-stage-distribution{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));gap:7px;margin-top:9px}.sm-stage-box{padding:8px;border:1px solid rgba(52,88,124,.36);border-radius:10px;background:rgba(5,18,32,.58);text-align:center}.sm-stage-box span{display:block;color:#7890aa;font-size:9px}.sm-stage-box strong{display:block;margin-top:4px;font-size:13px}
.sm-opportunity-list{display:grid;gap:8px;margin-top:12px}.sm-opportunity{display:grid;grid-template-columns:88px minmax(160px,1.2fr) repeat(5,minmax(78px,.55fr));gap:8px;align-items:center;padding:10px;border:1px solid rgba(52,88,124,.4);border-radius:11px;background:rgba(5,18,32,.7)}.sm-opportunity.passed{border-color:rgba(45,121,88,.72);background:rgba(8,35,29,.65)}.sm-opportunity-symbol{font-size:16px;font-weight:950}.sm-opportunity-family{font-size:11px;color:#a9bdd4}.sm-opportunity-cell span{display:block;color:#7890aa;font-size:9px}.sm-opportunity-cell strong{display:block;margin-top:3px;font-size:11px}.sm-observation-empty{padding:14px;text-align:center;color:#8fa4bf;border:1px dashed rgba(60,96,131,.45);border-radius:11px}.sm-stage-pass{color:#83e9b2}.sm-stage-fail{color:#ff9da7}.sm-stage-watch{color:#9cd3ff}
@media(max-width:1150px){.sm-observation-summary,.sm-stage-distribution{grid-template-columns:repeat(3,1fr)}.sm-opportunity{grid-template-columns:80px 1fr repeat(3,minmax(75px,.55fr))}.sm-opportunity-cell:nth-last-child(-n+2){display:none}}
@media(max-width:700px){.sm-observation-summary,.sm-stage-distribution{grid-template-columns:repeat(2,1fr)}.sm-opportunity{grid-template-columns:72px 1fr}.sm-opportunity-cell{display:none}}
</style>`;

const OVERLAY_SCRIPT = `
<script id="smartMoneyObservationScript">
(function(){
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
  const stageLabels={STOP_RUN:'STOP RUN',ABSORPTION:'ABSORPTION',IMBALANCE:'IMBALANCE',STRUCTURE_CONFIRMATION:'STRUCTURE',RISK_ENGINE:'RISK'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const cash=value=>Number.isFinite(Number(value))?money.format(Number(value)):'—';
  const number=(value,digits=1)=>Number.isFinite(Number(value))?Number(value).toFixed(digits):'—';
  function ensurePanel(){
    if(document.getElementById('smartMoneyObservationPanel'))return document.getElementById('smartMoneyObservationPanel');
    const scanner=document.getElementById('scanner');if(!scanner)return null;
    const panel=document.createElement('div');panel.id='smartMoneyObservationPanel';panel.className='sm-observation-panel';
    panel.innerHTML='<div class="sm-observation-head"><div><span class="eyebrow">INSTITUTIONAL FLOW PIPELINE</span><h3>Stop Run → Absorption → Imbalance → Structure → Risk</h3><p class="muted">كل سهم يمر بالمراحل بالترتيب. أي فشل يمنع المراحل التالية، ولا تُرسل هذه النتائج إلى الوسيط.</p></div><span class="sm-observation-lock">OBSERVATION ONLY</span></div><div id="smartMoneyObservationContent"><div class="sm-observation-empty">بانتظار أول فحص Institutional Flow.</div></div>';
    scanner.appendChild(panel);return panel;
  }
  function stageDistribution(latest){
    const order=Array.isArray(latest?.stageOrder)&&latest.stageOrder.length?latest.stageOrder:Object.keys(stageLabels);
    const values=latest?.stageDistribution||{};
    return '<div class="sm-stage-distribution">'+order.map(name=>'<div class="sm-stage-box"><span>'+esc(stageLabels[name]||name)+'</span><strong>'+esc(values[name]??0)+'</strong></div>').join('')+'</div>';
  }
  function render(status){
    ensurePanel();const content=document.getElementById('smartMoneyObservationContent');if(!content)return;
    const latest=status?.latest||null;const items=Array.isArray(latest?.topOpportunities)?latest.topOpportunities:[];
    const lastRun=latest?.recordedAt||latest?.evaluatedAt;
    const summary='<div class="sm-observation-summary"><div class="sm-observation-metric"><span>المحرك</span><strong>'+esc(latest?.engine||'INSTITUTIONAL FLOW')+'</strong></div><div class="sm-observation-metric"><span>الفريم</span><strong>'+esc(latest?.timeframe||'—')+'</strong></div><div class="sm-observation-metric"><span>الأسهم المحللة</span><strong>'+esc(latest?.evaluatedSymbols??0)+'</strong></div><div class="sm-observation-metric"><span>السلسلة المكتملة</span><strong>'+esc(latest?.completedCandidates??0)+'</strong></div><div class="sm-observation-metric"><span>آخر تحليل</span><strong>'+esc(lastRun?new Date(lastRun).toLocaleTimeString('en-US'):'—')+'</strong></div></div>';
    const distribution=stageDistribution(latest);
    if(!items.length){content.innerHTML=summary+distribution+'<div class="sm-observation-empty">لا توجد نتائج مؤهلة للعرض في آخر فحص.</div>';return;}
    const rows=items.map(item=>{
      const passed=item.pipelinePassed===true;const failed=item.failedStage||'NONE';const stage=item.currentStage||'STOP_RUN';
      return '<div class="sm-opportunity '+(passed?'passed':'')+'"><div><div class="sm-opportunity-symbol" dir="ltr">'+esc(item.symbol)+'</div><div class="sm-opportunity-family">'+esc(item.direction||'—')+' · '+esc(item.dataMode||'—')+'</div></div><div><strong>'+esc(passed?'PIPELINE COMPLETE':(item.reason||'PIPELINE REJECTED'))+'</strong><div class="sm-opportunity-family">'+esc(item.setupFamily||'INSTITUTIONAL FLOW')+'</div></div><div class="sm-opportunity-cell"><span>SCORE</span><strong>'+number(item.setupScore,1)+'</strong></div><div class="sm-opportunity-cell"><span>LAST PASSED</span><strong class="sm-stage-watch">'+esc(stageLabels[stage]||stage)+'</strong></div><div class="sm-opportunity-cell"><span>FAILED STAGE</span><strong class="'+(passed?'sm-stage-pass':'sm-stage-fail')+'">'+esc(passed?'NONE':(stageLabels[failed]||failed))+'</strong></div><div class="sm-opportunity-cell"><span>ENTRY / SL</span><strong dir="ltr">'+cash(item.entry)+' · '+cash(item.stopLoss)+'</strong></div><div class="sm-opportunity-cell"><span>TP / RR</span><strong dir="ltr">'+cash(item.takeProfit)+' · '+number(item.rewardRisk,2)+'</strong></div></div>';
    }).join('');
    content.innerHTML=summary+distribution+'<div class="sm-opportunity-list">'+rows+'</div>';
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
