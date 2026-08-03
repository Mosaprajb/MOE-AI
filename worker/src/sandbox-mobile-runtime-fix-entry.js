import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-final-entry.js';

export { AlertCoordinator, SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const ACTIVITY_PATH = '/api/scanner/live-activity';
const DIAGNOSTIC_PATH = '/api/scanner/diagnostic';

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-mobile-runtime-fix': '1.0.0',
    },
  });
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

function scannerAttempt(event = {}) {
  const type = String(event.type || '').trim().toUpperCase();
  return type === 'SCANNER_CYCLE_COMPLETED' || type === 'SCANNER_CYCLE_FAILED';
}

function obsoleteNotArmedSkip(event = {}) {
  const type = String(event.type || '').trim().toUpperCase();
  const reason = String(event.reason || event.message || '').trim();
  return type === 'SCANNER_CYCLE_SKIPPED'
    && /pilot must be explicitly armed|SANDBOX_PILOT_NOT_ARMED/i.test(reason);
}

async function mobileSnapshot(env) {
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
    const { audit, runtime } = await mobileSnapshot(env);
    const stored = Array.isArray(audit?.events?.recent) ? audit.events.recent : [];
    const events = stored.filter((event) => !obsoleteNotArmedSkip(event));
    if (runtime?.armed !== true) {
      events.unshift({
        id: 'mobile_scanner_waiting',
        type: 'SCANNER_WAITING',
        status: 'STOPPED',
        reason: 'Press Start trading to arm Paper Trading and begin scheduled scanner cycles.',
        createdAt: new Date().toISOString(),
        executionAttempted: false,
        liveFundsUsed: false,
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
    const { audit, runtime } = await mobileSnapshot(env);
    const events = Array.isArray(audit?.events?.recent) ? audit.events.recent : [];
    const attempts = events.filter(scannerAttempt);
    const today = newYorkDateKey();
    const attemptsToday = attempts.filter((event) => newYorkDateKey(event.createdAt) === today).length;
    const lastRun = audit?.scanner?.lastRun || {};
    const diagnostic = {
      armed: runtime?.armed === true,
      attempts: attemptsToday,
      attemptsToday,
      attemptsTotal: attempts.length,
      skippedNotArmed: events.filter(obsoleteNotArmedSkip).length,
      scanned: finite(lastRun.scanned, 0),
      accepted: finite(lastRun.accepted, 0),
      selected: finite(lastRun.selected ?? lastRun.opportunitySelection?.summary?.selected, 0),
      durationMs: Number.isFinite(Number(lastRun.durationMs ?? lastRun.elapsedMs))
        ? Number(lastRun.durationMs ?? lastRun.elapsedMs)
        : null,
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

function patchTradeSettingsSource(html, env = {}) {
  const fallbackCash = Math.max(0, finite(env.MOE_SANDBOX_DEFAULT_CAPITAL, 25_000));
  let patched = html;

  patched = patched.replace(
    'equity:{cash:null,margin:null},',
    `equity:{cash:${fallbackCash},margin:0},`,
  );

  patched = patched.replace(
    'id="slRange" min="0.25" max="5" step="0.25" value="1"',
    'id="slRange" min="0" max="5" step="0.25" value="1"',
  );

  patched = patched.replace(
    `  const lossesToCap=Math.ceil(g.dailyLossPct/g.stopLossPct);\n  const binding = lossesToCap<=g.maxTrades ? 'loss cap' : 'trade limit';\n  const worst = Math.min(g.dailyLossPct, g.maxTrades*g.stopLossPct);\n  $('riskMath').textContent='Worst realistic day: '+worst.toFixed(1)+'% of traded capital'\n    +(pool==null?'':' (about '+money(pool*worst/100)+')')\n    +' — '+Math.min(lossesToCap,g.maxTrades)+' losing trades in a row hits your '+binding+'.';`,
    `  const lossesToCap=g.stopLossPct>0?Math.ceil(g.dailyLossPct/g.stopLossPct):Infinity;\n  const binding = lossesToCap<=g.maxTrades ? 'loss cap' : 'trade limit';\n  const worst = Math.min(g.dailyLossPct, g.maxTrades*g.stopLossPct);\n  $('riskMath').textContent = g.stopLossPct===0\n    ? 'Fixed stop loss is 0%. Strategy exits remain active; no fixed dollar loss is reserved per trade.'\n    : 'Worst realistic day: '+worst.toFixed(1)+'% of traded capital'\n      +(pool==null?'':' (about '+money(pool*worst/100)+')')\n      +' — '+Math.min(lossesToCap,g.maxTrades)+' losing trades in a row hits your '+binding+'.';`,
  );

  patched = patched.replace(
    `  $('sumCash').textContent=g.cashPct+'%'; $('sumMargin').textContent=g.marginPct+'%';\n  $('sumTp').textContent=g.takeProfitR.toFixed(1)+'R'; $('sumSl').textContent=(+g.stopLossPct)+'%';\n  $('sumMax').textContent=g.maxTrades; $('sumCap').textContent=g.dailyLossPct.toFixed(1)+'%';`,
    `  $('sumCash').textContent=g.cashPct+'% · '+(c==null?'—':money(c*g.cashPct/100));\n  $('sumMargin').textContent=g.marginPct+'% · '+(m==null?'—':money(m*g.marginPct/100));\n  $('sumTp').textContent=g.takeProfitR.toFixed(1)+'R · '+(risk==null?'—':money(risk*g.takeProfitR));\n  $('sumSl').textContent=(+g.stopLossPct)+'% · '+(risk==null?'—':money(risk));\n  $('sumMax').textContent=g.maxTrades;\n  $('sumCap').textContent=g.dailyLossPct.toFixed(1)+'% · '+(pool==null?'—':money(pool*g.dailyLossPct/100));`,
  );

  return patched;
}

const BALANCE_SOURCE_SCRIPT = String.raw`
<script id="moe-mobile-balance-source-fix">
(function(){
  if(window.__moeMobileBalanceSourceFix) return;
  window.__moeMobileBalanceSourceFix=true;

  function numberOrNull(value){
    const parsed=Number(value);
    return Number.isFinite(parsed)?parsed:null;
  }

  function ensureNote(){
    let note=document.getElementById('moeBalanceSourceFinal');
    if(note) return note;
    const margin=document.getElementById('marginAmt');
    if(!margin) return null;
    note=document.createElement('div');
    note.id='moeBalanceSourceFinal';
    note.className='note';
    note.style.marginTop='10px';
    margin.closest('.alloc')?.insertAdjacentElement('afterend',note);
    return note;
  }

  async function refresh(){
    const note=ensureNote();
    try{
      const response=await fetch('/api/trading-intelligence/portfolio-risk',{
        cache:'no-store',
        credentials:'same-origin',
        headers:{accept:'application/json','x-moe-mobile-client':'1'}
      });
      const payload=await response.json().catch(function(){return {};});
      const cash=numberOrNull(payload.cashBalance??payload.portfolio?.cashBalance);
      const margin=numberOrNull(payload.marginBalance??payload.portfolio?.marginBalance);
      if(typeof state!=='undefined'){
        if(cash!=null) state.equity.cash=cash;
        if(margin!=null) state.equity.margin=margin;
      }
      const source=String(payload.balanceSource||'SANDBOX_DEFAULT');
      if(note){
        note.textContent=source==='WEBULL_SANDBOX'
          ? 'Balance source: Webull Paper live account'
          : source==='PORTFOLIO_RISK'
            ? 'Balance source: synchronized portfolio balance'
            : 'Balance source: Sandbox fallback balance';
      }
    }catch(_){
      if(note) note.textContent='Balance source: Sandbox fallback balance';
    }
    if(typeof syncSettings==='function') syncSettings();
  }

  if(document.readyState==='loading'){
    document.addEventListener('DOMContentLoaded',refresh,{once:true});
  }else{
    refresh();
  }
  clearInterval(window.__moeBalanceSourceTick);
  window.__moeBalanceSourceTick=setInterval(refresh,30000);
})();
</script>`;

async function patchDashboard(response, request, env) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;

  let html = await response.text();
  html = patchTradeSettingsSource(html, env);
  if (!html.includes('id="moe-mobile-balance-source-fix"')) {
    html = html.includes('</body>')
      ? html.replace('</body>', `${BALANCE_SOURCE_SCRIPT}\n</body>`)
      : `${html}\n${BALANCE_SOURCE_SCRIPT}`;
  }

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  return new Response(html, {
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
    return MOBILE_PATHS.has(pathname)
      ? patchDashboard(response, request, env)
      : response;
  },
  async scheduled(controller, env, ctx) {
    try {
      const runtime = await coordinator(env).mobileDashboardRuntime();
      if (runtime?.armed !== true) {
        return {
          ok: true,
          skipped: 'MOBILE_DASHBOARD_NOT_ARMED',
          executionAuthorityChanged: false,
          liveFundsUsed: false,
          createdAt: new Date().toISOString(),
        };
      }
      return baseWorker.scheduled(controller, {
        ...env,
        MOE_SANDBOX_PILOT_ENABLED: 'true',
      }, ctx);
    } catch (error) {
      console.error(JSON.stringify({
        event: 'MOBILE_SCANNER_SCHEDULE_FAILED',
        error: error instanceof Error ? error.message : 'Unknown mobile scanner scheduling failure',
        createdAt: new Date().toISOString(),
      }));
      throw error;
    }
  },
};
