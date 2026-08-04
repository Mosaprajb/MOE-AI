import {
  scannerOnlyHtml,
  tradingViewDashboardHtml as baseTradingViewDashboardHtml,
} from './tradingview-only-dashboard.js';

export { scannerOnlyHtml };

const ENHANCEMENT = String.raw`
<script id="moe-tradingview-final-ui">
(function(){
  if(window.__moeTradingViewFinalUi) return;
  window.__moeTradingViewFinalUi=true;
  let initialized=false;
  let latestAuditId=null;
  let archiveObserver=null;

  function notify(message){
    const toast=document.getElementById('toast');
    if(!toast) return;
    toast.textContent=message;
    toast.classList.add('on');
    clearTimeout(window.__moeTvToastTimer);
    window.__moeTvToastTimer=setTimeout(function(){toast.classList.remove('on');},4200);
  }

  function eventMessage(event){
    const type=String(event?.type||'').toUpperCase();
    const symbol=String(event?.symbol||'').toUpperCase();
    if(type==='TRADINGVIEW_POSITION_OPENED') return symbol+' position opened';
    if(type==='TRAILING_STOP_PLACED') return symbol+' trailing stop activated';
    if(type==='TRAILING_STOP_RAISED') return symbol+' stop raised to $'+Number(event.currentStopPrice||0).toFixed(2);
    if(type==='TRADINGVIEW_POSITION_CLOSED') return symbol+' position closed · '+String(event.exitReason||'EXIT');
    if(type==='TRADINGVIEW_ALERT_PROCESSING_FAILED') return symbol+' alert failed · '+String(event.error||'broker error');
    if(type==='KILL_SWITCH_EXIT_RETRIED') return symbol+' emergency exit retried';
    return '';
  }

  async function pollImportantEvents(){
    try{
      const response=await fetch('/api/tradingview/audit',{cache:'no-store',credentials:'same-origin',headers:{'x-moe-mobile-client':'1'}});
      if(!response.ok) return;
      const payload=await response.json();
      const event=Array.isArray(payload.audit)?payload.audit[0]:null;
      if(!event) return;
      if(!initialized){latestAuditId=event.id;initialized=true;return;}
      if(event.id&&event.id!==latestAuditId){
        latestAuditId=event.id;
        const message=eventMessage(event);
        if(message) notify(message);
      }
    }catch(_){}
  }

  function addSortControl(){
    const exportButton=document.getElementById('csv');
    if(!exportButton||document.getElementById('archiveSort')) return;
    const select=document.createElement('select');
    select.id='archiveSort';
    select.innerHTML='<option value="DATE_DESC">Newest first</option><option value="DATE_ASC">Oldest first</option><option value="PNL_DESC">Highest P/L</option><option value="PNL_ASC">Lowest P/L</option><option value="TICKER">Ticker</option>';
    exportButton.insertAdjacentElement('beforebegin',select);
    select.addEventListener('change',sortArchiveRows);
  }

  function numericCell(row,index){
    return Number(String(row.cells[index]?.textContent||'').replace(/[^0-9+.-]/g,''))||0;
  }

  function sortArchiveRows(){
    const body=document.getElementById('archiveRows');
    const select=document.getElementById('archiveSort');
    if(!body||!select) return;
    const current=Array.from(body.querySelectorAll('tr')).filter(function(row){return row.cells.length>=8;});
    const sorted=current.slice();
    const mode=select.value;
    sorted.sort(function(a,b){
      if(mode==='DATE_ASC'||mode==='DATE_DESC'){
        const av=Date.parse(a.cells[0]?.textContent||'')||0;
        const bv=Date.parse(b.cells[0]?.textContent||'')||0;
        return mode==='DATE_ASC'?av-bv:bv-av;
      }
      if(mode==='PNL_ASC'||mode==='PNL_DESC'){
        const av=numericCell(a,5),bv=numericCell(b,5);
        return mode==='PNL_ASC'?av-bv:bv-av;
      }
      return String(a.cells[1]?.textContent||'').localeCompare(String(b.cells[1]?.textContent||''));
    });
    const changed=sorted.some(function(row,index){return row!==current[index];});
    if(!changed) return;
    if(archiveObserver) archiveObserver.disconnect();
    sorted.forEach(function(row){body.appendChild(row);});
    if(archiveObserver) archiveObserver.observe(body,{childList:true});
  }

  function observeArchive(){
    const body=document.getElementById('archiveRows');
    if(!body) return;
    archiveObserver=new MutationObserver(sortArchiveRows);
    archiveObserver.observe(body,{childList:true});
  }

  function start(){
    addSortControl();
    observeArchive();
    pollImportantEvents();
    setInterval(function(){if(!document.hidden) pollImportantEvents();},2500);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
</script>`;

export function tradingViewDashboardHtml() {
  const html = baseTradingViewDashboardHtml();
  return html.includes('</body>')
    ? html.replace('</body>', `${ENHANCEMENT}\n</body>`)
    : `${html}\n${ENHANCEMENT}`;
}
