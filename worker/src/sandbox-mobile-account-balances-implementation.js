import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-phone-fix-entry.js';
import { getWebullAccountSnapshot } from './webull-client.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const PORTFOLIO_PATH = '/api/trading-intelligence/portfolio-risk';
const LIVE_BALANCE_CACHE_URL = 'https://moerand.internal/mobile-live-account-balances-v1';

function numeric(value, fallback = null) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : fallback;
  }
  if (value && typeof value === 'object') {
    for (const key of ['amount', 'value', 'balance', 'quantity']) {
      const parsed = numeric(value[key], null);
      if (parsed != null) return parsed;
    }
  }
  return fallback;
}

function normalizedKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function findAmount(root, keys, depth = 0, seen = new Set()) {
  if (root == null || typeof root !== 'object' || depth > 10 || seen.has(root)) return null;
  seen.add(root);
  const entries = Array.isArray(root) ? [...root.entries()] : Object.entries(root);

  for (const [key, value] of entries) {
    if (!keys.has(normalizedKey(key))) continue;
    const parsed = numeric(value, null);
    if (parsed != null) return parsed;
  }

  for (const [, value] of entries) {
    const parsed = findAmount(value, keys, depth + 1, seen);
    if (parsed != null) return parsed;
  }
  return null;
}

function liveCredentials(env = {}) {
  const fields = {
    appKey: String(env.WEBULL_LIVE_APP_KEY || '').trim(),
    appSecret: String(env.WEBULL_LIVE_APP_SECRET || '').trim(),
    accessToken: String(env.WEBULL_LIVE_ACCESS_TOKEN || '').trim(),
    accountId: String(env.WEBULL_LIVE_ACCOUNT_ID || '').trim(),
  };
  const missing = Object.entries(fields)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  return { ...fields, missing, configured: missing.length === 0 };
}

function liveReadEnv(env = {}, credentials = liveCredentials(env)) {
  return {
    ...env,
    WEBULL_APP_KEY: credentials.appKey,
    WEBULL_APP_SECRET: credentials.appSecret,
    WEBULL_ACCESS_TOKEN: credentials.accessToken,
    WEBULL_ACCOUNT_ID: credentials.accountId,
    WEBULL_ENVIRONMENT: 'production',
    WEBULL_API_BASE_URL: String(env.WEBULL_LIVE_API_BASE_URL || 'https://api.webull.com').trim(),
    WEBULL_LIVE_TRADING: 'false',
    WEBULL_LIVE_ORDER_SUBMISSION: 'false',
    WEBULL_LIVE_AUTOMATION_ARMED: 'false',
    WEBULL_LIVE_KILL_SWITCH: 'true',
  };
}

function accountAmounts(balance = {}) {
  const cashBalance = findAmount(balance, new Set([
    'totalcashbalance',
    'cashbalance',
    'cash',
    'totalcash',
    'settledcash',
    'availablecash',
    'cashavailable',
    'availablewithdrawal',
    'availabletowithdraw',
    'withdrawablecash',
    'cashavailableforwithdrawal',
  ]));
  const marginBalance = findAmount(balance, new Set([
    'daybuyingpower',
    'buyingpower',
    'stockbuyingpower',
    'overnightbuyingpower',
    'nighttradingbuyingpower',
    'marginexcess',
    'marginbuyingpower',
    'availablebuyingpower',
    'availablefunds',
    'onedaymarginpower',
    'infinitemarginpower',
    'stockpower',
  ]));
  const accountValue = findAmount(balance, new Set([
    'totalnetliquidationvalue',
    'netliquidationvalue',
    'netliquidation',
    'totalcollateralvalue',
    'totalassetvalue',
    'totalasset',
    'totalassets',
    'accountvalue',
    'equity',
    'netassets',
    'totalmarketvalue',
  ]));
  return { cashBalance, marginBalance, accountValue };
}

function accountTotal(account = {}) {
  for (const value of [account.accountValue, account.cashBalance, account.marginBalance]) {
    const parsed = numeric(value, null);
    if (parsed != null) return parsed;
  }
  return null;
}

async function readLiveAccount(env = {}) {
  const credentials = liveCredentials(env);
  const locked = String(env.WEBULL_LIVE_KILL_SWITCH || 'true').toLowerCase() !== 'false'
    || String(env.WEBULL_LIVE_TRADING || 'false').toLowerCase() !== 'true'
    || String(env.WEBULL_LIVE_ORDER_SUBMISSION || 'false').toLowerCase() !== 'true';

  if (!credentials.configured) {
    return {
      mode: 'LIVE',
      configured: false,
      connected: false,
      readOnly: true,
      tradingLocked: true,
      status: 'NOT_CONFIGURED',
      cashBalance: null,
      marginBalance: null,
      accountValue: null,
      totalBalance: null,
      updatedAt: null,
    };
  }

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(LIVE_BALANCE_CACHE_URL);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached.json();
  }

  try {
    const snapshot = await getWebullAccountSnapshot(
      credentials.accountId,
      liveReadEnv(env, credentials),
    );
    const amounts = accountAmounts(snapshot.balance || {});
    const result = {
      mode: 'LIVE',
      configured: true,
      connected: true,
      readOnly: true,
      tradingLocked: locked,
      status: locked ? 'CONNECTED_LOCKED' : 'CONNECTED',
      ...amounts,
      totalBalance: accountTotal(amounts),
      updatedAt: snapshot.fetchedAt || new Date().toISOString(),
    };
    if (cache) {
      await cache.put(cacheKey, Response.json(result, {
        headers: { 'cache-control': 'public, max-age=20' },
      })).catch(() => undefined);
    }
    return result;
  } catch (error) {
    return {
      mode: 'LIVE',
      configured: true,
      connected: false,
      readOnly: true,
      tradingLocked: true,
      status: 'CONNECTION_FAILED',
      cashBalance: null,
      marginBalance: null,
      accountValue: null,
      totalBalance: null,
      updatedAt: null,
      error: error instanceof Error ? error.message : 'Live account balance request failed.',
    };
  }
}

function paperAccountFromPayload(payload = {}, env = {}) {
  const configured = ['WEBULL_APP_KEY', 'WEBULL_APP_SECRET', 'WEBULL_ACCESS_TOKEN', 'WEBULL_ACCOUNT_ID']
    .every((key) => Boolean(String(env[key] || '').trim()));
  const connected = payload.balancesLive === true && payload.balanceSource === 'WEBULL_SANDBOX';
  const cashBalance = connected
    ? numeric(payload.cashBalance ?? payload.portfolio?.cashBalance, null)
    : null;
  const marginBalance = connected
    ? numeric(payload.marginBalance ?? payload.portfolio?.marginBalance, null)
    : null;
  const accountValue = connected
    ? numeric(payload.accountValue ?? payload.portfolio?.accountValue, null)
    : null;
  const account = {
    mode: 'PAPER',
    configured,
    connected,
    readOnly: true,
    tradingLocked: false,
    status: connected ? 'CONNECTED' : configured ? 'CONNECTION_FAILED' : 'NOT_CONFIGURED',
    cashBalance,
    marginBalance,
    accountValue,
    updatedAt: connected ? (payload.balanceUpdatedAt || new Date().toISOString()) : null,
  };
  return { ...account, totalBalance: accountTotal(account) };
}

async function augmentPortfolioResponse(response, request, env) {
  if (request.method !== 'GET') return response;
  const payload = await response.clone().json().catch(() => ({}));
  const [paper, live] = await Promise.all([
    Promise.resolve(paperAccountFromPayload(payload, env)),
    readLiveAccount(env),
  ]);

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-moe-account-balances', 'paper-live-read-only');

  return new Response(JSON.stringify({
    ...payload,
    ok: true,
    accounts: { paper, live },
    paperAccount: paper,
    liveAccount: live,
  }), {
    status: response.status === 204 ? 200 : response.status,
    statusText: response.statusText,
    headers,
  });
}

function accountBalanceScript(env = {}) {
  const fallbackCash = Math.max(0, numeric(env.MOE_SANDBOX_DEFAULT_CAPITAL, 25_000));
  return String.raw`
<script id="moe-mobile-two-account-balances">
(function(){
  if(window.__moeMobileTwoAccountBalances)return;
  window.__moeMobileTwoAccountBalances=true;
  const FALLBACK_CASH=${fallbackCash};
  const accounts={PAPER:null,LIVE:null};
  let selectedSource='SANDBOX_DEFAULT';
  let rendering=false;

  function num(value,fallback=null){const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;}
  function money(value){const parsed=num(value,null);return parsed==null?'—':'$'+parsed.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function node(id){return document.getElementById(id);}
  function set(id,value){const el=node(id);if(el&&el.textContent!==value)el.textContent=value;}
  function selectedMode(){return typeof state==='undefined'?'PAPER':String(state.mode||'PAPER').toUpperCase();}
  function total(account){return num(account?.totalBalance??account?.accountValue??account?.cashBalance,null);}

  function ensureStyles(){
    if(node('moeAccountBalanceStyles'))return;
    const style=document.createElement('style');
    style.id='moeAccountBalanceStyles';
    style.textContent='.moe-account-balance{display:block;margin-top:10px;font-family:IBM Plex Mono,ui-monospace,monospace;font-size:17px;font-weight:700;color:var(--text);letter-spacing:-.02em}.moe-account-state{display:block;margin-top:4px;font-family:IBM Plex Mono,ui-monospace,monospace;font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase}.moe-account-state.ok{color:var(--green)}.moe-account-state.bad{color:var(--red)}.moe-account-state.off{color:var(--muted)}';
    document.head.appendChild(style);
  }

  function ensureAccountNodes(buttonId,prefix){
    const button=node(buttonId);if(!button)return;
    if(!node(prefix+'Balance')){
      const balance=document.createElement('span');
      balance.id=prefix+'Balance';balance.className='moe-account-balance';balance.textContent='Checking…';
      button.appendChild(balance);
    }
    if(!node(prefix+'State')){
      const status=document.createElement('span');
      status.id=prefix+'State';status.className='moe-account-state off';status.textContent='Checking connection';
      button.appendChild(status);
    }
  }

  function accountStatus(account,isLive){
    if(account?.connected){
      return {text:isLive&&account.tradingLocked?'Connected · trading locked':'Connected',className:'moe-account-state ok'};
    }
    if(account?.configured)return {text:'Connection failed',className:'moe-account-state bad'};
    return {text:'Not configured',className:'moe-account-state off'};
  }

  function renderCards(){
    const paper=accounts.PAPER, live=accounts.LIVE;
    set('moePaperBalance',paper?.connected?money(total(paper)):'Unavailable');
    set('moeLiveBalance',live?.connected?money(total(live)):'Unavailable');
    const ps=accountStatus(paper,false),ls=accountStatus(live,true);
    const pn=node('moePaperState'),ln=node('moeLiveState');
    if(pn){set('moePaperState',ps.text);pn.className=ps.className;}
    if(ln){set('moeLiveState',ls.text);ln.className=ls.className;}
  }

  function ensureSource(){
    let el=node('moePhoneBalanceSource');
    if(el)return el;
    const anchor=node('marginAmt');
    if(!anchor)return null;
    el=document.createElement('div');
    el.id='moePhoneBalanceSource';
    el.className='note';
    el.style.marginTop='10px';
    anchor.closest('.alloc')?.insertAdjacentElement('afterend',el);
    return el;
  }

  function applySelectedAccount(){
    if(typeof state==='undefined')return null;
    const mode=selectedMode();
    const account=accounts[mode];
    if(account?.connected){
      const accountCash=num(account.cashBalance,total(account));
      state.equity.cash=accountCash;
      state.equity.margin=num(account.marginBalance,0);
      selectedSource=mode==='LIVE'?'WEBULL_LIVE':'WEBULL_SANDBOX';
      return account;
    }
    if(mode==='PAPER'){
      state.equity.cash=FALLBACK_CASH;
      state.equity.margin=0;
      selectedSource='SANDBOX_DEFAULT';
    }else{
      state.equity.cash=null;
      state.equity.margin=null;
      selectedSource=account?.configured?'WEBULL_LIVE_OFFLINE':'WEBULL_LIVE_NOT_CONFIGURED';
    }
    return account;
  }

  function renderSelected(){
    if(rendering||typeof state==='undefined')return;
    rendering=true;
    try{
      const account=applySelectedAccount();
      const cash=num(state.equity?.cash,null);
      const margin=num(state.equity?.margin,null);
      const cashPct=num(state.cfg?.cashPct,0);
      const marginPct=num(state.cfg?.marginPct,0);
      const cashUsed=cash==null?null:cash*cashPct/100;
      const marginUsed=margin==null?null:margin*marginPct/100;
      const selected=(cashUsed??0)+(marginUsed??0);
      const selectedKnown=cashUsed!=null||marginUsed!=null;
      const stopPct=num(state.cfg?.stopLossPct,0);
      const risk=selectedKnown?selected*stopPct/100:null;
      const target=risk==null?null:risk*num(state.cfg?.takeProfitR,0);
      const daily=selectedKnown?selected*num(state.cfg?.dailyLossPct,0)/100:null;

      set('cashAmt',cash==null?'Balance unavailable':money(cashUsed)+' of '+money(cash));
      set('marginAmt',margin==null?'Balance unavailable':money(marginUsed)+' of '+money(margin));
      set('sumCash',cashUsed==null?cashPct+'% · —':cashPct+'% · '+money(cashUsed));
      set('sumMargin',marginUsed==null?marginPct+'% · —':marginPct+'% · '+money(marginUsed));
      set('sumTp',num(state.cfg?.takeProfitR,0).toFixed(1)+'R · '+money(target));
      set('sumSl',stopPct+'% · '+money(risk));
      set('sumCap',num(state.cfg?.dailyLossPct,0).toFixed(1)+'% · '+money(daily));
      set('tpNote',target==null?'Target unavailable until the account balance connects':'Targets '+money(target)+' per winning trade');
      set('slNote',risk==null?'Risk unavailable until the account balance connects':stopPct===0?'Fixed stop loss is disabled ($0.00).':'Up to '+money(risk)+' on one trade');
      set('capNote',daily==null?'Daily cap unavailable until the account balance connects':'Halts the day at '+money(daily));

      const sourceNode=ensureSource();
      if(sourceNode){
        const mode=selectedMode();
        sourceNode.textContent=selectedSource==='WEBULL_LIVE'
          ? 'Balance source: Webull Live account (read only; trading remains locked)'
          : selectedSource==='WEBULL_SANDBOX'
            ? 'Balance source: Webull Paper account'
            : selectedSource==='SANDBOX_DEFAULT'
              ? 'Balance source: Sandbox fallback balance — Paper broker is not confirmed connected'
              : selectedSource==='WEBULL_LIVE_NOT_CONFIGURED'
                ? 'Balance source: Live account credentials are not configured'
                : 'Balance source: Live account connection failed';
        sourceNode.style.color=account?.connected?'var(--green)':mode==='LIVE'?'var(--red)':'var(--amber)';
      }
    }finally{rendering=false;}
  }

  function installWrappers(){
    if(typeof setMode==='function'&&!setMode.__moeAccountBalancesWrapped){
      const originalSetMode=setMode;
      const wrappedSetMode=function(){const result=originalSetMode.apply(this,arguments);renderCards();renderSelected();return result;};
      wrappedSetMode.__moeAccountBalancesWrapped=true;
      setMode=wrappedSetMode;
    }
    if(typeof syncSettings==='function'&&!syncSettings.__moeAccountBalancesWrapped){
      const originalSyncSettings=syncSettings;
      const wrappedSyncSettings=function(){const result=originalSyncSettings.apply(this,arguments);renderSelected();return result;};
      wrappedSyncSettings.__moeAccountBalancesWrapped=true;
      syncSettings=wrappedSyncSettings;
    }
  }

  async function refresh(){
    try{
      const response=await fetch('/api/trading-intelligence/portfolio-risk?includeAccounts=1',{
        cache:'no-store',credentials:'same-origin',
        headers:{accept:'application/json','x-moe-mobile-client':'1'}
      });
      const payload=await response.json().catch(function(){return {};});
      accounts.PAPER=payload.accounts?.paper||payload.paperAccount||null;
      accounts.LIVE=payload.accounts?.live||payload.liveAccount||null;
    }catch(_){
      accounts.PAPER=accounts.PAPER||{configured:true,connected:false,status:'CONNECTION_FAILED'};
      accounts.LIVE=accounts.LIVE||{configured:false,connected:false,status:'NOT_CONFIGURED',tradingLocked:true};
    }
    renderCards();
    renderSelected();
  }

  function install(){
    ensureStyles();
    ensureAccountNodes('btnPaper','moePaper');
    ensureAccountNodes('btnLive','moeLive');
    installWrappers();
    ['cashAmt','marginAmt','sumCash','sumMargin','sumTp','sumSl','sumCap'].forEach(function(id){
      const el=node(id);if(!el)return;
      new MutationObserver(function(){if(!rendering)queueMicrotask(renderSelected);}).observe(el,{childList:true,characterData:true,subtree:true});
    });
    refresh();
    setTimeout(refresh,900);
    clearInterval(window.__moeTwoAccountBalanceTick);
    window.__moeTwoAccountBalanceTick=setInterval(refresh,15000);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})();
</script>`;
}

async function patchDashboard(response, request, env) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('id="moe-mobile-two-account-balances"')) return response;
  const patched = html.includes('</body>')
    ? html.replace('</body>', `${accountBalanceScript(env)}\n</body>`)
    : `${html}\n${accountBalanceScript(env)}`;
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
    const pathname = new URL(request.url).pathname;
    const response = await baseWorker.fetch(request, env, ctx);
    if (pathname === PORTFOLIO_PATH) return augmentPortfolioResponse(response, request, env);
    return MOBILE_PATHS.has(pathname)
      ? patchDashboard(response, request, env)
      : response;
  },
  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
