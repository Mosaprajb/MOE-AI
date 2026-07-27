import worker, { AlertCoordinator as BaseAlertCoordinator } from './scanner-tab-live-overlay-entry.js';
import { AUTO_SCANNER_SYMBOLS, activeTradingWindow } from './auto-scanner.js';
import {
  applyScannerSelectionSettings,
  getScannerSelectionSettings,
  SCANNER_SELECTION_LEVELS,
  updateScannerSelectionSettings,
} from './scanner-selection-service.js';

const SELECTION_PATH = '/api/scanner/selection';
const DIAGNOSTIC_PATH = '/api/scanner/diagnostic';
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);

function json(data, status = 200) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
}

function headers(response) {
  const result = new Headers(response.headers);
  result.delete('content-length');
  return result;
}

function runtimeEnv(env, settings) {
  const overrides = applyScannerSelectionSettings(env, settings);
  return new Proxy(env, {
    get(target, property, receiver) {
      if (typeof property === 'string' && Object.prototype.hasOwnProperty.call(overrides, property)) return overrides[property];
      return Reflect.get(target, property, receiver);
    },
  });
}

function rotateBatch(now = Date.now(), size = 12) {
  const bucket = Math.floor(now / 60_000);
  const start = (bucket * size) % AUTO_SCANNER_SYMBOLS.length;
  return Array.from({ length: size }, (_, index) => AUTO_SCANNER_SYMBOLS[(start + index) % AUTO_SCANNER_SYMBOLS.length]);
}

async function diagnosticProbe(env, stub, now = Date.now()) {
  const window = activeTradingWindow(new Date(now), env);
  const batch = rotateBatch(now);
  const start = new Date(now - 12 * 60 * 60_000).toISOString();
  const end = new Date(now).toISOString();
  const feed = window.dataFeed || 'iex';
  const query = new URLSearchParams({
    symbols: batch.join(','),
    timeframe: '1Min',
    start,
    end,
    limit: '10000',
    adjustment: 'raw',
    feed,
    sort: 'asc',
  });

  await stub.recordScannerProgress({
    status: 'RUNNING',
    phase: 'DIAGNOSTIC_DATA_CHECK',
    totalSymbols: AUTO_SCANNER_SYMBOLS.length,
    scannedCount: 0,
    currentBatch: batch,
    currentSymbol: batch[0],
    currentProfile: '1m DATA CHECK',
    session: window.label || 'UNKNOWN',
    rows: batch.map((symbol) => ({ symbol, status: 'CHECKING_DATA', profile: '1m DATA CHECK' })),
  });

  try {
    const response = await fetch(`https://data.alpaca.markets/v2/stocks/bars?${query}`, {
      headers: {
        'APCA-API-KEY-ID': env.ALPACA_KEY_ID,
        'APCA-API-SECRET-KEY': env.ALPACA_SECRET_KEY,
      },
    });
    if (!response.ok) throw new Error(`Market data returned ${response.status}`);
    const payload = await response.json();
    const rows = batch.map((symbol) => {
      const bars = Array.isArray(payload.bars?.[symbol]) ? payload.bars[symbol] : [];
      const latest = bars.at(-1) || null;
      return latest ? {
        symbol,
        status: 'DATA_OK',
        profile: '1m DATA CHECK',
        price: Number(latest.c),
        open: Number(latest.o),
        high: Number(latest.h),
        low: Number(latest.l),
        close: Number(latest.c),
        volume: Number(latest.v || 0),
        barTime: latest.t || null,
      } : { symbol, status: 'NO_RECENT_BAR', profile: '1m DATA CHECK', reason: 'No recent bar returned for this symbol' };
    });
    const withPrice = rows.filter((row) => Number.isFinite(row.price));
    const current = withPrice.at(-1) || rows.at(-1);
    await stub.recordScannerProgress({
      status: 'WAITING',
      phase: 'DIAGNOSTIC_COMPLETE',
      totalSymbols: AUTO_SCANNER_SYMBOLS.length,
      scannedCount: batch.length,
      currentBatch: batch,
      currentSymbol: current?.symbol || batch[0],
      currentProfile: '1m DATA CHECK',
      session: window.label || 'UNKNOWN',
      rows,
      reason: withPrice.length ? `Diagnostic data received for ${withPrice.length}/${batch.length} symbols` : 'Diagnostic completed but no recent bars were returned',
      completedAt: new Date().toISOString(),
    });
    return { ok: true, feed, batch, symbolsWithPrices: withPrice.length, rows };
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Diagnostic market-data request failed';
    await stub.recordScannerProgress({
      status: 'FAILED',
      phase: 'DIAGNOSTIC_FAILED',
      totalSymbols: AUTO_SCANNER_SYMBOLS.length,
      scannedCount: batch.length,
      currentBatch: batch,
      currentSymbol: batch[0],
      currentProfile: '1m DATA CHECK',
      session: window.label || 'UNKNOWN',
      rows: batch.map((symbol) => ({ symbol, status: 'DATA_ERROR', profile: '1m DATA CHECK', reason: message })),
      reason: message,
      completedAt: new Date().toISOString(),
    });
    return { ok: false, error: message, feed, batch };
  }
}

function controlsMarkup() {
  return `<div id="scannerSelectionControls" class="scanner-selection-controls">
    <div class="scanner-selection-copy"><strong>درجة اختيار الأسهم</strong><span id="scannerSelectionDescription">تحميل الإعداد...</span></div>
    <div class="scanner-selection-buttons">
      <button type="button" data-level="DISCOVERY">استكشاف <small>58</small></button>
      <button type="button" data-level="ACTIVE">نشط <small>65</small></button>
      <button type="button" data-level="BALANCED">متوازن <small>70</small></button>
      <button type="button" data-level="CONSERVATIVE">حذر <small>75</small></button>
    </div>
    <button type="button" id="scannerDiagnosticNow" class="scanner-diagnostic-button">فحص البيانات الآن</button>
    <div id="scannerSelectionMessage" class="scanner-selection-message">هذا الإعداد يغيّر الترشيح الأولي في Sandbox فقط؛ فلاتر MOE AI والمخاطر والتنفيذ لا تتغير.</div>
  </div>`;
}

async function enhance(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  let html = await response.text();
  if (html.includes('scannerSelectionControls')) return new Response(html, { status: response.status, statusText: response.statusText, headers: headers(response) });

  const style = `<style id="scannerSelectionStyles">
  .scanner-selection-controls{display:grid;grid-template-columns:minmax(220px,1fr) minmax(320px,1.5fr) auto;gap:10px;align-items:center;margin:12px 0;padding:13px;border:1px solid rgba(67,111,150,.58);border-radius:14px;background:rgba(5,18,31,.72)}.scanner-selection-copy strong{display:block;color:#eaf4ff;font-size:13px}.scanner-selection-copy span{display:block;margin-top:5px;color:#8fa4bf;font-size:10px;line-height:1.5}.scanner-selection-buttons{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:7px}.scanner-selection-buttons button,.scanner-diagnostic-button{min-height:42px;border:1px solid #365f82;border-radius:10px;background:#102d48;color:#eaf4ff;font-weight:900;cursor:pointer}.scanner-selection-buttons button small{display:block;margin-top:2px;color:#86a4be}.scanner-selection-buttons button.active{border-color:#54dfa0;background:#17553f;color:#fff;box-shadow:0 0 18px rgba(84,223,160,.18)}.scanner-diagnostic-button{background:#173e61}.scanner-selection-buttons button:disabled,.scanner-diagnostic-button:disabled{opacity:.55;cursor:wait}.scanner-selection-message{grid-column:1/-1;color:#8fa4bf;font-size:9px;line-height:1.55}.scanner-selection-message.success{color:#83e9b2}.scanner-selection-message.error{color:#ffabb5}
  @media(max-width:900px){.scanner-selection-controls{grid-template-columns:1fr}.scanner-selection-buttons{grid-template-columns:repeat(2,minmax(0,1fr))}.scanner-selection-message{grid-column:1}}
  </style>`;

  const script = `<script id="scannerSelectionControlsScript">
  (function(){let cachedPin='',busy=false;const byId=id=>document.getElementById(id);const message=(text,type)=>{const el=byId('scannerSelectionMessage');if(el){el.textContent=text;el.className='scanner-selection-message '+(type||'');}};const pin=()=>cachedPin||(cachedPin=window.prompt('أدخل رمز التحكم لتعديل حساسية السكانر. سيبقى في ذاكرة الصفحة فقط.')||'');
  async function load(){try{const response=await fetch('/api/scanner/selection',{cache:'no-store'}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر تحميل الإعداد');const settings=payload.settings||{};document.querySelectorAll('[data-level]').forEach(button=>button.classList.toggle('active',button.dataset.level===settings.level));byId('scannerSelectionDescription').textContent=(settings.labelAr||settings.level)+' · الحد الأولي '+settings.minimumScore+' · '+(settings.descriptionAr||'');}catch(error){message(error.message||String(error),'error');}}
  async function update(level){if(busy)return;const controlPin=pin();if(!controlPin)return;busy=true;document.querySelectorAll('[data-level]').forEach(button=>button.disabled=true);try{const response=await fetch('/api/scanner/selection',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({pin:controlPin,level})}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر حفظ الإعداد');message('تم ضبط درجة اختيار الأسهم على '+payload.settings.labelAr+' ('+payload.settings.minimumScore+'). سيستخدمها الفحص القادم.','success');await load();}catch(error){if(/incorrect pin|invalid pin/i.test(error.message))cachedPin='';message(error.message||String(error),'error');}finally{busy=false;document.querySelectorAll('[data-level]').forEach(button=>button.disabled=false);}}
  async function diagnostic(){if(busy)return;const controlPin=pin();if(!controlPin)return;busy=true;const button=byId('scannerDiagnosticNow');button.disabled=true;button.textContent='جارٍ فحص البيانات...';try{const response=await fetch('/api/scanner/diagnostic',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({pin:controlPin})}),payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'فشل الفحص التشخيصي');message('اكتمل فحص البيانات: ظهرت أسعار '+payload.diagnostic.symbolsWithPrices+' من '+payload.diagnostic.batch.length+' أسهم.','success');}catch(error){if(/incorrect pin|invalid pin/i.test(error.message))cachedPin='';message(error.message||String(error),'error');}finally{busy=false;button.disabled=false;button.textContent='فحص البيانات الآن';}}
  const start=()=>{document.querySelectorAll('[data-level]').forEach(button=>button.onclick=()=>update(button.dataset.level));const test=byId('scannerDiagnosticNow');if(test)test.onclick=diagnostic;load();};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
  })();
  </script>`;

  const marker = '<div class="terminal-grid scanner-grid">';
  if (html.includes(marker)) html = html.replace(marker, `${controlsMarkup()}${marker}`);
  html = html.replace('</head>', `${style}</head>`).replace('</body>', `${script}</body>`);
  return new Response(html, { status: response.status, statusText: response.statusText, headers: headers(response) });
}

export class AlertCoordinator extends BaseAlertCoordinator {
  getScannerSelectionSettings() { return getScannerSelectionSettings(this.ctx.storage); }
  updateScannerSelectionSettings(patch = {}) { return updateScannerSelectionSettings(this.ctx.storage, patch); }
}

function coordinator(env) { return env.ALERT_COORDINATOR.getByName('global'); }

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const stub = coordinator(env);
    if (url.pathname === SELECTION_PATH) {
      if (request.method === 'GET') return json({ ok: true, settings: await stub.getScannerSelectionSettings(), levels: SCANNER_SELECTION_LEVELS });
      if (request.method !== 'PUT') return json({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const payload = await request.json();
        await stub.verifyLiveControlPin(payload.pin);
        return json({ ok: true, settings: await stub.updateScannerSelectionSettings({ level: payload.level, updatedBy: 'DASHBOARD_OWNER' }) });
      } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'Scanner setting update failed' }, 400); }
    }
    if (url.pathname === DIAGNOSTIC_PATH) {
      if (request.method !== 'POST') return json({ ok: false, error: 'Method not allowed' }, 405);
      try {
        const payload = await request.json();
        await stub.verifyLiveControlPin(payload.pin);
        const diagnostic = await diagnosticProbe(env, stub, Date.now());
        return json({ ok: diagnostic.ok, diagnostic }, diagnostic.ok ? 200 : 502);
      } catch (error) { return json({ ok: false, error: error instanceof Error ? error.message : 'Scanner diagnostic failed' }, 400); }
    }
    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhance(response) : response;
  },

  async scheduled(controller, env, ctx) {
    const stub = coordinator(env);
    let settings;
    try { settings = await stub.getScannerSelectionSettings(); }
    catch { settings = SCANNER_SELECTION_LEVELS.ACTIVE; }
    const adjusted = runtimeEnv(env, settings);
    const result = worker.scheduled(controller, adjusted, ctx);
    const probeTask = Promise.resolve(result).catch(() => null).then(() => diagnosticProbe(adjusted, stub, Number(controller?.scheduledTime) || Date.now()));
    if (ctx?.waitUntil) ctx.waitUntil(probeTask);
    return result;
  },
};
