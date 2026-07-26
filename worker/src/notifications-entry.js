import worker, { AlertCoordinator as PageRouterCoordinator } from './page-router-entry.js';
import {
  emitConfirmedTradeNotification,
  listTradeNotifications,
  notificationServiceStatus,
  registerNotificationSubscription,
  sendTestNotification,
  unregisterNotificationSubscription,
} from './trade-notification-service.js';

const SERVICE_WORKER_PATH = '/notification-sw.js';
const PATHS = {
  config: '/api/notifications/config',
  subscribe: '/api/notifications/subscribe',
  unsubscribe: '/api/notifications/unsubscribe',
  status: '/api/notifications/status',
  history: '/api/notifications/history',
  test: '/api/notifications/test',
};

function secureJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function notificationServiceWorker() {
  const source = `
self.addEventListener('install',event=>{self.skipWaiting();});
self.addEventListener('activate',event=>{event.waitUntil(self.clients.claim());});
self.addEventListener('push',event=>{
  let payload={};
  try{payload=event.data?event.data.json():{};}catch{payload={title:'MOE-AI',body:event.data?event.data.text():'New trade update'};}
  const title=payload.title||'MOE-AI';
  const options={
    body:payload.body||'New trade update',
    tag:payload.tag||'moe-ai-trade',
    renotify:payload.renotify===true,
    timestamp:payload.timestamp||Date.now(),
    data:payload.data||{url:'/alerts'}
  };
  event.waitUntil(self.registration.showNotification(title,options));
});
self.addEventListener('notificationclick',event=>{
  event.notification.close();
  const raw=event.notification.data&&event.notification.data.url?event.notification.data.url:'/alerts';
  const target=new URL(raw,self.location.origin).href;
  event.waitUntil(self.clients.matchAll({type:'window',includeUncontrolled:true}).then(windows=>{
    const exact=windows.find(client=>client.url===target);
    if(exact)return exact.focus();
    const sameOrigin=windows.find(client=>client.url.startsWith(self.location.origin));
    if(sameOrigin)return sameOrigin.navigate(target).then(client=>client.focus());
    return self.clients.openWindow(target);
  }));
});`;
  return new Response(source, {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-cache, no-store, must-revalidate',
      'service-worker-allowed': '/',
      'x-content-type-options': 'nosniff',
    },
  });
}

function isHtml(response) {
  return String(response?.headers?.get?.('content-type') || '').includes('text/html');
}

async function registerNotificationWorkerInPage(response) {
  if (!isHtml(response)) return response;
  const html = await response.text();
  if (html.includes('moeNotificationWorkerRegistration')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const script = `<script id="moeNotificationWorkerRegistration">(function(){if(!('serviceWorker'in navigator))return;window.addEventListener('load',function(){navigator.serviceWorker.register('${SERVICE_WORKER_PATH}',{scope:'/'}).catch(function(error){console.error('MOE notification service worker registration failed',error);});},{once:true});})();</script>`;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return new Response(html.replace('</body>', `${script}</body>`), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('Invalid JSON payload');
  }
}

export class AlertCoordinator extends PageRouterCoordinator {
  async registerTradeNotificationSubscription(payload = {}) {
    return registerNotificationSubscription(this.ctx.storage, payload);
  }

  async unregisterTradeNotificationSubscription(endpoint = '') {
    return unregisterNotificationSubscription(this.ctx.storage, endpoint);
  }

  async tradeNotificationStatus() {
    return notificationServiceStatus(this.ctx.storage, this.env);
  }

  async tradeNotificationHistory(options = {}) {
    return listTradeNotifications(this.ctx.storage, options);
  }

  async testTradeNotification(options = {}) {
    return sendTestNotification(this.ctx.storage, options, this.env);
  }

  async syncConfirmedTradeNotifications() {
    const trades = await this.listAllTrades();
    const control = await this.getLiveControlState();
    const fallbackMode = control.liveTradingEnabled === true && control.killSwitch === false ? 'live' : 'demo';
    const results = [];

    for (const trade of trades) {
      const entry = await emitConfirmedTradeNotification(this.ctx.storage, trade, 'entry', this.env, fallbackMode);
      if (entry.sent || entry.duplicate || entry.retryLimitReached) {
        results.push({ tradeId: trade.id, eventType: 'entry', ...entry });
      }
      if (String(trade.status || '').toUpperCase() === 'CLOSED') {
        const exit = await emitConfirmedTradeNotification(this.ctx.storage, trade, 'exit', this.env, fallbackMode);
        if (exit.sent || exit.duplicate || exit.retryLimitReached) {
          results.push({ tradeId: trade.id, eventType: 'exit', ...exit });
        }
      }
    }

    return {
      checked: trades.length,
      events: results.length,
      results,
      syncedAt: new Date().toISOString(),
    };
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

async function handleNotifications(request, env) {
  const url = new URL(request.url);
  const stub = coordinator(env);

  try {
    if (url.pathname === PATHS.config) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      return secureJson({
        ok: true,
        publicKey: String(env.VAPID_PUBLIC_KEY || ''),
        providerConfigured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK),
      });
    }

    if (url.pathname === PATHS.subscribe) {
      if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      const payload = await parseJson(request);
      return secureJson({ ok: true, device: await stub.registerTradeNotificationSubscription(payload) });
    }

    if (url.pathname === PATHS.unsubscribe) {
      if (request.method !== 'DELETE' && request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      const payload = await parseJson(request);
      return secureJson({ ok: true, ...(await stub.unregisterTradeNotificationSubscription(payload.endpoint)) });
    }

    if (url.pathname === PATHS.status) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      return secureJson({ ok: true, ...(await stub.tradeNotificationStatus()) });
    }

    if (url.pathname === PATHS.history) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      const notifications = await stub.tradeNotificationHistory({
        mode: url.searchParams.get('mode') || '',
        eventType: url.searchParams.get('eventType') || '',
        status: url.searchParams.get('status') || '',
        limit: url.searchParams.get('limit') || 100,
      });
      return secureJson({ ok: true, count: notifications.length, notifications });
    }

    if (url.pathname === PATHS.test) {
      if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      const status = await stub.tradeNotificationStatus();
      if (!status.providerConfigured) {
        return secureJson({ ok: false, sent: false, error: 'Notification service is not fully configured.' }, 503);
      }
      const payload = await parseJson(request);
      const result = await stub.testTradeNotification(payload);
      return secureJson({ ok: true, ...result }, result.sent ? 200 : 424);
    }

    return null;
  } catch (error) {
    return secureJson({
      ok: false,
      error: error instanceof Error ? error.message : 'Notification request failed',
    }, 400);
  }
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (path === SERVICE_WORKER_PATH) return notificationServiceWorker();
    if (Object.values(PATHS).includes(path)) {
      const response = await handleNotifications(request, env);
      if (response) return response;
    }
    const response = await worker.fetch(request, env, ctx);
    return registerNotificationWorkerInPage(response);
  },

  scheduled(controller, env, ctx) {
    const base = worker.scheduled(controller, env, ctx);
    const sync = coordinator(env).syncConfirmedTradeNotifications().then((result) => {
      console.log(JSON.stringify({ event: 'CONFIRMED_TRADE_NOTIFICATIONS_SYNCED', ...result }));
      return result;
    }).catch((error) => {
      console.error(JSON.stringify({
        event: 'CONFIRMED_TRADE_NOTIFICATION_SYNC_FAILED',
        error: error instanceof Error ? error.message : 'Unknown notification sync error',
        createdAt: new Date().toISOString(),
      }));
      return null;
    });
    if (ctx?.waitUntil) ctx.waitUntil(sync);
    return base;
  },
};
