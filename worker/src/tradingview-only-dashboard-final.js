import {
  scannerOnlyHtml,
  tradingViewDashboardHtml as baseTradingViewDashboardHtml,
} from './tradingview-only-dashboard.js';

export { scannerOnlyHtml };

const ENHANCEMENT = `
<style id="moe-tradingview-v2-style">
@keyframes moeConnectionPulse{0%,100%{transform:scale(.85);opacity:.7;box-shadow:0 0 0 0 rgba(74,222,128,.45)}50%{transform:scale(1.18);opacity:1;box-shadow:0 0 0 8px rgba(74,222,128,0)}}
.connectionLine{display:flex;align-items:center;gap:8px;min-height:20px;font-size:12px;color:var(--m)}
.connectionLine strong{color:var(--t)}
.connectionDot{width:10px;height:10px;border-radius:50%;display:inline-block;flex:none}
.connectionDot.online{background:var(--g);animation:moeConnectionPulse 1.35s ease-in-out infinite}
.connectionDot.offline{background:var(--r);box-shadow:0 0 0 3px rgba(251,113,133,.12)}
.connectionDetail{color:var(--m);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.sessionOpen{color:var(--g)}.sessionClosed{color:var(--r)}
.ruleBox{margin-top:10px;padding:10px;border:1px solid var(--l);border-radius:12px;background:#08131d;color:var(--m);font-size:11px;line-height:1.5}
.ruleBox b{color:var(--t)}
.fieldHint{display:block;color:var(--m);font-size:10px;margin-top:3px}
#marketCountdown,#flattenCountdown{font-variant-numeric:tabular-nums}
</style>
<script id="moe-tradingview-final-ui">
(function(){
  if(window.__moeTradingViewFinalUi) return;
  window.__moeTradingViewFinalUi=true;

  var nativeFetch=window.fetch.bind(window);
  var latestStatus=null;
  var initialized=false;
  var latestAuditId=null;
  var archiveObserver=null;
  var drafts=Object.create(null);
  var dirty=new Set();
  var saving=false;
  var fieldMap={
    size:'positionSizeDollars',
    tp:'takeProfitDollars',
    sl:'stopLossDollars',
    daily:'maxDailyLossDollars',
    maxOpen:'maxOpenPositions',
    account:'accountType',
    trailing:'trailingEnabled',
    tradingMode:'tradingMode',
    maxBpPercent:'maxBuyingPowerPercent',
    orderSession:'session',
    autoFlattenTime:'autoFlattenTimeLocal'
  };

  function byId(id){return document.getElementById(id)}
  function notify(message){
    var toast=byId('toast');
    if(!toast) return;
    toast.textContent=message;
    toast.classList.add('on');
    clearTimeout(window.__moeTvToastTimer);
    window.__moeTvToastTimer=setTimeout(function(){toast.classList.remove('on')},4200);
  }
  function escapeHtml(value){
    return String(value==null?'':value).replace(/[&<>"']/g,function(character){
      return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character];
    });
  }
  function formatDuration(seconds){
    var total=Math.max(0,Math.floor(Number(seconds)||0));
    var hours=Math.floor(total/3600);
    var minutes=Math.floor((total%3600)/60);
    var secs=total%60;
    return String(hours).padStart(2,'0')+':'+String(minutes).padStart(2,'0')+':'+String(secs).padStart(2,'0');
  }
  function countdownTo(iso){
    var target=Date.parse(String(iso||''));
    if(!Number.isFinite(target)) return null;
    return Math.max(0,Math.ceil((target-Date.now())/1000));
  }
  function eventMessage(event){
    var type=String(event&&event.type||'').toUpperCase();
    var symbol=String(event&&event.symbol||'').toUpperCase();
    if(type==='TRADINGVIEW_POSITION_OPENED') return symbol+' position opened';
    if(type==='TRAILING_STOP_PLACED') return symbol+' trailing stop activated';
    if(type==='TRAILING_STOP_RAISED') return symbol+' stop raised to $'+Number(event.currentStopPrice||0).toFixed(2);
    if(type==='TRADINGVIEW_POSITION_CLOSED') return symbol+' position closed · '+String(event.exitReason||'EXIT');
    if(type==='TRADINGVIEW_ALERT_PROCESSING_FAILED') return symbol+' alert failed · '+String(event.error||'broker error');
    if(type==='KILL_SWITCH_EXIT_RETRIED') return symbol+' emergency exit retried';
    if(type==='AUTO_FLATTEN_EXIT_SUBMITTED') return symbol+' auto-flatten exit submitted';
    if(type==='AUTO_FLATTEN_EXIT_RETRIED') return symbol+' auto-flatten exit retried';
    return '';
  }

  function installDraftAwareFetch(){
    window.fetch=async function(input,init){
      var response=await nativeFetch(input,init);
      var url=typeof input==='string'?input:String(input&&input.url||'');
      if(!response.ok||dirty.size===0||url.indexOf('/api/tradingview/status')<0) return response;
      try{
        var payload=await response.clone().json();
        payload.settings=payload.settings||{};
        dirty.forEach(function(id){
          var key=fieldMap[id];
          if(key) payload.settings[key]=drafts[id];
        });
        return new Response(JSON.stringify(payload),{
          status:response.status,
          statusText:response.statusText,
          headers:new Headers(response.headers)
        });
      }catch(_){return response}
    };
  }

  function renameLabel(inputId,text){
    var input=byId(inputId);
    var label=input&&input.closest('label');
    if(!label) return;
    var first=label.childNodes[0];
    if(first&&first.nodeType===Node.TEXT_NODE) first.nodeValue=text;
  }
  function addField(container,id,label,controlHtml){
    if(byId(id)) return;
    var wrapper=document.createElement('label');
    wrapper.innerHTML=label+controlHtml;
    container.appendChild(wrapper);
  }
  function installV2Fields(){
    var size=byId('size');
    var fields=size&&size.closest('.fields');
    if(!fields) return;
    var card=fields.closest('.card');
    var heading=card&&card.querySelector('h2');
    if(heading) heading.textContent='Whole-trade dollar settings';
    renameLabel('tp','Take profit total $');
    renameLabel('sl','Stop loss total $');
    var sub=document.querySelector('header .sub');
    if(sub) sub.textContent='Equities · Long only · Whole-trade dollar controls';

    addField(fields,'tradingMode','Trading mode',
      '<select id="tradingMode"><option value="CASH_LONG_ONLY">Cash long only</option><option value="CASH_PLUS_MARGIN_LONG">Cash + margin long</option></select>');
    addField(fields,'maxBpPercent','Max buying power %',
      '<input id="maxBpPercent" type="number" min="1" max="100" step="1" value="25">');
    addField(fields,'orderSession','Order session',
      '<select id="orderSession"><option value="CORE">Regular only · CORE</option><option value="ALL">Pre + regular + after-hours · ALL</option></select>');
    addField(fields,'autoFlattenTime','Auto-flatten local time',
      '<input id="autoFlattenTime" type="time" step="60" value="18:55">');

    if(card&&!byId('noOvernightRule')){
      var rule=document.createElement('div');
      rule.id='noOvernightRule';
      rule.className='ruleBox';
      rule.innerHTML='<b>No overnight holding:</b> mandatory. New overnight entries are blocked and all positions are flattened before the configured cutoff.<br><span id="flattenTimezone">Timezone: America/Chicago</span>';
      var reception=byId('reception');
      var switchBox=reception&&reception.closest('.switch');
      if(switchBox) switchBox.insertAdjacentElement('beforebegin',rule); else card.appendChild(rule);
    }

    var reason=byId('reason');
    if(reason&&!Array.from(reason.options).some(function(option){return option.value==='AUTO_FLATTEN'})){
      var option=document.createElement('option');
      option.value='AUTO_FLATTEN';
      option.textContent='AUTO_FLATTEN';
      reason.appendChild(option);
    }
  }

  function addStat(container,id,label){
    if(byId(id)) return;
    var stat=document.createElement('div');
    stat.className='stat';
    stat.innerHTML='<small>'+label+'</small><b id="'+id+'">—</b>';
    container.appendChild(stat);
  }
  function installMarketClock(){
    var hero=document.querySelector('#dash .card .stats');
    if(!hero) return;
    addStat(hero,'marketSession','Market session');
    addStat(hero,'marketCountdown','Session remaining');
    addStat(hero,'entryWindow','Entry window');
    addStat(hero,'flattenCountdown','Auto-flatten');
  }

  function readDraftValue(element){
    return element.type==='checkbox'?element.checked:element.value;
  }
  function writeDraftValue(element,value){
    if(element.type==='checkbox') element.checked=value===true||String(value)==='true';
    else element.value=value==null?'':String(value);
  }
  function installDraftListeners(){
    Object.keys(fieldMap).forEach(function(id){
      var element=byId(id);
      if(!element||element.dataset.moeDraftBound==='1') return;
      element.dataset.moeDraftBound='1';
      ['input','change'].forEach(function(eventName){
        element.addEventListener(eventName,function(){
          dirty.add(id);
          drafts[id]=readDraftValue(element);
        });
      });
    });
    setInterval(function(){
      dirty.forEach(function(id){
        var element=byId(id);
        if(element) writeDraftValue(element,drafts[id]);
      });
    },120);
  }

  function setCleanValue(id,value){
    if(dirty.has(id)) return;
    var element=byId(id);
    if(element) writeDraftValue(element,value);
  }
  function numberValue(id,label){
    var value=Number(byId(id)&&byId(id).value);
    if(!Number.isFinite(value)) throw new Error(label+' is required');
    return value;
  }
  async function saveV2Settings(event){
    event.preventDefault();
    event.stopImmediatePropagation();
    if(saving) return;
    saving=true;
    var message=byId('settingsMsg');
    try{
      var payload={
        positionSizeDollars:numberValue('size','Position size'),
        takeProfitDollars:numberValue('tp','Total take profit'),
        stopLossDollars:numberValue('sl','Total stop loss'),
        maxDailyLossDollars:numberValue('daily','Daily max loss'),
        maxOpenPositions:numberValue('maxOpen','Max open positions'),
        accountType:byId('account').value,
        trailingEnabled:byId('trailing').checked,
        tradingMode:byId('tradingMode').value,
        maxBuyingPowerPercent:numberValue('maxBpPercent','Max buying power percentage'),
        session:byId('orderSession').value,
        autoFlattenTimeLocal:byId('autoFlattenTime').value,
        autoFlattenTimezone:latestStatus&&latestStatus.settings&&latestStatus.settings.autoFlattenTimezone||'America/Chicago'
      };
      var response=await nativeFetch('/api/tradingview/settings',{
        method:'PUT',cache:'no-store',credentials:'same-origin',
        headers:{'content-type':'application/json','x-moe-mobile-client':'1'},
        body:JSON.stringify(payload)
      });
      var data=await response.json().catch(function(){return {}});
      if(!response.ok||data.ok===false) throw new Error(data.error||('HTTP '+response.status));
      dirty.clear();
      drafts=Object.create(null);
      if(message) message.textContent='Saved · alert reception was turned off for safety';
      notify('Whole-trade, session and buying-power settings saved');
      await refreshEnhancements();
    }catch(error){
      if(message) message.textContent=error.message;
      notify(error.message);
    }finally{saving=false}
  }
  function installSaveOverride(){
    var save=byId('save');
    if(save&&save.dataset.moeSaveV2!=='1'){
      save.dataset.moeSaveV2='1';
      save.addEventListener('click',saveV2Settings,true);
    }
  }

  function renderConnection(targetId,account){
    var target=byId(targetId);
    if(!target) return;
    account=account||{};
    var connected=account.connected===true;
    var label=connected?'Connected':'Disconnected';
    var detail=account.locked?'Locked':account.error||'';
    var signature=(connected?'1':'0')+'|'+label+'|'+detail;
    if(target.dataset.connectionSignature===signature&&target.querySelector('.connectionDot')) return;
    target.dataset.connectionSignature=signature;
    target.className='connectionLine';
    target.innerHTML='<span class="connectionDot '+(connected?'online':'offline')+'" aria-hidden="true"></span><strong>'+label+'</strong>'+(detail?'<span class="connectionDetail">· '+escapeHtml(detail)+'</span>':'');
  }
  function renderTradingViewConnection(payload){
    var target=byId('connection');
    if(!target) return;
    var connected=payload.tradingViewConnected===true;
    var label=connected?'Connected':payload.runtime&&payload.runtime.receptionEnabled?'Waiting for alert':'Reception off';
    target.innerHTML='<span class="connectionDot '+(connected?'online':'offline')+'" aria-hidden="true"></span> '+label;
  }
  function renderConnections(){
    if(!latestStatus) return;
    renderConnection('demoConn',latestStatus.accounts&&latestStatus.accounts.demo);
    renderConnection('liveConn',latestStatus.accounts&&latestStatus.accounts.live);
    renderTradingViewConnection(latestStatus);
  }

  function renderClock(){
    if(!latestStatus||!latestStatus.marketClock) return;
    var clock=latestStatus.marketClock;
    var session=byId('marketSession');
    var remaining=byId('marketCountdown');
    var entry=byId('entryWindow');
    var flatten=byId('flattenCountdown');
    if(session){
      session.textContent=clock.label+' · '+clock.phase;
      session.className=clock.entryAllowed?'sessionOpen':'sessionClosed';
    }
    if(remaining){
      var seconds=countdownTo(clock.nextTransitionAt);
      remaining.textContent=seconds==null?'—':formatDuration(seconds)+' → '+String(clock.nextTransitionLabel||'Next session');
    }
    if(entry){
      entry.textContent=clock.entryAllowed?'OPEN · '+String(clock.selectedSession||'ALL'):'BLOCKED · '+String(clock.entryBlockedReason||'CLOSED');
      entry.className=clock.entryAllowed?'sessionOpen':'sessionClosed';
    }
    if(flatten){
      var flattenSeconds=countdownTo(clock.autoFlattenAt);
      flatten.textContent=clock.autoFlattenDue?'ACTIVE · flatten required':flattenSeconds==null?'—':formatDuration(flattenSeconds);
      flatten.className=clock.autoFlattenDue?'sessionClosed':'sessionOpen';
    }
  }

  function applyV2Status(payload){
    latestStatus=payload;
    var settings=payload.settings||{};
    setCleanValue('tradingMode',settings.tradingMode||'CASH_LONG_ONLY');
    setCleanValue('maxBpPercent',settings.maxBuyingPowerPercent==null?25:settings.maxBuyingPowerPercent);
    setCleanValue('orderSession',settings.session||'ALL');
    setCleanValue('autoFlattenTime',settings.autoFlattenTimeLocal||'18:55');
    var zone=byId('flattenTimezone');
    if(zone) zone.textContent='Timezone: '+String(settings.autoFlattenTimezone||'America/Chicago');
    renderConnections();
    renderClock();
  }
  async function refreshEnhancements(){
    try{
      var response=await nativeFetch('/api/tradingview/status',{
        cache:'no-store',credentials:'same-origin',headers:{'x-moe-mobile-client':'1'}
      });
      if(!response.ok) return;
      applyV2Status(await response.json());
    }catch(_){}
  }

  async function pollImportantEvents(){
    try{
      var response=await nativeFetch('/api/tradingview/audit',{cache:'no-store',credentials:'same-origin',headers:{'x-moe-mobile-client':'1'}});
      if(!response.ok) return;
      var payload=await response.json();
      var event=Array.isArray(payload.audit)?payload.audit[0]:null;
      if(!event) return;
      if(!initialized){latestAuditId=event.id;initialized=true;return}
      if(event.id&&event.id!==latestAuditId){
        latestAuditId=event.id;
        var message=eventMessage(event);
        if(message) notify(message);
      }
    }catch(_){}
  }

  function addSortControl(){
    var exportButton=byId('csv');
    if(!exportButton||byId('archiveSort')) return;
    var select=document.createElement('select');
    select.id='archiveSort';
    select.innerHTML='<option value="DATE_DESC">Newest first</option><option value="DATE_ASC">Oldest first</option><option value="PNL_DESC">Highest P/L</option><option value="PNL_ASC">Lowest P/L</option><option value="TICKER">Ticker</option>';
    exportButton.insertAdjacentElement('beforebegin',select);
    select.addEventListener('change',sortArchiveRows);
  }
  function numericCell(row,index){
    return Number(String(row.cells[index]&&row.cells[index].textContent||'').replace(/[^0-9+.-]/g,''))||0;
  }
  function sortArchiveRows(){
    var body=byId('archiveRows');
    var select=byId('archiveSort');
    if(!body||!select) return;
    var current=Array.from(body.querySelectorAll('tr')).filter(function(row){return row.cells.length>=8});
    var sorted=current.slice();
    var mode=select.value;
    sorted.sort(function(a,b){
      if(mode==='DATE_ASC'||mode==='DATE_DESC'){
        var av=Date.parse(a.cells[0]&&a.cells[0].textContent||'')||0;
        var bv=Date.parse(b.cells[0]&&b.cells[0].textContent||'')||0;
        return mode==='DATE_ASC'?av-bv:bv-av;
      }
      if(mode==='PNL_ASC'||mode==='PNL_DESC'){
        var ap=numericCell(a,5),bp=numericCell(b,5);
        return mode==='PNL_ASC'?ap-bp:bp-ap;
      }
      return String(a.cells[1]&&a.cells[1].textContent||'').localeCompare(String(b.cells[1]&&b.cells[1].textContent||''));
    });
    var changed=sorted.some(function(row,index){return row!==current[index]});
    if(!changed) return;
    if(archiveObserver) archiveObserver.disconnect();
    sorted.forEach(function(row){body.appendChild(row)});
    if(archiveObserver) archiveObserver.observe(body,{childList:true});
  }
  function observeArchive(){
    var body=byId('archiveRows');
    if(!body) return;
    archiveObserver=new MutationObserver(sortArchiveRows);
    archiveObserver.observe(body,{childList:true});
  }

  function start(){
    installDraftAwareFetch();
    installV2Fields();
    installMarketClock();
    installDraftListeners();
    installSaveOverride();
    addSortControl();
    observeArchive();
    refreshEnhancements();
    pollImportantEvents();
    setInterval(function(){if(!document.hidden) refreshEnhancements()},3000);
    setInterval(function(){if(!document.hidden) pollImportantEvents()},2500);
    setInterval(function(){renderConnections();renderClock()},500);
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',start,{once:true});
  else start();
})();
</script>`;

export function tradingViewDashboardHtml() {
  const html = baseTradingViewDashboardHtml();
  return html.includes('</body>')
    ? html.replace('</body>', () => `${ENHANCEMENT}\n</body>`)
    : `${html}\n${ENHANCEMENT}`;
}
