import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-scan-mode-entry.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);

const MOBILE_STATUS_FIX = String.raw`
<script id="moe-mobile-status-fix">
(function(){
  if (window.__moeMobileStatusFixInstalled) return;
  window.__moeMobileStatusFixInstalled = true;

  let connectionKnown = false;
  let paperConnected = false;
  let liveConnected = false;

  async function readJson(url){
    try{
      const response = await fetch(url, {
        cache: 'no-store',
        credentials: 'same-origin',
        headers: {
          accept: 'application/json',
          'x-moe-mobile-client': '1'
        }
      });
      return await response.json().catch(function(){ return {}; });
    }catch(_){
      return {};
    }
  }

  function statusOf(value){
    if(value == null) return '';
    if(typeof value === 'string') return value.trim().toUpperCase();
    if(typeof value === 'object'){
      return String(value.status || value.state || value.connectionStatus || '').trim().toUpperCase();
    }
    return '';
  }

  function isConnected(value){
    return value && typeof value === 'object' && value.connected === true
      || statusOf(value) === 'CONNECTED';
  }

  function setConnectionCard(cardId, stateId, connected, label){
    const card = document.getElementById(cardId);
    const stateLabel = document.getElementById(stateId);
    if(card) card.dataset.connected = String(connected === true);
    if(stateLabel) stateLabel.textContent = label;
  }

  function applyStartGate(){
    const button = document.getElementById('startBtn');
    if(!button || typeof state === 'undefined') return;

    const mode = String(state.mode || 'PAPER').toUpperCase();
    const noSymbols = !state.running && (!Array.isArray(state.symbols) || !state.symbols.length);
    const connectionBlocked = !state.running && connectionKnown && (
      mode === 'LIVE' ? !liveConnected : !paperConnected
    );

    button.disabled = noSymbols || connectionBlocked;
    button.title = connectionBlocked
      ? (mode === 'LIVE' ? 'Live trading is locked.' : 'Paper trading broker is not connected.')
      : '';

    if(state.running) button.textContent = 'Stop trading';
    else if(connectionBlocked) button.textContent = mode === 'LIVE' ? 'Live trading locked' : 'Paper trading offline';
    else button.textContent = 'Start trading';
  }

  async function refreshTradingConnectionsFixed(){
    const results = await Promise.all([
      readJson('/api/health?view=public'),
      readJson('/api/readiness?view=public'),
      readJson('/api/trading/mode')
    ]);
    const health = results[0] || {};
    const readiness = results[1] || {};
    const modePayload = results[2] || {};

    const healthConnections = health.connections || {};
    const readinessConnections = readiness.connections || readiness.readiness?.connections || {};
    paperConnected = [
      health.broker,
      health.webull,
      health.alpaca,
      healthConnections.webull,
      healthConnections.alpaca,
      readiness.broker,
      readiness.webull,
      readiness.alpaca,
      readinessConnections.webull,
      readinessConnections.alpaca
    ].some(isConnected);

    const control = modePayload.control || {};
    const capability = control.staticLiveCapability || modePayload.staticLiveCapability || {};
    const checks = capability.checks || {};
    const liveLocked = modePayload.liveLocked === true
      || control.liveLocked === true
      || control.killSwitch === true
      || readiness.live?.locked === true
      || readiness.live?.killSwitchActive === true;

    liveConnected = control.effectiveLiveUnlocked === true
      && control.killSwitch === false
      && capability.ready === true
      && checks.productionCredentials === true;

    connectionKnown = true;
    setConnectionCard(
      'paperConnection',
      'paperConnectionState',
      paperConnected,
      paperConnected ? 'Connected' : 'Not connected'
    );
    setConnectionCard(
      'liveConnection',
      'liveConnectionState',
      liveConnected,
      liveConnected ? 'Connected' : (liveLocked ? 'Locked' : 'Not connected')
    );
    applyStartGate();
  }

  function sessionIdFrom(payload){
    const nested = payload && payload.session && typeof payload.session === 'object'
      ? payload.session
      : {};
    let current = nested.current;
    if(current == null) current = payload?.current;
    if(current == null && typeof payload?.session === 'string') current = payload.session;
    if(current && typeof current === 'object'){
      current = current.id || current.name || current.current || current.status;
    }
    return String(current || 'CLOSED').trim().toUpperCase();
  }

  function explicitOpenFrom(payload){
    const nested = payload && payload.session && typeof payload.session === 'object'
      ? payload.session
      : {};
    const candidates = [nested.open, nested.isOpen, payload?.open, payload?.isOpen];
    for(const value of candidates){
      if(typeof value === 'boolean') return value;
    }
    return null;
  }

  function timestampFrom(payload, open){
    const nested = payload && payload.session && typeof payload.session === 'object'
      ? payload.session
      : {};
    const value = open
      ? (nested.endsAt || payload?.endsAt || nested.closesAt || payload?.closesAt)
      : (nested.nextOpenAt || payload?.nextOpenAt || nested.opensAt || payload?.opensAt || nested.endsAt || payload?.endsAt);
    if(!value) return null;
    const timestamp = new Date(value).getTime();
    return Number.isFinite(timestamp) ? timestamp : null;
  }

  function sessionAllowed(id){
    const allowed = Array.isArray(state?.sessions) ? state.sessions : [];
    if(id === 'CORE' || id === 'REGULAR') return allowed.includes('REGULAR');
    if(id === 'PREMARKET') return allowed.includes('PREMARKET');
    if(id === 'AFTER_HOURS') return allowed.includes('AFTER_HOURS');
    if(id === 'EXTENDED') return allowed.includes('PREMARKET') || allowed.includes('AFTER_HOURS');
    return false;
  }

  async function refreshMarketFixed(){
    const payload = await readJson('/api/market/session');
    const id = sessionIdFrom(payload);
    const explicitOpen = explicitOpenFrom(payload);
    const open = explicitOpen == null
      ? !['CLOSED', 'UNKNOWN', 'OFFLINE', ''].includes(id)
      : explicitOpen;
    const endsAt = timestampFrom(payload, open);

    state.sessionEndsAt = endsAt;
    const name = document.getElementById('sessName');
    const label = document.getElementById('sessLbl');
    const sub = document.getElementById('sessSub');
    const time = document.getElementById('sessTime');

    if(name){
      name.textContent = open
        ? (SESSION_LABEL[id] || id.replaceAll('_', ' ').toLowerCase().replace(/(^|\s)\S/g, function(c){ return c.toUpperCase(); }))
        : 'Closed';
    }
    if(label) label.textContent = open ? 'until close' : 'until open';
    if(sub){
      sub.textContent = open
        ? (sessionAllowed(id) ? 'Trading allowed in this session' : 'Not in your allowed sessions')
        : 'Waiting for the next session';
    }
    if(!endsAt && time) time.textContent = '—';
    if(typeof paintClock === 'function') paintClock();
  }

  if(typeof paintStart === 'function'){
    const originalPaintStart = paintStart;
    paintStart = function(){
      const result = originalPaintStart.apply(this, arguments);
      applyStartGate();
      return result;
    };
  }

  if(typeof renderChips === 'function'){
    const originalRenderChips = renderChips;
    renderChips = function(){
      const result = originalRenderChips.apply(this, arguments);
      applyStartGate();
      return result;
    };
  }

  if(typeof setMode === 'function'){
    const originalSetMode = setMode;
    setMode = function(){
      const result = originalSetMode.apply(this, arguments);
      applyStartGate();
      return result;
    };
  }

  if(typeof refreshStatus === 'function'){
    const originalRefreshStatus = refreshStatus;
    refreshStatus = async function(){
      await originalRefreshStatus.apply(this, arguments);
      await refreshMarketFixed();
      applyStartGate();
    };
  }

  clearInterval(window.__moeConnectionTick);
  window.__moeConnectionTick = setInterval(refreshTradingConnectionsFixed, 8000);
  refreshTradingConnectionsFixed();
  refreshMarketFixed();
  setTimeout(function(){
    refreshTradingConnectionsFixed();
    refreshMarketFixed();
  }, 600);
})();
</script>`;

async function patchMobileDashboard(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;

  const html = await response.text();
  if (html.includes('id="moe-mobile-status-fix"')) return response;
  const patched = html.includes('</body>')
    ? html.replace('</body>', `${MOBILE_STATUS_FIX}\n</body>`)
    : `${html}\n${MOBILE_STATUS_FIX}`;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  return new Response(patched, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const response = await baseWorker.fetch(request, env, ctx);
    const pathname = new URL(request.url).pathname;
    return MOBILE_PATHS.has(pathname)
      ? patchMobileDashboard(response, request)
      : response;
  },
  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
