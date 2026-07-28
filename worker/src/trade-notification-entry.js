import worker, { AlertCoordinator as BaseAlertCoordinator } from './scanner-universe-entry.js';
import {
  getTradeNotificationStatus,
  registerTradeNotification,
  testTradeNotification,
  unregisterTradeNotification,
} from './session-notification-service.js';
import { getTradeAlertStatus, processTradeLifecycleAlerts } from './trade-alert-service.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const REGISTER_PATH = '/api/trading/trade-notifications/register';
const UNREGISTER_PATH = '/api/trading/trade-notifications/unregister';
const STATUS_PATH = '/api/trading/trade-notifications/status';
const TEST_PATH = '/api/trading/trade-notifications/test';
const HISTORY_PATH = '/api/trading/trade-notifications/history';

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

async function requestPayload(request) {
  try { return await request.json(); }
  catch { throw new Error('Invalid JSON payload'); }
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function enrichLifecycleReport(report = {}) {
  const lifecycles = Array.isArray(report.lifecycles) ? report.lifecycles : [];
  return {
    ...report,
    lifecycles: lifecycles.map((lifecycle) => {
      const exitOrder = lifecycle.exitReason === 'TAKE_PROFIT'
        ? lifecycle.orders?.takeProfit
        : lifecycle.exitReason === 'STOP_LOSS'
          ? lifecycle.orders?.stopLoss
          : null;
      const confirmedExitPrice = positive(exitOrder?.averageFillPrice)
        || positive(exitOrder?.limitPrice)
        || positive(exitOrder?.stopPrice);
      return confirmedExitPrice
        ? { ...lifecycle, exitPrice: confirmedExitPrice, currentPrice: confirmedExitPrice }
        : lifecycle;
    }),
  };
}

async function enhanceDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('moerandTradeNotificationControls')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: secureHeaders(response),
    });
  }

  const style = `<style id="moerandTradeNotificationStyles">
  .trade-notification-controls{display:grid!important;grid-template-columns:1fr auto auto;gap:9px;align-items:center;margin-top:10px;padding:10px;border:1px solid rgba(54,89,124,.46);border-radius:10px;background:rgba(5,18,31,.66);visibility:visible!important;opacity:1!important}
  .trade-notification-copy strong{display:block;font-size:11px;color:#e9f3ff}.trade-notification-copy span{display:block;margin-top:4px;font-size:9px;color:#8fa4bf;line-height:1.5}
  .trade-notification-button{min-height:40px;padding:8px 12px;border:1px solid #337153;border-radius:9px;background:#145d44;color:#fff;font-weight:900;cursor:pointer}.trade-notification-button.off{border-color:#79505a;background:#5f2632}.trade-notification-button.test{border-color:#38678e;background:#173e61}.trade-notification-button:disabled{opacity:.55;cursor:wait}
  @media(max-width:700px){.trade-notification-controls{grid-template-columns:1fr!important}.trade-notification-button{width:100%}}
  </style>`;

  const script = `<script id="moerandTradeNotificationControls">
  (function(){
    let busy=false;
    const byId=id=>document.getElementById(id);
    const notify=(message,type)=>{const toast=byId('controlToast');if(!toast){window.alert(message);return;}toast.textContent=message;toast.className='control-toast show '+(type||'success');setTimeout(()=>toast.className='control-toast',7000);};
    const base64ToBytes=value=>{const padding='='.repeat((4-value.length%4)%4);const base64=(value+padding).replace(/-/g,'+').replace(/_/g,'/');return Uint8Array.from(atob(base64),char=>char.charCodeAt(0));};
    const isIOS=()=>/iphone|ipad|ipod/i.test(navigator.userAgent)||(navigator.platform==='MacIntel'&&navigator.maxTouchPoints>1);
    const isStandalone=()=>window.matchMedia('(display-mode: standalone)').matches||window.navigator.standalone===true;
    function environmentIssue(){
      if(!window.isSecureContext)return 'تنبيهات الصفقات تتطلب فتح الموقع عبر HTTPS مباشرة.';
      if(!('serviceWorker' in navigator)||!('PushManager' in window)||!('Notification' in window))return 'هذا المتصفح لا يدعم إشعارات Push.';
      if(isIOS()&&!isStandalone())return 'على iPhone: افتح MOERAND من أيقونة الشاشة الرئيسية لتفعيل تنبيهات الصفقات.';
      return '';
    }
    function mount(){
      if(byId('tradeNotificationControls'))return byId('tradeNotificationControls');
      const panel=byId('sessionPolicyPanel');if(!panel)return null;
      const controls=document.createElement('div');controls.id='tradeNotificationControls';controls.className='trade-notification-controls';
      controls.innerHTML='<div class="trade-notification-copy"><strong id="tradeNotificationTitle">تنبيهات الصفقات غير مفعّلة</strong><span id="tradeNotificationStatus">فعّلها لتصلك أسعار فتح وإغلاق الصفقة بعد تأكيد Webull.</span></div><button type="button" id="tradeNotificationToggle" class="trade-notification-button" data-enabled="false">تفعيل تنبيهات الصفقات</button><button type="button" id="tradeNotificationTest" class="trade-notification-button test" disabled>اختبار تنبيه الصفقة</button>';
      const sessionControls=byId('sessionNotificationControls');
      if(sessionControls&&sessionControls.parentNode===panel)sessionControls.insertAdjacentElement('afterend',controls);else panel.appendChild(controls);
      byId('tradeNotificationToggle').onclick=toggle;
      byId('tradeNotificationTest').onclick=test;
      return controls;
    }
    async function registration(){const issue=environmentIssue();if(issue)throw new Error(issue);const registered=await navigator.serviceWorker.register('/session-notification-sw.js',{scope:'/'});await navigator.serviceWorker.ready;return registered;}
    async function currentSubscription(){const reg=await registration();return reg.pushManager.getSubscription();}
    function render(enabled,permission,message){
      mount();const toggle=byId('tradeNotificationToggle'),testButton=byId('tradeNotificationTest'),title=byId('tradeNotificationTitle'),status=byId('tradeNotificationStatus');
      toggle.dataset.enabled=enabled?'true':'false';toggle.className='trade-notification-button '+(enabled?'off':'');toggle.textContent=enabled?'إيقاف تنبيهات الصفقات':'تفعيل تنبيهات الصفقات';testButton.disabled=!enabled||busy;title.textContent=enabled?'تنبيهات الصفقات مفعّلة':'تنبيهات الصفقات غير مفعّلة';
      status.textContent=message||(enabled?'سيصلك تنبيه بعد تأكيد فتح الصفقة أو إغلاقها، مع الأسعار والنتيجة.':permission==='denied'?'الإشعارات محظورة من إعدادات المتصفح أو الجهاز.':'فعّلها لتصلك أسعار فتح وإغلاق الصفقة بعد تأكيد Webull.');
    }
    async function refresh(){
      mount();const issue=environmentIssue();if(issue){render(false,Notification.permission,issue);return;}
      try{const subscription=await currentSubscription();if(!subscription){render(false,Notification.permission);return;}const response=await fetch('/api/trading/trade-notifications/status',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});const payload=await response.json();render(response.ok&&payload.status?.enabled===true,Notification.permission);}catch(error){render(false,Notification.permission,error.message||String(error));}
    }
    async function enable(){
      const issue=environmentIssue();if(issue)throw new Error(issue);
      const permission=await Notification.requestPermission();
      if(permission!=='granted')throw new Error('لم يتم منح إذن الإشعارات. فعّل الإشعارات من إعدادات المتصفح أو الجهاز.');
      const configResponse=await fetch('/api/trading/session-notifications/config',{cache:'no-store'});const config=await configResponse.json();if(!configResponse.ok||!config.publicKey)throw new Error(config.error||'مفتاح الإشعارات العام غير متاح.');
      const reg=await registration();let subscription=await reg.pushManager.getSubscription();if(!subscription)subscription=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64ToBytes(config.publicKey)});
      const response=await fetch('/api/trading/trade-notifications/register',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({subscription:subscription.toJSON()})});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر تفعيل تنبيهات الصفقات.');
    }
    async function disable(){
      const subscription=await currentSubscription();if(!subscription){render(false,Notification.permission);return;}
      const response=await fetch('/api/trading/trade-notifications/unregister',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر إيقاف تنبيهات الصفقات.');
    }
    async function toggle(){
      if(busy)return;busy=true;const button=byId('tradeNotificationToggle');const enabled=button?.dataset.enabled==='true';if(button)button.disabled=true;
      try{if(enabled){await disable();notify('تم إيقاف تنبيهات الصفقات على هذا الجهاز.','success');}else{await enable();notify('تم تفعيل تنبيهات الصفقات على هذا الجهاز.','success');}await refresh();}catch(error){notify(error.message||String(error),'error');await refresh();}finally{busy=false;if(button)button.disabled=false;}
    }
    async function test(){
      if(busy)return;busy=true;const button=byId('tradeNotificationTest');if(button)button.disabled=true;
      try{const subscription=await currentSubscription();if(!subscription)throw new Error('فعّل تنبيهات الصفقات أولًا.');const response=await fetch('/api/trading/trade-notifications/test',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({endpoint:subscription.endpoint})});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر إرسال اختبار تنبيه الصفقة.');notify('تم إرسال اختبار تنبيه الصفقة إلى هذا الجهاز.','success');}catch(error){notify(error.message||String(error),'error');}finally{busy=false;await refresh();}
    }
    const start=()=>{mount();refresh();setInterval(refresh,30000);};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();setTimeout(start,1300);
  })();
  </script>`;

  const enhanced = html.replace('</head>', `${style}</head>`).replace('</body>', `${script}</body>`);
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers: secureHeaders(response),
  });
}

export class AlertCoordinator extends BaseAlertCoordinator {
  registerTradeNotification(payload = {}) { return registerTradeNotification(this.ctx.storage, payload); }
  unregisterTradeNotification(endpoint = '') { return unregisterTradeNotification(this.ctx.storage, endpoint); }
  getTradeNotificationStatus(endpoint = '') { return getTradeNotificationStatus(this.ctx.storage, endpoint); }
  testTradeNotification(endpoint = '') { return testTradeNotification(this.ctx.storage, endpoint, this.env); }
  tradeAlertHistory() { return getTradeAlertStatus(this.ctx.storage); }

  async applyLifecycleReport(report = {}) {
    const beforeTrades = await this.listAllTrades();
    const enrichedReport = enrichLifecycleReport(report);
    const persisted = await super.applyLifecycleReport(enrichedReport);
    const afterTrades = await this.listAllTrades();
    let tradeAlerts;
    try {
      tradeAlerts = await processTradeLifecycleAlerts(this.ctx.storage, { beforeTrades, afterTrades, report: enrichedReport }, this.env);
    } catch (error) {
      tradeAlerts = { enabled: true, events: [], error: error instanceof Error ? error.message : 'Trade alert processing failed' };
    }
    return { ...persisted, tradeAlerts };
  }
}

function coordinator(env) { return env.ALERT_COORDINATOR.getByName('global'); }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === HISTORY_PATH) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      try { return secureJson({ ok: true, alerts: await coordinator(env).tradeAlertHistory() }); }
      catch (error) { return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Trade alert history unavailable' }, 500); }
    }

    if ([REGISTER_PATH, UNREGISTER_PATH, STATUS_PATH, TEST_PATH].includes(url.pathname)) {
      if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      let payload;
      try { payload = await requestPayload(request); }
      catch (error) { return secureJson({ ok: false, error: error.message }, 400); }
      try {
        const stub = coordinator(env);
        if (url.pathname === REGISTER_PATH) return secureJson({ ok: true, status: await stub.registerTradeNotification(payload) });
        if (url.pathname === UNREGISTER_PATH) return secureJson({ ok: true, status: await stub.unregisterTradeNotification(payload.endpoint) });
        if (url.pathname === STATUS_PATH) return secureJson({ ok: true, status: await stub.getTradeNotificationStatus(payload.endpoint) });
        return secureJson({ ok: true, status: await stub.testTradeNotification(payload.endpoint) });
      } catch (error) {
        return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Trade notification request failed' }, 400);
      }
    }

    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhanceDashboard(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
