import { SCAN_SOURCE_MODE_API_PATH } from '../scanner/scan-source-mode.js';

const PANEL_ID = 'moeScanModeSelector';
const STYLE_ID = 'moeScanModeSelectorStyles';
const SCRIPT_ID = 'moeScanModeSelectorScript';

const STYLE = `
<style id="${STYLE_ID}">
.sms-panel{margin:14px auto;padding:15px;max-width:1440px;border:1px solid rgba(130,86,210,.55);border-radius:18px;background:linear-gradient(145deg,rgba(24,10,47,.97),rgba(8,17,31,.99));color:#efe7ff;direction:ltr}.sms-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.sms-kicker{font-size:9px;letter-spacing:.16em;color:#c49fff;font-weight:900}.sms-head h3{margin:4px 0 0;font-size:18px}.sms-safe{padding:6px 9px;border:1px solid #55db9b;border-radius:999px;color:#55db9b;font-size:9px;font-weight:900}.sms-grid{display:grid;grid-template-columns:minmax(220px,.7fr) minmax(280px,1.3fr);gap:10px;margin-top:13px}.sms-box{padding:12px;border:1px solid rgba(137,92,207,.4);border-radius:13px;background:rgba(22,10,43,.76)}.sms-label{display:block;margin-bottom:7px;font-size:9px;letter-spacing:.1em;color:#bba7d9;font-weight:900}.sms-select,.sms-input{width:100%;box-sizing:border-box;padding:9px 10px;border:1px solid rgba(167,120,235,.48);border-radius:10px;background:#110b21;color:#f8f2ff;outline:none}.sms-actions{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-top:10px}.sms-button{padding:9px 13px;border:1px solid rgba(193,151,255,.7);border-radius:10px;background:#6b2db6;color:#fff;font-size:10px;font-weight:900;cursor:pointer}.sms-status{font-size:9px;color:#a997c5}.sms-error{color:#ff9daf}.sms-note{margin-top:10px;font-size:9px;line-height:1.55;color:#9e8db9}.sms-hidden{display:none}@media(max-width:760px){.sms-grid{grid-template-columns:1fr}}
</style>`;

const SCRIPT = `
<script id="${SCRIPT_ID}">
(function(){
  const endpoint='${SCAN_SOURCE_MODE_API_PATH}';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  let latest={mode:'FULL_UNIVERSE',curatedSymbols:[],focusedSymbols:[]};let message='';let error='';
  const root=()=>document.getElementById('${PANEL_ID}');
  const manual=mode=>mode==='CURATED_UNIVERSE'||mode==='FOCUSED_SCAN';
  const symbolsFor=mode=>mode==='CURATED_UNIVERSE'?(latest.curatedSymbols||[]):mode==='FOCUSED_SCAN'?(latest.focusedSymbols||[]):[];
  function render(){const node=root();if(!node)return;const mode=latest.mode||'FULL_UNIVERSE';const symbols=symbolsFor(mode).join(', ');node.innerHTML='<div class="sms-head"><div><div class="sms-kicker">SCAN SOURCE · SYMBOL ROUTING ONLY</div><h3>Scan Mode</h3></div><span class="sms-safe">RISK + LIVE LOCK UNCHANGED</span></div><div class="sms-grid"><div class="sms-box"><label class="sms-label" for="sms-mode">SOURCE MODE</label><select class="sms-select" id="sms-mode"><option value="FULL_UNIVERSE" '+(mode==='FULL_UNIVERSE'?'selected':'')+'>Full Universe — default</option><option value="CURATED_UNIVERSE" '+(mode==='CURATED_UNIVERSE'?'selected':'')+'>Curated Universe — persistent</option><option value="FOCUSED_SCAN" '+(mode==='FOCUSED_SCAN'?'selected':'')+'>Focused Scan — temporary</option></select></div><div class="sms-box '+(manual(mode)?'':'sms-hidden')+'" id="sms-symbol-box"><label class="sms-label" for="sms-symbols">TICKERS · COMMA OR SPACE SEPARATED</label><input class="sms-input" id="sms-symbols" value="'+esc(symbols)+'" placeholder="AAPL, NVDA or a single symbol"><div class="sms-actions"><button class="sms-button" id="sms-save">Apply Scan Mode</button><span class="sms-status '+(error?'sms-error':'')+'">'+esc(error||message||('Active symbols: '+(latest.activeSymbolCount??'full universe')))+'</span></div></div></div><div class="sms-note">The selected mode changes only which symbols enter the strategy pipeline. Strategy logic, sizing, portfolio risk, daily-loss protection, kill switch, and Live lock remain authoritative and unchanged.</div>';
    document.getElementById('sms-mode')?.addEventListener('change',event=>{const next=event.target.value;latest={...latest,mode:next};message='';error='';render();if(next==='FULL_UNIVERSE')save();});
    document.getElementById('sms-save')?.addEventListener('click',save);
  }
  async function request(url,options={}){const response=await fetch(url,{cache:'no-store',credentials:'same-origin',...options,headers:{'content-type':'application/json',...(options.headers||{})}});const payload=await response.json().catch(()=>({}));if(!response.ok||payload.ok===false)throw new Error(payload.error||payload.code||('HTTP '+response.status));return payload;}
  async function refresh(){try{const payload=await request(endpoint);latest=payload.scanMode||payload;error='';render();}catch(err){error=err.message||String(err);render();}}
  async function save(){try{const mode=latest.mode||'FULL_UNIVERSE';const raw=document.getElementById('sms-symbols')?.value||'';const symbols=raw.split(/[\\s,;]+/).filter(Boolean);const payload=await request(endpoint,{method:'PUT',body:JSON.stringify({mode,symbols})});latest=payload.scanMode||latest;message='Scan mode saved and audit logged.';error='';render();}catch(err){error=err.message||String(err);message='';render();}}
  refresh();setInterval(refresh,15000);
})();
</script>`;

function contentType(response) {
  return response?.headers?.get?.('content-type') || '';
}

export async function enhanceScanModeDashboard(response) {
  if (!contentType(response).toLowerCase().includes('text/html')) return response;
  let html = await response.text();
  if (!html.includes(STYLE_ID)) html = html.replace('</head>', `${STYLE}</head>`);
  if (!html.includes(PANEL_ID)) {
    const panel = `<section id="${PANEL_ID}" class="sms-panel" aria-live="polite"><div class="sms-status">Loading scan mode…</div></section>`;
    html = html.replace(/<body([^>]*)>/i, `<body$1>${panel}`);
  }
  if (!html.includes(SCRIPT_ID)) html = html.replace('</body>', `${SCRIPT}</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  headers.set('x-moe-scan-mode-ui', '1');
  return new Response(html, { status: response.status, statusText: response.statusText, headers });
}
