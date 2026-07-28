import worker, { AlertCoordinator } from './live-ui-consistency-entry.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

async function enhanceDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  if (html.includes('moerandPinSessionBroker')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: secureHeaders(response),
    });
  }

  const broker = `<script id="moerandPinSessionBroker">
  (function(){
    if(window.__moerandPinBrokerReady)return;
    window.__moerandPinBrokerReady=true;

    let sessionPin='';
    const nativePrompt=window.prompt.bind(window);
    const pinPrompt=message=>/MOERAND|PIN|رمز التحكم|الرمز السري/i.test(String(message||''));

    window.__getMoerandControlPin=function(message){
      if(sessionPin)return sessionPin;
      const entered=nativePrompt(message||'أدخل رمز التحكم السري لـ MOERAND. سيبقى في ذاكرة الصفحة فقط.')||'';
      sessionPin=String(entered).trim();
      window.__portfolioRiskPin=sessionPin;
      return sessionPin;
    };
    window.__setMoerandControlPin=function(value){
      sessionPin=String(value||'').trim();
      window.__portfolioRiskPin=sessionPin;
      return sessionPin;
    };
    window.__clearMoerandControlPin=function(){
      sessionPin='';
      window.__portfolioRiskPin='';
    };
    window.__hasMoerandControlPin=function(){return Boolean(sessionPin);};

    window.prompt=function(message,defaultValue){
      if(pinPrompt(message))return window.__getMoerandControlPin(message);
      return nativePrompt(message,defaultValue);
    };

    const nativeFetch=window.fetch.bind(window);
    window.fetch=async function(input,init){
      const response=await nativeFetch(input,init);
      const url=typeof input==='string'?input:String(input?.url||'');
      const protectedPath=/\/api\/(trading\/live|trading-intelligence\/portfolio-risk)/.test(url);
      if(protectedPath&&[401,403,423].includes(response.status)){
        response.clone().text().then(body=>{
          if(/incorrect pin|invalid pin|pin controls|temporarily locked/i.test(body))window.__clearMoerandControlPin();
        }).catch(()=>{});
      }
      return response;
    };
  })();
  </script>`;

  const enhanced = html.replace('</head>', `${broker}</head>`);
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
    return DASHBOARD_PATHS.has(path) ? enhanceDashboard(response) : response;
  },

  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
