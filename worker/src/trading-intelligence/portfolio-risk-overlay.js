const PORTFOLIO_STYLE = `
<style id="portfolioRiskStyles">
.pr-panel{margin-top:14px;padding:16px;border:1px solid rgba(74,116,153,.5);border-radius:18px;background:linear-gradient(145deg,rgba(8,27,45,.94),rgba(4,14,26,.98));color:#dbe8f5}.pr-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.pr-head h3{margin:4px 0 0;font-size:19px}.pr-kicker{font-size:9px;letter-spacing:.16em;color:#78a9d1;font-weight:900}.pr-state{padding:7px 10px;border:1px solid currentColor;border-radius:999px;font-size:10px;font-weight:900}.pr-state.NORMAL{color:#54dfa0}.pr-state.WARNING{color:#f5bf62}.pr-state.BLOCKED,.pr-state.CRITICAL{color:#ff7f8c}.pr-summary{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:8px;margin-top:13px}.pr-card{padding:10px;border:1px solid rgba(61,99,134,.42);border-radius:12px;background:rgba(6,20,35,.75);min-width:0}.pr-card span{display:block;color:#7f98b2;font-size:9px}.pr-card strong{display:block;margin-top:5px;font-size:13px;overflow-wrap:anywhere}.pr-layout{display:grid;grid-template-columns:minmax(260px,.8fr) minmax(0,1.2fr);gap:12px;margin-top:12px}.pr-box{padding:12px;border:1px solid rgba(61,99,134,.42);border-radius:13px;background:rgba(5,18,32,.72)}.pr-box h4{margin:0 0 9px;font-size:12px}.pr-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}.pr-metric{padding:8px;border:1px solid rgba(52,88,124,.34);border-radius:9px}.pr-metric span{display:block;color:#7890aa;font-size:8px}.pr-metric strong{display:block;margin-top:4px;font-size:11px}.pr-tags{display:flex;flex-wrap:wrap;gap:6px}.pr-tag{padding:6px 8px;border-radius:999px;border:1px solid rgba(72,107,140,.52);font-size:9px;color:#a9bdd1}.pr-tag.blocker{color:#ff9da7;border-color:#8a3b46}.pr-tag.warning{color:#f7cb7c;border-color:#8d6a2e}.pr-table{width:100%;border-collapse:collapse;font-size:9px}.pr-table th,.pr-table td{text-align:left;padding:7px;border-bottom:1px solid rgba(55,90,124,.34)}.pr-table th{color:#7890aa}.pr-note{margin-top:9px;color:#8fa4bf;font-size:9px;line-height:1.5}.pr-empty{padding:18px;text-align:center;color:#8fa4bf;border:1px dashed rgba(60,96,131,.45);border-radius:12px}.pr-error{color:#ff9da7}.pr-ok{color:#54dfa0}.pr-warn{color:#f5bf62}@media(max-width:1100px){.pr-summary{grid-template-columns:repeat(3,1fr)}}@media(max-width:800px){.pr-layout{grid-template-columns:1fr}.pr-summary{grid-template-columns:repeat(2,1fr)}}@media(max-width:520px){.pr-summary,.pr-grid{grid-template-columns:1fr}.pr-panel{padding:12px}.pr-table{font-size:8px}}
</style>`;

const PORTFOLIO_SCRIPT = `
<script id="portfolioRiskScript">
(function(){
  const money=new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',maximumFractionDigits:2});
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const cash=value=>Number.isFinite(Number(value))?money.format(Number(value)):'—';
  const number=(value,digits=2)=>Number.isFinite(Number(value))?Number(value).toFixed(digits):'—';
  const percent=value=>Number.isFinite(Number(value))?number(value,2)+'%':'—';
  const list=value=>Array.isArray(value)?value:[];
  const metric=(label,value)=>'<div class="pr-metric"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';
  const card=(label,value)=>'<div class="pr-card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';
  function panel(){
    let node=document.getElementById('portfolioRiskPanel');
    if(node)return node;
    node=document.createElement('section');
    node.id='portfolioRiskPanel';
    node.className='pr-panel';
    const anchor=document.querySelector('.sm-observation-panel')||document.querySelector('main')||document.body;
    if(anchor&&anchor.parentNode)anchor.parentNode.insertBefore(node,anchor.nextSibling);else document.body.appendChild(node);
    return node;
  }
  function tags(items,type){return list(items).map(item=>'<span class="pr-tag '+type+'">'+esc(String(item).replaceAll('_',' '))+'</span>').join('')||'<span class="pr-tag">NONE</span>';}
  function positions(items){
    const rows=list(items).slice(0,12).map(item=>'<tr><td>'+esc(item.symbol||'—')+'</td><td>'+esc(item.direction||'—')+'</td><td>'+cash(item.marketValue)+'</td><td>'+cash(item.openRisk)+'</td><td>'+esc(item.protectionStatus||'—')+'</td></tr>').join('');
    return rows?'<table class="pr-table"><thead><tr><th>SYMBOL</th><th>SIDE</th><th>VALUE</th><th>OPEN RISK</th><th>PROTECTION</th></tr></thead><tbody>'+rows+'</tbody></table>':'<div class="pr-empty">No open paper positions.</div>';
  }
  function render(risk){
    const node=panel();
    if(!risk){node.innerHTML='<div class="pr-empty">Portfolio risk intelligence is unavailable.</div>';return;}
    const capital=risk.capital||{},daily=risk.daily||{},exposure=risk.exposure||{},protection=risk.protection||{},data=risk.capitalData||{};
    const gate=risk.portfolioAcceptsNewRisk?'ALLOWED':'BLOCKED';
    node.innerHTML='<div class="pr-head"><div><div class="pr-kicker">PORTFOLIO & CAPITAL RISK</div><h3>Portfolio Risk Command Panel</h3></div><span class="pr-state '+esc(risk.status||'BLOCKED')+'">'+esc(risk.status||'BLOCKED')+'</span></div>'+
      '<div class="pr-summary">'+card('Risk Gate',gate)+card('Execution Permission','BLOCKED')+card('Buying Power',cash(capital.dayBuyingPower))+card('Net Liquidation',cash(capital.netLiquidation))+card('Daily P&L',cash(daily.realizedPnl))+card('Open Risk',cash(exposure.openRisk))+'</div>'+
      '<div class="pr-layout"><div class="pr-box"><h4>CAPITAL & DAILY LIMITS</h4><div class="pr-grid">'+
      metric('Cash Balance',cash(capital.cashBalance))+metric('Settled Cash',cash(capital.settledCash))+metric('Overnight BP',cash(capital.overnightBuyingPower))+metric('Deployed Capital',cash(capital.deployedCapital))+metric('Reserved Capital',cash(capital.reservedCapital))+metric('Remaining Loss Capacity',cash(daily.remainingLossCapacity))+metric('Daily Entries',String(daily.entries??'—'))+metric('Capital Coverage',percent(data.coveragePercent))+'</div><div class="pr-note">Source: '+esc(data.source||'UNAVAILABLE')+' · Age: '+esc(data.ageSeconds==null?'—':data.ageSeconds+'s')+' · Read-only paper intelligence.</div></div>'+
      '<div class="pr-box"><h4>EXPOSURE & PROTECTION</h4><div class="pr-grid">'+metric('Open Positions',String(exposure.openPositions??0))+metric('Active Reservations',String(exposure.activeReservations??0))+metric('Gross Exposure',cash(exposure.grossExposure))+metric('Risk / Equity',percent(exposure.openRiskPercentEquity))+metric('Largest Symbol',esc(exposure.largestSymbol||'—')+' '+percent(exposure.symbolConcentrationPercent))+metric('Sector Proxy',esc(exposure.largestSectorProxy||'—')+' '+percent(exposure.sectorProxyExposurePercent))+metric('Unprotected',String(protection.unprotectedPositions??0))+metric('Margin Hard Exit',String(protection.marginHardExitRequired??0))+'</div><div class="pr-note">Correlation exposure remains unavailable until a validated correlation matrix exists; sector exposure is shown only as a proxy.</div></div></div>'+
      '<div class="pr-layout"><div class="pr-box"><h4>BLOCKERS</h4><div class="pr-tags">'+tags(risk.blockers,'blocker')+'</div></div><div class="pr-box"><h4>WARNINGS</h4><div class="pr-tags">'+tags(risk.warnings,'warning')+'</div></div></div>'+
      '<div class="pr-box" style="margin-top:12px"><h4>OPEN PAPER POSITIONS</h4>'+positions(risk.positions)+'</div>';
  }
  async function refresh(){
    try{
      const response=await fetch('/api/trading-intelligence/portfolio-risk',{cache:'no-store'});
      const payload=await response.json();
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Portfolio risk request failed');
      render(payload.portfolioRisk);
    }catch(error){panel().innerHTML='<div class="pr-empty pr-error">Portfolio Risk unavailable: '+esc(error.message||error)+'</div>';}
  }
  refresh();
  setInterval(refresh,60000);
})();
</script>`;

export async function enhancePortfolioRiskDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('portfolioRiskScript')) return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  const enhanced = html
    .replace('</head>', `${PORTFOLIO_STYLE}</head>`)
    .replace('</body>', `${PORTFOLIO_SCRIPT}</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers });
}
