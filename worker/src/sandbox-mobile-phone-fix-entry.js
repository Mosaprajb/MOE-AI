import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-final-entry.js';
import { getWebullAccountSnapshot } from './webull-client.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const PORTFOLIO_PATH = '/api/trading-intelligence/portfolio-risk';
const ACTIVITY_PATH = '/api/scanner/live-activity';
const DIAGNOSTIC_PATH = '/api/scanner/diagnostic';
const BALANCE_CACHE_URL = 'https://moerand.internal/mobile-phone-balances-v2';

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

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

async function readWebullBalances(env = {}) {
  const accountId = String(env.WEBULL_ACCOUNT_ID || '').trim();
  if (!accountId) return null;

  const cache = globalThis.caches?.default;
  const cacheKey = new Request(BALANCE_CACHE_URL);
  if (cache) {
    const cached = await cache.match(cacheKey);
    if (cached) return cached.json();
  }

  try {
    const snapshot = await getWebullAccountSnapshot(accountId, env);
    const balance = snapshot.balance || {};
    const cashBalance = findAmount(balance, new Set([
      'totalcashbalance',
      'cashbalance',
      'totalcash',
      'settledcash',
      'availablecash',
      'availablewithdrawal',
      'availabletowithdraw',
      'withdrawablecash',
      'cashavailableforwithdrawal',
    ]));
    const marginBalance = findAmount(balance, new Set([
      'daybuyingpower',
      'buyingpower',
      'overnightbuyingpower',
      'nighttradingbuyingpower',
      'marginexcess',
      'marginbuyingpower',
      'availablebuyingpower',
      'onedaymarginpower',
      'infinitemarginpower',
      'stockpower',
    ]));
    const accountValue = findAmount(balance, new Set([
      'totalnetliquidationvalue',
      'netliquidationvalue',
      'totalcollateralvalue',
      'totalassetvalue',
    ]));
    const result = {
      cashBalance,
      marginBalance,
      accountValue,
      fetchedAt: snapshot.fetchedAt || new Date().toISOString(),
    };
    if (cache) {
      await cache.put(cacheKey, Response.json(result, {
        headers: { 'cache-control': 'public, max-age=20' },
      })).catch(() => undefined);
    }
    return result;
  } catch {
    return null;
  }
}

function firstPositive(...values) {
  for (const value of values) {
    const parsed = numeric(value, null);
    if (parsed != null && parsed > 0) return parsed;
  }
  return null;
}

async function portfolioResponse(response, request, env) {
  if (request.method !== 'GET') return response;
  const payload = await response.clone().json().catch(() => ({}));
  const broker = await readWebullBalances(env);
  const fallbackCash = Math.max(0, numeric(env.MOE_SANDBOX_DEFAULT_CAPITAL, 25_000));
  const existingCash = payload.cashBalance
    ?? payload.portfolio?.cashBalance
    ?? payload.portfolioRisk?.capital?.cashBalance;
  const existingMargin = payload.marginBalance
    ?? payload.portfolio?.marginBalance
    ?? payload.portfolioRisk?.capital?.marginExcess
    ?? payload.portfolioRisk?.capital?.dayBuyingPower;

  const brokerCash = firstPositive(broker?.cashBalance, broker?.accountValue);
  const brokerMargin = firstPositive(broker?.marginBalance);
  const brokerUsable = brokerCash != null || brokerMargin != null;
  const existingUsable = firstPositive(existingCash, existingMargin) != null;

  const cashBalance = brokerUsable
    ? (brokerCash ?? 0)
    : (firstPositive(existingCash) ?? fallbackCash);
  const marginBalance = brokerUsable
    ? (brokerMargin ?? 0)
    : (firstPositive(existingMargin) ?? 0);
  const balanceSource = brokerUsable
    ? 'WEBULL_SANDBOX'
    : existingUsable
      ? 'PORTFOLIO_RISK'
      : 'SANDBOX_DEFAULT';

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  headers.set('content-type', 'application/json; charset=utf-8');
  headers.set('x-moe-mobile-balances', balanceSource);

  return new Response(JSON.stringify({
    ...payload,
    ok: true,
    cashBalance,
    marginBalance,
    balanceSource,
    balancesLive: brokerUsable,
    balanceUpdatedAt: broker?.fetchedAt || new Date().toISOString(),
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

function internalScannerNoise(event = {}) {
  const type = String(event.type || '').trim().toUpperCase();
  const reason = String(event.reason || event.message || event.code || '').trim();
  if (/AUTO_SCANNER_ENABLED is false|AUTO_SCANNER_DISABLED/i.test(reason)) return true;
  return type === 'SCANNER_CYCLE_SKIPPED'
    && /pilot must be explicitly armed|SANDBOX_PILOT_NOT_ARMED/i.test(reason);
}

function actualScannerAttempt(event = {}) {
  if (internalScannerNoise(event)) return false;
  const type = String(event.type || '').trim().toUpperCase();
  return type === 'SCANNER_CYCLE_COMPLETED' || type === 'SCANNER_CYCLE_FAILED';
}

function newYorkDateKey(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-mobile-phone-fix': '1.0.0',
    },
  });
}

async function mobileAudit(env) {
  const stub = coordinator(env);
  const [audit, runtime] = await Promise.all([
    stub.sandboxPilotAudit({ limit: 500 }),
    stub.mobileDashboardRuntime(),
  ]);
  return { audit, runtime };
}

async function activityResponse(request, env) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  try {
    const { audit, runtime } = await mobileAudit(env);
    const stored = Array.isArray(audit?.events?.recent) ? audit.events.recent : [];
    const events = stored.filter((event) => !internalScannerNoise(event));
    if (runtime?.armed !== true) {
      events.unshift({
        id: 'mobile_scanner_waiting',
        type: 'SCANNER_WAITING',
        status: 'STOPPED',
        reason: 'Press Start trading to begin scheduled scanner cycles.',
        createdAt: new Date().toISOString(),
      });
    }
    return json({
      ok: true,
      events: events.slice(0, 100),
      activity: events.slice(0, 100),
      items: events.slice(0, 100),
      scannerArmed: runtime?.armed === true,
      checkedAt: audit?.checkedAt || new Date().toISOString(),
      storage: 'DURABLE_OBJECT',
    });
  } catch (error) {
    return json({
      ok: false,
      events: [],
      error: error instanceof Error ? error.message : 'Activity log failed.',
    }, 500);
  }
}

async function diagnosticResponse(request, env) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  try {
    const { audit, runtime } = await mobileAudit(env);
    const stored = Array.isArray(audit?.events?.recent) ? audit.events.recent : [];
    const attempts = stored.filter(actualScannerAttempt);
    const today = newYorkDateKey();
    const attemptsToday = attempts.filter((event) => newYorkDateKey(event.createdAt) === today).length;
    const lastRun = audit?.scanner?.lastRun || {};
    const diagnostic = {
      armed: runtime?.armed === true,
      attempts: attemptsToday,
      attemptsToday,
      attemptsTotal: attempts.length,
      scanned: numeric(lastRun.scanned, 0),
      accepted: numeric(lastRun.accepted, 0),
      selected: numeric(lastRun.selected ?? lastRun.opportunitySelection?.summary?.selected, 0),
      durationMs: numeric(lastRun.durationMs ?? lastRun.elapsedMs, null),
      skipped: runtime?.armed === true ? (lastRun.skipped || null) : 'MOBILE_DASHBOARD_NOT_ARMED',
      error: lastRun.error || null,
      lastRunAt: audit?.scanner?.lastRunAt || null,
      ageSeconds: audit?.scanner?.ageSeconds ?? null,
      activeOpportunityCount: audit?.scanner?.activeOpportunityCount ?? 0,
    };
    return json({ ok: true, diagnostic, ...diagnostic, storage: 'DURABLE_OBJECT' });
  } catch (error) {
    return json({
      ok: false,
      diagnostic: { armed: false, attempts: 0, attemptsToday: 0, attemptsTotal: 0 },
      error: error instanceof Error ? error.message : 'Scanner diagnostic failed.',
    }, 500);
  }
}

function mobileMoneyScript(env = {}) {
  const fallbackCash = Math.max(0, numeric(env.MOE_SANDBOX_DEFAULT_CAPITAL, 25_000));
  return String.raw`
<script id="moe-mobile-phone-money-fix">
(function(){
  if(window.__moeMobilePhoneMoneyFix) return;
  window.__moeMobilePhoneMoneyFix=true;
  const FALLBACK_CASH=${fallbackCash};
  let source='SANDBOX_DEFAULT';

  function num(value,fallback=null){const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;}
  function money(value){const parsed=num(value,null);return parsed==null?'—':'$'+parsed.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function node(id){return document.getElementById(id);}
  function set(id,value){const el=node(id);if(el)el.textContent=value;}
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
  function renderMoney(){
    if(typeof state==='undefined')return;
    const cash=num(state.equity?.cash,FALLBACK_CASH);
    const margin=num(state.equity?.margin,0);
    const cashUsed=cash*num(state.cfg.cashPct,0)/100;
    const marginUsed=margin*num(state.cfg.marginPct,0)/100;
    const selected=cashUsed+marginUsed;
    const stopPct=num(state.cfg.stopLossPct,0);
    const risk=selected*stopPct/100;
    const target=risk*num(state.cfg.takeProfitR,0);
    const daily=selected*num(state.cfg.dailyLossPct,0)/100;

    set('cashAmt',money(cashUsed)+' of '+money(cash));
    set('marginAmt',money(marginUsed)+' of '+money(margin));
    set('sumCash',num(state.cfg.cashPct,0)+'% · '+money(cashUsed));
    set('sumMargin',num(state.cfg.marginPct,0)+'% · '+money(marginUsed));
    set('sumTp',num(state.cfg.takeProfitR,0).toFixed(1)+'R · '+money(target));
    set('sumSl',num(state.cfg.stopLossPct,0)+'% · '+money(risk));
    set('sumCap',num(state.cfg.dailyLossPct,0).toFixed(1)+'% · '+money(daily));
    set('tpNote','Targets '+money(target)+' per winning trade');
    set('slNote',stopPct===0?'Fixed stop loss is disabled ($0.00).':'Up to '+money(risk)+' on one trade');
    set('capNote','Halts the day at '+money(daily));

    const sourceNode=ensureSource();
    if(sourceNode){
      sourceNode.textContent=source==='WEBULL_SANDBOX'
        ? 'Balance source: Webull Paper live account'
        : source==='PORTFOLIO_RISK'
          ? 'Balance source: synchronized portfolio balance'
          : 'Balance source: Sandbox fallback balance';
    }
  }
  async function refresh(){
    try{
      const response=await fetch('/api/trading-intelligence/portfolio-risk',{
        cache:'no-store',credentials:'same-origin',
        headers:{accept:'application/json','x-moe-mobile-client':'1'}
      });
      const payload=await response.json().catch(function(){return {};});
      const cash=num(payload.cashBalance??payload.portfolio?.cashBalance,null);
      const margin=num(payload.marginBalance??payload.portfolio?.marginBalance,null);
      source=String(payload.balanceSource||'SANDBOX_DEFAULT');
      if(typeof state!=='undefined'){
        state.equity.cash=cash!=null?cash:FALLBACK_CASH;
        state.equity.margin=margin!=null?margin:0;
      }
    }catch(_){
      if(typeof state!=='undefined'&&!(num(state.equity?.cash,0)>0))state.equity.cash=FALLBACK_CASH;
      source='SANDBOX_DEFAULT';
    }
    renderMoney();
  }
  function install(){
    const stop=node('slRange');if(stop){stop.min='0';stop.step='0.25';}
    if(typeof syncSettings==='function'&&!syncSettings.__moeMoneyWrapped){
      const original=syncSettings;
      const wrapped=function(){const result=original.apply(this,arguments);renderMoney();return result;};
      wrapped.__moeMoneyWrapped=true;
      syncSettings=wrapped;
    }
    document.querySelectorAll('#sheetSettings input[type="range"]').forEach(function(input){
      input.addEventListener('input',renderMoney);
    });
    refresh();
    setTimeout(refresh,800);
    clearInterval(window.__moePhoneMoneyTick);
    window.__moePhoneMoneyTick=setInterval(refresh,15000);
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
  if (html.includes('id="moe-mobile-phone-money-fix"')) return response;
  const patched = html.includes('</body>')
    ? html.replace('</body>', `${mobileMoneyScript(env)}\n</body>`)
    : `${html}\n${mobileMoneyScript(env)}`;
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
    if (pathname === ACTIVITY_PATH) return activityResponse(request, env);
    if (pathname === DIAGNOSTIC_PATH) return diagnosticResponse(request, env);

    const response = await baseWorker.fetch(request, env, ctx);
    if (pathname === PORTFOLIO_PATH) return portfolioResponse(response, request, env);
    return MOBILE_PATHS.has(pathname)
      ? patchDashboard(response, request, env)
      : response;
  },
  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
