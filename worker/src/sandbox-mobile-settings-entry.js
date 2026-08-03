import baseWorker, {
  AlertCoordinator as BaseAlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-ui-fix-entry.js';
import { getWebullAccountSnapshot } from './webull-client.js';
import {
  MOBILE_CONFIG_KEY,
  MOBILE_RUNTIME_KEY,
} from './dashboard/mobile-dashboard.js';

export { SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const MOBILE_PORTFOLIO_PATH = '/api/trading-intelligence/portfolio-risk';
const STRATEGIES = new Set([
  'FUSION_V2',
  'MOERAND_SIMPLE_INTERNAL',
  'MOERAND_SCALP_INTERNAL',
  'MOERAND_CLEAN_INTERNAL',
]);
const SESSIONS = new Set(['PREMARKET', 'REGULAR', 'AFTER_HOURS']);
const BROKER_BALANCE_CACHE_URL = 'https://moerand.internal/mobile-account-balances-v1';

function finite(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback, minimum = 1, maximum = 10_000_000) {
  const parsed = finite(value, fallback);
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

function mobileLimits(env = {}) {
  const portfolioRisk = Math.max(0, finite(env.MOE_MAX_PORTFOLIO_RISK_PERCENT, 1));
  const openRisk = Math.max(0, finite(env.MOE_MAX_OPEN_RISK_PERCENT, portfolioRisk));
  return {
    cashAllocationPercent: Math.min(100, Math.max(0, finite(env.MOE_MOBILE_MAX_CASH_ALLOCATION_PERCENT, 100))),
    marginAllocationPercent: Math.min(100, Math.max(0, finite(env.MOE_MOBILE_MAX_MARGIN_ALLOCATION_PERCENT, 100))),
    takeProfitR: Math.min(20, Math.max(0.5, finite(env.MOE_MOBILE_MAX_TAKE_PROFIT_R, 5))),
    riskPerTradePercent: Math.min(openRisk, portfolioRisk),
    maxDailyTrades: integer(env.MOE_MAX_DAILY_TRADES, 3, 1, 100),
    maxDailyLossPercent: Math.max(0.1, finite(env.MOE_MAX_DAILY_LOSS_PERCENT, 2)),
  };
}

function defaultConfig(env = {}) {
  const limits = mobileLimits(env);
  return {
    cashAllocationPercent: Math.min(25, limits.cashAllocationPercent),
    marginAllocationPercent: 0,
    takeProfitR: Math.min(2, limits.takeProfitR),
    riskPerTradePercent: Math.min(1, limits.riskPerTradePercent),
    maxDailyTrades: Math.min(3, limits.maxDailyTrades),
    maxDailyLossPercent: Math.min(2, limits.maxDailyLossPercent),
  };
}

const CONFIG_MINIMUMS = Object.freeze({
  cashAllocationPercent: 0,
  marginAllocationPercent: 0,
  takeProfitR: 0.5,
  riskPerTradePercent: 0,
  maxDailyTrades: 1,
  maxDailyLossPercent: 0.1,
});

function validateConfig(input = {}, env = {}, current = defaultConfig(env)) {
  const limits = mobileLimits(env);
  const next = { ...current };
  for (const key of Object.keys(CONFIG_MINIMUMS)) {
    if (input[key] == null) continue;
    const value = Number(input[key]);
    if (!Number.isFinite(value)) throw new Error(`${key} must be a finite number.`);
    if (value < CONFIG_MINIMUMS[key]) throw new Error(`${key} must be at least ${CONFIG_MINIMUMS[key]}.`);
    if (value > limits[key]) throw new Error(`${key} exceeds the server-side ceiling of ${limits[key]}.`);
    next[key] = key === 'maxDailyTrades' ? Math.floor(value) : value;
  }
  return next;
}

function normalizeSymbols(values) {
  if (!Array.isArray(values)) return [];
  const symbols = [...new Set(values
    .map((value) => String(value || '').trim().toUpperCase())
    .filter(Boolean))];
  const invalid = symbols.filter((symbol) => !/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol));
  if (invalid.length) throw new Error(`Invalid symbols: ${invalid.join(', ')}.`);
  return symbols.slice(0, 50);
}

function normalizeSessions(values) {
  if (!Array.isArray(values)) return ['REGULAR'];
  const sessions = [...new Set(values.map((value) => String(value || '').trim().toUpperCase()))];
  const invalid = sessions.filter((value) => !SESSIONS.has(value));
  if (invalid.length) throw new Error(`Invalid trading sessions: ${invalid.join(', ')}.`);
  if (!sessions.length) throw new Error('At least one trading session is required.');
  return sessions;
}

function defaultRuntime(env = {}) {
  return {
    mode: 'SANDBOX',
    armed: false,
    strategy: 'FUSION_V2',
    symbols: [],
    sessions: ['REGULAR'],
    settings: defaultConfig(env),
    updatedAt: null,
    updatedBy: null,
  };
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async mobileDashboardConfig() {
    const saved = await this.ctx.storage.get(MOBILE_CONFIG_KEY);
    return validateConfig(saved && typeof saved === 'object' ? saved : {}, this.env);
  }

  async updateMobileDashboardConfig(patch = {}) {
    const current = await this.mobileDashboardConfig();
    const config = validateConfig(patch, this.env, current);
    await this.ctx.storage.put(MOBILE_CONFIG_KEY, config);
    return config;
  }

  async mobileDashboardRuntime() {
    const saved = await this.ctx.storage.get(MOBILE_RUNTIME_KEY);
    const base = defaultRuntime(this.env);
    if (!saved || typeof saved !== 'object') return base;
    return {
      ...base,
      ...saved,
      mode: String(saved.mode || base.mode).toUpperCase() === 'LIVE' ? 'LIVE' : 'SANDBOX',
      armed: saved.armed === true,
      strategy: STRATEGIES.has(String(saved.strategy || '').toUpperCase())
        ? String(saved.strategy).toUpperCase()
        : base.strategy,
      symbols: normalizeSymbols(saved.symbols),
      sessions: normalizeSessions(saved.sessions),
      settings: validateConfig(saved.settings || {}, this.env),
    };
  }

  async updateMobileDashboardRuntime(patch = {}, actor = 'MOBILE_DASHBOARD') {
    const current = await this.mobileDashboardRuntime();
    const mode = patch.mode == null ? current.mode : String(patch.mode).trim().toUpperCase();
    if (!['SANDBOX', 'LIVE'].includes(mode)) throw new Error('mode must be SANDBOX or LIVE.');
    const strategy = patch.strategy == null
      ? current.strategy
      : String(patch.strategy).trim().toUpperCase();
    if (!STRATEGIES.has(strategy)) throw new Error('Unsupported trading strategy.');
    const settings = patch.settings == null
      ? current.settings
      : validateConfig(patch.settings, this.env, current.settings);
    const next = {
      ...current,
      mode,
      armed: patch.armed == null ? current.armed : patch.armed === true,
      strategy,
      symbols: patch.symbols == null ? current.symbols : normalizeSymbols(patch.symbols),
      sessions: patch.sessions == null ? current.sessions : normalizeSessions(patch.sessions),
      settings,
      updatedAt: new Date().toISOString(),
      updatedBy: String(actor || 'MOBILE_DASHBOARD').slice(0, 64),
    };
    if (next.armed && !next.symbols.length) throw new Error('At least one symbol is required before arming trading.');
    await this.ctx.storage.put(MOBILE_RUNTIME_KEY, next);
    return next;
  }
}

function normalizedKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function amount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/[$,%\s]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  if (value && typeof value === 'object') {
    for (const key of ['amount', 'value', 'balance', 'quantity']) {
      const parsed = amount(value[key]);
      if (parsed != null) return parsed;
    }
  }
  return null;
}

function findAmount(root, candidateKeys, depth = 0, seen = new Set()) {
  if (root == null || depth > 8 || typeof root !== 'object' || seen.has(root)) return null;
  seen.add(root);
  const entries = Array.isArray(root) ? root.entries() : Object.entries(root);
  for (const [key, value] of entries) {
    if (candidateKeys.has(normalizedKey(key))) {
      const parsed = amount(value);
      if (parsed != null) return parsed;
    }
  }
  for (const [, value] of entries) {
    const nested = findAmount(value, candidateKeys, depth + 1, seen);
    if (nested != null) return nested;
  }
  return null;
}

async function readBrokerBalances(env = {}) {
  const accountId = String(env.WEBULL_ACCOUNT_ID || '').trim();
  if (!accountId) return null;
  const cache = globalThis.caches?.default;
  const cacheRequest = new Request(BROKER_BALANCE_CACHE_URL);
  if (cache) {
    const cached = await cache.match(cacheRequest);
    if (cached) return cached.json();
  }

  try {
    const snapshot = await getWebullAccountSnapshot(accountId, env);
    const cashBalance = findAmount(snapshot.balance, new Set([
      'cashbalance',
      'totalcash',
      'availablecash',
      'settledcash',
      'withdrawablecash',
      'cashavailableforwithdrawal',
      'cash',
    ]));
    const marginBalance = findAmount(snapshot.balance, new Set([
      'marginbalance',
      'marginexcess',
      'daybuyingpower',
      'buyingpower',
      'marginbuyingpower',
      'overnightbuyingpower',
      'availablebuyingpower',
    ]));
    const result = {
      cashBalance,
      marginBalance,
      source: 'WEBULL_SANDBOX',
      live: cashBalance != null || marginBalance != null,
      updatedAt: snapshot.fetchedAt || new Date().toISOString(),
    };
    if (cache) {
      await cache.put(cacheRequest, Response.json(result, {
        headers: { 'cache-control': 'public, max-age=30' },
      })).catch(() => undefined);
    }
    return result;
  } catch {
    return null;
  }
}

function firstFinite(...values) {
  for (const value of values) {
    const parsed = finite(value, null);
    if (parsed != null) return parsed;
  }
  return null;
}

async function patchPortfolioResponse(response, request, env) {
  if (request.method !== 'GET') return response;
  const payload = await response.clone().json().catch(() => ({}));
  const broker = await readBrokerBalances(env);
  const fallbackCash = Math.max(0, finite(env.MOE_SANDBOX_DEFAULT_CAPITAL, 25_000));
  const existingCash = payload.cashBalance
    ?? payload.portfolio?.cashBalance
    ?? payload.portfolioRisk?.capital?.cashBalance;
  const existingMargin = payload.marginBalance
    ?? payload.portfolio?.marginBalance
    ?? payload.portfolioRisk?.capital?.marginExcess
    ?? payload.portfolioRisk?.capital?.dayBuyingPower;
  const cashBalance = firstFinite(broker?.cashBalance, existingCash, fallbackCash);
  const marginBalance = firstFinite(broker?.marginBalance, existingMargin, 0);
  const source = broker?.live
    ? broker.source
    : existingCash != null || existingMargin != null
      ? 'PORTFOLIO_RISK'
      : 'SANDBOX_DEFAULT';

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-moe-mobile-balances', source);
  return new Response(JSON.stringify({
    ...payload,
    ok: true,
    cashBalance,
    marginBalance,
    balanceSource: source,
    balancesLive: broker?.live === true,
    balanceUpdatedAt: broker?.updatedAt || new Date().toISOString(),
    portfolio: {
      ...(payload.portfolio && typeof payload.portfolio === 'object' ? payload.portfolio : {}),
      cashBalance,
      marginBalance,
    },
  }), {
    status: 200,
    headers,
  });
}

const MOBILE_SETTINGS_SCRIPT = String.raw`
<script id="moe-mobile-live-setting-amounts">
(function(){
  if(window.__moeLiveSettingAmountsInstalled) return;
  window.__moeLiveSettingAmountsInstalled=true;

  let balanceSource='UNKNOWN';

  function numberOrNull(value){
    const parsed=Number(value);
    return Number.isFinite(parsed)?parsed:null;
  }

  function dollars(value){
    const parsed=numberOrNull(value);
    if(parsed==null) return '—';
    return '$'+parsed.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  }

  function text(id,value){
    const node=document.getElementById(id);
    if(node) node.textContent=value;
  }

  function calculations(){
    const cash=numberOrNull(state?.equity?.cash);
    const margin=numberOrNull(state?.equity?.margin);
    const cashUsed=cash==null?null:cash*Number(state.cfg.cashPct||0)/100;
    const marginUsed=margin==null?null:margin*Number(state.cfg.marginPct||0)/100;
    const pool=(cashUsed==null&&marginUsed==null)
      ? null
      : (cashUsed||0)+(marginUsed||0);
    const stopPercent=Number(state.cfg.stopLossPct||0);
    const risk=pool==null?null:pool*stopPercent/100;
    const target=risk==null?null:risk*Number(state.cfg.takeProfitR||0);
    const dailyCap=pool==null?null:pool*Number(state.cfg.dailyLossPct||0)/100;
    return {cash,margin,cashUsed,marginUsed,pool,stopPercent,risk,target,dailyCap};
  }

  function enhanceSettingsAmounts(){
    if(typeof state==='undefined') return;
    const c=calculations();
    const sourceSuffix=balanceSource==='WEBULL_SANDBOX'?' · live broker balance':'';

    text('cashAmt',c.cash==null
      ? 'Cash balance unavailable'
      : dollars(c.cashUsed)+' selected from '+dollars(c.cash)+sourceSuffix);
    text('marginAmt',c.margin==null
      ? 'Margin balance unavailable'
      : dollars(c.marginUsed)+' selected from '+dollars(c.margin)+sourceSuffix);

    text('sumCash',state.cfg.cashPct+'%'+(c.cashUsed==null?'':' · '+dollars(c.cashUsed)));
    text('sumMargin',state.cfg.marginPct+'%'+(c.marginUsed==null?'':' · '+dollars(c.marginUsed)));
    text('sumTp',Number(state.cfg.takeProfitR).toFixed(1)+'R'+(c.target==null?'':' · '+dollars(c.target)));
    text('sumSl',Number(state.cfg.stopLossPct)+'%'+(c.risk==null?'':' · '+dollars(c.risk)));
    text('sumCap',Number(state.cfg.dailyLossPct).toFixed(1)+'%'+(c.dailyCap==null?'':' · '+dollars(c.dailyCap)));

    if(c.stopPercent===0){
      text('slNote','Fixed stop-loss risk disabled: '+dollars(0)+' reserved per trade.');
      text('tpNote','Take profit remains '+Number(state.cfg.takeProfitR).toFixed(1)+'R; no fixed dollar risk is reserved.');
      text('riskMath','Stop-loss risk is 0%. Strategy exits and broker protection remain active, but no fixed dollar loss is reserved per trade.');
    }else{
      text('slNote',c.risk==null
        ? 'Maximum planned loss per trade'
        : 'Maximum planned loss per trade: '+dollars(c.risk));
      text('tpNote',c.target==null
        ? 'Closes at '+Number(state.cfg.takeProfitR).toFixed(1)+'× what the trade risked'
        : 'Potential profit at target: '+dollars(c.target)+' ('+Number(state.cfg.takeProfitR).toFixed(1)+'R)');
      if(c.pool!=null){
        const lossesToCap=Math.ceil(Number(state.cfg.dailyLossPct)/c.stopPercent);
        const binding=lossesToCap<=Number(state.cfg.maxTrades)?'loss cap':'trade limit';
        const worst=Math.min(Number(state.cfg.dailyLossPct),Number(state.cfg.maxTrades)*c.stopPercent);
        text('riskMath','Worst realistic day: '+dollars(c.pool*worst/100)+' ('+worst.toFixed(2)+'% of selected capital) — '+Math.min(lossesToCap,Number(state.cfg.maxTrades))+' losing trades reaches the '+binding+'.');
      }
    }

    text('capNote',c.dailyCap==null
      ? 'Trading halts for the day at this loss'
      : 'Daily loss limit: '+dollars(c.dailyCap));
  }

  async function refreshSettingBalances(){
    try{
      const response=await fetch('/api/trading-intelligence/portfolio-risk',{
        cache:'no-store',
        credentials:'same-origin',
        headers:{accept:'application/json','x-moe-mobile-client':'1'}
      });
      const payload=await response.json();
      if(response.ok&&payload){
        const cash=payload.cashBalance??payload.portfolio?.cashBalance;
        const margin=payload.marginBalance??payload.portfolio?.marginBalance;
        if(numberOrNull(cash)!=null) state.equity.cash=Number(cash);
        if(numberOrNull(margin)!=null) state.equity.margin=Number(margin);
        balanceSource=String(payload.balanceSource||'UNKNOWN');
      }
    }catch(_){}
    enhanceSettingsAmounts();
  }

  const stopRange=document.getElementById('slRange');
  if(stopRange){
    stopRange.min='0';
    stopRange.step='0.25';
  }

  if(typeof syncSettings==='function'){
    const originalSyncSettings=syncSettings;
    syncSettings=function(){
      const result=originalSyncSettings.apply(this,arguments);
      enhanceSettingsAmounts();
      return result;
    };
  }

  const openSettingsButton=document.getElementById('openSettings');
  if(openSettingsButton){
    const originalOpenSettings=openSettingsButton.onclick;
    openSettingsButton.onclick=function(event){
      const result=originalOpenSettings?originalOpenSettings.call(this,event):undefined;
      refreshSettingBalances();
      return result;
    };
  }

  document.querySelectorAll('#sheetSettings input[type="range"]').forEach(function(input){
    input.addEventListener('input',enhanceSettingsAmounts);
  });

  refreshSettingBalances();
  clearInterval(window.__moeSettingBalanceTick);
  window.__moeSettingBalanceTick=setInterval(refreshSettingBalances,30000);
})();
</script>`;

async function patchMobileDashboard(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('id="moe-mobile-live-setting-amounts"')) return response;
  const patched = html.includes('</body>')
    ? html.replace('</body>', `${MOBILE_SETTINGS_SCRIPT}\n</body>`)
    : `${html}\n${MOBILE_SETTINGS_SCRIPT}`;
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
    if (pathname === MOBILE_PORTFOLIO_PATH) {
      return patchPortfolioResponse(response, request, env);
    }
    return MOBILE_PATHS.has(pathname)
      ? patchMobileDashboard(response, request)
      : response;
  },
  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
