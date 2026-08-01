// Dashboard enhancement for Simulation Mode.
// The browser receives no API keys. The control PIN is submitted once over same-origin HTTPS,
// immediately cleared, and replaced by an HttpOnly cookie that JavaScript cannot read.

const STYLE = `
<style id="moeSimulationStyles">
:root{--sim-purple:#a56bff;--sim-deep:#27133f;--sim-border:rgba(178,116,255,.65)}
#moe-simulation-banner{display:none;position:sticky;top:0;z-index:500;padding:11px 16px;text-align:center;background:linear-gradient(90deg,#5d1ba7,#9b4dff,#5d1ba7);color:#fff;font-weight:1000;letter-spacing:.12em;box-shadow:0 8px 28px rgba(83,24,145,.48)}
body.moe-simulation-active #moe-simulation-banner{display:block}
.sim-panel{margin:14px 0;padding:17px;border:1px solid var(--sim-border);border-radius:18px;background:linear-gradient(145deg,rgba(37,16,62,.98),rgba(13,8,26,.99));color:#f0e7ff;box-shadow:0 14px 38px rgba(36,13,67,.28)}
.sim-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.sim-kicker{font-size:9px;letter-spacing:.18em;color:#c8a4ff;font-weight:1000}.sim-title{margin:5px 0 0;font-size:20px}.sim-safe{padding:6px 10px;border:1px solid #6fe0a3;border-radius:999px;color:#6fe0a3;font-size:9px;font-weight:900}
.sim-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:10px;margin-top:14px}.sim-box{padding:12px;border:1px solid rgba(187,135,255,.32);border-radius:13px;background:rgba(29,13,49,.72)}.sim-label{display:block;margin-bottom:7px;font-size:9px;letter-spacing:.1em;color:#bca6d9;font-weight:900}.sim-options{display:grid;gap:7px}.sim-option{display:flex;gap:8px;align-items:center;font-size:11px}.sim-option input{accent-color:#a56bff}.sim-select,.sim-pin{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid rgba(186,134,255,.46);border-radius:10px;background:#130b22;color:#f5efff;outline:none}.sim-buttons{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}.sim-button{padding:9px 13px;border:1px solid rgba(196,153,255,.7);border-radius:10px;background:#6f2ac2;color:#fff;font-size:10px;font-weight:900;cursor:pointer}.sim-button.secondary{background:transparent}.sim-button.danger{background:#6d2047;border-color:#d96ca7}.sim-button:disabled{opacity:.45;cursor:not-allowed}
.sim-status{margin-top:13px;display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}.sim-chip{padding:9px;border:1px solid rgba(184,130,255,.3);border-radius:10px;background:rgba(9,7,17,.55)}.sim-chip b{display:block;margin-top:4px;font-size:11px}.sim-running{color:#d8b7ff}.sim-error{margin-top:10px;color:#ff9fbd;font-size:10px}.sim-section{margin-top:16px}.sim-section h4{margin:0 0 8px;font-size:12px;color:#d6b6ff}.sim-table-wrap{overflow:auto;border:1px solid rgba(183,130,255,.3);border-radius:12px}.sim-table{width:100%;min-width:720px;border-collapse:collapse;font-size:10px}.sim-table th,.sim-table td{padding:9px;border-bottom:1px solid rgba(183,130,255,.2);text-align:left;white-space:nowrap}.sim-table th{font-size:8px;letter-spacing:.08em;color:#bca2dc;background:#140a24}.sim-table tr:last-child td{border-bottom:0}.sim-badge{display:inline-flex;padding:4px 7px;border-radius:999px;font-size:8px;font-weight:1000;border:1px solid currentColor}.sim-badge.fusion{color:#79b7ff}.sim-badge.moerand{color:#ffad67}.sim-badge.mode{color:#d5adff}.sim-timeline{display:grid;gap:6px;max-height:260px;overflow:auto}.sim-event{padding:8px 9px;border-left:3px solid #9751e8;background:rgba(19,10,34,.72);font-size:9px}.sim-report-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}.sim-report-card{padding:12px;border:1px solid rgba(184,130,255,.35);border-radius:13px;background:rgba(18,9,32,.7)}.sim-metrics{display:grid;grid-template-columns:repeat(3,1fr);gap:7px}.sim-metric{padding:8px;border-radius:9px;background:rgba(91,39,145,.25);font-size:8px;color:#bda7d6}.sim-metric b{display:block;margin-top:4px;font-size:12px;color:#fff}.dls-sim-strategy{min-width:118px}.dls-sim-heading{color:#c6a5ff!important}
@media(max-width:640px){.sim-panel{padding:12px}.sim-title{font-size:17px}.sim-metrics{grid-template-columns:repeat(2,1fr)}}
</style>`;

const SCRIPT = `
<script id="moeSimulationScript">
(function(){
  const endpoints={session:'/api/sandbox/simulate/session',start:'/api/sandbox/simulate/start',tick:'/api/sandbox/simulate/tick',stop:'/api/sandbox/simulate/stop',status:'/api/sandbox/simulate/status',report:'/api/sandbox/simulate/report'};
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const strategyClass=value=>String(value).includes('FUSION')?'fusion':'moerand';
  const badge=value=>'<span class="sim-badge '+strategyClass(value)+'">'+esc(value)+'</span>';
  let latest={status:'IDLE',active:false};let ticking=false;let lastTickAt=0;let errorText='';
  const draft={strategies:new Set(['FUSION_V2','MOERAND_SIMPLE_INTERNAL']),range:'LAST_SESSION',speedMultiplier:60};

  function ensureBanner(){let node=document.getElementById('moe-simulation-banner');if(node)return node;node=document.createElement('div');node.id='moe-simulation-banner';node.textContent='SIMULATION MODE — NOT REAL MARKET DATA';document.body.prepend(node);return node;}
  function ensurePanel(){let node=document.getElementById('moe-simulation-panel');if(node)return node;node=document.createElement('section');node.id='moe-simulation-panel';node.className='sim-panel';const scanner=document.getElementById('dashboard-live-scanner');const main=document.querySelector('main');if(scanner?.parentNode)scanner.parentNode.insertBefore(node,scanner);else if(main)main.insertBefore(node,main.firstChild);else document.body.appendChild(node);return node;}
  function checked(value){return draft.strategies.has(value)?'checked':'';}
  function selected(value,expected){return String(value)===String(expected)?'selected':'';}
  function syncDraftFromRun(){if(!latest.active)return;if(Array.isArray(latest.selectedStrategies)&&latest.selectedStrategies.length)draft.strategies=new Set(latest.selectedStrategies);if(latest.range)draft.range=latest.range;if(latest.speedMultiplier)draft.speedMultiplier=Number(latest.speedMultiplier);}
  function metric(label,value){return '<div class="sim-metric">'+esc(label)+'<b>'+esc(value??0)+'</b></div>';}
  function strategyReports(report){const items=Object.entries(report?.byStrategy||{});if(!items.length)return '<div class="sim-box">No simulation report is available yet.</div>';return '<div class="sim-report-grid">'+items.map(([name,m])=>'<article class="sim-report-card"><div>'+badge(name)+'</div><div class="sim-metrics" style="margin-top:9px">'+metric('DETECTED',m.detected)+metric('ACCEPTED',m.accepted)+metric('REJECTED',m.rejected)+metric('TRADES',m.executed)+metric('WINS',m.wins)+metric('LOSSES',m.losses)+metric('WIN RATE',Number(m.winRate||0).toFixed(2)+'%')+metric('REALIZED R',Number(m.realizedR||0).toFixed(3))+metric('AVG R',Number(m.averageR||0).toFixed(3))+'</div></article>').join('')+'</div>';}
  function tradeRows(items){return (items||[]).map(item=>'<tr><td>'+badge(item.sourceStrategy)+'</td><td>'+esc(item.symbol)+'</td><td>'+esc(item.status)+'</td><td>'+esc(Number(item.entry||0).toFixed(2))+'</td><td>'+esc(Number(item.stopLoss||0).toFixed(2))+'</td><td>'+esc(Number(item.takeProfit||0).toFixed(2))+'</td><td>'+esc(item.outcome||'—')+'</td><td>'+esc(item.realizedR==null?'—':Number(item.realizedR).toFixed(3))+'</td></tr>').join('');}
  function eventRows(items){return (items||[]).slice(0,60).map(item=>'<div class="sim-event"><b>'+esc(item.type)+'</b> · '+esc(item.strategy||'SYSTEM')+' · '+esc(item.symbol||'—')+' · simulated '+esc(new Date(item.simulatedAt||Date.now()).toLocaleString())+(item.outcome?' · '+esc(item.outcome)+' '+esc(item.realizedR)+'R':'')+'</div>').join('')||'<div class="sim-box">No simulation events yet.</div>';}

  function bindDraftControls(){
    document.querySelectorAll('input[name="sim-strategy"]').forEach(node=>node.addEventListener('change',()=>{if(node.checked)draft.strategies.add(node.value);else draft.strategies.delete(node.value);}));
    document.getElementById('sim-range')?.addEventListener('change',event=>{draft.range=event.target.value;});
    document.getElementById('sim-speed')?.addEventListener('change',event=>{draft.speedMultiplier=Number(event.target.value||60);});
  }

  function render(){
    syncDraftFromRun();ensureBanner();const panel=ensurePanel();const active=latest.active===true;document.body.classList.toggle('moe-simulation-active',active);
    const selectedStrategies=active?(latest.selectedStrategies||[]):[...draft.strategies];const strategyLabel=selectedStrategies.map(badge).join(' ');
    const activeRows=tradeRows(latest.activeTrades);const closedRows=tradeRows(latest.completedTrades);
    panel.innerHTML='<div class="sim-head"><div><div class="sim-kicker">HISTORICAL REPLAY · LOCAL BROKER</div><h3 class="sim-title">Simulation Mode</h3></div><span class="sim-safe">LIVE LOCKED · ZERO WEBULL REQUESTS</span></div>'+
      '<div class="sim-grid"><div class="sim-box"><span class="sim-label">STRATEGIES FOR THIS RUN</span><div class="sim-options"><label class="sim-option"><input type="checkbox" name="sim-strategy" value="FUSION_V2" '+checked('FUSION_V2')+' '+(active?'disabled':'')+'> FUSION_V2</label><label class="sim-option"><input type="checkbox" name="sim-strategy" value="MOERAND_SIMPLE_INTERNAL" '+checked('MOERAND_SIMPLE_INTERNAL')+' '+(active?'disabled':'')+'> MOERAND_SIMPLE_INTERNAL</label></div></div>'+
      '<div class="sim-box"><label class="sim-label" for="sim-range">HISTORICAL RANGE</label><select class="sim-select" id="sim-range" '+(active?'disabled':'')+'><option value="LAST_SESSION" '+selected(draft.range,'LAST_SESSION')+'>Last completed session</option><option value="LAST_3_DAYS" '+selected(draft.range,'LAST_3_DAYS')+'>Last 3 completed sessions</option></select></div>'+
      '<div class="sim-box"><label class="sim-label" for="sim-speed">REPLAY SPEED</label><select class="sim-select" id="sim-speed" '+(active?'disabled':'')+'><option value="60" '+selected(draft.speedMultiplier,60)+'>60x — one 5m candle every 5s</option><option value="300" '+selected(draft.speedMultiplier,300)+'>300x — one 5m candle every 1s</option></select></div>'+
      '<div class="sim-box"><label class="sim-label" for="sim-pin">SIMULATION CONTROL PIN</label><input class="sim-pin" id="sim-pin" type="password" autocomplete="one-time-code" placeholder="Not stored in browser" '+(active?'disabled':'')+'></div></div>'+
      '<div class="sim-buttons"><button class="sim-button" id="sim-start" '+(active?'disabled':'')+'>Start Simulation</button><button class="sim-button danger" id="sim-stop" '+(!active?'disabled':'')+'>Stop Simulation</button><button class="sim-button secondary" id="sim-export" '+(!latest.report?'disabled':'')+'>Export labelled JSON report</button></div>'+
      (errorText?'<div class="sim-error">'+esc(errorText)+'</div>':'')+
      '<div class="sim-status"><div class="sim-chip">STATUS<b class="'+(active?'sim-running':'')+'">'+esc(latest.status||'IDLE')+'</b></div><div class="sim-chip">SIMULATING<b>'+(strategyLabel||'—')+'</b></div><div class="sim-chip">SIMULATED TIME<b>'+esc(latest.simulatedAt?new Date(latest.simulatedAt).toLocaleString():'—')+'</b></div><div class="sim-chip">SPEED<b>'+esc(latest.speedMultiplier||draft.speedMultiplier)+'x</b></div><div class="sim-chip">PROGRESS<b>'+esc(latest.progressPercent||0)+'%</b></div><div class="sim-chip">BROKER<b>LOCAL ONLY</b></div></div>'+
      '<section class="sim-section"><h4>Active simulated trade</h4><div class="sim-table-wrap"><table class="sim-table"><thead><tr><th>STRATEGY</th><th>SYMBOL</th><th>STATUS</th><th>ENTRY</th><th>STOP</th><th>TARGET</th><th>OUTCOME</th><th>R</th></tr></thead><tbody>'+(activeRows||'<tr><td colspan="8">No active simulated trade.</td></tr>')+'</tbody></table></div></section>'+
      '<section class="sim-section"><h4>Simulation timeline</h4><div class="sim-timeline">'+eventRows(latest.timeline)+'</div></section>'+
      '<section class="sim-section"><h4>End-of-simulation comparison</h4>'+strategyReports(latest.report)+'</section>'+
      '<section class="sim-section"><h4>Completed simulated trades</h4><div class="sim-table-wrap"><table class="sim-table"><thead><tr><th>STRATEGY</th><th>SYMBOL</th><th>STATUS</th><th>ENTRY</th><th>STOP</th><th>TARGET</th><th>OUTCOME</th><th>R</th></tr></thead><tbody>'+(closedRows||'<tr><td colspan="8">No completed simulated trades.</td></tr>')+'</tbody></table></div></section>';
    bindDraftControls();
    document.getElementById('sim-start')?.addEventListener('click',start);
    document.getElementById('sim-stop')?.addEventListener('click',stop);
    document.getElementById('sim-export')?.addEventListener('click',exportReport);
    decorateLiveScanner();
  }

  async function jsonRequest(url,options={}){const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.ok===false)throw new Error(payload.error||payload.code||('Request failed '+response.status));return payload;}
  async function refresh(){try{const payload=await jsonRequest(endpoints.status);latest=payload.simulation||payload;errorText='';if(document.activeElement?.id!=='sim-pin')render();}catch(error){errorText=error.message||String(error);render();}}
  async function start(){try{const pin=document.getElementById('sim-pin')?.value||'';const strategies=[...draft.strategies];if(!strategies.length)throw new Error('Select at least one strategy.');await jsonRequest(endpoints.session,{method:'POST',body:JSON.stringify({pin})});const pinNode=document.getElementById('sim-pin');if(pinNode)pinNode.value='';const payload=await jsonRequest(endpoints.start,{method:'POST',body:JSON.stringify({strategies,range:draft.range,speedMultiplier:draft.speedMultiplier})});latest=payload.simulation;lastTickAt=0;errorText='';render();}catch(error){errorText=error.message||String(error);render();}}
  async function stop(){try{const payload=await jsonRequest(endpoints.stop,{method:'POST',body:'{}'});latest=payload.simulation;errorText='';render();if(window.refreshDashboardLiveScanner)window.refreshDashboardLiveScanner();}catch(error){errorText=error.message||String(error);render();}}
  async function exportReport(){try{const response=await fetch(endpoints.report,{cache:'no-store',credentials:'same-origin'});if(!response.ok)throw new Error('Report export failed');const blob=await response.blob();const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download='MOE-SIMULATION-'+(latest.runId||Date.now())+'.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}catch(error){errorText=error.message||String(error);render();}}
  async function maybeTick(){if(!latest.active||ticking)return;const interval=Math.max(1000,Number(latest.tickIntervalMs||5000));if(Date.now()-lastTickAt<interval)return;ticking=true;lastTickAt=Date.now();try{const payload=await jsonRequest(endpoints.tick,{method:'POST',body:'{}'});latest=payload.simulation;errorText='';render();if(window.refreshDashboardLiveScanner)window.refreshDashboardLiveScanner();}catch(error){errorText=error.message||String(error);render();}finally{ticking=false;}}
  function decorateLiveScanner(){if(!latest.active)return;const table=document.querySelector('#dashboard-live-scanner table');if(!table)return;const head=table.querySelector('thead tr');if(head&&!head.querySelector('.dls-sim-heading')){const th=document.createElement('th');th.className='dls-sim-heading';th.textContent='STRATEGY';head.children[1]?.after(th);}const sourceRows=latest.liveScanner?.rows||[];[...table.querySelectorAll('tbody tr')].forEach((row,index)=>{row.querySelector('.dls-sim-strategy')?.remove();const td=document.createElement('td');td.className='dls-sim-strategy';td.innerHTML=sourceRows[index]?badge(sourceRows[index].sourceStrategy):badge('SIMULATION');row.children[1]?.after(td);});}

  ensureBanner();ensurePanel();refresh();setInterval(refresh,3000);setInterval(maybeTick,500);const observer=new MutationObserver(()=>decorateLiveScanner());observer.observe(document.documentElement,{subtree:true,childList:true});
})();
</script>`;

export async function enhanceSimulationDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('moeSimulationScript')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const enhanced = html
    .replace('</head>', `${STYLE}</head>`)
    .replace('</body>', `${SCRIPT}</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers });
}
