import worker, { AlertCoordinator as BaseAlertCoordinator } from './session-policy-entry.js';
import {
  getSessionNotificationStatus,
  registerSessionNotification,
  testSessionNotification,
  unregisterSessionNotification,
} from './session-notification-service.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const CONFIG_PATH = '/api/trading/session-notifications/config';
const REGISTER_PATH = '/api/trading/session-notifications/register';
const UNREGISTER_PATH = '/api/trading/session-notifications/unregister';
const STATUS_PATH = '/api/trading/session-notifications/status';
const TEST_PATH = '/api/trading/session-notifications/test';
const SERVICE_WORKER_PATH = '/session-notification-sw.js';
const MANIFEST_PATH = '/manifest.webmanifest';

function secureJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function serviceWorkerResponse() {
  const source = `self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{};}catch{payload={title:'MOERAND',body:event.data?event.data.text():'تنبيه جديد'};}
  const options={body:payload.body||'تنبيه جديد',icon:payload.icon||'/icon-192.svg',badge:payload.badge||'/icon-192.svg',tag:payload.tag||'moerand-session-alert',renotify:payload.renotify!==false,timestamp:payload.timestamp||Date.now(),data:payload.data||{url:'/'}};
  event.waitUntil(self.registration.showNotification(payload.title||'MOERAND',options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const target=new URL(event.notification.data?.url||'/',self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{const existing=windows.find(client=>client.url.startsWith(target));return existing?existing.focus():self.clients.openWindow(target);}));
});`;
  return new Response(source, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'service-worker-allowed': '/',
    },
  });
}

function manifestResponse() {
  return new Response(JSON.stringify({
    name: 'MOERAND AI',
    short_name: 'MOERAND',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#06121f',
    theme_color: '#06121f',
    orientation: 'portrait-primary',
    icons: [
      { src: '/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any maskable' },
    ],
  }), {
    headers: {
      'content-type': 'application/manifest+json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function requestPayload(request) {
  try { return await request.json(); }
  catch { throw new Error('Invalid JSON payload'); }
}

async function enhanceDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('moerandSessionNotificationControls')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: secureHeaders(response) });
  }

  const appMeta = `<link rel="manifest" href="/manifest.webmanifest">
  <meta name="theme-color" content="#06121f">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <meta name="apple-mobile-web-app-title" content="MOERAND">`;

  const style = `<style id="moerandSessionNotificationStyles">
  .session-notification-controls{display:grid;grid-template-columns:1fr auto auto;gap:9px;align-items:center;margin-top:10px;padding:10px;border:1px solid rgba(54,89,124,.46);border-radius:10px;background:rgba(5,18,31,.66)}
  .session-notification-copy strong{display:block;font-size:11px;color:#e9f3ff}.session-notification-copy span{display:block;margin-top:4px;font-size:9px;color:#8fa4bf;line-height:1.5}
  .session-notification-button{min-height:40px;padding:8px 12px;border:1px solid #337153;border-radius:9px;background:#145d44;color:#fff;font-weight:900;cursor:pointer}.session-notification-button.off{border-color:#79505a;background:#5f2632}.session-notification-button.test{border-color:#38678e;background:#173e61}.session-notification-button:disabled{opacity:.55;cursor:wait}
  @media(max-width:700px){.session-notification-controls{grid-template-columns:1fr}.session-notification-button{width:100%}}
  </style>`;

  const script = `<script id="moerandSessionNotificationControls">
  (function(){
    let busy=false;
    const byId=id=>document.getElementById(id);
    const notify=(message,type)=>{const toast=byId('controlToast');if(!toast){window.alert(message);return;}toast.textContent=message;toast.className='control-toast show '+(type||'success');setTimeout(()=>toast.className='control-toast',7000);};
    const base64ToBytes=value=>{const padding='='.repeat((4-value.length%4)%4);const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(base64),char=>char.charCodeAt(0));};
    const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
    function environmentIssue(){
      if(!window.isSecureContext)return 'التنبيهات تتطلب فتح الموقع عبر HTTPS مباشرة.';
      if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))return 'هذا المتصفح لا يدعم إشعارات Push.';
      if(isIOS()&&!isStandalone())return 'على iPhone: أضف MOERAND إلى الشاشة الرئيسية، ثم افتحه من الأيقونة وليس داخل Safari.';
      return '';
    }
    function mount(){if(byId('sessionNotificationControls'))return byId('sessionNotificationControls');const panel=byId('sessionPolicyPanel');if(!panel)return null;const controls=document.createElement('div');controls.id='sessionNotificationControls';controls.className='session-notification-controls';controls.innerHTML='<div class="session-notification-copy"><strong id="sessionNotificationTitle">تنبيهات الجلسات غير مفعّلة</strong><span id="sessionNotificationStatus">فعّلها لتصلك إشعارات الافتتاح والانتهاء على هذا الجهاز.</span></div><button type="button" id="sessionNotificationToggle" class="session-notification-button" data-enabled="false">تفعيل التنبيهات</button><button type="button" id="sessionNotificationTest" class="session-notification-button test" disabled>اختبار التنبيه</button>';panel.appendChild(controls);byId('sessionNotificationToggle').onclick=toggle;byId('sessionNotificationTest').onclick=test;return controls;}
    async function registration(){const issue=environmentIssue();if(issue)throw new Error(issue);const registered=await navigator.serviceWorker.register('/session-notification-sw.js',{scope:'/'});await navigator.serviceWorker.ready;return registered;}
    async function currentSubscription(){const reg=await registration();return reg.pushManager.getSubscription();}
    function render(enabled,permission,message){mount();const toggle=byId('sessionNotificationToggle'),testButton=byId('sessionNotificationTest'),title=byId('sessionNotificationTitle'),status=byId('sessionNotificationStatus');toggle.dataset.enabled=enabled?'true':'false';toggle.className='session-notification-button '+(enabled?'off':'');toggle.textContent=enabled?'إيقاف التنبيهات':'تفعيل التنبيهات';testButton.disabled=!enabled||busy;title.textContent=enabled?'تنبيهات الجلسات مفعّلة':'تنبيهات الجلسات غير مفعّلة';status.textContent=message|| (enabled?'سيصلك تنبيه عند افتتاح وانتهاء كل جلسة على هذا الجهاز.':permission==='denied'?'الإشعارات محظورة من إعدادات المتصفح أو الجهاز.':'فعّلها لتصلك إشعارات الافتتاح والانتهاء على هذا الجهاز.');}
    async function refresh(){mount();const issue=environmentIssue();if(issue){render(false,Notification.permission,issue);return;}try{const subscription=await currentSubscription();if(!subscription){render(false,Notification.permission);return;}const response=await fetch('/api/trading/session-notifications/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});const payload=await response.json();render(response.ok&&payload.status?.enabled===true,Notification.permission);}catch(error){render(false,Notification.permission,error.message||String(error));}}
    async function enable(){
      const issue=environmentIssue();if(issue)throw new Error(issue);
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw new Error('لم يتم منح إذن الإشعارات. فعّل الإشعارات من إعدادات المتصفح أو الجهاز.');
      const configResponse=await fetch('/api/trading/session-notifications/config',{cache:'no-store'});const config=await configResponse.json();if(!configResponse.ok||!config.publicKey)throw new Error(config.error||'مفتاح الإشعارات العام غير متاح.');
      const reg=await registration();let subscription=await reg.pushManager.getSubscription();if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64ToBytes(config.publicKey)});
      const response=await fetch('/api/trading/session-notifications/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON()})});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر تفعيل التنبيهات.');
    }
    async function disable(){const subscription=await currentSubscription();if(!subscription){render(false,Notification.permission);return;}const response=await fetch('/api/trading/session-notifications/unregister',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر إيقاف التنبيهات.');await subscription.unsubscribe();}
    async function toggle(){if(busy)return;busy=true;const button=byId('sessionNotificationToggle');const enabled=button?.dataset.enabled==='true';if(button)button.disabled=true;try{if(enabled){await disable();notify('تم إيقاف تنبيهات الجلسات على هذا الجهاز.','success');}else{await enable();notify('تم تفعيل تنبيهات الجلسات على هذا الجهاز.','success');}await refresh();}catch(error){notify(error.message||String(error),'error');await refresh();}finally{busy=false;if(button)button.disabled=false;}}
    async function test(){if(busy)return;busy=true;const button=byId('sessionNotificationTest');if(button)button.disabled=true;try{const subscription=await currentSubscription();if(!subscription)throw new Error('فعّل التنبيهات أولًا.');const response=await fetch('/api/trading/session-notifications/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر إرسال اختبار التنبيه.');notify('تم إرسال اختبار التنبيه إلى هذا الجهاز.','success');}catch(error){notify(error.message||String(error),'error');}finally{busy=false;await refresh();}}
    const start=()=>{mount();refresh();setInterval(refresh,30000);};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();setTimeout(start,900);
  })();
  </script>`;

  const enhanced = html.replace('</head>', `${appMeta}${style}</head>`).replace('</body>', `${script}</body>`);
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers: secureHeaders(response) });
}

export class AlertCoordinator extends BaseAlertCoordinator {
  registerSessionNotification(payload = {}) { return registerSessionNotification(this.ctx.storage, payload); }
  unregisterSessionNotification(endpoint = '') { return unregisterSessionNotification(this.ctx.storage, endpoint); }
  getSessionNotificationStatus(endpoint = '') { return getSessionNotificationStatus(this.ctx.storage, endpoint); }
  testSessionNotification(endpoint = '') { return testSessionNotification(this.ctx.storage, endpoint, this.env); }
}

function coordinator(env) { return env.ALERT_COORDINATOR.getByName('global'); }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === SERVICE_WORKER_PATH && request.method === 'GET') return serviceWorkerResponse();
    if (url.pathname === MANIFEST_PATH && request.method === 'GET') return manifestResponse();
    if (url.pathname === CONFIG_PATH && request.method === 'GET') return secureJson({ ok: true, publicKey: env.VAPID_PUBLIC_KEY || '' });

    if ([REGISTER_PATH, UNREGISTER_PATH, STATUS_PATH, TEST_PATH].includes(url.pathname)) {
      if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      let payload;
      try { payload = await requestPayload(request); }
      catch (error) { return secureJson({ ok: false, error: error.message }, 400); }
      try {
        const stub = coordinator(env);
        if (url.pathname === REGISTER_PATH) return secureJson({ ok: true, status: await stub.registerSessionNotification(payload) });
        if (url.pathname === UNREGISTER_PATH) return secureJson({ ok: true, status: await stub.unregisterSessionNotification(payload.endpoint) });
        if (url.pathname === STATUS_PATH) return secureJson({ ok: true, status: await stub.getSessionNotificationStatus(payload.endpoint) });
        return secureJson({ ok: true, status: await stub.testSessionNotification(payload.endpoint) });
      } catch (error) {
        return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Session notification request failed' }, 400);
      }
    }

    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhanceDashboard(response) : response;
  },
  scheduled(controller, env, ctx) { return worker.scheduled(controller, env, ctx); },
};
