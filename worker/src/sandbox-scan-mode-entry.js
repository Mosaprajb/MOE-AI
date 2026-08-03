// Final Sandbox entry: adds symbol-source selection without changing strategy, risk, or execution.

import baseWorker, {
  AlertCoordinator as BaseAlertCoordinator,
  SimulationDriver,
} from './sandbox-simulation-rpc-entry.js';
import { AUTO_SCANNER_SYMBOLS } from './auto-scanner.js';
import { enhanceScanModeDashboard } from './dashboard/scan-mode-selector.js';
import {
  isMobileClientRequest,
  isMobileDashboardPath,
  isMobileProtectedApiPath,
  serveMobileDashboard as serveMobileDashboardBase,
} from './dashboard/mobile-dashboard.js';
import { handleAuthenticatedMobileApi } from './dashboard/mobile-dashboard-api.js';
import {
  readHistoricalSimulation,
  readHistoricalSimulationReport,
  startHistoricalSimulation,
  stopHistoricalSimulation,
  tickHistoricalSimulation,
} from './simulation/simulation-engine-v2.js';
import {
  SCAN_SOURCE_MODE_API_PATH,
  SCAN_SOURCE_MODES,
  createScanFilteredFetch,
  listScanSourceModeAudit,
  readScanSourceMode,
  selectedScanSymbols,
  updateScanSourceMode,
} from './scanner/scan-source-mode.js';

export { SimulationDriver };

const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/moe-ai', '/moe-ai/']);
const MOBILE_RUNTIME_STATE_PATHS = new Set(['/api/health', '/api/trading/mode']);

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-scan-mode': '1.0.0',
    },
  });
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function sameOriginControlAllowed(request, env = {}) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  let appOrigin = '';
  try { appOrigin = env.APP_URL ? new URL(env.APP_URL).origin : ''; } catch { appOrigin = ''; }
  return origin === requestOrigin
    || origin === String(env.APP_ORIGIN || '').replace(/\/$/, '')
    || origin === appOrigin
    || origin === 'http://localhost:3000';
}

const MOBILE_CONNECTION_STYLE = `
<style id="mobileTradingConnectionStyles">
.trading-connections{display:grid;grid-template-columns:1fr 1fr;gap:9px;margin:0 0 16px}
.trading-connection{display:flex;align-items:center;gap:9px;min-width:0;padding:11px 12px;border:1px solid var(--line);border-radius:14px;background:var(--panel)}
.trading-connection-dot{flex:none;width:11px;height:11px;border-radius:50%;background:var(--red);box-shadow:0 0 12px rgba(229,72,77,.75)}
.trading-connection[data-connected="true"] .trading-connection-dot{background:var(--green);box-shadow:0 0 12px rgba(74,222,128,.75)}
.trading-connection-copy{display:grid;gap:1px;min-width:0}
.trading-connection-name{font-size:12px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.trading-connection-state{font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:10px;font-weight:700;color:var(--red);text-transform:uppercase;letter-spacing:.05em}
.trading-connection[data-connected="true"] .trading-connection-state{color:var(--green)}
.symbol-suggestions{margin-top:8px;max-height:260px;overflow-y:auto;border:1px solid var(--line);border-radius:14px;background:var(--panel);box-shadow:0 16px 34px rgba(0,0,0,.38)}
.symbol-suggestions[hidden]{display:none}
.symbol-suggestion{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 15px;border:0;border-bottom:1px solid var(--line);background:transparent;color:var(--text);font-family:'IBM Plex Mono',ui-monospace,monospace;font-size:16px;font-weight:700;text-align:left;cursor:pointer}
.symbol-suggestion:last-child{border-bottom:0}
.symbol-suggestion:hover,.symbol-suggestion[data-active="true"]{background:var(--accent-dim);color:var(--accent)}
.symbol-suggestion small{font-family:'Archivo',system-ui,sans-serif;font-size:11px;font-weight:700;color:var(--muted);letter-spacing:.05em;text-transform:uppercase}
.symbol-suggestions-empty{padding:14px 15px;color:var(--muted);font-size:14px}
</style>`;

const MOBILE_CONNECTION_HTML = `
<section class="trading-connections" aria-label="Trading connection status">
  <div class="trading-connection" id="paperConnection" data-connected="false">
    <i class="trading-connection-dot" aria-hidden="true"></i>
    <span class="trading-connection-copy">
      <span class="trading-connection-name">Paper Trading</span>
      <span class="trading-connection-state" id="paperConnectionState">Checking</span>
    </span>
  </div>
  <div class="trading-connection" id="liveConnection" data-connected="false">
    <i class="trading-connection-dot" aria-hidden="true"></i>
    <span class="trading-connection-copy">
      <span class="trading-connection-name">Live Trading</span>
      <span class="trading-connection-state" id="liveConnectionState">Checking</span>
    </span>
  </div>
</section>`;

const MOBILE_CONNECTION_SCRIPT = `
const MOE_SYMBOL_UNIVERSE=${JSON.stringify(AUTO_SCANNER_SYMBOLS)};
function setTradingConnection(id,stateId,connected){
  const card=$(id), label=$(stateId);
  if(card) card.dataset.connected=String(connected===true);
  if(label) label.textContent=connected===true?'Connected':'Not connected';
}
function connectionState(value){
  return String(value??'').trim().toUpperCase();
}
async function refreshTradingConnections(){
  let paperConnected=false;
  let liveConnected=false;
  try{
    const h=await api(API.health);
    const brokerState=connectionState(h?.broker?.status);
    const webullState=connectionState(h?.webull?.status??h?.webull);
    const alpacaState=connectionState(h?.alpaca?.status??h?.alpaca);
    paperConnected=h?.broker?.connected===true
      || brokerState==='CONNECTED'
      || webullState==='CONNECTED'
      || alpacaState==='CONNECTED';
  }catch(_){}
  try{
    const m=await api(API.mode);
    const control=m?.control||{};
    const capability=control.staticLiveCapability||{};
    const checks=capability.checks||{};
    liveConnected=control.effectiveLiveUnlocked===true
      && control.killSwitch===false
      && capability.ready===true
      && checks.productionCredentials===true;
  }catch(_){}
  setTradingConnection('paperConnection','paperConnectionState',paperConnected);
  setTradingConnection('liveConnection','liveConnectionState',liveConnected);
}
function setupSymbolSuggestions(inputId){
  const input=$(inputId);
  if(!input||input.dataset.symbolSuggestions==='ready') return;
  input.dataset.symbolSuggestions='ready';
  input.setAttribute('autocomplete','off');
  const list=document.createElement('div');
  list.className='symbol-suggestions';
  list.hidden=true;
  list.setAttribute('role','listbox');
  input.insertAdjacentElement('afterend',list);
  let activeIndex=-1;
  let matches=[];
  function selected(){ return new Set((state.symbols||[]).map(value=>String(value).toUpperCase())); }
  function draw(){
    const query=String(input.value||'').trim().toUpperCase().replace(/[^A-Z0-9.-]/g,'');
    const used=selected();
    const starts=[];
    const contains=[];
    for(const raw of MOE_SYMBOL_UNIVERSE){
      const symbol=String(raw||'').toUpperCase();
      if(!symbol||used.has(symbol)) continue;
      if(!query||symbol.startsWith(query)) starts.push(symbol);
      else if(symbol.includes(query)) contains.push(symbol);
    }
    matches=[...starts,...contains].slice(0,12);
    activeIndex=-1;
    if(!matches.length){
      list.innerHTML=query?'<div class="symbol-suggestions-empty">No supported symbol found.</div>':'';
      list.hidden=!query;
      return;
    }
    list.innerHTML=matches.map((symbol,index)=>'<button type="button" class="symbol-suggestion" data-symbol="'+symbol+'" data-index="'+index+'"><span>'+symbol+'</span><small>Scanner universe</small></button>').join('');
    list.hidden=false;
  }
  function choose(symbol){
    if(!symbol) return;
    input.value=symbol;
    addSymbol(input);
    list.hidden=true;
    activeIndex=-1;
  }
  input.addEventListener('focus',draw);
  input.addEventListener('input',draw);
  input.addEventListener('keydown',event=>{
    if(list.hidden||!matches.length) return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      event.stopImmediatePropagation();
      activeIndex=event.key==='ArrowDown'
        ? (activeIndex+1)%matches.length
        : (activeIndex-1+matches.length)%matches.length;
      list.querySelectorAll('.symbol-suggestion').forEach((node,index)=>node.dataset.active=String(index===activeIndex));
      list.querySelector('[data-active="true"]')?.scrollIntoView({block:'nearest'});
    }else if(event.key==='Enter'&&activeIndex>=0){
      event.preventDefault();
      event.stopImmediatePropagation();
      choose(matches[activeIndex]);
    }else if(event.key==='Escape'){
      event.preventDefault();
      list.hidden=true;
    }
  },true);
  list.addEventListener('mousedown',event=>{
    const button=event.target.closest('[data-symbol]');
    if(!button) return;
    event.preventDefault();
    choose(button.dataset.symbol);
  });
  input.addEventListener('blur',()=>setTimeout(()=>{list.hidden=true;},140));
}
`;

async function serveMobileDashboard(request) {
  const response = serveMobileDashboardBase(request);
  if (request.method === 'HEAD') return response;

  const html = await response.text();
  const unlockedHtml = html
    .replace('</head>', `${MOBILE_CONNECTION_STYLE}\n</head>`)
    .replace('</header>', `</header>\n${MOBILE_CONNECTION_HTML}`)
    .replace(
      /\nlock\(\);\n<\/script>/,
      `${MOBILE_CONNECTION_SCRIPT}\nlock = function(){
  state.unlocked=true;
  pin='';
  paintDots();
  $('lock').hidden=true;
  document.body.style.overflow='';
};
if($('lockNow')) $('lockNow').hidden=true;
setupSymbolSuggestions('symInput');
setupSymbolSuggestions('symInput2');
lock();
boot();
refreshTradingConnections();
clearInterval(window.__moeConnectionTick);
window.__moeConnectionTick=setInterval(refreshTradingConnections,8000);
</script>`,
    );

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  return new Response(unlockedHtml, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function normalizeMobileRuntimeState(request, response, stub) {
  const pathname = new URL(request.url).pathname;
  if (!response || !MOBILE_RUNTIME_STATE_PATHS.has(pathname)) return response;
  const payload = await response.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object') return response;

  const runtime = await stub.mobileDashboardRuntime();
  const armed = runtime?.armed === true;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-moe-mobile-runtime-authoritative', '1');
  return new Response(JSON.stringify({
    ...payload,
    armed,
    runtime: {
      ...(payload.runtime && typeof payload.runtime === 'object' ? payload.runtime : {}),
      ...runtime,
      armed,
    },
  }), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async startHistoricalSimulation(options = {}) {
    return startHistoricalSimulation(this.ctx.storage, this.env, options);
  }

  async tickHistoricalSimulation() {
    return tickHistoricalSimulation(this.ctx.storage, this.env);
  }

  async stopHistoricalSimulation() {
    return stopHistoricalSimulation(this.ctx.storage, this.env);
  }

  async historicalSimulationStatus() {
    return readHistoricalSimulation(this.ctx.storage);
  }

  async historicalSimulationReport() {
    return readHistoricalSimulationReport(this.ctx.storage);
  }

  async scanSourceMode() {
    return readScanSourceMode(this.ctx.storage, { fullUniverseSize: AUTO_SCANNER_SYMBOLS.length });
  }

  async updateScanSourceMode(patch = {}, actor = 'DASHBOARD') {
    return updateScanSourceMode(this.ctx.storage, patch, {
      actor,
      fullUniverseSize: AUTO_SCANNER_SYMBOLS.length,
    });
  }

  async scanSourceModeAudit(options = {}) {
    return listScanSourceModeAudit(this.ctx.storage, options);
  }

  async getTradingSessionPolicy() {
    const runtime = await this.mobileDashboardRuntime();
    return {
      sessions: [...runtime.sessions],
      mode: runtime.sessions.length === 3 ? 'ALL_SESSIONS' : 'CUSTOM',
      updatedAt: runtime.updatedAt || null,
      updatedBy: runtime.updatedBy || null,
      storage: 'DURABLE_OBJECT',
    };
  }

  async updateTradingSessionPolicyFromMobile(sessions = [], actor = 'MOBILE_DASHBOARD') {
    const runtime = await this.updateMobileDashboardRuntime({ sessions }, actor);
    return {
      sessions: [...runtime.sessions],
      mode: runtime.sessions.length === 3 ? 'ALL_SESSIONS' : 'CUSTOM',
      updatedAt: runtime.updatedAt,
      updatedBy: runtime.updatedBy,
      storage: 'DURABLE_OBJECT',
    };
  }
}

async function handleScanModeApi(request, env) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (!sameOriginControlAllowed(request, env)) {
    return json({ ok: false, code: 'ORIGIN_NOT_ALLOWED', error: 'Origin not allowed.' }, 403);
  }
  const stub = coordinator(env);
  if (request.method === 'GET') {
    const [scanMode, recentAudit] = await Promise.all([
      stub.scanSourceMode(),
      stub.scanSourceModeAudit({ limit: 25 }),
    ]);
    return json({
      ok: true,
      scanMode,
      recentAudit,
      storage: 'DURABLE_OBJECT',
      defaultMode: SCAN_SOURCE_MODES.FULL_UNIVERSE,
      symbolSelectionOnly: true,
      riskGatesBypassed: false,
      liveLockBypassed: false,
    });
  }
  if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed.' }, 405);
  let body;
  try { body = await request.json(); } catch { return json({ ok: false, error: 'Valid JSON is required.' }, 400); }
  try {
    const result = await stub.updateScanSourceMode(body, 'DASHBOARD');
    return json({
      ok: true,
      ...result,
      storage: 'DURABLE_OBJECT',
      symbolSelectionOnly: true,
      riskGatesBypassed: false,
      liveLockBypassed: false,
    });
  } catch (error) {
    return json({
      ok: false,
      code: error?.code || 'SCAN_MODE_UPDATE_FAILED',
      error: error instanceof Error ? error.message : 'Scan mode update failed.',
      invalidSymbols: error?.invalidSymbols || [],
    }, 422);
  }
}

async function runScheduledWithSelectedSymbols(controller, env, ctx) {
  const scanMode = await coordinator(env).scanSourceMode();
  if (scanMode.mode === SCAN_SOURCE_MODES.FULL_UNIVERSE) {
    return baseWorker.scheduled(controller, env, ctx);
  }

  const symbols = selectedScanSymbols(scanMode, AUTO_SCANNER_SYMBOLS);
  if (!symbols.length) {
    console.warn(JSON.stringify({
      event: 'AUTO_SCANNER_SKIPPED_EMPTY_MANUAL_UNIVERSE',
      scanMode: scanMode.mode,
      createdAt: new Date().toISOString(),
    }));
    return baseWorker.scheduled(controller, { ...env, AUTO_SCANNER_ENABLED: 'false' }, ctx);
  }

  // The legacy scanner batches the Full Universe internally. This fetch adapter intersects each
  // Alpaca batch with the selected manual universe, so only selected symbols receive bars and can
  // enter any strategy pipeline. It does not alter strategy calculations or any downstream gate.
  const originalFetch = globalThis.fetch;
  const capturedTasks = [];
  const scopedContext = {
    ...ctx,
    waitUntil(promise) {
      capturedTasks.push(Promise.resolve(promise));
    },
  };
  const scopedEnv = {
    ...env,
    AUTO_SCANNER_SCAN_MODE: scanMode.mode,
    AUTO_SCANNER_SELECTED_SYMBOLS: symbols.join(','),
  };

  globalThis.fetch = createScanFilteredFetch(originalFetch.bind(globalThis), symbols);
  try {
    const returned = baseWorker.scheduled(controller, scopedEnv, scopedContext);
    if (returned && typeof returned.then === 'function') await returned;
    if (capturedTasks.length) await Promise.allSettled(capturedTasks);
    console.log(JSON.stringify({
      event: 'AUTO_SCANNER_MANUAL_UNIVERSE_APPLIED',
      scanMode: scanMode.mode,
      symbols,
      symbolCount: symbols.length,
      strategyLogicAffected: false,
      riskGatesAffected: false,
      liveLockAffected: false,
      createdAt: new Date().toISOString(),
    }));
  } finally {
    globalThis.fetch = originalFetch;
  }
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (isMobileDashboardPath(pathname)) return serveMobileDashboard(request);

    const stub = coordinator(env);
    const mobileRequest = isMobileClientRequest(request) && isMobileProtectedApiPath(pathname);
    if (mobileRequest) {
      const mobileResponse = await handleAuthenticatedMobileApi(request, env, stub, {
        baseFetch: (nextRequest) => baseWorker.fetch(nextRequest, env, ctx),
      });
      if (mobileResponse) return normalizeMobileRuntimeState(request, mobileResponse, stub);
    }

    if (pathname === SCAN_SOURCE_MODE_API_PATH) return handleScanModeApi(request, env);
    const response = await baseWorker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(pathname) ? enhanceScanModeDashboard(response) : response;
  },
  scheduled(controller, env, ctx) {
    const task = runScheduledWithSelectedSymbols(controller, env, ctx).catch((error) => {
      console.error(JSON.stringify({
        event: 'SCAN_MODE_SCHEDULE_FAILED_CLOSED',
        error: error instanceof Error ? error.message : 'Scan mode scheduler failed.',
        scannerExecuted: false,
        liveFundsUsed: false,
        createdAt: new Date().toISOString(),
      }));
      throw error;
    });
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
    return task;
  },
};
