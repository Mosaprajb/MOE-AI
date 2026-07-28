import worker, { AlertCoordinator as BaseAlertCoordinator } from './notification-subscription-guard-entry.js';
import { getScannerProgress, recordScannerProgress } from './scanner-progress-service.js';

const PROGRESS_PATH = '/api/scanner/progress';
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const TRACKER_KEY = '__moerandScannerProgressTracker';
const FETCH_WRAPPED_KEY = '__moerandScannerFetchWrapped';

function secureJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function positive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function profileFromUrl(url) {
  const timeframe = url.searchParams.get('timeframe') || '';
  return timeframe.replace('Min', 'm').replace('Hour', 'h');
}

function latestBarRows(payload = {}, profile = '') {
  return Object.entries(payload.bars || {}).map(([symbol, bars]) => {
    const latest = Array.isArray(bars) ? bars.at(-1) : null;
    if (!latest) return null;
    return {
      symbol,
      status: 'SCANNED',
      profile,
      price: positive(latest.c),
      open: positive(latest.o),
      high: positive(latest.h),
      low: positive(latest.l),
      close: positive(latest.c),
      volume: Number.isFinite(Number(latest.v)) ? Number(latest.v) : null,
      barTime: latest.t || null,
    };
  }).filter(Boolean);
}

function snapshotRow(symbol, payload = {}, profile = '') {
  const bid = positive(payload?.latestQuote?.bp);
  const ask = positive(payload?.latestQuote?.ap);
  const price = positive(ask) || positive(payload?.latestTrade?.p) || positive(payload?.minuteBar?.c) || bid;
  const spreadPercent = bid && ask ? ((ask - bid) / ((ask + bid) / 2)) * 100 : null;
  return {
    symbol,
    status: 'PRICE_CHECK',
    profile,
    price,
    bid,
    ask,
    spreadPercent: spreadPercent == null ? null : Number(spreadPercent.toFixed(3)),
    open: positive(payload?.minuteBar?.o),
    high: positive(payload?.minuteBar?.h),
    low: positive(payload?.minuteBar?.l),
    close: positive(payload?.minuteBar?.c),
    volume: Number.isFinite(Number(payload?.minuteBar?.v)) ? Number(payload.minuteBar.v) : null,
    barTime: payload?.minuteBar?.t || payload?.latestTrade?.t || null,
  };
}

function createTracker(env, controller, ctx) {
  const stub = env.ALERT_COORDINATOR?.getByName?.('global');
  const runId = `scan:${Number(controller?.scheduledTime) || Date.now()}:${crypto.randomUUID()}`;
  const seenBatches = new Set();
  let scannedCount = 0;
  const startedAt = new Date().toISOString();

  const write = (patch) => {
    if (!stub?.recordScannerProgress) return Promise.resolve(null);
    const task = stub.recordScannerProgress({ runId, totalSymbols: 306, session: 'UNKNOWN', startedAt, ...patch });
    if (ctx?.waitUntil) ctx.waitUntil(Promise.resolve(task).catch(() => null));
    return task;
  };

  return {
    runId,
    write,
    async before(input) {
      let url;
      try { url = new URL(typeof input === 'string' ? input : input?.url); } catch { return null; }
      if (url.hostname !== 'data.alpaca.markets') return null;

      if (url.pathname === '/v2/stocks/bars') {
        const symbols = String(url.searchParams.get('symbols') || '').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
        const profile = profileFromUrl(url);
        const batchKey = `${profile}:${symbols.join(',')}`;
        const firstPage = !url.searchParams.get('page_token');
        if (firstPage && !seenBatches.has(batchKey)) seenBatches.add(batchKey);
        await write({
          reset: seenBatches.size === 1 && firstPage && scannedCount === 0,
          status: 'RUNNING',
          phase: 'FETCHING_MARKET_DATA',
          currentProfile: profile,
          currentBatch: symbols,
          currentSymbol: symbols[0] || null,
        }).catch(() => null);
        return { kind: 'BARS', symbols, profile, batchKey, firstPage };
      }

      const snapshotMatch = url.pathname.match(/^\/v2\/stocks\/([^/]+)\/snapshot$/);
      if (snapshotMatch) {
        const symbol = decodeURIComponent(snapshotMatch[1]).toUpperCase();
        await write({
          status: 'RUNNING',
          phase: 'CHECKING_LIVE_PRICE',
          currentSymbol: symbol,
          currentBatch: [symbol],
          rows: [{ symbol, status: 'CHECKING_PRICE' }],
        }).catch(() => null);
        return { kind: 'SNAPSHOT', symbol, profile: 'LIVE' };
      }
      return null;
    },
    async after(meta, response) {
      if (!meta || !response?.ok) return;
      let payload;
      try { payload = await response.clone().json(); } catch { return; }
      if (meta.kind === 'BARS') {
        if (meta.firstPage) scannedCount = Math.min(306, scannedCount + meta.symbols.length);
        const rows = latestBarRows(payload, meta.profile);
        await write({
          status: 'RUNNING',
          phase: 'EVALUATING_BATCH',
          currentProfile: meta.profile,
          currentBatch: meta.symbols,
          currentSymbol: meta.symbols.at(-1) || meta.symbols[0] || null,
          scannedCount,
          rows,
        }).catch(() => null);
      } else if (meta.kind === 'SNAPSHOT') {
        await write({
          status: 'RUNNING',
          phase: 'CHECKING_CANDIDATE_PRICE',
          currentSymbol: meta.symbol,
          currentBatch: [meta.symbol],
          rows: [snapshotRow(meta.symbol, payload, meta.profile)],
        }).catch(() => null);
      }
    },
    finish() {
      return write({
        status: 'COMPLETING',
        phase: 'WAITING_FOR_SCANNER_RESULT',
        currentBatch: [],
        completedAt: new Date().toISOString(),
      }).catch(() => null);
    },
  };
}

function ensureFetchInstrumentation() {
  if (globalThis[FETCH_WRAPPED_KEY]) return;
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = async function instrumentedFetch(input, init) {
    const tracker = globalThis[TRACKER_KEY] || null;
    const meta = tracker ? await tracker.before(input, init).catch(() => null) : null;
    const response = await nativeFetch(input, init);
    if (tracker && meta) tracker.after(meta, response).catch(() => null);
    return response;
  };
  globalThis[FETCH_WRAPPED_KEY] = true;
}

function rowsFromBotRecord(record = {}) {
  const rows = [];
  for (const submission of Array.isArray(record.submissions) ? record.submissions : []) {
    rows.push({
      symbol: submission.symbol,
      status: submission.submitted ? 'SUBMITTED' : submission.accepted ? 'ACCEPTED' : 'REJECTED',
      score: submission.score,
      brainScore: submission.brainScore,
      profile: submission.timeframe,
      reason: submission.message || '',
    });
  }
  for (const profile of Array.isArray(record.profiles) ? record.profiles : []) {
    for (const item of Array.isArray(profile.topRejected) ? profile.topRejected : []) {
      rows.push({
        symbol: item.symbol,
        status: 'REJECTED',
        brainScore: item.brainScore,
        profile: profile.profile,
        reason: Array.isArray(item.reasons) ? item.reasons.join(' · ') : '',
      });
    }
  }
  return rows;
}

async function enhanceDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('moerandLiveScannerPrices')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: secureHeaders(response) });
  }

  const style = `<style id="moerandLiveScannerPriceStyles">
  .scanner-live-card{margin-top:12px;padding:12px;border:1px solid rgba(56,103,142,.7);border-radius:12px;background:linear-gradient(120deg,rgba(18,54,83,.65),rgba(5,19,33,.94))}.scanner-live-top{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap}.scanner-live-symbol{font-size:25px;font-weight:950;color:#eaf5ff;letter-spacing:.8px}.scanner-live-phase{padding:6px 9px;border:1px solid #3b709a;border-radius:999px;color:#a7d8ff;font-size:9px;font-weight:900}.scanner-live-price{margin-top:5px;font-size:18px;font-weight:900;color:#83e9b2}.scanner-live-grid{display:grid;grid-template-columns:repeat(6,minmax(0,1fr));gap:7px;margin-top:11px}.scanner-live-metric{padding:8px;border:1px solid rgba(55,91,124,.48);border-radius:9px;background:rgba(4,17,29,.65)}.scanner-live-metric span{display:block;color:#829ab3;font-size:8px}.scanner-live-metric strong{display:block;margin-top:4px;color:#eef6ff;font-size:10px}.scanner-live-progress{height:6px;margin-top:11px;border-radius:999px;background:#102b43;overflow:hidden}.scanner-live-progress i{display:block;height:100%;width:0;background:linear-gradient(90deg,#2b8e66,#57c996);transition:width .25s ease}.scanner-live-caption{margin-top:7px;color:#8fa4bf;font-size:9px;line-height:1.5}.scanner-symbol{display:grid!important;grid-template-columns:1fr!important;align-content:center!important;justify-items:center!important;gap:2px!important;min-height:52px!important}.scanner-symbol small{font-size:8px;color:#8fa4bf;font-weight:700}.scanner-symbol.active{border-color:#65bdf7!important;box-shadow:0 0 0 1px rgba(101,189,247,.35),0 0 16px rgba(49,143,205,.25);background:rgba(17,68,103,.88)!important}.scanner-symbol.price-check,.scanner-symbol.accepted{border-color:#c89d43!important;background:rgba(96,69,21,.35)!important}.scanner-symbol.submitted{border-color:#39b77e!important;background:rgba(27,103,72,.38)!important}.scanner-symbol.rejected{border-color:rgba(153,74,84,.68)!important}.scanner-symbol .scan-status{font-size:7px;text-transform:uppercase}.scanner-symbol.submitted .scan-status{color:#83e9b2}.scanner-symbol.accepted .scan-status,.scanner-symbol.price-check .scan-status{color:#f2ce82}.scanner-live-batch{margin-top:7px;color:#718ba4;font-size:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  @media(max-width:760px){.scanner-live-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.scanner-live-symbol{font-size:21px}}
  </style>`;

  const script = `<script id="moerandLiveScannerPrices">
  (function(){
    let loading=false;
    const byId=id=>document.getElementById(id);
    const money=value=>Number.isFinite(Number(value))?'$'+Number(value).toFixed(2):'—';
    const compact=value=>Number.isFinite(Number(value))?new Intl.NumberFormat('en-US',{notation:'compact',maximumFractionDigits:1}).format(Number(value)):'—';
    const phaseLabels={FETCHING_MARKET_DATA:'جلب بيانات الأسعار',EVALUATING_BATCH:'تقييم دفعة الأسهم',CHECKING_LIVE_PRICE:'فحص السعر المباشر',CHECKING_CANDIDATE_PRICE:'تأكيد سعر المرشح',WAITING_FOR_SCANNER_RESULT:'إنهاء نتيجة الماسح',COMPLETE:'اكتمل الفحص',FAILED:'فشل الفحص',WAITING:'بانتظار دورة الفحص',IDLE:'خامل'};
    function mount(){
      if(byId('scannerLiveCard'))return byId('scannerLiveCard');
      const panel=byId('scannerUniversePanel');if(!panel)return null;
      const card=document.createElement('div');card.id='scannerLiveCard';card.className='scanner-live-card';
      card.innerHTML='<div class="scanner-live-top"><div><div class="scanner-live-symbol" id="scannerLiveSymbol">—</div><div class="scanner-live-price" id="scannerLivePrice">—</div></div><span class="scanner-live-phase" id="scannerLivePhase">بانتظار الفحص</span></div><div class="scanner-live-grid"><div class="scanner-live-metric"><span>OPEN</span><strong id="scannerLiveOpen">—</strong></div><div class="scanner-live-metric"><span>HIGH</span><strong id="scannerLiveHigh">—</strong></div><div class="scanner-live-metric"><span>LOW</span><strong id="scannerLiveLow">—</strong></div><div class="scanner-live-metric"><span>BID</span><strong id="scannerLiveBid">—</strong></div><div class="scanner-live-metric"><span>ASK</span><strong id="scannerLiveAsk">—</strong></div><div class="scanner-live-metric"><span>VOLUME</span><strong id="scannerLiveVolume">—</strong></div></div><div class="scanner-live-progress"><i id="scannerLiveProgressBar"></i></div><div class="scanner-live-caption" id="scannerLiveCaption">يعرض نفس بيانات الأسعار التي يستخدمها الماسح، من دون طلبات سوق إضافية.</div><div class="scanner-live-batch" id="scannerLiveBatch"></div>';
      const head=panel.querySelector('.scanner-universe-head');if(head)head.insertAdjacentElement('afterend',card);else panel.prepend(card);return card;
    }
    function paintRows(progress){
      const rows=new Map((progress.rows||[]).map(row=>[String(row.symbol||'').toUpperCase(),row]));
      document.querySelectorAll('#scannerUniverseList .scanner-symbol').forEach(node=>{
        const symbol=String(node.dataset.symbol||'').toUpperCase();const row=rows.get(symbol);const active=symbol===String(progress.currentSymbol||'').toUpperCase();
        node.classList.remove('active','price-check','accepted','submitted','rejected');if(active)node.classList.add('active');
        const status=String(row?.status||'WAITING').toLowerCase().replaceAll('_','-');if(['price-check','accepted','submitted','rejected'].includes(status))node.classList.add(status);
        node.innerHTML='<span>'+symbol+'</span><small>'+money(row?.price??row?.close)+'</small><small class="scan-status">'+String(row?.status||'WAITING').replaceAll('_',' ')+'</small>';
        node.title=row?.reason||('آخر تحديث: '+(row?.updatedAt||'—'));
      });
    }
    function render(progress){
      mount();const symbol=String(progress.currentSymbol||'—').toUpperCase();const row=(progress.rows||[]).find(item=>String(item.symbol||'').toUpperCase()===symbol)||{};
      byId('scannerLiveSymbol').textContent=symbol;byId('scannerLivePrice').textContent=money(row.price??row.close);byId('scannerLivePhase').textContent=phaseLabels[progress.phase]||String(progress.phase||progress.status||'بانتظار الفحص');
      byId('scannerLiveOpen').textContent=money(row.open);byId('scannerLiveHigh').textContent=money(row.high);byId('scannerLiveLow').textContent=money(row.low);byId('scannerLiveBid').textContent=money(row.bid);byId('scannerLiveAsk').textContent=money(row.ask);byId('scannerLiveVolume').textContent=compact(row.volume);
      byId('scannerLiveProgressBar').style.width=Math.max(0,Math.min(100,Number(progress.progressPercent||0)))+'%';byId('scannerLiveCaption').textContent='تم فحص '+Number(progress.scannedCount||0)+' من '+Number(progress.totalSymbols||0)+' · '+Number(progress.progressPercent||0).toFixed(1)+'% · الفريم '+String(progress.currentProfile||'—');byId('scannerLiveBatch').textContent=(progress.currentBatch||[]).length?'الدفعة الجارية: '+progress.currentBatch.join(' · '):'آخر تحديث: '+(progress.updatedAt?new Date(progress.updatedAt).toLocaleTimeString('en-US'):'—');paintRows(progress);
    }
    async function load(){if(loading)return;loading=true;mount();try{const response=await fetch('/api/scanner/progress',{cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'Scanner progress unavailable');render(payload.progress||{});}catch(error){byId('scannerLivePhase').textContent='تعذر قراءة التقدم';byId('scannerLiveCaption').textContent=error.message||String(error);}finally{loading=false;}}
    const start=()=>{mount();load();setInterval(load,2000);};if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();setTimeout(start,1500);
  })();
  </script>`;

  const enhanced = html.replace('</head>', `${style}</head>`).replace('</body>', `${script}</body>`);
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers: secureHeaders(response) });
}

export class AlertCoordinator extends BaseAlertCoordinator {
  recordScannerProgress(patch = {}) { return recordScannerProgress(this.ctx.storage, patch); }
  getScannerProgress() { return getScannerProgress(this.ctx.storage); }

  async recordBotStatus(record = {}) {
    const stored = await super.recordBotStatus(record);
    const skipped = record.skipped || record.error || null;
    await recordScannerProgress(this.ctx.storage, {
      status: record.ok === false ? 'FAILED' : skipped ? 'WAITING' : 'COMPLETE',
      phase: record.ok === false ? 'FAILED' : skipped ? 'WAITING' : 'COMPLETE',
      session: record.session || record.sessionWindow?.label || 'UNKNOWN',
      totalSymbols: Number(record.universeSize || record.scanned || 306),
      scannedCount: Number(record.scanned || (skipped ? 0 : record.universeSize || 306)),
      currentBatch: [],
      currentSymbol: record.submissions?.at(-1)?.symbol || null,
      completedAt: record.completedAt || new Date().toISOString(),
      rows: rowsFromBotRecord(record),
      reason: skipped,
    });
    return stored;
  }
}

function coordinator(env) { return env.ALERT_COORDINATOR.getByName('global'); }

ensureFetchInstrumentation();

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === PROGRESS_PATH) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      try { return secureJson({ ok: true, progress: await coordinator(env).getScannerProgress() }); }
      catch (error) { return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Scanner progress unavailable' }, 500); }
    }
    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhanceDashboard(response) : response;
  },

  scheduled(controller, env, ctx) {
    const tracker = createTracker(env, controller, ctx);
    globalThis[TRACKER_KEY] = tracker;
    const captured = [];
    const proxyCtx = new Proxy(ctx || {}, {
      get(target, property, receiver) {
        if (property === 'waitUntil') return (promise) => {
          const tracked = Promise.resolve(promise);
          captured.push(tracked);
          if (typeof target.waitUntil === 'function') target.waitUntil(tracked);
        };
        return Reflect.get(target, property, receiver);
      },
    });

    tracker.write({ reset: true, status: 'RUNNING', phase: 'STARTING', totalSymbols: 306, scannedCount: 0, currentBatch: [], currentSymbol: null }).catch(() => null);
    const result = worker.scheduled(controller, env, proxyCtx);
    const completion = Promise.allSettled([...captured, Promise.resolve(result)]).finally(async () => {
      if (globalThis[TRACKER_KEY] === tracker) globalThis[TRACKER_KEY] = null;
      await tracker.finish();
    });
    if (ctx?.waitUntil) ctx.waitUntil(completion);
    return result;
  },
};
