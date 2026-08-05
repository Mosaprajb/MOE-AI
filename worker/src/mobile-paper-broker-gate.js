import { getWebullAccountSnapshot } from './webull-client.js';

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const BROKER_GATE_UI_MARKER = 'moe-mobile-paper-broker-gate';
const BROKER_GATE_TTL_MS = 8_000;

let cachedGate = null;
let cachedGateAccountId = '';
let cachedGateExpiresAt = 0;

function configuredCredentials(env = {}) {
  const required = ['WEBULL_APP_KEY', 'WEBULL_APP_SECRET', 'WEBULL_ACCESS_TOKEN', 'WEBULL_ACCOUNT_ID'];
  const missing = required.filter((key) => !String(env[key] || '').trim());
  return {
    configured: missing.length === 0,
    missing,
    accountId: String(env.WEBULL_ACCOUNT_ID || '').trim(),
  };
}

export function isMobileClientRequest(request) {
  if (request.headers.get('x-moe-mobile-client') === '1') return true;
  const referer = request.headers.get('referer');
  if (!referer) return false;
  try {
    return MOBILE_PATHS.has(new URL(referer).pathname);
  } catch {
    return false;
  }
}

export async function readMobilePaperBrokerGate(env = {}, options = {}) {
  const credentials = configuredCredentials(env);
  const now = Number(options.now) || Date.now();
  const useCache = options.useCache !== false;

  if (!credentials.configured) {
    return {
      mode: 'PAPER',
      configured: false,
      connected: false,
      status: 'NOT_CONFIGURED',
      reason: 'PAPER_BROKER_CREDENTIALS_MISSING',
      checkedAt: new Date(now).toISOString(),
    };
  }

  if (
    useCache
    && cachedGate
    && cachedGateAccountId === credentials.accountId
    && cachedGateExpiresAt > now
  ) {
    return cachedGate;
  }

  const snapshotReader = options.snapshotReader || getWebullAccountSnapshot;
  let result;
  try {
    const snapshot = await snapshotReader(credentials.accountId, env);
    result = {
      mode: 'PAPER',
      configured: true,
      connected: true,
      status: 'CONNECTED',
      reason: null,
      checkedAt: snapshot?.fetchedAt || new Date(now).toISOString(),
    };
  } catch {
    result = {
      mode: 'PAPER',
      configured: true,
      connected: false,
      status: 'CONNECTION_FAILED',
      reason: 'PAPER_BROKER_PROBE_FAILED',
      checkedAt: new Date(now).toISOString(),
    };
  }

  if (useCache) {
    cachedGate = result;
    cachedGateAccountId = credentials.accountId;
    cachedGateExpiresAt = now + BROKER_GATE_TTL_MS;
  }
  return result;
}

export async function ensureMobilePaperBrokerSafeRuntime(
  env = {},
  stub = null,
  actor = 'MOBILE_PAPER_BROKER_GATE',
) {
  const broker = await readMobilePaperBrokerGate(env);
  let runtime = null;
  try {
    runtime = stub ? await stub.mobileDashboardRuntime() : null;
  } catch {
    runtime = null;
  }

  const wasArmed = runtime?.armed === true;
  if (wasArmed && broker.connected !== true && stub) {
    try {
      runtime = await stub.updateMobileDashboardRuntime({ armed: false }, actor);
    } catch {
      runtime = { ...(runtime || {}), armed: false };
    }
  }

  return {
    broker,
    runtime,
    wasArmed,
    armed: runtime?.armed === true && broker.connected === true,
  };
}

export async function mobilePaperArmIntent(request) {
  if (request.method !== 'PUT' || !isMobileClientRequest(request)) return false;
  let payload;
  try {
    payload = await request.clone().json();
  } catch {
    return false;
  }
  if (payload?.armed !== true) return false;
  return String(payload.mode || 'SANDBOX').trim().toUpperCase() !== 'LIVE';
}

export function paperBrokerOfflineStartResponse(broker = {}) {
  return Response.json({
    ok: false,
    code: 'PAPER_BROKER_OFFLINE',
    error: broker.configured === false
      ? 'Paper broker is not configured. Trading was not started.'
      : 'Paper broker is offline. Trading was not started.',
    broker: {
      mode: 'PAPER',
      configured: broker.configured === true,
      connected: false,
      status: broker.status || 'CONNECTION_FAILED',
    },
    armed: false,
    scannerArmed: false,
  }, {
    status: 409,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-mobile-paper-broker-gate': 'blocked',
    },
  });
}

export async function normalizeMobileHealthForPaperBroker(
  response,
  env = {},
  stub = null,
) {
  if (!response.ok) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload) return response;

  const safety = await ensureMobilePaperBrokerSafeRuntime(
    env,
    stub,
    'MOBILE_HEALTH_BROKER_OFFLINE',
  );
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-moe-mobile-paper-broker-gate', safety.broker.connected ? 'connected' : 'offline');

  return new Response(JSON.stringify({
    ...payload,
    armed: safety.armed,
    scannerArmed: safety.armed,
    broker: {
      ...(payload.broker && typeof payload.broker === 'object' ? payload.broker : {}),
      mode: 'PAPER',
      configured: safety.broker.configured === true,
      connected: safety.broker.connected === true,
      status: safety.broker.status,
    },
    mobileRuntime: safety.runtime && typeof safety.runtime === 'object'
      ? { ...safety.runtime, armed: safety.armed }
      : { armed: false },
    paperBrokerGate: safety.broker,
  }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

const BROKER_GATE_UI_SCRIPT = String.raw`
<script id="${BROKER_GATE_UI_MARKER}">
(function(){
  if(window.__moeMobilePaperBrokerGate)return;
  window.__moeMobilePaperBrokerGate=true;
  const HEALTH_ENDPOINT='/api/health?mobilePaperBrokerGate=1';
  let paperConnected=false;
  let gateLoading=false;

  function node(id){return document.getElementById(id);}
  function paperMode(){return typeof state==='undefined'||String(state.mode||'PAPER').toUpperCase()!=='LIVE';}
  function running(){return typeof state!=='undefined'&&state.running===true;}
  function symbolCount(){return typeof state==='undefined'||!Array.isArray(state.symbols)?0:state.symbols.length;}

  function showBlockedMessage(){
    const message='Paper broker is offline. Trading cannot start until the Paper account reconnects.';
    if(typeof openInfoRaw==='function'){
      openInfoRaw('Paper broker offline','<div class="danger-note">'+message+'</div><p class="note">The scanner remains stopped and no order can be submitted.</p>');
    }
  }

  function applyGate(){
    const start=node('startBtn');
    const broker=node('stBroker');
    const engine=node('stEngine');
    if(broker&&paperMode()){
      broker.textContent=paperConnected?'Connected':'Offline';
      broker.className=paperConnected?'ok':'bad';
    }
    if(!start)return;

    if(!paperMode()){
      start.disabled=true;
      start.dataset.brokerGate='live-locked';
      start.textContent='Live trading locked';
      return;
    }

    if(!paperConnected){
      if(typeof state!=='undefined')state.running=false;
      start.dataset.running='false';
      start.dataset.brokerGate='offline';
      start.disabled=true;
      start.textContent='Paper broker offline';
      if(engine){engine.textContent='Stopped';engine.className='off';}
      return;
    }

    start.dataset.brokerGate='connected';
    start.dataset.running=String(running());
    start.textContent=running()?'Stop trading':'Start trading';
    start.disabled=!running()&&symbolCount()===0;
  }

  async function refreshGate(force){
    if(gateLoading&&!force)return;
    gateLoading=true;
    try{
      const response=await fetch(HEALTH_ENDPOINT+'&t='+Date.now(),{
        cache:'no-store',
        credentials:'same-origin',
        headers:{accept:'application/json','x-moe-mobile-client':'1'}
      });
      const payload=await response.json().catch(function(){return {};});
      if(!response.ok||payload.ok===false)throw new Error(payload.error||'Broker status unavailable');
      paperConnected=payload.broker&&payload.broker.connected===true;
      if(typeof state!=='undefined'&&payload.armed!=null)state.running=payload.armed===true;
    }catch(_){
      paperConnected=false;
      if(typeof state!=='undefined')state.running=false;
    }finally{
      gateLoading=false;
      applyGate();
    }
  }

  function wrapPainters(){
    if(typeof paintStart==='function'&&!paintStart.__moePaperBrokerGateWrapped){
      const original=paintStart;
      const wrapped=function(){const result=original.apply(this,arguments);applyGate();return result;};
      wrapped.__moePaperBrokerGateWrapped=true;
      paintStart=wrapped;
    }
    if(typeof renderChips==='function'&&!renderChips.__moePaperBrokerGateWrapped){
      const original=renderChips;
      const wrapped=function(){const result=original.apply(this,arguments);applyGate();return result;};
      wrapped.__moePaperBrokerGateWrapped=true;
      renderChips=wrapped;
    }
  }

  function install(){
    wrapPainters();
    const start=node('startBtn');
    if(start&&!start.dataset.brokerGateBound){
      start.dataset.brokerGateBound='1';
      start.addEventListener('click',function(event){
        if(paperMode()&&!running()&&!paperConnected){
          event.preventDefault();
          event.stopImmediatePropagation();
          showBlockedMessage();
          refreshGate(true);
        }
      },true);
    }
    refreshGate(true);
    clearInterval(window.__moePaperBrokerGateTick);
    window.__moePaperBrokerGateTick=setInterval(function(){if(!document.hidden)refreshGate(false);},5000);
    document.addEventListener('visibilitychange',function(){if(!document.hidden)refreshGate(true);});
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
</script>`;

export async function enhanceMobilePaperBrokerGateUi(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  if (html.includes(`id="${BROKER_GATE_UI_MARKER}"`)) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }

  const enhanced = html.includes('</body>')
    ? html.replace('</body>', `${BROKER_GATE_UI_SCRIPT}\n</body>`)
    : `${html}\n${BROKER_GATE_UI_SCRIPT}`;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('x-moe-mobile-paper-broker-ui', 'enabled');
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
