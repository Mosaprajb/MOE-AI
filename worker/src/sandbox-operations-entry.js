import baseWorker, { AlertCoordinator } from './sandbox-runtime-pilot-entry.js';
import { getWebullAccountSnapshot } from './webull-client.js';

const DASHBOARD_PATHS = new Set(['/', '/dashboard', '/dashboard/', '/moe-ai', '/moe-ai/']);
const PUBLIC_VIEW_PATHS = new Set([
  '/api/health',
  '/api/readiness',
  '/api/sandbox/audit',
  '/api/sandbox/orders/status',
]);
const PUBLIC_VIEW = 'public';
const POLL_INTERVAL_MS = 5_000;
const DEFAULT_SANDBOX_CAPITAL = 25_000;
const POSITION_RISK_PERCENT = 1;
const PROBE_CACHE_SECONDS = 60;
const INTERNAL_CACHE_ORIGIN = 'https://moerand.internal';

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function enabled(value) {
  return text(value).toLowerCase() === 'true';
}

function iso(value = Date.now()) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-sandbox-operations': '1.0.0',
    },
  });
}

function isPublicView(request) {
  const url = new URL(request.url);
  return url.searchParams.get('view') === PUBLIC_VIEW;
}

function internalAuthorizedRequest(request, env) {
  const url = new URL(request.url);
  url.searchParams.delete('view');
  const headers = new Headers(request.headers);
  headers.set('x-moe-webhook-secret', text(env.MOE_WEBHOOK_SECRET));
  headers.set('accept', 'application/json');
  return new Request(url.toString(), {
    method: request.method,
    headers,
  });
}

async function readJson(response) {
  const payload = await response.clone().json().catch(() => null);
  if (!payload || typeof payload !== 'object') {
    throw new Error(`Observability endpoint returned invalid JSON (${response.status}).`);
  }
  return payload;
}

function newYorkClock(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    weekday: values.weekday,
    minutes: Number(values.hour) * 60 + Number(values.minute),
  };
}

export function currentSandboxSession(env = {}, now = new Date()) {
  const { weekday, minutes } = newYorkClock(now);
  const weekdayOpen = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  const mode = text(env.AUTO_SCANNER_TRADING_HOURS, 'CORE').toUpperCase();
  const autoMode = ['AUTO', 'ALL_SESSIONS', '24H', '24/5'].includes(mode);
  const extendedMode = autoMode || ['ALL', 'EXTENDED'].includes(mode);

  if (weekdayOpen && minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
    return { current: 'CORE', open: true, checkedAt: iso(now) };
  }
  if (extendedMode && weekdayOpen && minutes >= 4 * 60 && minutes < 20 * 60) {
    return { current: 'EXTENDED', open: true, checkedAt: iso(now) };
  }

  if (autoMode && enabled(env.AUTO_SCANNER_OVERNIGHT_ENABLED)) {
    const sundayNight = weekday === 'Sun' && minutes >= 20 * 60;
    const mondayToThursdayNight = ['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday)
      && (minutes < 4 * 60 || minutes >= 20 * 60);
    const fridayEarly = weekday === 'Fri' && minutes < 4 * 60;
    if (sundayNight || mondayToThursdayNight || fridayEarly) {
      return { current: 'NIGHT', open: true, checkedAt: iso(now) };
    }
  }

  return { current: 'CLOSED', open: false, checkedAt: iso(now) };
}

async function cachedProbe(cacheKey, producer, ttlSeconds = PROBE_CACHE_SECONDS) {
  const cache = globalThis.caches?.default;
  const cacheRequest = new Request(`${INTERNAL_CACHE_ORIGIN}/sandbox-operations-cache/${cacheKey}`);
  if (cache) {
    const cached = await cache.match(cacheRequest);
    if (cached) return cached.json();
  }

  const value = await producer();
  if (cache) {
    await cache.put(cacheRequest, Response.json(value, {
      headers: { 'cache-control': `public, max-age=${ttlSeconds}` },
    })).catch(() => undefined);
  }
  return value;
}

function ema(values, length) {
  if (!Array.isArray(values) || values.length < length) return null;
  const alpha = 2 / (length + 1);
  let output = null;
  for (const raw of values) {
    const value = Number(raw);
    if (!Number.isFinite(value)) continue;
    output = output == null ? value : value * alpha + output * (1 - alpha);
  }
  return output;
}

function hourlyTrend(bars = []) {
  const closes = bars.map((bar) => Number(bar?.c)).filter(Number.isFinite).slice(-240);
  if (closes.length < 55) {
    return { ready: false, trend: 'UNKNOWN', latest: null, ema20: null, ema50: null };
  }

  const latest = closes.at(-1);
  const ema20 = ema(closes, 20);
  const ema50 = ema(closes, 50);
  let trend = 'NEUTRAL';
  if (latest > ema20 && ema20 > ema50) trend = 'BULLISH';
  else if (latest < ema20 && ema20 < ema50) trend = 'BEARISH';

  return {
    ready: true,
    trend,
    latest: Number(latest.toFixed(2)),
    ema20: Number(ema20.toFixed(2)),
    ema50: Number(ema50.toFixed(2)),
  };
}

async function probeAlpacaHourlyRegime(env = {}) {
  if (!text(env.ALPACA_KEY_ID) || !text(env.ALPACA_SECRET_KEY)) {
    return {
      status: 'ERROR',
      reason: 'CREDENTIALS_MISSING',
      regime: 'UNKNOWN',
      indexes: { SPY: { trend: 'UNKNOWN' }, QQQ: { trend: 'UNKNOWN' } },
      checkedAt: iso(),
    };
  }

  return cachedProbe('alpaca-hourly-regime-v1', async () => {
    try {
      const end = new Date();
      const start = new Date(end.getTime() - 60 * 24 * 60 * 60_000);
      const query = new URLSearchParams({
        symbols: 'SPY,QQQ',
        timeframe: '1Hour',
        start: start.toISOString(),
        end: end.toISOString(),
        limit: '1000',
        adjustment: 'raw',
        feed: 'iex',
        sort: 'asc',
      });
      const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
        headers: {
          'APCA-API-KEY-ID': text(env.ALPACA_KEY_ID),
          'APCA-API-SECRET-KEY': text(env.ALPACA_SECRET_KEY),
        },
      });
      if (!response.ok) throw new Error(`ALPACA_${response.status}`);
      const payload = await response.json();
      const indexes = {
        SPY: hourlyTrend(payload?.bars?.SPY || []),
        QQQ: hourlyTrend(payload?.bars?.QQQ || []),
      };
      if (!indexes.SPY.ready || !indexes.QQQ.ready) {
        throw new Error('ALPACA_HOURLY_HISTORY_INCOMPLETE');
      }
      const trends = [indexes.SPY.trend, indexes.QQQ.trend];
      const regime = trends.every((value) => value === 'BULLISH')
        ? 'BULLISH'
        : trends.every((value) => value === 'BEARISH')
          ? 'BEARISH'
          : 'NEUTRAL';
      return { status: 'CONNECTED', reason: null, regime, indexes, checkedAt: iso() };
    } catch {
      return {
        status: 'ERROR',
        reason: 'ALPACA_PROBE_FAILED',
        regime: 'UNKNOWN',
        indexes: { SPY: { trend: 'UNKNOWN' }, QQQ: { trend: 'UNKNOWN' } },
        checkedAt: iso(),
      };
    }
  });
}

async function probeWebullSandbox(env = {}) {
  const required = ['WEBULL_APP_KEY', 'WEBULL_APP_SECRET', 'WEBULL_ACCESS_TOKEN', 'WEBULL_ACCOUNT_ID'];
  if (required.some((name) => !text(env[name]))) {
    return { status: 'ERROR', reason: 'CREDENTIALS_MISSING', checkedAt: iso() };
  }

  return cachedProbe('webull-readonly-connectivity-v1', async () => {
    try {
      await getWebullAccountSnapshot(text(env.WEBULL_ACCOUNT_ID), env);
      return { status: 'CONNECTED', reason: null, checkedAt: iso() };
    } catch {
      return { status: 'ERROR', reason: 'WEBULL_PROBE_FAILED', checkedAt: iso() };
    }
  });
}

function publicHealth(health = {}) {
  return {
    ok: health.ok === true,
    status: text(health.status, 'DEGRADED').toUpperCase(),
    environment: 'SANDBOX',
    pilotArmed: health.pilotArmed === true,
    liveLocked: health.liveLocked === true,
    liveFundsAllowed: false,
    checkedAt: health.checkedAt || iso(),
  };
}

async function publicReadiness(readiness = {}, env = {}) {
  const [alpaca, webull] = await Promise.all([
    probeAlpacaHourlyRegime(env),
    probeWebullSandbox(env),
  ]);
  const credentials = readiness.credentials || {};
  const safety = readiness.safety || {};
  return {
    ok: readiness.ok === true,
    ready: readiness.ready === true,
    status: text(readiness.status, 'BLOCKED').toUpperCase(),
    pilotArmed: safety.pilotArmed === true,
    credentials: {
      configuredCount: finite(credentials.configuredCount, 0),
      requiredCount: finite(credentials.requiredCount, 7),
    },
    live: {
      locked: safety.liveLocked === true,
      killSwitchActive: safety.liveLocks?.liveKillSwitchActive === true,
      fundsAllowed: false,
    },
    connections: { alpaca, webull },
    marketRegime: {
      regime: alpaca.regime,
      indexes: alpaca.indexes,
      checkedAt: alpaca.checkedAt,
    },
    positionSizing: {
      sandboxCapital: finite(env.MOE_SANDBOX_DEFAULT_CAPITAL, DEFAULT_SANDBOX_CAPITAL),
      riskPercent: POSITION_RISK_PERCENT,
    },
    checkedAt: readiness.checkedAt || iso(),
  };
}

function publicAudit(audit = {}, env = {}) {
  const lastRun = audit.scanner?.lastRun || {};
  return {
    ok: audit.ok === true,
    mode: 'SANDBOX',
    session: currentSandboxSession(env),
    scanner: {
      ok: lastRun.ok !== false,
      skipped: text(lastRun.skipped) || null,
      error: lastRun.ok === false || Boolean(text(lastRun.error)),
      lastRunAt: audit.scanner?.lastRunAt || null,
      ageSeconds: Number.isFinite(Number(audit.scanner?.ageSeconds))
        ? Number(audit.scanner.ageSeconds)
        : null,
      activeOpportunityCount: finite(audit.scanner?.activeOpportunityCount, 0),
    },
    burnIn: {
      clean: audit.burnIn?.clean === true,
      submittedOrderCount: finite(audit.burnIn?.submittedOrderCount, 0),
      liveLeakAttemptCount: finite(audit.burnIn?.liveLeakAttemptCount, 0),
      unprotectedSubmissionCount: finite(audit.burnIn?.unprotectedSubmissionCount, 0),
    },
    liveFundsUsed: false,
    checkedAt: audit.checkedAt || iso(),
  };
}

function publicOrders(orders = {}) {
  return {
    ok: orders.ok === true,
    mode: 'SANDBOX',
    summary: {
      totalReservations: finite(orders.summary?.totalReservations, 0),
      reserved: finite(orders.summary?.reserved, 0),
      submitted: finite(orders.summary?.submitted, 0),
      released: finite(orders.summary?.released, 0),
    },
    submissionGate: {
      allowed: orders.submissionGate?.allowed === true,
      maximumSubmissions: finite(orders.submissionGate?.maximumSubmissions, 1),
      submitted: finite(orders.submissionGate?.submitted, 0),
      remaining: finite(orders.submissionGate?.remaining, 0),
    },
    liveFundsUsed: false,
    checkedAt: orders.checkedAt || iso(),
  };
}

async function publicObservabilityResponse(request, env, ctx, pathname) {
  try {
    const internalResponse = await baseWorker.fetch(internalAuthorizedRequest(request, env), env, ctx);
    const payload = await readJson(internalResponse);
    if (pathname === '/api/health') return json(publicHealth(payload));
    if (pathname === '/api/readiness') return json(await publicReadiness(payload, env));
    if (pathname === '/api/sandbox/audit') return json(publicAudit(payload, env));
    if (pathname === '/api/sandbox/orders/status') return json(publicOrders(payload));
  } catch (error) {
    return json({
      ok: false,
      status: 'ERROR',
      error: error instanceof Error ? error.message : 'Sandbox operations request failed.',
      checkedAt: iso(),
    }, 503);
  }
  return json({ ok: false, error: 'Not found' }, 404);
}

const SANDBOX_OPERATIONS_STYLE = `
<style id="sandboxOperationsStyles">
:root{--sandbox-ops-height:0px}
.sop-bar{position:sticky;top:0;z-index:120;width:100%;padding:8px 10px;border-bottom:1px solid rgba(85,132,176,.55);background:rgba(4,12,22,.97);backdrop-filter:blur(18px);box-shadow:0 12px 34px rgba(0,0,0,.30);color:#e8f2ff}
.sop-inner{display:flex;align-items:center;gap:8px;overflow-x:auto;scrollbar-width:thin;padding-bottom:2px}
.sop-title{display:grid;gap:2px;min-width:150px;padding-inline:4px 9px;border-inline-end:1px solid rgba(80,118,153,.38)}
.sop-title strong{font-size:12px;letter-spacing:.05em}.sop-title span{font-size:9px;color:#7996b2}
.sop-chip{display:grid;gap:3px;min-width:112px;padding:7px 9px;border:1px solid rgba(74,111,148,.48);border-radius:11px;background:rgba(9,25,42,.86)}
.sop-chip.wide{min-width:178px}.sop-label{font-size:8px;letter-spacing:.09em;color:#7895b0;text-transform:uppercase}.sop-value{font-size:11px;font-weight:900;white-space:nowrap}.sop-value[data-state="good"]{color:#58dfa1}.sop-value[data-state="bad"]{color:#ff8491}.sop-value[data-state="warn"]{color:#f4c46d}.sop-value[data-state="muted"]{color:#a5b5c8}
.sop-dot{display:inline-block;width:7px;height:7px;margin-inline-end:6px;border-radius:50%;background:currentColor;box-shadow:0 0 12px currentColor}.sop-updated{margin-inline-start:auto;min-width:max-content;color:#6f89a2;font-size:9px;padding-inline:6px}.sop-bar.sop-error{border-bottom-color:rgba(255,132,145,.75)}
.terminal-nav{top:calc(var(--sandbox-ops-height,0px) + 10px)!important}.dls-qty{font-variant-numeric:tabular-nums;font-weight:900;color:#86c8f5}
@media(max-width:720px){.sop-bar{padding:7px 5px}.sop-chip{min-width:102px}.sop-chip.wide{min-width:150px}.sop-title{min-width:130px}.sop-updated{display:none}}
</style>`;

const SANDBOX_OPERATIONS_SCRIPT = `
<script id="sandboxOperationsScript">
(function(){
  const pollMs=${POLL_INTERVAL_MS};
  const paths={health:'/api/health?view=public',readiness:'/api/readiness?view=public',audit:'/api/sandbox/audit?view=public',orders:'/api/sandbox/orders/status?view=public',scanner:'/api/scanner/opportunities/live'};
  const words={ar:{title:'عمليات Sandbox',environment:'البيئة',pilot:'Pilot',session:'الجلسة',market:'السوق',alpaca:'Alpaca',webull:'Webull',credentials:'الاعتمادات',live:'Live',kill:'مفتاح الإيقاف',updated:'آخر تحديث',connected:'متصل',error:'خطأ',locked:'مقفل',active:'نشط',bullish:'صاعد',bearish:'هابط',neutral:'عرضي',unknown:'غير معروف',quantity:'الكمية عند مخاطرة 1%'},en:{title:'Sandbox Operations',environment:'Environment',pilot:'Pilot',session:'Session',market:'Market Regime',alpaca:'Alpaca',webull:'Webull',credentials:'Credentials',live:'Live',kill:'Kill Switch',updated:'Updated',connected:'CONNECTED',error:'ERROR',locked:'LOCKED',active:'ACTIVE',bullish:'BULLISH',bearish:'BEARISH',neutral:'NEUTRAL',unknown:'UNKNOWN',quantity:'QTY @ 1% RISK'}};
  let snapshot=null,scannerSnapshot=null,sandboxCapital=${DEFAULT_SANDBOX_CAPITAL};
  const locale=()=>window.MOERAND_I18N?.locale?.()==='en'||document.documentElement.lang?.startsWith('en')?'en':'ar';
  const t=key=>words[locale()][key]||key;
  function esc(value){return String(value??'').replace(/[&<>"']/g,function(char){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char];});}
  function node(){let el=document.getElementById('sandboxOperationsBar');if(el)return el;el=document.createElement('section');el.id='sandboxOperationsBar';el.className='sop-bar';el.setAttribute('aria-live','polite');document.body.prepend(el);const ro=new ResizeObserver(()=>document.documentElement.style.setProperty('--sandbox-ops-height',el.offsetHeight+'px'));ro.observe(el);return el;}
  function chip(label,value,kind,wide){return '<div class="sop-chip'+(wide?' wide':'')+'"><span class="sop-label">'+esc(label)+'</span><strong class="sop-value" data-state="'+esc(kind)+'"><span class="sop-dot"></span>'+esc(value)+'</strong></div>';}
  function pilotValue(health,readiness){if(health?.pilotArmed===true&&health?.status==='UP')return'RUNNING';if(health?.pilotArmed!==true&&readiness?.status==='CONFIGURED_NOT_ARMED'&&readiness?.credentials?.configuredCount===readiness?.credentials?.requiredCount)return'READY';return'DISARMED';}
  function kind(value){const current=String(value||'').toUpperCase();if(['CONNECTED','READY','RUNNING','LOCKED','ACTIVE','CORE','EXTENDED','NIGHT','BULLISH','SANDBOX'].includes(current))return'good';if(['ERROR','BLOCKED','SAFETY_BLOCKED','BEARISH'].includes(current))return'bad';if(['DISARMED','NEUTRAL','CLOSED'].includes(current))return'warn';return'muted';}
  function regimeLabel(value){const key=String(value||'UNKNOWN').toLowerCase();return t(key);}
  function render(data){snapshot=data;const health=data.health||{},readiness=data.readiness||{},audit=data.audit||{};sandboxCapital=Number(readiness.positionSizing?.sandboxCapital)||${DEFAULT_SANDBOX_CAPITAL};const pilot=pilotValue(health,readiness);const session=audit.session?.current||'CLOSED';const alpaca=readiness.connections?.alpaca?.status||'ERROR';const webull=readiness.connections?.webull?.status||'ERROR';const credentials=(readiness.credentials?.configuredCount??0)+'/'+(readiness.credentials?.requiredCount??7);const live=readiness.live?.locked===true?'LOCKED':'ERROR';const kill=readiness.live?.killSwitchActive===true?'ACTIVE':'ERROR';const regime=readiness.marketRegime?.regime||'UNKNOWN';const regimeText=regimeLabel(regime);const el=node();const error=[alpaca,webull,live,kill].includes('ERROR')||data.failed===true;el.classList.toggle('sop-error',error);el.innerHTML='<div class="sop-inner"><div class="sop-title"><strong>'+esc(t('title'))+'</strong><span>READ-ONLY · 5s</span></div>'+chip(t('environment'),'SANDBOX','good')+chip(t('pilot'),pilot,kind(pilot))+chip(t('session'),session,kind(session))+chip(t('market'),regimeText,kind(regime),true)+chip(t('alpaca'),alpaca==='CONNECTED'?t('connected'):t('error'),kind(alpaca))+chip(t('webull'),webull==='CONNECTED'?t('connected'):t('error'),kind(webull))+chip(t('credentials'),credentials,credentials==='7/7'?'good':'bad')+chip(t('live'),live==='LOCKED'?t('locked'):t('error'),kind(live))+chip(t('kill'),kill==='ACTIVE'?t('active'):t('error'),kind(kill))+'<span class="sop-updated">'+esc(t('updated'))+' '+esc(new Date().toLocaleTimeString())+'</span></div>';applyPositionSizing();}
  async function fetchJson(path){const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),4500);try{const response=await fetch(path,{cache:'no-store',signal:controller.signal,headers:{accept:'application/json'}});const payload=await response.json().catch(()=>({}));if(!response.ok||payload?.error)throw new Error(payload?.error||('HTTP '+response.status));return payload;}finally{clearTimeout(timer);}}
  function opportunityRecords(){const live=scannerSnapshot?.liveScanner||{};return live.opportunitySelection?.selected||live.opportunitySelection?.opportunities||[];}
  function level(record,names){const opportunity=record?.opportunity||record||{};const metadata=opportunity.metadata||{};const plan=opportunity.tradePlan||metadata.tradePlan||metadata.order||{};for(const name of names){const value=Number(opportunity[name]??plan[name]);if(Number.isFinite(value)&&value>0)return value;}return null;}
  function quantityFor(symbol){const record=opportunityRecords().find(item=>String(item?.symbol||item?.opportunity?.symbol||'').toUpperCase()===symbol);const entry=level(record,['entry','limitPrice']);const stop=level(record,['stopLoss','stop']);const risk=entry!=null&&stop!=null?entry-stop:0;if(!(risk>0))return'—';return String(Math.max(0,Math.floor((sandboxCapital*0.01)/risk)));}
  function applyPositionSizing(){const table=document.querySelector('#dashboard-live-scanner .dls-table');if(!table)return;const head=table.querySelector('thead tr');if(head&&!head.querySelector('[data-sop-qty-head]')){const th=document.createElement('th');th.dataset.sopQtyHead='1';th.textContent=t('quantity');const statusHead=[...head.children].find(cell=>String(cell.textContent).trim().toUpperCase()==='STATUS');head.insertBefore(th,statusHead||head.lastElementChild);}for(const row of table.querySelectorAll('tbody tr')){let cell=row.querySelector('[data-sop-qty]');if(!cell){cell=document.createElement('td');cell.dataset.sopQty='1';cell.className='dls-qty';const statusCell=row.querySelector('.dls-status');row.insertBefore(cell,statusCell||row.lastElementChild);}const symbol=String(row.querySelector('.dls-symbol')?.textContent||'').trim().toUpperCase();cell.textContent=quantityFor(symbol);cell.title='floor((Sandbox Capital × 1%) ÷ (Entry − Stop Loss))';}}
  async function refresh(){const results=await Promise.allSettled([fetchJson(paths.health),fetchJson(paths.readiness),fetchJson(paths.audit),fetchJson(paths.orders),fetchJson(paths.scanner)]);const keys=['health','readiness','audit','orders','scanner'];const data={failed:false};results.forEach((result,index)=>{if(result.status==='fulfilled')data[keys[index]]=result.value;else{data.failed=true;data[keys[index]]={ok:false,error:true};}});scannerSnapshot=data.scanner?.ok===true?data.scanner:scannerSnapshot;render(data);}
  node();const observer=new MutationObserver(()=>applyPositionSizing());observer.observe(document.documentElement,{childList:true,subtree:true});refresh();setInterval(refresh,pollMs);document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});window.addEventListener('moerand:locale-change',()=>{if(snapshot)render(snapshot);});window.refreshSandboxOperations=refresh;
})();
</script>`;

async function enhanceDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('sandboxOperationsScript')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  }
  const enhanced = html
    .replace('</head>', `${SANDBOX_OPERATIONS_STYLE}</head>`)
    .replace('</body>', `${SANDBOX_OPERATIONS_SCRIPT}</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;
    if (request.method === 'GET' && PUBLIC_VIEW_PATHS.has(pathname) && isPublicView(request)) {
      return publicObservabilityResponse(request, env, ctx, pathname);
    }
    const response = await baseWorker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(pathname) ? enhanceDashboard(response) : response;
  },
  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};
