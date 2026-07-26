import worker, { AlertCoordinator } from './pin-session-entry.js';

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function isHtml(response) {
  return String(response?.headers?.get?.('content-type') || '').includes('text/html');
}

async function enhanceApplication(response, request) {
  if (!isHtml(response)) return response;
  const html = await response.text();
  if (html.includes('moeUnifiedAppShellV2')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: secureHeaders(response),
    });
  }

  const path = new URL(request.url).pathname;
  const style = `<style id="moeUnifiedAppShellV2Styles">
  :root{--moe-shell-bg:rgba(5,15,28,.96);--moe-shell-border:rgba(66,107,146,.48);--moe-shell-text:#edf4ff;--moe-shell-muted:#8fa4bf;--moe-shell-blue:#69bfff;--moe-shell-green:#62dda0;--moe-shell-red:#ff8c99;--moe-shell-gold:#f7cb7c}
  html{scroll-padding-top:88px}body{padding-top:74px!important}
  .terminal-nav,body>main>.nav,.wrap>.nav{display:none!important}
  #moeAppShell{position:fixed;inset:0 0 auto 0;z-index:10000;min-height:64px;border-bottom:1px solid var(--moe-shell-border);background:var(--moe-shell-bg);backdrop-filter:blur(18px);color:var(--moe-shell-text);font-family:Inter,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
  .moe-shell-row{max-width:1680px;margin:auto;min-height:64px;padding:9px 18px;display:flex;align-items:center;gap:12px}
  .moe-brand{display:flex;align-items:center;gap:9px;text-decoration:none;color:var(--moe-shell-text);font-weight:950;white-space:nowrap}.moe-brand-mark{width:36px;height:36px;border-radius:12px;display:grid;place-items:center;background:linear-gradient(145deg,#2484c6,#12527f);border:1px solid #69bfff;box-shadow:0 8px 24px rgba(22,111,172,.3)}.moe-brand-copy{display:grid;gap:1px}.moe-brand-copy small{color:var(--moe-shell-muted);font-size:9px;font-weight:700}
  .moe-main-nav{display:flex;align-items:center;gap:6px;overflow:auto;scrollbar-width:none;flex:1}.moe-main-nav::-webkit-scrollbar{display:none}.moe-nav-link{display:inline-flex;align-items:center;gap:6px;min-height:39px;padding:8px 10px;border:1px solid transparent;border-radius:11px;color:#b9cbe0;text-decoration:none;font-size:11px;font-weight:850;white-space:nowrap}.moe-nav-link:hover{color:#fff;border-color:#315270;background:#0d2135}.moe-nav-link.active{color:#fff;border-color:#4a91c5;background:#153d5c;box-shadow:0 0 0 1px rgba(105,191,255,.12)}
  .moe-shell-controls{display:flex;align-items:center;gap:7px}.moe-mode-chip,.moe-connection-chip{display:grid;gap:1px;padding:7px 9px;border:1px solid var(--moe-shell-border);border-radius:10px;background:#091b2d;white-space:nowrap}.moe-mode-chip span,.moe-connection-chip span{font-size:8px;color:var(--moe-shell-muted)}.moe-mode-chip strong,.moe-connection-chip strong{font-size:10px}.moe-mode-chip.live{border-color:#9b4050;background:rgba(111,35,49,.4)}.moe-mode-chip.live strong{color:#ff9da7}.moe-mode-chip.sandbox{border-color:#2c7457;background:rgba(31,104,75,.25)}.moe-mode-chip.sandbox strong{color:#83e9b2}
  .moe-shell-button{min-width:40px;min-height:40px;border:1px solid #315270!important;border-radius:11px!important;background:#0d2135!important;color:#edf4ff!important;padding:8px 10px!important;font-size:11px!important;font-weight:900!important;cursor:pointer}.moe-shell-button:hover{border-color:#69bfff!important}.moe-shell-button.danger{border-color:#8b3d49!important;color:#ffb2ba!important}.moe-menu-button{display:none!important}
  #moeMobileDrawer{display:none;position:fixed;inset:64px 0 0 0;z-index:9999;background:rgba(2,9,17,.76);backdrop-filter:blur(5px)}#moeMobileDrawer.open{display:block}.moe-drawer-panel{width:min(88vw,360px);height:100%;padding:14px;background:#071522;border-inline-end:1px solid var(--moe-shell-border);overflow:auto}.moe-drawer-nav{display:grid;gap:7px}.moe-drawer-nav .moe-nav-link{font-size:13px;justify-content:flex-start;padding:12px}
  .moe-shell-toast{position:fixed;z-index:11000;inset:auto 18px 18px auto;max-width:min(420px,calc(100vw - 36px));padding:12px 14px;border:1px solid #315270;border-radius:13px;background:#0b2135;color:#edf4ff;box-shadow:0 18px 50px rgba(0,0,0,.35);font:700 12px/1.6 Inter,system-ui;opacity:0;transform:translateY(12px);pointer-events:none;transition:.2s}.moe-shell-toast.show{opacity:1;transform:none}.moe-shell-toast.error{border-color:#8b3d49;color:#ffb2ba}.moe-shell-toast.success{border-color:#2c7457;color:#8ceab8}
  html[dir="rtl"] .moe-shell-toast{inset:auto auto 18px 18px}
  .moe-page-mode-banner{margin:0 auto 14px;max-width:1680px;padding:9px 14px;border:1px solid var(--moe-shell-border);border-radius:12px;background:rgba(7,22,38,.82);display:flex;align-items:center;justify-content:space-between;gap:10px;color:#aebfd2;font:750 11px/1.5 Inter,system-ui}.moe-page-mode-banner strong{color:#edf4ff}.moe-page-mode-banner.live{border-color:#8b3d49;background:rgba(94,29,42,.2)}.moe-page-mode-banner.sandbox{border-color:#2c7457;background:rgba(24,91,66,.16)}
  [data-moe-collapsible="true"]{position:relative}.moe-details-toggle{margin-top:10px!important}
  @media(max-width:1100px){.moe-main-nav{display:none}.moe-menu-button{display:inline-grid!important;place-items:center}.moe-brand{flex:1}.moe-connection-chip{display:none}}
  @media(max-width:700px){body{padding-top:66px!important}.moe-shell-row{padding:8px 10px;gap:7px}.moe-brand-copy small{display:none}.moe-mode-chip{padding:6px 8px}.moe-shell-button{min-width:38px;min-height:38px;padding:7px!important}.moe-page-mode-banner{margin:0 10px 12px}.moe-brand-mark{width:34px;height:34px}.moe-brand-copy strong{font-size:13px}}
  </style>`;

  const script = `<script id="moeUnifiedAppShellV2">
  (function(){
    if(window.__moeAppShellV2Ready)return;window.__moeAppShellV2Ready=true;
    const pagePath=${JSON.stringify(path)};
    const dictionary={
      ar:{brandSub:'منصة التداول الآلي والتحكم بالمخاطر',dashboard:'لوحة التحكم',scanner:'الماسح',opportunities:'الفرص',alerts:'التنبيهات',trading:'التداول',management:'إدارة الصفقات',performance:'الأداء',account:'الحساب',learning:'مركز التعلم',settings:'الإعدادات',language:'EN',lock:'قفل',mode:'وضع التداول',connection:'اتصال الحساب',loading:'جارٍ التحقق',live:'تداول حقيقي',sandbox:'تداول تجريبي',stopped:'متوقف',connected:'متصل',disconnected:'غير متصل',liveWarning:'أوامر حقيقية وأموال حقيقية',sandboxNote:'لا يتم استخدام أموال حقيقية',lockConfirm:'سيتم مسح جلسة PIN وقفل التطبيق في هذه الصفحة. متابعة؟',locked:'تم قفل الجلسة ومسح رمز التحكم من ذاكرة الصفحة.',refreshError:'تعذر تحديث حالة التداول.'},
      en:{brandSub:'Automated trading and risk control',dashboard:'Dashboard',scanner:'Scanner',opportunities:'Opportunities',alerts:'Alerts',trading:'Trading',management:'Trade Management',performance:'Performance',account:'Account',learning:'Learning Center',settings:'Settings',language:'العربية',lock:'Lock',mode:'Trading mode',connection:'Account connection',loading:'Checking',live:'Live Trading',sandbox:'Demo Trading',stopped:'Stopped',connected:'Connected',disconnected:'Disconnected',liveWarning:'Real orders and real funds',sandboxNote:'No real money is used',lockConfirm:'This clears the page PIN session and locks protected controls. Continue?',locked:'The PIN session was cleared and protected controls were locked.',refreshError:'Unable to refresh trading status.'}
    };
    const saved=localStorage.getItem('moe-ui-language');
    let language=saved==='en'?'en':'ar';
    let controlState={liveTradingEnabled:false,sandboxAutomationEnabled:false,killSwitch:true};
    const t=key=>dictionary[language][key]||key;
    const navItems=[
      ['dashboard','⌂','/dashboard'],['scanner','⌕','/dashboard#scanner'],['opportunities','✦','/dashboard#active-position'],['alerts','◉','/dashboard#alerts'],['trading','↗','/dashboard#live-control'],['management','▤','/dashboard#trades'],['performance','⌁','/dashboard#analytics'],['account','◎','/dashboard#portfolio-risk'],['learning','◆','/learning'],['settings','⚙','/dashboard#settings']
    ];
    function active(href,key){if(pagePath==='/learning')return key==='learning';if(pagePath.startsWith('/dashboard')||pagePath==='/'||pagePath.startsWith('/moe-ai')){const hash=location.hash;if(!hash)return key==='dashboard';return href.endsWith(hash);}return false;}
    function navMarkup(drawer){return navItems.map(([key,icon,href])=>'<a class="moe-nav-link '+(active(href,key)?'active':'')+'" href="'+href+'"><span aria-hidden="true">'+icon+'</span><span>'+t(key)+'</span></a>').join('');}
    function shell(){
      let node=document.getElementById('moeAppShell');if(node)return node;
      node=document.createElement('header');node.id='moeAppShell';
      node.innerHTML='<div class="moe-shell-row"><button class="moe-shell-button moe-menu-button" id="moeMenuButton" aria-label="Menu">☰</button><a class="moe-brand" href="/dashboard"><span class="moe-brand-mark">M</span><span class="moe-brand-copy"><strong>MOERAND AI</strong><small>'+t('brandSub')+'</small></span></a><nav class="moe-main-nav" aria-label="Main navigation">'+navMarkup(false)+'</nav><div class="moe-shell-controls"><div class="moe-mode-chip" id="moeGlobalMode"><span>'+t('mode')+'</span><strong>'+t('loading')+'</strong></div><div class="moe-connection-chip" id="moeGlobalConnection"><span>'+t('connection')+'</span><strong>'+t('loading')+'</strong></div><button class="moe-shell-button" id="moeLanguageButton" type="button">'+t('language')+'</button><button class="moe-shell-button danger" id="moeLockButton" type="button">'+t('lock')+'</button></div></div>';
      document.body.prepend(node);
      const drawer=document.createElement('div');drawer.id='moeMobileDrawer';drawer.innerHTML='<aside class="moe-drawer-panel"><nav class="moe-drawer-nav">'+navMarkup(true)+'</nav></aside>';document.body.appendChild(drawer);
      document.getElementById('moeMenuButton').onclick=()=>drawer.classList.toggle('open');drawer.onclick=e=>{if(e.target===drawer)drawer.classList.remove('open');};
      document.getElementById('moeLanguageButton').onclick=toggleLanguage;
      document.getElementById('moeLockButton').onclick=lockSession;
      addModeBanner();
      return node;
    }
    function addModeBanner(){if(document.getElementById('moePageModeBanner'))return;const banner=document.createElement('div');banner.id='moePageModeBanner';banner.className='moe-page-mode-banner';const target=document.querySelector('main')||document.body;target.prepend(banner);renderState();}
    function toast(message,type){let node=document.getElementById('moeShellToast');if(!node){node=document.createElement('div');node.id='moeShellToast';node.className='moe-shell-toast';document.body.appendChild(node);}node.textContent=message;node.className='moe-shell-toast show '+(type||'');clearTimeout(node._timer);node._timer=setTimeout(()=>node.className='moe-shell-toast',5000);}
    function applyLanguage(){document.documentElement.lang=language;document.documentElement.dir=language==='ar'?'rtl':'ltr';localStorage.setItem('moe-ui-language',language);const old=document.getElementById('moeAppShell');const drawer=document.getElementById('moeMobileDrawer');if(old)old.remove();if(drawer)drawer.remove();shell();renderState();window.dispatchEvent(new CustomEvent('moe:language-change',{detail:{language}}));}
    function toggleLanguage(){language=language==='ar'?'en':'ar';applyLanguage();}
    function lockSession(){if(!confirm(t('lockConfirm')))return;if(typeof window.__clearMoerandControlPin==='function')window.__clearMoerandControlPin();try{sessionStorage.removeItem('moe-webhook-secret');}catch{}toast(t('locked'),'success');}
    function renderState(){
      const live=controlState.liveTradingEnabled===true&&controlState.killSwitch===false;const sandbox=!live&&controlState.sandboxAutomationEnabled===true;
      const mode=document.getElementById('moeGlobalMode');if(mode){mode.className='moe-mode-chip '+(live?'live':sandbox?'sandbox':'');mode.querySelector('strong').textContent=live?t('live'):sandbox?t('sandbox'):t('stopped');}
      const connection=document.getElementById('moeGlobalConnection');if(connection)connection.querySelector('strong').textContent=controlState.pinConfigured===false?t('disconnected'):t('connected');
      const banner=document.getElementById('moePageModeBanner');if(banner){banner.className='moe-page-mode-banner '+(live?'live':sandbox?'sandbox':'');banner.innerHTML='<span><strong>'+(live?t('live'):sandbox?t('sandbox'):t('stopped'))+'</strong> · '+(live?t('liveWarning'):t('sandboxNote'))+'</span><span>'+t('connection')+': <strong>'+(controlState.pinConfigured===false?t('disconnected'):t('connected'))+'</strong></span>';}
    }
    async function refreshState(){try{const response=await fetch('/api/trading/live/readiness',{cache:'no-store'});const payload=await response.json();if(response.ok&&payload.ok){controlState=payload.control||controlState;renderState();}}catch(error){console.warn(t('refreshError'),error);}}
    function translateLearningCenter(){if(pagePath!=='/learning')return;const map=language==='ar'?{
      'MOERAND Learning Center':'مركز تعلم MOERAND','Evidence-based strategy review with mandatory human approval.':'مراجعة أداء الاستراتيجية المبنية على النتائج، مع موافقة بشرية إلزامية.','Refresh':'تحديث','Generate report':'إنشاء تقرير','Learning status':'حالة التعلم','Closed trades analyzed':'الصفقات المغلقة المحللة','Minimum sample':'الحد الأدنى للعينة','Recommendations':'التوصيات','Data completeness':'اكتمال البيانات','Live promotion gate':'بوابة الجاهزية للاختبار الحقيقي','Safety policy: recommendations are never applied automatically and cannot change live-trading rules without a separate reviewed deployment.':'سياسة الأمان: لا تُطبّق التوصيات تلقائيًا، ولا تغيّر قواعد التداول الحقيقي دون مراجعة ونشر مستقل.','Supervised live promotion gate':'بوابة الجاهزية للاختبار الحقيقي تحت الإشراف','Overall performance':'الأداء العام','Win rate':'نسبة الفوز','Expectancy':'العائد المتوقع لكل صفقة','Profit factor':'معامل الربح','Max losing streak':'أطول سلسلة خسائر','Improvement recommendations':'توصيات التحسين','Learning settings':'إعدادات محرك التعلم','Enable learning engine':'تفعيل محرك التعلم','Minimum sample size':'الحد الأدنى لحجم العينة','Save settings':'حفظ الإعدادات','Performance explorer':'مستكشف الأداء','Timeframes':'الفريمات','Sessions':'الجلسات','Setups':'الإعدادات التداولية','Market regimes':'حالات السوق','Confidence':'درجات الثقة','Sectors':'القطاعات','Symbols':'الأسهم','Approval history':'سجل الموافقات والرفض'}:null;
      if(!map)return;const walker=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT);const nodes=[];while(walker.nextNode())nodes.push(walker.currentNode);nodes.forEach(node=>{const value=node.nodeValue.trim();if(map[value])node.nodeValue=node.nodeValue.replace(value,map[value]);});
    }
    const start=()=>{applyLanguage();translateLearningCenter();refreshState();setInterval(refreshState,10000);window.addEventListener('hashchange',()=>{const old=document.getElementById('moeAppShell');if(old)old.remove();const drawer=document.getElementById('moeMobileDrawer');if(drawer)drawer.remove();shell();});};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  })();
  </script>`;

  const enhanced = html
    .replace('</head>', `${style}</head>`)
    .replace('</body>', `${script}</body>`);
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers: secureHeaders(response),
  });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const response = await worker.fetch(request, env, ctx);
    return enhanceApplication(response, request);
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
