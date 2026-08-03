const VISIBLE_UI_MARKER = 'moe-mobile-scanner-visible-ui';

const VISIBLE_UI_STYLE = String.raw`
<style id="moe-mobile-scanner-visible-ui-style">
.moe-visible-monitor{margin-top:16px;padding:15px;border:1px solid var(--line);border-radius:18px;background:var(--panel-2)}
.moe-visible-monitor-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px}
.moe-visible-monitor-title{font-size:13px;font-weight:900;letter-spacing:.09em;text-transform:uppercase;color:var(--muted)}
.moe-visible-monitor-refresh{width:auto;padding:10px 12px;border-radius:12px;font-size:13px;justify-content:center}
.moe-visible-monitor-symbol{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:12px;color:var(--muted);margin-bottom:2px}
.moe-visible-monitor-price{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:32px;font-weight:700;color:var(--accent);line-height:1.15}
.moe-visible-monitor-meta{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:11px;color:var(--muted);margin-top:5px;overflow-wrap:anywhere}
.moe-visible-monitor-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:14px}
.moe-visible-monitor-cell{padding:11px 7px;border:1px solid var(--line);border-radius:13px;background:var(--panel);text-align:center;min-width:0}
.moe-visible-monitor-cell span{display:block;font-size:9px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:5px}
.moe-visible-monitor-cell b{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:14px;white-space:nowrap}
.moe-visible-ready{margin-top:14px}
.moe-visible-ready-top{display:flex;justify-content:space-between;gap:10px;font-size:12px}
.moe-visible-ready-top b{font-family:'IBM Plex Mono',ui-monospace,monospace}
.moe-visible-ready-track{height:12px;margin-top:7px;border-radius:99px;background:var(--panel);border:1px solid var(--line);overflow:hidden}
.moe-visible-ready-fill{height:100%;width:0;border-radius:99px;background:var(--red);transition:width .4s ease,background-color .4s ease}
.moe-visible-ready-note{font-size:11px;color:var(--muted);margin-top:7px}
.moe-visible-activity-tools{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px}
.moe-visible-activity-tools .btn{padding:13px;font-size:14px;justify-content:center}
#chips .chip[data-monitor-selected="true"],#chips2 .chip[data-monitor-selected="true"]{box-shadow:0 0 0 2px var(--text);transform:translateY(-1px)}
@media(max-width:390px){.moe-visible-monitor-grid{grid-template-columns:1fr}.moe-visible-monitor-cell{text-align:left}.moe-visible-monitor-cell span,.moe-visible-monitor-cell b{display:inline}.moe-visible-monitor-cell span{margin-right:8px}}
</style>`;

const VISIBLE_UI_SCRIPT = String.raw`
<script id="${VISIBLE_UI_MARKER}">
(function(){
  if(window.__moeMobileScannerVisibleUi)return;
  window.__moeMobileScannerVisibleUi=true;
  const MONITOR_ENDPOINT='/api/scanner/monitor';
  const ACTIVITY_ENDPOINT='/api/scanner/live-activity';
  const SYMBOL_KEY='moe-mobile-monitor-symbol-v2';
  const CLEAR_KEY='moe-mobile-activity-cleared-at-v2';
  let selectedSymbol='';
  let monitorLoading=false;
  let activityLoading=false;

  function node(id){return document.getElementById(id);}
  function safe(value){return String(value??'').replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[char];});}
  function money(value){const parsed=Number(value);return Number.isFinite(parsed)?'$'+parsed.toFixed(2):'—';}
  function symbols(){
    const values=Array.from(document.querySelectorAll('#chips [data-rm]')).map(function(button){return String(button.dataset.rm||'').trim().toUpperCase();}).filter(Boolean);
    return Array.from(new Set(values));
  }
  function savedSymbol(){try{return String(localStorage.getItem(SYMBOL_KEY)||'').toUpperCase();}catch(_){return '';}}
  function saveSymbol(value){try{localStorage.setItem(SYMBOL_KEY,value);}catch(_){}}

  function monitorMarkup(location){
    return '<section class="moe-visible-monitor" data-moe-monitor-location="'+location+'">'+
      '<div class="moe-visible-monitor-head"><div class="moe-visible-monitor-title">Selected symbol live monitor</div><button type="button" class="btn moe-visible-monitor-refresh" data-moe-monitor-refresh>↻ Refresh</button></div>'+
      '<div class="moe-visible-monitor-symbol" data-moe-monitor-field="symbol">No symbol selected</div>'+
      '<div class="moe-visible-monitor-price" data-moe-monitor-field="price">—</div>'+
      '<div class="moe-visible-monitor-meta" data-moe-monitor-field="meta">Choose a ticker to load its live quote.</div>'+
      '<div class="moe-visible-monitor-grid"><div class="moe-visible-monitor-cell"><span>Entry</span><b data-moe-monitor-field="entry">—</b></div><div class="moe-visible-monitor-cell"><span>Target / exit</span><b data-moe-monitor-field="exit">—</b></div><div class="moe-visible-monitor-cell"><span>Stop loss</span><b data-moe-monitor-field="stop">—</b></div></div>'+
      '<div class="moe-visible-ready"><div class="moe-visible-ready-top"><span data-moe-monitor-field="stage">Waiting for symbol</span><b data-moe-monitor-field="percent">0%</b></div><div class="moe-visible-ready-track"><div class="moe-visible-ready-fill" data-moe-monitor-field="fill"></div></div><div class="moe-visible-ready-note" data-moe-monitor-field="note">Execution prices appear only after the scanner builds a valid protected setup.</div></div>'+
      '</section>';
  }

  function ensureMainMonitor(){
    if(document.querySelector('[data-moe-monitor-location="main"]'))return;
    const chips=node('chips');
    const card=chips?.closest('.card');
    const stack=card?.querySelector('.stack');
    if(!chips||!card)return;
    const holder=document.createElement('div');holder.innerHTML=monitorMarkup('main');
    const panel=holder.firstElementChild;
    stack?card.insertBefore(panel,stack):chips.insertAdjacentElement('afterend',panel);
  }

  function ensureScannerMonitor(){
    if(document.querySelector('[data-moe-monitor-location="scanner"]'))return;
    const body=document.querySelector('#sheetScanner .sheet-body');if(!body)return;
    const holder=document.createElement('div');holder.innerHTML=monitorMarkup('scanner');
    body.insertBefore(holder.firstElementChild,body.firstChild);
  }

  function ensureActivityTools(){
    if(node('moeActivityToolsVisible'))return;
    const body=document.querySelector('#sheetActivity .sheet-body');
    const list=node('activityList');
    if(!body||!list)return;
    const tools=document.createElement('div');
    tools.id='moeActivityToolsVisible';tools.className='moe-visible-activity-tools';
    tools.innerHTML='<button type="button" class="btn" id="moeActivityRefreshVisible">↻ Refresh</button><button type="button" class="btn ghost" id="moeActivityClearVisible">Clear old</button>';
    body.insertBefore(tools,list);
    node('moeActivityRefreshVisible').addEventListener('click',function(){refreshActivity(true);});
    node('moeActivityClearVisible').addEventListener('click',function(){
      try{localStorage.setItem(CLEAR_KEY,String(Date.now()));}catch(_){}
      list.innerHTML='<div class="empty">Old activity cleared from this screen. New scanner events will appear here.</div>';
    });
  }

  function fields(name){return Array.from(document.querySelectorAll('[data-moe-monitor-field="'+name+'"]'));}
  function text(name,value){fields(name).forEach(function(element){element.textContent=value;});}
  function paintSelectedChips(){
    document.querySelectorAll('#chips .chip,#chips2 .chip').forEach(function(chip){
      const value=String(chip.querySelector('[data-rm]')?.dataset.rm||'').toUpperCase();
      chip.dataset.monitorSelected=String(Boolean(selectedSymbol&&value===selectedSymbol));
    });
  }

  function syncSelectedSymbol(preferred){
    const list=symbols();
    const candidate=String(preferred||'').toUpperCase();
    if(candidate&&list.includes(candidate))selectedSymbol=candidate;
    if(!list.includes(selectedSymbol)){
      const saved=savedSymbol();selectedSymbol=list.includes(saved)?saved:(list[0]||'');
    }
    saveSymbol(selectedSymbol);paintSelectedChips();text('symbol',selectedSymbol||'No symbol selected');
    return selectedSymbol;
  }

  function setLoading(message){
    text('symbol',selectedSymbol||'No symbol selected');
    text('meta',message);
    document.querySelectorAll('[data-moe-monitor-refresh]').forEach(function(button){button.disabled=true;});
  }

  function renderMonitor(payload){
    const quote=payload.quote||{},plan=payload.plan||null,ready=payload.readiness||{};
    text('symbol',(payload.symbol||selectedSymbol)+' · live quote');
    text('price',money(quote.price));
    const updated=quote.updatedAt?new Date(quote.updatedAt).toLocaleTimeString('en-US',{hour12:false}):'—';
    text('meta',(quote.feed||'ALPACA')+' · Bid '+money(quote.bid)+' · Ask '+money(quote.ask)+' · '+updated);
    text('entry',plan?money(plan.entryPrice):'Not ready');
    text('exit',plan?money(plan.exitPrice):'Not ready');
    text('stop',plan?money(plan.stopLossPrice):'Not ready');
    text('stage',ready.stage||payload.scanner?.reason||'Scanning selected symbol');
    const percent=Math.max(0,Math.min(100,Number(ready.percent)||0));
    text('percent',Math.round(percent)+'%');
    fields('fill').forEach(function(fill){fill.style.width=percent+'%';fill.style.background=percent>=90?'var(--green)':percent>=60?'var(--amber)':'var(--red)';});
    text('note',plan?'Protected Paper plan from the current scanner signal.':'No executable setup yet. Entry, target, and stop will appear when all scanner gates pass.');
  }

  async function refreshMonitor(force){
    ensureAll();
    syncSelectedSymbol();
    if(!selectedSymbol){text('price','—');text('meta','Choose a ticker to load its live quote.');return;}
    if(monitorLoading&&!force)return;
    monitorLoading=true;setLoading('Refreshing '+selectedSymbol+' live quote…');
    try{
      const response=await fetch(MONITOR_ENDPOINT+'?symbol='+encodeURIComponent(selectedSymbol)+'&t='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});
      const payload=await response.json().catch(function(){return {};});
      if(!response.ok||payload.ok===false)throw new Error(payload.error||'Scanner monitor unavailable');
      renderMonitor(payload);
    }catch(error){
      text('price','—');text('meta',error?.message||'Live monitor unavailable');text('stage','Monitor unavailable');
    }finally{
      monitorLoading=false;document.querySelectorAll('[data-moe-monitor-refresh]').forEach(function(button){button.disabled=false;});
    }
  }

  async function refreshActivity(manual){
    ensureActivityTools();if(activityLoading)return;
    activityLoading=true;
    const button=node('moeActivityRefreshVisible');if(button&&manual){button.disabled=true;button.textContent='Refreshing…';}
    try{
      const response=await fetch(ACTIVITY_ENDPOINT+'?t='+Date.now(),{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});
      const payload=await response.json().catch(function(){return {};});
      if(!response.ok||payload.ok===false)throw new Error(payload.error||'Activity unavailable');
      let cutoff=0;try{cutoff=Number(localStorage.getItem(CLEAR_KEY)||0);}catch(_){}
      const items=(payload.events||payload.activity||payload.items||[]).filter(function(item){const time=Date.parse(item.createdAt||item.timestamp||0);return !cutoff||!Number.isFinite(time)||time>cutoff;}).slice(0,100);
      node('activityList').innerHTML=items.length?'<div class="log">'+items.map(function(item){
        const stamp=item.createdAt||item.timestamp;const time=stamp?new Date(stamp).toLocaleTimeString('en-US',{hour12:false}):'';
        return '<div><b>'+safe(time)+'</b> '+safe(item.type||item.event||'')+' '+safe(item.symbol||'')+' '+safe(item.reason||item.message||'')+'</div>';
      }).join('')+'</div>':'<div class="empty">No new activity after the last clear.</div>';
    }catch(error){node('activityList').innerHTML='<div class="empty">'+safe(error?.message||'Activity is unavailable right now.')+'</div>';}
    finally{activityLoading=false;if(button&&manual){button.disabled=false;button.textContent='↻ Refresh';}}
  }

  function ensureAll(){
    ensureMainMonitor();ensureScannerMonitor();ensureActivityTools();
    document.querySelectorAll('[data-moe-monitor-refresh]').forEach(function(button){
      if(button.dataset.bound==='1')return;button.dataset.bound='1';button.addEventListener('click',function(){refreshMonitor(true);});
    });
  }

  function install(){
    ensureAll();syncSelectedSymbol();
    node('chips')?.addEventListener('click',function(event){
      if(event.target.closest('[data-rm]'))return;
      const chip=event.target.closest('.chip');const value=chip?.querySelector('[data-rm]')?.dataset.rm;
      if(value){syncSelectedSymbol(value);refreshMonitor(true);}
    });
    node('openScanner')?.addEventListener('click',function(){setTimeout(function(){ensureAll();refreshMonitor(true);},0);});
    node('openActivity')?.addEventListener('click',function(){setTimeout(function(){ensureAll();refreshActivity(false);},0);});
    const chips=node('chips');if(chips)new MutationObserver(function(){const before=selectedSymbol;syncSelectedSymbol();if(selectedSymbol&&selectedSymbol!==before)refreshMonitor(true);}).observe(chips,{childList:true,subtree:true});
    new MutationObserver(ensureAll).observe(document.body,{childList:true,subtree:true});
    refreshMonitor(true);
    clearInterval(window.__moeVisibleMonitorTick);
    window.__moeVisibleMonitorTick=setInterval(function(){if(!document.hidden)refreshMonitor(false);},3000);
    document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshMonitor(true);});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
</script>`;

export async function enhanceMobileScannerVisibleUi(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  if (html.includes(`id="${VISIBLE_UI_MARKER}"`)) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const enhanced = html
    .replace('</head>', `${VISIBLE_UI_STYLE}\n</head>`)
    .replace('</body>', `${VISIBLE_UI_SCRIPT}\n</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-moe-mobile-scanner-visible-ui', 'enabled');
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
