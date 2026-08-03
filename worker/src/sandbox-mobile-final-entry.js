import baseWorker, {
  AlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-settings-entry.js';

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
      'x-moe-mobile-final': '1.0.0',
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

function scannerEvent(event = {}) {
  return String(event.type || '').toUpperCase().startsWith('SCANNER_CYCLE_');
}

async function readAudit(env) {
  const stub = coordinator(env);
  if (typeof stub.sandboxPilotAudit !== 'function') throw new Error('Scanner audit is unavailable.');
  return stub.sandboxPilotAudit({ limit: 500 });
}

async function activityResponse(request, env) {
  if (request.method !== 'GET') return json({ ok: false, error: 'Method not allowed.' }, 405);
  try {
    const audit = await readAudit(env);
    const events = Array.isArray(audit?.events?.recent) ? audit.events.recent : [];
    return json({
      ok: true,
      events,
      activity: events,
      items: events,
      counts: audit?.events?.counts || {},
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
    const audit = await readAudit(env);
    const events = Array.isArray(audit?.events?.recent) ? audit.events.recent : [];
    const today = newYorkDateKey();
    const attemptsToday = events.filter((event) => scannerEvent(event)
      && newYorkDateKey(event.createdAt) === today).length;
    const attemptsTotal = events.filter(scannerEvent).length;
    const lastRun = audit?.scanner?.lastRun || {};
    const diagnostic = {
      attempts: attemptsToday,
      attemptsToday,
      attemptsTotal,
      scanned: finite(lastRun.scanned, 0),
      accepted: finite(lastRun.accepted, 0),
      selected: finite(lastRun.selected ?? lastRun.opportunitySelection?.summary?.selected, 0),
      durationMs: Number.isFinite(Number(lastRun.durationMs ?? lastRun.elapsedMs))
        ? Number(lastRun.durationMs ?? lastRun.elapsedMs)
        : null,
      skipped: lastRun.skipped || null,
      error: lastRun.error || null,
      lastRunAt: audit?.scanner?.lastRunAt || null,
      ageSeconds: audit?.scanner?.ageSeconds ?? null,
      activeOpportunityCount: audit?.scanner?.activeOpportunityCount ?? 0,
    };
    return json({ ok: true, diagnostic, ...diagnostic, storage: 'DURABLE_OBJECT' });
  } catch (error) {
    return json({
      ok: false,
      diagnostic: { attempts: 0, attemptsToday: 0, attemptsTotal: 0 },
      error: error instanceof Error ? error.message : 'Scanner diagnostic failed.',
    }, 500);
  }
}

const MOBILE_STYLE = `
<style id="moe-mobile-final-style">
.status dd .moe-primary{display:block}
.status dd .moe-money{display:block;margin-top:4px;color:var(--accent);font-size:11px;line-height:1.25;white-space:normal}
.moe-balance-source{margin-top:8px;color:var(--muted);font-size:11px;line-height:1.4}
.moe-activity-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;color:var(--muted);font-size:11px}
.moe-activity-reason{margin-top:5px;color:var(--text);font-size:13px;line-height:1.35}
</style>`;

function mobileScript(env = {}) {
  const fallbackCash = Math.max(0, finite(env.MOE_SANDBOX_DEFAULT_CAPITAL, 25_000));
  return String.raw`
<script id="moe-mobile-final-script">
(function(){
  if(window.__moeMobileFinalInstalled) return;
  window.__moeMobileFinalInstalled=true;
  const FALLBACK_CASH=${fallbackCash};
  let cashBalance=FALLBACK_CASH;
  let marginBalance=0;
  let balanceSource='SANDBOX_DEFAULT';

  function num(value,fallback=null){const parsed=Number(value);return Number.isFinite(parsed)?parsed:fallback;}
  function money(value){const parsed=num(value,null);return parsed==null?'—':'$'+parsed.toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});}
  function esc(value){return String(value??'').replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function setText(id,value){const node=document.getElementById(id);if(node)node.textContent=value;}
  function setSummary(id,primary,amount){
    const node=document.getElementById(id);if(!node)return;
    node.innerHTML='<span class="moe-primary">'+esc(primary)+'</span><small class="moe-money">'+esc(money(amount))+'</small>';
  }
  function appState(){return typeof state==='undefined'?null:state;}
  function calculations(){
    const app=appState();if(!app)return null;
    const cashUsed=cashBalance*num(app.cfg.cashPct,0)/100;
    const marginUsed=marginBalance*num(app.cfg.marginPct,0)/100;
    const selected=cashUsed+marginUsed;
    const stopPct=num(app.cfg.stopLossPct,0);
    const risk=selected*stopPct/100;
    return {app,cashUsed,marginUsed,selected,stopPct,risk,target:risk*num(app.cfg.takeProfitR,0),dailyCap:selected*num(app.cfg.dailyLossPct,0)/100};
  }
  function ensureSourceNote(){
    const cashNode=document.getElementById('cashAmt');
    if(!cashNode||document.getElementById('moeBalanceSource'))return;
    const note=document.createElement('div');note.id='moeBalanceSource';note.className='moe-balance-source';
    cashNode.closest('.alloc')?.insertAdjacentElement('afterend',note);
  }
  function renderAmounts(){
    const c=calculations();if(!c)return;
    ensureSourceNote();
    const source=balanceSource==='WEBULL_SANDBOX'?'Webull Paper live balance':balanceSource==='PORTFOLIO_RISK'?'Portfolio balance':'Sandbox fallback balance';
    setText('cashAmt',money(c.cashUsed)+' selected from '+money(cashBalance));
    setText('marginAmt',money(c.marginUsed)+' selected from '+money(marginBalance));
    setText('moeBalanceSource','Balance source: '+source);
    setSummary('sumCash',num(c.app.cfg.cashPct,0)+'%',c.cashUsed);
    setSummary('sumMargin',num(c.app.cfg.marginPct,0)+'%',c.marginUsed);
    setSummary('sumTp',num(c.app.cfg.takeProfitR,0).toFixed(1)+'R',c.target);
    setSummary('sumSl',num(c.app.cfg.stopLossPct,0)+'%',c.risk);
    setSummary('sumCap',num(c.app.cfg.dailyLossPct,0).toFixed(1)+'%',c.dailyCap);
    setText('slNote',c.stopPct===0?'Fixed stop-loss allocation: $0.00':'Maximum planned loss per trade: '+money(c.risk));
    setText('tpNote',c.stopPct===0?'Take-profit amount is $0.00 while fixed stop loss is 0%.':'Potential profit at target: '+money(c.target)+' ('+num(c.app.cfg.takeProfitR,0).toFixed(1)+'R)');
    setText('capNote','Daily loss limit: '+money(c.dailyCap));
  }
  async function refreshBalances(){
    try{
      const response=await fetch('/api/trading-intelligence/portfolio-risk',{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});
      const payload=await response.json().catch(function(){return {};});
      const cash=num(payload.cashBalance??payload.portfolio?.cashBalance,null);
      const margin=num(payload.marginBalance??payload.portfolio?.marginBalance,null);
      if(cash!=null)cashBalance=cash;
      if(margin!=null)marginBalance=margin;
      balanceSource=String(payload.balanceSource||balanceSource);
      const app=appState();if(app){app.equity.cash=cashBalance;app.equity.margin=marginBalance;}
    }catch(_){}
    renderAmounts();
  }
  function ensureAttemptRows(){
    if(!document.getElementById('scAttempts')){
      const list=document.querySelector('#sheetScanner dl.status');
      if(list){const row=document.createElement('div');row.innerHTML='<dt>Scan attempts today</dt><dd class="mono" id="scAttempts">0</dd>';list.appendChild(row);}
    }
    if(!document.getElementById('stScanAttempts')){
      const list=document.getElementById('stEngine')?.closest('dl.status');
      if(list){const row=document.createElement('div');row.innerHTML='<dt>Scanner attempts</dt><dd class="mono" id="stScanAttempts">0</dd>';list.appendChild(row);}
    }
  }
  async function refreshAttempts(){
    ensureAttemptRows();
    try{
      const response=await fetch('/api/scanner/diagnostic',{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});
      const payload=await response.json().catch(function(){return {};});
      const d=payload.diagnostic||payload;const attempts=num(d.attemptsToday??d.attempts,0);
      setText('scAttempts',String(attempts));setText('stScanAttempts',String(attempts));
    }catch(_){}
  }
  async function loadActivityFixed(){
    const list=document.getElementById('activityList');if(!list)return;
    try{
      const response=await fetch('/api/scanner/live-activity',{cache:'no-store',credentials:'same-origin',headers:{accept:'application/json','x-moe-mobile-client':'1'}});
      const payload=await response.json().catch(function(){return {};});
      if(!response.ok||payload.ok===false)throw new Error(payload.error||'Activity unavailable');
      const items=(payload.events||payload.activity||payload.items||[]).slice(0,100);
      if(!items.length){list.innerHTML='<div class="empty">No scanner activity has been recorded yet.</div>';return;}
      list.innerHTML='<div class="log">'+items.map(function(item){
        const created=item.createdAt||item.timestamp;const when=created?new Date(created).toLocaleString('en-US',{hour12:false}):'';
        const title=item.type||item.event||'ACTIVITY';const status=item.status||item.code||'';const reason=item.reason||item.message||'';
        const metrics=[];if(num(item.scanned,null)!=null)metrics.push('scanned '+num(item.scanned,0));if(num(item.accepted,null)!=null)metrics.push('accepted '+num(item.accepted,0));if(num(item.selected,null)!=null)metrics.push('selected '+num(item.selected,0));
        return '<div><b>'+esc(title)+'</b>'+(reason?'<div class="moe-activity-reason">'+esc(reason)+'</div>':'')+'<div class="moe-activity-meta"><span>'+esc(when)+'</span>'+(status?'<span>'+esc(status)+'</span>':'')+(item.symbol?'<span>'+esc(item.symbol)+'</span>':'')+(metrics.length?'<span>'+esc(metrics.join(' · '))+'</span>':'')+'</div></div>';
      }).join('')+'</div>';
    }catch(error){list.innerHTML='<div class="empty">Activity is unavailable: '+esc(error.message||'unknown error')+'</div>';}
  }
  function install(){
    const stop=document.getElementById('slRange');if(stop){stop.min='0';stop.step='0.25';}
    document.querySelectorAll('#sheetSettings input[type="range"]').forEach(function(input){input.addEventListener('input',renderAmounts);});
    if(typeof syncSettings==='function'){const original=syncSettings;syncSettings=function(){const result=original.apply(this,arguments);renderAmounts();return result;};}
    if(typeof loadScanner==='function'){const original=loadScanner;loadScanner=async function(){await original.apply(this,arguments);await refreshAttempts();};}
    if(typeof loadActivity==='function')loadActivity=loadActivityFixed;
    ensureAttemptRows();refreshBalances();refreshAttempts();renderAmounts();
    clearInterval(window.__moeFinalBalanceTick);window.__moeFinalBalanceTick=setInterval(refreshBalances,30000);
    clearInterval(window.__moeFinalUiTick);window.__moeFinalUiTick=setInterval(function(){renderAmounts();refreshAttempts();},8000);
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
  if (html.includes('id="moe-mobile-final-script"')) return response;
  const patched = html
    .replace('</head>', `${MOBILE_STYLE}\n</head>`)
    .replace('</body>', `${mobileScript(env)}\n</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  return new Response(patched, { status: response.status, statusText: response.statusText, headers });
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === ACTIVITY_PATH) return activityResponse(request, env);
    if (pathname === DIAGNOSTIC_PATH) return diagnosticResponse(request, env);
    const response = await baseWorker.fetch(request, env, ctx);
    return MOBILE_PATHS.has(pathname) ? patchDashboard(response, request, env) : response;
  },
  scheduled(controller, env, ctx) {
    return baseWorker.scheduled(controller, env, ctx);
  },
};