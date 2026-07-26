import worker, { AlertCoordinator } from './ui-v2-entry.js';

const APP_ROUTES = new Map([
  ['/', 'dashboard'],
  ['/dashboard', 'dashboard'],
  ['/dashboard/', 'dashboard'],
  ['/scanner', 'scanner'],
  ['/scanner/', 'scanner'],
  ['/opportunities', 'opportunities'],
  ['/opportunities/', 'opportunities'],
  ['/alerts', 'alerts'],
  ['/alerts/', 'alerts'],
  ['/trading', 'trading'],
  ['/trading/', 'trading'],
  ['/trade-management', 'management'],
  ['/trade-management/', 'management'],
  ['/performance', 'performance'],
  ['/performance/', 'performance'],
  ['/account', 'account'],
  ['/account/', 'account'],
  ['/settings', 'settings'],
  ['/settings/', 'settings'],
]);

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function isHtml(response) {
  return String(response?.headers?.get?.('content-type') || '').includes('text/html');
}

function dashboardRequest(request) {
  const url = new URL(request.url);
  url.pathname = '/dashboard';
  url.hash = '';
  return new Request(url.toString(), request);
}

async function enhanceRoute(response, route) {
  if (!isHtml(response)) return response;
  const html = await response.text();
  if (html.includes('moeSinglePageRouter')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: secureHeaders(response) });
  }

  const style = `<style id="moeSinglePageRouterStyles">
  body[data-moe-route-ready="true"] main>*{display:none!important}
  body[data-moe-route-ready="true"] main>#moePageModeBanner,
  body[data-moe-route-ready="true"] main>.moe-route-page,
  body[data-moe-route-ready="true"] main>[data-moe-route-visible="true"]{display:block!important}
  .moe-route-page{width:100%;max-width:1680px;margin:0 auto;padding:0 18px 24px;box-sizing:border-box}
  .moe-route-header{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:4px 0 14px;padding:18px;border:1px solid rgba(64,103,141,.46);border-radius:12px;background:linear-gradient(145deg,rgba(12,31,50,.96),rgba(6,17,30,.98));box-shadow:0 16px 46px rgba(0,0,0,.2)}
  .moe-route-header h1{margin:0;font-size:clamp(24px,3vw,34px)}.moe-route-header p{margin:7px 0 0;color:#8fa4bf;font-size:12px;line-height:1.65}
  .moe-route-grid{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:12px}.moe-route-card{grid-column:span 4;padding:16px;border:1px solid rgba(60,98,135,.42);border-radius:12px;background:linear-gradient(145deg,rgba(12,30,49,.94),rgba(6,17,29,.98));box-shadow:0 12px 34px rgba(0,0,0,.18);min-width:0}.moe-route-card.wide{grid-column:span 8}.moe-route-card.full{grid-column:1/-1}.moe-route-card h2{margin:0 0 11px;font-size:16px}.moe-route-card p{color:#8fa4bf;line-height:1.6;font-size:11px}.moe-route-state{display:inline-flex;align-items:center;gap:7px;padding:6px 9px;border:1px solid rgba(83,125,164,.5);border-radius:8px;font-size:10px;font-weight:900}.moe-route-state.ok{color:#7ee2a8;border-color:#2b7656}.moe-route-state.warn{color:#ffd07a;border-color:#88692d}.moe-route-state.error{color:#ff9da7;border-color:#8a3b46}
  .moe-route-actions{display:flex;gap:8px;flex-wrap:wrap}.moe-route-button{min-height:42px;padding:9px 13px;border:1px solid #315270;border-radius:10px;background:#10233b;color:#edf4ff;font-weight:850;cursor:pointer}.moe-route-button.primary{background:#1769aa;border-color:#2a87cf}.moe-route-button.danger{background:#6e2730;border-color:#a94351}.moe-route-button:disabled{opacity:.55;cursor:not-allowed}
  .alerts-history{display:grid;gap:8px}.alert-row{display:grid;grid-template-columns:auto 1fr auto auto;gap:10px;align-items:center;padding:11px 12px;border:1px solid rgba(55,91,126,.4);border-radius:10px;background:rgba(7,20,34,.72)}.alert-icon{width:34px;height:34px;border-radius:9px;display:grid;place-items:center;font-weight:950}.alert-icon.entry{background:rgba(42,136,92,.18);color:#7ee2a8}.alert-icon.exit{background:rgba(149,65,77,.18);color:#ff9da7}.alert-main strong{display:block}.alert-main span,.alert-meta{display:block;color:#8fa4bf;font-size:10px;margin-top:3px}.alert-price{font-weight:900;white-space:nowrap}.alert-status{padding:5px 8px;border-radius:8px;font-size:9px;font-weight:900;border:1px solid currentColor}.alert-status.DELIVERED{color:#7ee2a8}.alert-status.FAILED{color:#ff9da7}.alert-status.PARTIAL,.alert-status.NO_REGISTERED_DEVICE{color:#ffd07a}
  .alerts-filters{display:flex;gap:7px;flex-wrap:wrap}.alerts-filter{padding:7px 10px;border-radius:9px;border:1px solid #294564;background:#0c1f33;color:#c4d4e6;cursor:pointer;font-weight:800;font-size:10px}.alerts-filter.active{border-color:#66b8ff;background:#17496c;color:white}.alerts-empty{padding:32px 16px;text-align:center;color:#8fa4bf;border:1px dashed rgba(66,103,139,.52);border-radius:11px}
  @media(max-width:1000px){.moe-route-card,.moe-route-card.wide{grid-column:span 6}}
  @media(max-width:700px){.moe-route-page{padding:0 10px 18px}.moe-route-header{padding:14px;flex-direction:column}.moe-route-card,.moe-route-card.wide,.moe-route-card.full{grid-column:1/-1}.alert-row{grid-template-columns:auto 1fr}.alert-price,.alert-status{grid-column:2}.moe-route-grid{gap:10px}}
  </style>`;

  const script = `<script id="moeSinglePageRouter">
  (function(){
    const route=${JSON.stringify(route)};
    const routePaths={dashboard:'/dashboard',scanner:'/scanner',opportunities:'/opportunities',alerts:'/alerts',trading:'/trading',management:'/trade-management',performance:'/performance',account:'/account',learning:'/learning',settings:'/settings'};
    const ar={dashboard:['لوحة التحكم','ملخص حالة الحساب والتداول والمخاطر.'],scanner:['الماسح','حالة المسح والفرص المطابقة لقواعد MOERAND.'],opportunities:['الفرص','الفرص الحالية والصفقات النشطة فقط.'],alerts:['التنبيهات','تنبيهات دخول وخروج الصفقات المؤكدة حسب وضع التداول الحالي.'],trading:['التداول','تشغيل أو إيقاف التداول الحقيقي والتجريبي بأمان.'],management:['إدارة الصفقات','المراكز والأوامر وسجل التنفيذ للحساب النشط.'],performance:['الأداء','نتائج الصفقات والتحليلات الإحصائية.'],account:['الحساب','الرصيد والقوة الشرائية ومخاطر المحفظة.'],settings:['الإعدادات','إعدادات التطبيق واللغة والتنبيهات.']};
    const en={dashboard:['Dashboard','Account, trading, and risk status summary.'],scanner:['Scanner','Scanner status and opportunities matching MOERAND rules.'],opportunities:['Opportunities','Current opportunities and active trades only.'],alerts:['Alerts','Confirmed trade entry and exit alerts for the active trading mode.'],trading:['Trading','Safely start or stop live and demo trading.'],management:['Trade Management','Positions, orders, and execution history for the active account.'],performance:['Performance','Trade results and statistical analytics.'],account:['Account','Balance, buying power, and portfolio risk.'],settings:['Settings','Application, language, and notification settings.']};
    const language=()=>localStorage.getItem('moe-ui-language')==='en'?'en':'ar';
    const dictionary=()=>language()==='en'?en:ar;
    const title=()=>dictionary()[route]||dictionary().dashboard;
    const sectionMap={scanner:['#scanner'],opportunities:['#active-trade','#active-position'],trading:['#live-control','.mode-control'],management:['#trades'],performance:['#analytics'],account:['#portfolio-risk'],settings:['#settings'],dashboard:['.terminal-header','#marketClock','#operatingBanner','.grid','.stats']};
    function patchNavigation(){document.querySelectorAll('.moe-nav-link').forEach(link=>{const label=(link.textContent||'').trim();const keys={Dashboard:'dashboard','لوحة التحكم':'dashboard',Scanner:'scanner','الماسح':'scanner',Opportunities:'opportunities','الفرص':'opportunities',Alerts:'alerts','التنبيهات':'alerts',Trading:'trading','التداول':'trading','Trade Management':'management','إدارة الصفقات':'management',Performance:'performance','الأداء':'performance',Account:'account','الحساب':'account','Learning Center':'learning','مركز التعلم':'learning',Settings:'settings','الإعدادات':'settings'};const key=keys[label];if(key&&routePaths[key]){link.href=routePaths[key];link.classList.toggle('active',key===route);}});}
    function page(){let node=document.getElementById('moeRoutePage');if(node)return node;node=document.createElement('section');node.id='moeRoutePage';node.className='moe-route-page';const main=document.querySelector('main')||document.body;main.appendChild(node);return node;}
    function moveSections(){const node=page();if(route==='alerts'){renderAlertsPage(node);return;}const selectors=sectionMap[route]||sectionMap.dashboard;const moved=[];selectors.forEach(selector=>document.querySelectorAll(selector).forEach(item=>{if(item.id==='moePageModeBanner'||item.closest('#moeRoutePage'))return;item.setAttribute('data-moe-route-visible','true');node.appendChild(item);moved.push(item);}));const [heading,description]=title();const header=document.createElement('div');header.className='moe-route-header';header.innerHTML='<div><h1>'+heading+'</h1><p>'+description+'</p></div>';node.prepend(header);if(!moved.length){const empty=document.createElement('div');empty.className='moe-route-card full alerts-empty';empty.textContent=language()==='en'?'This page is being connected to its existing data source.':'يتم ربط هذه الصفحة بمصدر بياناتها الحالي.';node.appendChild(empty);}}
    function alertsMarkup(){const english=language()==='en';return '<div class="moe-route-header"><div><h1>'+(english?'Alerts':'التنبيهات')+'</h1><p>'+(english?'Confirmed trade notifications only. Opportunities and unfilled orders do not generate entry alerts.':'تنبيهات الصفقات المؤكدة فقط. الفرص والأوامر غير المنفذة لا تولّد تنبيهات دخول.')+'</p></div><span class="moe-route-state warn" id="alertsModeState">—</span></div><div class="moe-route-grid"><section class="moe-route-card"><h2>'+(english?'Notification status':'حالة التنبيهات')+'</h2><div id="notificationPermissionState" class="moe-route-state warn">'+(english?'Checking':'جارٍ التحقق')+'</div><p id="notificationStatusText"></p><div class="moe-route-actions"><button class="moe-route-button primary" id="enableNotifications">'+(english?'Enable Notifications':'تفعيل التنبيهات')+'</button><button class="moe-route-button" id="sendTestNotification">'+(english?'Send Test Notification':'إرسال تنبيه تجريبي')+'</button></div></section><section class="moe-route-card"><h2>'+(english?'Registered devices':'الأجهزة المسجلة')+'</h2><div id="registeredDevices" class="alerts-empty">—</div></section><section class="moe-route-card"><h2>'+(english?'Delivery summary':'ملخص الإرسال')+'</h2><div id="deliverySummary" class="alerts-empty">—</div></section><section class="moe-route-card full"><div style="display:flex;justify-content:space-between;gap:12px;align-items:center;flex-wrap:wrap"><h2>'+(english?'Notification history':'سجل التنبيهات')+'</h2><div class="alerts-filters" id="alertsFilters"></div></div><div id="alertsHistory" class="alerts-history"><div class="alerts-empty">'+(english?'Loading alerts...':'جارٍ تحميل التنبيهات...')+'</div></div></section></div>';}
    function renderAlertsPage(node){node.innerHTML=alertsMarkup();wireAlerts();}
    let alertFilter='all';let currentMode='demo';
    async function api(path,options={}){const response=await fetch(path,{cache:'no-store',...options});const data=await response.json().catch(()=>({error:'Invalid response'}));if(!response.ok)throw new Error(data.error||('HTTP '+response.status));return data;}
    function deviceType(){return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent)?'mobile-browser':'desktop-browser';}
    function base64ToUint8(value){const padding='='.repeat((4-value.length%4)%4);const raw=atob((value+padding).replace(/-/g,'+').replace(/_/g,'/'));return Uint8Array.from([...raw].map(char=>char.charCodeAt(0)));}
    async function registerPush(){if(!('serviceWorker'in navigator)||!('PushManager'in window)||!('Notification'in window))throw new Error(language()==='en'?'This device does not support browser push notifications.':'هذا الجهاز لا يدعم تنبيهات المتصفح.');const permission=await Notification.requestPermission();if(permission!=='granted')throw new Error(language()==='en'?'Notification permission was not granted.':'لم يتم منح إذن التنبيهات.');const registration=await navigator.serviceWorker.ready;const config=await api('/api/notifications/config');let subscription=await registration.pushManager.getSubscription();if(!subscription)subscription=await registration.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64ToUint8(config.publicKey)});await api('/api/notifications/subscribe',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription,language:language(),deviceType:deviceType(),userAgent:navigator.userAgent})});return subscription;}
    function filters(){const english=language()==='en';const items=[['all',english?'All':'الكل'],['entry',english?'Entries':'الدخول'],['exit',english?'Exits':'الخروج'],['delivered',english?'Delivered':'تم الإرسال'],['failed',english?'Failed':'فشل الإرسال']];const root=document.getElementById('alertsFilters');root.innerHTML=items.map(([id,label])=>'<button class="alerts-filter '+(id===alertFilter?'active':'')+'" data-filter="'+id+'">'+label+'</button>').join('');root.querySelectorAll('[data-filter]').forEach(button=>button.onclick=()=>{alertFilter=button.dataset.filter;filters();loadAlerts();});}
    function renderHistory(items){const english=language()==='en';const root=document.getElementById('alertsHistory');let filtered=items;if(alertFilter==='entry'||alertFilter==='exit')filtered=items.filter(item=>item.eventType===alertFilter);if(alertFilter==='delivered')filtered=items.filter(item=>item.deliveryStatus==='DELIVERED');if(alertFilter==='failed')filtered=items.filter(item=>item.deliveryStatus==='FAILED'||item.deliveryStatus==='PARTIAL');if(!filtered.length){root.innerHTML='<div class="alerts-empty">'+(english?'No trading alerts have been generated yet.':'لا توجد تنبيهات تداول حتى الآن.')+'</div>';return;}root.innerHTML=filtered.map(item=>'<div class="alert-row"><div class="alert-icon '+item.eventType+'">'+(item.eventType==='entry'?'↗':'↘')+'</div><div class="alert-main"><strong>'+item.symbol+'</strong><span>'+(item.eventType==='entry'?(english?'Entry':'دخول'):(english?'Exit':'خروج'))+' · '+(item.tradingMode==='live'?(english?'Live':'حقيقي'):(english?'Demo':'تجريبي'))+'</span><span class="alert-meta">'+new Intl.DateTimeFormat(language()==='en'?'en-US':'ar-US',{dateStyle:'short',timeStyle:'short'}).format(new Date(item.createdAt))+'</span></div><div class="alert-price">'+new Intl.NumberFormat('en-US',{style:'currency',currency:'USD',minimumFractionDigits:2}).format(item.executionPrice)+'</div><span class="alert-status '+item.deliveryStatus+'">'+item.deliveryStatus+'</span></div>').join('');}
    async function loadAlerts(){try{const readiness=await api('/api/trading/live/readiness');currentMode=readiness.control?.liveTradingEnabled&&readiness.control?.killSwitch===false?'live':'demo';document.getElementById('alertsModeState').textContent=language()==='en'?(currentMode==='live'?'Live Alerts':'Demo Alerts'):(currentMode==='live'?'التنبيهات الحقيقية':'التنبيهات التجريبية');const data=await api('/api/notifications/history?mode='+currentMode+'&limit=200');renderHistory(data.notifications||[]);const status=await api('/api/notifications/status');const permission=('Notification'in window)?Notification.permission:'unsupported';const permissionNode=document.getElementById('notificationPermissionState');permissionNode.className='moe-route-state '+(permission==='granted'?'ok':permission==='denied'?'error':'warn');permissionNode.textContent=permission==='granted'?(language()==='en'?'Notifications Enabled':'التنبيهات مفعلة'):permission==='denied'?(language()==='en'?'Notifications Disabled':'التنبيهات غير مفعلة'):(language()==='en'?'Notification Permission Required':'يلزم السماح بالتنبيهات');document.getElementById('notificationStatusText').textContent=status.providerConfigured?(language()==='en'?'Push service connected.':'خدمة التنبيهات متصلة.'):(language()==='en'?'Notification service disconnected.':'الخدمة غير متصلة.');document.getElementById('registeredDevices').textContent=status.registeredDevices?String(status.registeredDevices)+' '+(language()==='en'?'device(s) registered':'جهاز مسجل'):(language()==='en'?'Device Not Registered':'الجهاز غير مسجل');const delivered=(data.notifications||[]).filter(item=>item.deliveryStatus==='DELIVERED').length,failed=(data.notifications||[]).filter(item=>item.deliveryStatus==='FAILED'||item.deliveryStatus==='PARTIAL').length;document.getElementById('deliverySummary').textContent=(language()==='en'?'Delivered: ':'تم الإرسال: ')+delivered+' · '+(language()==='en'?'Failed: ':'فشل: ')+failed;}catch(error){document.getElementById('alertsHistory').innerHTML='<div class="alerts-empty">'+error.message+'</div>';}}
    function wireAlerts(){filters();document.getElementById('enableNotifications').onclick=async()=>{const button=document.getElementById('enableNotifications');button.disabled=true;try{await registerPush();await loadAlerts();}catch(error){alert(error.message);}finally{button.disabled=false;}};document.getElementById('sendTestNotification').onclick=async()=>{const button=document.getElementById('sendTestNotification');button.disabled=true;try{const result=await api('/api/notifications/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({language:language()})});if(!result.sent)throw new Error(language()==='en'?'No registered device received the test notification.':'لم يستلم أي جهاز مسجل التنبيه التجريبي.');}catch(error){alert(error.message);}finally{button.disabled=false;}};loadAlerts();setInterval(loadAlerts,30000);}
    function removePreview(){document.querySelectorAll('button,a,span,strong,div').forEach(node=>{const value=(node.textContent||'').trim();if(/^(Preview|Preview Mode|معاينة فقط|وضع المعاينة)$/i.test(value))node.style.display='none';});}
    function start(){patchNavigation();moveSections();removePreview();document.body.dataset.moeRouteReady='true';localStorage.setItem('moe-active-page',route);}
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  })();
  </script>`;

  const enhanced = html.replace('</head>', `${style}</head>`).replace('</body>', `${script}</body>`);
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers: secureHeaders(response) });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const route = APP_ROUTES.get(url.pathname);
    if (!route) return worker.fetch(request, env, ctx);
    const response = await worker.fetch(dashboardRequest(request), env, ctx);
    return enhanceRoute(response, route);
  },
  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
