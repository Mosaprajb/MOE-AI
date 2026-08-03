import baseWorker, {
  AlertCoordinator as BaseAlertCoordinator,
  SimulationDriver,
} from './sandbox-mobile-account-balances-entry.js';

export { SimulationDriver };

const MOBILE_PATHS = new Set(['/m', '/m/', '/mobile', '/mobile/']);
const CLEAN_SETTINGS_PATH = '/api/strategy/moerand-clean/settings';
const CLEAN_SETTINGS_KEY = 'moerand-clean:ut-bot-settings:v1';
const CLEAN_STRATEGY = 'MOERAND_CLEAN_INTERNAL';
const DEFAULT_CLEAN_SETTINGS = Object.freeze({
  keyValue: 1,
  atrPeriod: 2,
  useHeikinAshi: false,
  timeframeMinutes: 5,
  closeOnly: true,
});

function number(value, fallback, minimum, maximum) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function integer(value, fallback, minimum, maximum) {
  return Math.trunc(number(value, fallback, minimum, maximum));
}

function boolean(value, fallback = false) {
  if (typeof value === 'boolean') return value;
  if (value == null || value === '') return fallback;
  return ['true', '1', 'yes', 'on'].includes(String(value).trim().toLowerCase());
}

function normalizeCleanSettings(value = {}) {
  return {
    keyValue: number(value.keyValue, DEFAULT_CLEAN_SETTINGS.keyValue, 0.1, 100),
    atrPeriod: integer(value.atrPeriod, DEFAULT_CLEAN_SETTINGS.atrPeriod, 1, 500),
    useHeikinAshi: boolean(value.useHeikinAshi, DEFAULT_CLEAN_SETTINGS.useHeikinAshi),
    timeframeMinutes: integer(value.timeframeMinutes, DEFAULT_CLEAN_SETTINGS.timeframeMinutes, 1, 15),
    closeOnly: true,
  };
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

function json(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store, no-cache, must-revalidate',
      'content-type': 'application/json; charset=utf-8',
      'x-content-type-options': 'nosniff',
      'x-moe-clean-strategy': 'ut-bot-close-only-v1',
    },
  });
}

function sameOrigin(request, env = {}) {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  const requestOrigin = new URL(request.url).origin;
  let appOrigin = '';
  try { appOrigin = env.APP_URL ? new URL(env.APP_URL).origin : ''; } catch { appOrigin = ''; }
  return origin === requestOrigin
    || origin === String(env.APP_ORIGIN || '').replace(/\/$/, '')
    || origin === appOrigin;
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async moerandCleanSettings() {
    const stored = await this.ctx.storage.get(CLEAN_SETTINGS_KEY);
    return normalizeCleanSettings(stored && typeof stored === 'object' ? stored : {});
  }

  async updateMoerandCleanSettings(patch = {}, actor = 'MOBILE_DASHBOARD') {
    const current = await this.moerandCleanSettings();
    const settings = normalizeCleanSettings({ ...current, ...patch });
    await this.ctx.storage.put(CLEAN_SETTINGS_KEY, {
      ...settings,
      updatedAt: new Date().toISOString(),
      updatedBy: String(actor || 'MOBILE_DASHBOARD').slice(0, 64),
    });
    return settings;
  }
}

async function handleCleanSettingsApi(request, env) {
  if (!sameOrigin(request, env)) return json({ ok: false, error: 'Invalid request origin.' }, 403);
  if (request.headers.get('x-moe-mobile-client') !== '1') {
    return json({ ok: false, error: 'Mobile client header is required.' }, 403);
  }
  const stub = coordinator(env);
  if (request.method === 'GET') {
    return json({
      ok: true,
      strategy: CLEAN_STRATEGY,
      settings: await stub.moerandCleanSettings(),
      signalTiming: 'CANDLE_CLOSE_ONLY',
      timeframeRange: { minimum: 1, maximum: 15 },
      storage: 'DURABLE_OBJECT',
    });
  }
  if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed.' }, 405);

  const runtime = await stub.mobileDashboardRuntime();
  if (runtime?.armed === true) {
    return json({ ok: false, error: 'Stop trading before changing strategy settings.' }, 409);
  }

  let body;
  try { body = await request.json(); }
  catch { return json({ ok: false, error: 'Valid JSON is required.' }, 400); }
  const settings = await stub.updateMoerandCleanSettings(body?.settings || body, 'MOBILE_DASHBOARD');
  return json({
    ok: true,
    strategy: CLEAN_STRATEGY,
    settings,
    signalTiming: 'CANDLE_CLOSE_ONLY',
    timeframeRange: { minimum: 1, maximum: 15 },
    storage: 'DURABLE_OBJECT',
  });
}

const CLEAN_SETTINGS_STYLE = String.raw`
<style id="moe-clean-utbot-settings-style">
.clean-utbot-settings{margin-top:14px;padding:16px;border:1px solid var(--line);border-radius:16px;background:var(--panel-2)}
.clean-utbot-settings[hidden]{display:none}
.clean-utbot-title{font-size:13px;font-weight:900;letter-spacing:.1em;text-transform:uppercase;color:var(--accent);margin-bottom:13px}
.clean-utbot-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.clean-utbot-field{display:grid;gap:7px}
.clean-utbot-field span{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.clean-utbot-field input,.clean-utbot-field select{width:100%;min-width:0;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);color:var(--text);font:700 16px 'IBM Plex Mono',monospace;outline:none}
.clean-utbot-field input:focus,.clean-utbot-field select:focus{border-color:var(--accent)}
.clean-utbot-check{grid-column:1/-1;display:flex;align-items:center;gap:11px;padding:12px;border:1px solid var(--line);border-radius:12px;background:var(--panel);font-size:14px;font-weight:700;cursor:pointer}
.clean-utbot-check input{width:22px;height:22px;accent-color:var(--accent)}
.clean-utbot-note{margin:12px 0 0;color:var(--muted);font:600 12px/1.55 'IBM Plex Mono',monospace}
.clean-utbot-save{width:100%;margin-top:13px;padding:14px;border:1px solid var(--accent);border-radius:13px;background:var(--accent);color:var(--accent-ink);font:900 15px 'Archivo',sans-serif;cursor:pointer}
.clean-utbot-save:disabled{opacity:.45}
.clean-utbot-state{min-height:20px;margin-top:8px;color:var(--muted);font-size:12px}
.clean-utbot-state[data-error="true"]{color:var(--red)}
@media(max-width:390px){.clean-utbot-grid{grid-template-columns:1fr}}
</style>`;

const CLEAN_SETTINGS_HTML = String.raw`
<div class="clean-utbot-settings" id="cleanUtbotSettings" hidden>
  <div class="clean-utbot-title">UT Bot settings</div>
  <div class="clean-utbot-grid">
    <label class="clean-utbot-field">
      <span>Key value · sensitivity</span>
      <input id="cleanKeyValue" type="number" min="0.1" max="100" step="0.1" inputmode="decimal" value="1">
    </label>
    <label class="clean-utbot-field">
      <span>ATR period</span>
      <input id="cleanAtrPeriod" type="number" min="1" max="500" step="1" inputmode="numeric" value="2">
    </label>
    <label class="clean-utbot-field" style="grid-column:1/-1">
      <span>Signal timeframe</span>
      <select id="cleanTimeframe">
        <option value="1">1 minute</option><option value="2">2 minutes</option>
        <option value="3">3 minutes</option><option value="4">4 minutes</option>
        <option value="5">5 minutes</option><option value="6">6 minutes</option>
        <option value="7">7 minutes</option><option value="8">8 minutes</option>
        <option value="9">9 minutes</option><option value="10">10 minutes</option>
        <option value="11">11 minutes</option><option value="12">12 minutes</option>
        <option value="13">13 minutes</option><option value="14">14 minutes</option>
        <option value="15">15 minutes</option>
      </select>
    </label>
    <label class="clean-utbot-check">
      <input id="cleanHeikin" type="checkbox">
      <span>Signals from Heikin Ashi candles</span>
    </label>
  </div>
  <p class="clean-utbot-note">BUY and SELL are confirmed only after the selected candle has fully closed.</p>
  <button type="button" class="clean-utbot-save" id="saveCleanSettings">Save strategy settings</button>
  <div class="clean-utbot-state" id="cleanSettingsState"></div>
</div>`;

const CLEAN_SETTINGS_SCRIPT = String.raw`
<script id="moe-clean-utbot-settings-script">
(function(){
  if(window.__moeCleanUtbotSettingsInstalled) return;
  window.__moeCleanUtbotSettingsInstalled=true;
  const strategy=document.getElementById('strategySelect');
  const panel=document.getElementById('cleanUtbotSettings');
  const saveButton=document.getElementById('saveCleanSettings');
  const stateLabel=document.getElementById('cleanSettingsState');
  const keyValue=document.getElementById('cleanKeyValue');
  const atrPeriod=document.getElementById('cleanAtrPeriod');
  const heikin=document.getElementById('cleanHeikin');
  const timeframe=document.getElementById('cleanTimeframe');
  if(!strategy||!panel||!saveButton) return;

  let loaded=false;
  let saving=false;
  let saveTimer=null;

  function setState(message,error){
    stateLabel.textContent=message||'';
    stateLabel.dataset.error=String(error===true);
  }
  function visible(){
    const show=strategy.value==='MOERAND_CLEAN_INTERNAL';
    panel.hidden=!show;
    if(show&&!loaded) loadSettings();
  }
  function apply(settings){
    keyValue.value=Number(settings?.keyValue??1);
    atrPeriod.value=Math.trunc(Number(settings?.atrPeriod??2));
    heikin.checked=settings?.useHeikinAshi===true;
    timeframe.value=String(Math.max(1,Math.min(15,Math.trunc(Number(settings?.timeframeMinutes??5)))));
  }
  function payload(){
    return {
      keyValue:Math.max(.1,Math.min(100,Number(keyValue.value||1))),
      atrPeriod:Math.max(1,Math.min(500,Math.trunc(Number(atrPeriod.value||2)))),
      useHeikinAshi:heikin.checked===true,
      timeframeMinutes:Math.max(1,Math.min(15,Math.trunc(Number(timeframe.value||5))))
    };
  }
  async function request(method,body){
    const response=await fetch('/api/strategy/moerand-clean/settings',{
      method,cache:'no-store',credentials:'same-origin',
      headers:{'content-type':'application/json','x-moe-mobile-client':'1'},
      body:body?JSON.stringify(body):undefined
    });
    const data=await response.json().catch(function(){return {};});
    if(!response.ok||data.ok===false) throw new Error(data.error||('HTTP '+response.status));
    return data;
  }
  async function loadSettings(){
    try{
      setState('Loading…',false);
      const data=await request('GET');
      apply(data.settings||{});
      loaded=true;
      setState('Candle-close confirmation is active.',false);
    }catch(error){setState(error.message||'Unable to load settings.',true);}
  }
  async function saveSettings(){
    if(saving) return;
    saving=true;saveButton.disabled=true;setState('Saving…',false);
    try{
      const data=await request('PUT',{settings:payload()});
      apply(data.settings||{});
      loaded=true;
      setState('Saved · signals execute after candle close.',false);
    }catch(error){setState(error.message||'Unable to save settings.',true);}
    finally{saving=false;saveButton.disabled=false;}
  }
  function scheduleSave(){
    clearTimeout(saveTimer);
    saveTimer=setTimeout(saveSettings,500);
  }

  strategy.addEventListener('change',visible);
  saveButton.addEventListener('click',saveSettings);
  [keyValue,atrPeriod,heikin,timeframe].forEach(function(node){node.addEventListener('change',scheduleSave);});
  try{
    if(typeof STRATS!=='undefined'&&STRATS.MOERAND_CLEAN_INTERNAL){
      STRATS.MOERAND_CLEAN_INTERNAL={
        name:'MOERAND Clean',
        idea:'UT Bot ATR trailing-stop crossovers with optional Heikin Ashi signals. Every BUY and SELL is confirmed only after the selected candle closes.',
        entry:['The selected candle closes above the UT Bot ATR trailing stop','The source crosses from below the trailing stop to above it'],
        exit:['The selected candle closes below the UT Bot ATR trailing stop','The final allowed session candle closes'],
        specs:[['Timeframe','1–15 minutes'],['Key value','Adjustable'],['ATR period','Adjustable'],['Heikin Ashi','Optional'],['Signal timing','Candle close only']],
        note:'Changing the settings is blocked while trading is running so one position cannot change rules midway.'
      };
    }
  }catch(_){}
  visible();
})();
</script>`;

async function patchMobileDashboard(response, request) {
  if (request.method === 'HEAD') return response;
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('id="moe-clean-utbot-settings-script"')) return response;

  let output = html.replace('</head>', `${CLEAN_SETTINGS_STYLE}\n</head>`);
  output = output.replace(
    /(<select class="big" id="strategySelect">[\s\S]*?<\/select>)/,
    `$1\n${CLEAN_SETTINGS_HTML}`,
  );
  output = output.includes('</body>')
    ? output.replace('</body>', `${CLEAN_SETTINGS_SCRIPT}\n</body>`)
    : `${output}\n${CLEAN_SETTINGS_SCRIPT}`;

  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store, no-cache, must-revalidate');
  return new Response(output, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function scopedScheduledEnvironment(env) {
  try {
    const stub = coordinator(env);
    const runtime = await stub.mobileDashboardRuntime();
    if (runtime?.armed !== true) {
      return {
        ...env,
        AUTO_SCANNER_ENABLED: 'false',
        WEBULL_AUTOMATION_ARMED: 'false',
        MOE_ACTIVE_STRATEGY: String(runtime?.strategy || env.MOE_ACTIVE_STRATEGY || 'FUSION_V2').toUpperCase(),
      };
    }

    const strategy = String(runtime?.strategy || 'FUSION_V2').toUpperCase();
    if (strategy !== CLEAN_STRATEGY) return { ...env, MOE_ACTIVE_STRATEGY: strategy };

    const settings = await stub.moerandCleanSettings();
    const higherMinutes = settings.timeframeMinutes < 15 ? 15 : 60;
    return {
      ...env,
      MOE_ACTIVE_STRATEGY: CLEAN_STRATEGY,
      MOERAND_CLEAN_KEY_VALUE: String(settings.keyValue),
      MOERAND_CLEAN_ATR_PERIOD: String(settings.atrPeriod),
      MOERAND_CLEAN_USE_HEIKIN_ASHI: String(settings.useHeikinAshi),
      MOERAND_CLEAN_TIMEFRAME_MINUTES: String(settings.timeframeMinutes),
      AUTO_SCANNER_PROFILES: `${settings.timeframeMinutes}:${higherMinutes}`,
    };
  } catch (error) {
    console.error(JSON.stringify({
      event: 'MOERAND_CLEAN_SETTINGS_SCOPE_FAILED',
      error: error instanceof Error ? error.message : 'Unable to load Clean strategy settings',
      createdAt: new Date().toISOString(),
    }));
    return env;
  }
}

export default {
  ...baseWorker,
  async fetch(request, env, ctx) {
    const pathname = new URL(request.url).pathname;
    if (pathname === CLEAN_SETTINGS_PATH) return handleCleanSettingsApi(request, env);
    const response = await baseWorker.fetch(request, env, ctx);
    return MOBILE_PATHS.has(pathname)
      ? patchMobileDashboard(response, request)
      : response;
  },
  scheduled(controller, env, ctx) {
    const task = scopedScheduledEnvironment(env)
      .then((scopedEnv) => baseWorker.scheduled(controller, scopedEnv, ctx));
    if (ctx && typeof ctx.waitUntil === 'function') ctx.waitUntil(task);
    return task;
  },
};
