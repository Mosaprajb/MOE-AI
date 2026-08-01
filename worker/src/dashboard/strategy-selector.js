import { STRATEGY_CAPACITY_API_PATH } from '../strategy/strategy-capacity.js';

const PANEL_ID = 'moeStrategyCapacitySelector';
const STYLE_ID = 'moeStrategyCapacitySelectorStyles';
const SCRIPT_ID = 'moeStrategyCapacitySelectorScript';

const STYLE = `
<style id="${STYLE_ID}">
.msc-panel{margin:14px auto;padding:15px;max-width:1440px;border:1px solid rgba(128,78,211,.58);border-radius:18px;background:linear-gradient(145deg,rgba(27,10,52,.97),rgba(8,17,33,.99));color:#eadfff;box-shadow:0 12px 32px rgba(6,3,18,.22);direction:ltr}.msc-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.msc-kicker{font-size:9px;letter-spacing:.16em;color:#c29aff;font-weight:900}.msc-head h3{margin:4px 0 0;font-size:18px}.msc-meta{display:flex;gap:7px;flex-wrap:wrap}.msc-pill{padding:6px 9px;border:1px solid rgba(166,116,242,.5);border-radius:999px;font-size:9px;color:#cbb5ec}.msc-pill.safe{color:#56df9d;border-color:#30875f}.msc-grid{display:grid;grid-template-columns:repeat(3,minmax(220px,1fr));gap:10px;margin-top:13px}.msc-card{padding:12px;border:1px solid rgba(119,76,181,.48);border-radius:14px;background:rgba(24,9,47,.78)}.msc-card.blocked{border-color:rgba(255,104,125,.68);background:rgba(55,12,31,.74)}.msc-card-head{display:flex;align-items:center;justify-content:space-between;gap:8px}.msc-name{font-size:12px;font-weight:900}.msc-toggle{width:13px;height:13px;accent-color:#8c4fe9}.msc-count{margin-top:10px;font-size:19px;font-weight:950;font-variant-numeric:tabular-nums}.msc-label{font-size:9px;color:#a993c8}.msc-sub{display:flex;justify-content:space-between;gap:8px;margin-top:8px;padding-top:8px;border-top:1px solid rgba(115,75,175,.32);font-size:9px;color:#bca9d8}.msc-status{margin-top:8px;font-size:9px;font-weight:900;color:#5ce5a5}.msc-card.blocked .msc-status{color:#ff8495}.msc-note{margin-top:10px;font-size:9px;line-height:1.55;color:#9e8bb9}.msc-empty,.msc-error{margin-top:12px;padding:16px;text-align:center;border:1px dashed rgba(153,107,220,.46);border-radius:12px;color:#aa96c7}.msc-error{color:#ff8a98}@media(max-width:920px){.msc-grid{grid-template-columns:1fr}}@media(max-width:640px){.msc-panel{padding:12px}.msc-head h3{font-size:16px}}
</style>`;

const SCRIPT = `
<script id="${SCRIPT_ID}">
(function(){
  const endpoint='${STRATEGY_CAPACITY_API_PATH}';
  const root=()=>document.getElementById('${PANEL_ID}');
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let timer=null;
  let inFlight=false;
  let stopped=false;

  function card(strategy){
    const blocked=!strategy.entryEnabled;
    const status=strategy.dailyLimitReached
      ? 'Daily limit reached — new entries paused'
      : strategy.concurrentLimitReached
        ? 'Position limit reached — new entries paused'
        : 'Entry capacity available';
    return '<article class="msc-card'+(blocked?' blocked':'')+'" data-strategy="'+esc(strategy.id)+'">'
      +'<div class="msc-card-head"><span class="msc-name">'+esc(strategy.label)+'</span>'
      +'<input class="msc-toggle" type="checkbox" '+(strategy.entryEnabled?'checked ':'')+'disabled aria-label="'+esc(strategy.label)+' capacity"></div>'
      +'<div class="msc-count">'+esc(strategy.dailyTrades)+' / '+esc(strategy.maxDailyTrades)+'</div>'
      +'<div class="msc-label">trades today</div>'
      +'<div class="msc-sub"><span>Open/pending: '+esc(strategy.concurrentPositions)+' / '+esc(strategy.maxConcurrentPositions)+'</span>'
      +'<span>Remaining: '+esc(strategy.remainingDailyTrades)+'</span></div>'
      +'<div class="msc-status">'+esc(status)+'</div>'
      +'</article>';
  }

  function render(payload){
    const panel=root();
    if(!panel)return;
    const capacity=payload?.strategyCapacity||payload;
    const strategies=Array.isArray(capacity?.strategies)?capacity.strategies:[];
    const day=capacity?.day||'—';
    panel.innerHTML='<div class="msc-head"><div><div class="msc-kicker">STRATEGY SELECTOR · PER-STRATEGY CAPACITY</div><h3>Sandbox Strategy Capacity</h3></div>'
      +'<div class="msc-meta"><span class="msc-pill safe">LONG-ONLY · SPOT EQUITIES</span><span class="msc-pill">New York day: '+esc(day)+'</span></div></div>'
      +(strategies.length?'<div class="msc-grid">'+strategies.map(card).join('')+'</div>':'<div class="msc-empty">No registered strategies.</div>')
      +'<div class="msc-note">Per-strategy limits only pause new entries. Existing open positions remain visible and managed. Shared portfolio limits, daily-loss limits, portfolio-risk limits, and the Sandbox pilot submission ceiling remain authoritative across all strategies.</div>';
  }

  function renderError(message){
    const panel=root();
    if(panel)panel.innerHTML='<div class="msc-error">Strategy capacity unavailable: '+esc(message)+'</div>';
  }

  function schedule(delay=5000){
    clearTimeout(timer);
    if(stopped)return;
    timer=setTimeout(refresh,delay);
  }

  async function refresh(){
    if(stopped||inFlight){schedule();return;}
    if(document.hidden){schedule(10000);return;}
    inFlight=true;
    try{
      const controller=new AbortController();
      const timeout=setTimeout(()=>controller.abort(),8000);
      const response=await fetch(endpoint,{cache:'no-store',credentials:'same-origin',signal:controller.signal});
      clearTimeout(timeout);
      const payload=await response.json();
      if(!response.ok||payload?.ok===false)throw new Error(payload?.error||('HTTP '+response.status));
      render(payload);
    }catch(error){renderError(error?.name==='AbortError'?'request timed out':(error?.message||'unknown error'));}
    finally{inFlight=false;schedule();}
  }

  document.addEventListener('visibilitychange',()=>{if(!document.hidden)schedule(50);});
  window.addEventListener('pagehide',()=>{stopped=true;clearTimeout(timer);},{once:true});
  refresh();
})();
</script>`;

function contentType(response) {
  return response?.headers?.get?.('content-type') || '';
}

export async function enhanceStrategySelectorDashboard(response) {
  if (!contentType(response).toLowerCase().includes('text/html')) return response;
  let html = await response.text();
  if (!html.includes(STYLE_ID)) html = html.replace('</head>', `${STYLE}</head>`);
  if (!html.includes(PANEL_ID)) {
    const panel = `<section id="${PANEL_ID}" class="msc-panel" aria-live="polite"><div class="msc-empty">Loading strategy capacity…</div></section>`;
    html = html.replace(/<body([^>]*)>/i, `<body$1>${panel}`);
  }
  if (!html.includes(SCRIPT_ID)) html = html.replace('</body>', `${SCRIPT}</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  headers.set('x-moe-strategy-capacity-ui', '1');
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
