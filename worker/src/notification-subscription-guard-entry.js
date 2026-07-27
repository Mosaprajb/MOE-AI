import worker, { AlertCoordinator } from './trade-notification-entry.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

async function protectSharedSubscription(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('moerandSharedPushSubscriptionGuard')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: secureHeaders(response),
    });
  }

  const script = `<script id="moerandSharedPushSubscriptionGuard">
  (function(){
    try{
      const proto=window.PushSubscription&&window.PushSubscription.prototype;
      if(!proto||typeof proto.unsubscribe!=='function'||proto.__moerandPreferenceSafe)return;
      const nativeUnsubscribe=proto.unsubscribe;
      Object.defineProperty(proto,'__moerandPreferenceSafe',{value:true,configurable:false});
      Object.defineProperty(proto,'__moerandNativeUnsubscribe',{value:nativeUnsubscribe,configurable:false});
      proto.unsubscribe=function(){return Promise.resolve(true);};
    }catch(error){console.warn('MOERAND shared push subscription guard unavailable',error);}
  })();
  </script>`;

  const enhanced = html.replace('</body>', `${script}</body>`);
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
    const path = new URL(request.url).pathname;
    return DASHBOARD_PATHS.has(path) ? protectSharedSubscription(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
