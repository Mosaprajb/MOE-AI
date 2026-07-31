import { createOpportunityManager } from '../opportunity/opportunity-manager.js';

export const LIVE_SCANNER_SCHEMA = 'MOE.DashboardLiveScannerSnapshot';
export const LIVE_SCANNER_VERSION = '1.0.0';
export const LIVE_SCANNER_STORAGE_KEY = 'dashboard-live-scanner:v1';
export const LIVE_SCANNER_API_PATH = '/api/scanner/opportunities/live';

const ACTIVE_STATUS = 'ACTIVE';
const DEFAULT_TOP_N = 10;
const DEFAULT_TTL_MS = 15 * 60_000;
const DEFAULT_MAX_TTL_MS = 24 * 60 * 60_000;

const GRADE_PRIORITY = Object.freeze({ AAA: 6, AA: 5, A: 4, BBB: 3, BB: 2, REJECT: 0 });

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clamp(value, minimum = 0, maximum = 100) {
  return Math.min(maximum, Math.max(minimum, finite(value)));
}

function positiveInteger(value, fallback, minimum = 1, maximum = 100) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function positiveDuration(value, fallback, minimum = 1_000, maximum = DEFAULT_MAX_TTL_MS) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function iso(value, fallback = Date.now()) {
  const date = value instanceof Date ? value : new Date(value ?? fallback);
  if (Number.isNaN(date.getTime())) return new Date(fallback).toISOString();
  return date.toISOString();
}

function timestamp(value, fallback = Date.now()) {
  return new Date(iso(value, fallback)).getTime();
}

function confidenceValue(value, fallback = 0) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return clamp(value.value ?? value.score ?? fallback);
  }
  return clamp(value ?? fallback);
}

function gradeFromScore(value) {
  const score = clamp(value);
  if (score >= 90) return 'AAA';
  if (score >= 84) return 'AA';
  if (score >= 76) return 'A';
  if (score >= 68) return 'BBB';
  if (score >= 55) return 'BB';
  return 'REJECT';
}

function grade(value, score) {
  const normalized = text(value).toUpperCase();
  return Object.hasOwn(GRADE_PRIORITY, normalized) ? normalized : gradeFromScore(score);
}

function symbol(value) {
  const normalized = text(value).toUpperCase();
  return /^[A-Z][A-Z0-9.-]{0,9}$/.test(normalized) ? normalized : null;
}

function managerRecordInput(item) {
  if (!item || typeof item !== 'object') return null;
  const opportunity = item.opportunity ?? item;
  if (!opportunity || typeof opportunity !== 'object') return null;
  const normalizedSymbol = symbol(item.symbol ?? opportunity.symbol);
  if (!normalizedSymbol) return null;
  return {
    opportunity: {
      ...opportunity,
      symbol: normalizedSymbol,
      direction: text(item.direction ?? opportunity.direction, 'LONG').toUpperCase(),
      timeframe: text(item.timeframe ?? opportunity.timeframe, '5m').toLowerCase(),
      score: clamp(item.score ?? opportunity.score),
      confidence: opportunity.confidence ?? { value: confidenceValue(item.confidence, item.score ?? opportunity.score), source: 'dashboard-live-scanner' },
      createdAt: iso(opportunity.createdAt ?? item.firstSeenAt ?? item.lastSeenAt),
      metadata: {
        ...(opportunity.metadata || {}),
        setupFamily: text(item.family ?? opportunity.metadata?.setupFamily, 'GENERAL').toUpperCase(),
        grade: grade(item.grade ?? opportunity.metadata?.grade, item.score ?? opportunity.score),
      },
    },
    fusion: item.fusion ?? opportunity.fusion ?? null,
    grade: grade(item.grade ?? opportunity.metadata?.grade, item.score ?? opportunity.score),
    dedupeKey: text(item.dedupeKey),
    expiresAt: item.expiresAt ?? opportunity.expiresAt ?? opportunity.validUntil,
    observedAt: item.lastSeenAt ?? item.observedAt ?? opportunity.createdAt,
    universePriority: item.universePriority ?? opportunity.metadata?.universePriority,
  };
}

function managerSelectionInputs(value) {
  const selected = Array.isArray(value)
    ? value
    : Array.isArray(value?.selected)
      ? value.selected
      : Array.isArray(value?.opportunitySelection?.selected)
        ? value.opportunitySelection.selected
        : Array.isArray(value?.liveScanner?.opportunitySelection?.selected)
          ? value.liveScanner.opportunitySelection.selected
          : Array.isArray(value?.opportunities)
            ? value.opportunities
            : [];
  return selected.map(managerRecordInput).filter(Boolean);
}

export function opportunityInputsFromBotRecord(record, { ttlMs = DEFAULT_TTL_MS } = {}) {
  const normalizedTtl = positiveDuration(ttlMs, DEFAULT_TTL_MS);
  const observedAt = iso(record?.completedAt ?? record?.recordedAt ?? record?.scheduledAt);
  const submissions = Array.isArray(record?.submissions) ? record.submissions : [];
  return submissions
    .filter((item) => item && item.accepted === true)
    .map((item, index) => {
      const normalizedSymbol = symbol(item.symbol);
      if (!normalizedSymbol) return null;
      const score = clamp(item.brainScore ?? item.score);
      const timeframe = text(item.timeframe, '5m').toLowerCase();
      const sourceId = text(item.signalId, `AUTO-${normalizedSymbol}-${timeframe}-${timestamp(observedAt)}-${index}`);
      return {
        opportunity: {
          id: sourceId,
          symbol: normalizedSymbol,
          direction: 'LONG',
          timeframe,
          score,
          confidence: { value: score, source: 'auto-scanner-brain' },
          reasons: [text(item.message, 'AUTO_SCANNER_ACCEPTED')],
          createdAt: observedAt,
          validForMs: normalizedTtl,
          metadata: {
            setupFamily: 'AUTO_SCANNER',
            grade: gradeFromScore(score),
            source: 'AUTO_SCANNER',
            higherTimeframe: text(item.higherTimeframe),
            validForMs: normalizedTtl,
          },
        },
        grade: gradeFromScore(score),
        validForMs: normalizedTtl,
        observedAt,
      };
    })
    .filter(Boolean);
}

function incomingInputs(value, options) {
  if (!value) return [];
  const managed = managerSelectionInputs(value);
  if (managed.length) return managed;
  return opportunityInputsFromBotRecord(value, options);
}

function normalizedRow(item, nowMs) {
  const opportunity = item?.opportunity ?? {};
  const normalizedSymbol = symbol(item?.symbol ?? opportunity.symbol);
  if (!normalizedSymbol) return null;
  const score = clamp(item?.score ?? opportunity.score);
  const confidence = confidenceValue(item?.confidence ?? opportunity.confidence, score);
  const expiresAt = iso(item?.expiresAt ?? opportunity.expiresAt ?? opportunity.validUntil, nowMs);
  const expiresMs = timestamp(expiresAt, nowMs);
  const status = text(item?.status ?? opportunity.status, ACTIVE_STATUS).toUpperCase();
  const timeframe = text(item?.timeframe ?? opportunity.timeframe, '5m').toLowerCase();
  const family = text(item?.family ?? opportunity.metadata?.setupFamily, 'GENERAL').toUpperCase();
  const dedupeKey = text(item?.dedupeKey, `${normalizedSymbol}|LONG|${timeframe}|${family}`);
  return {
    id: text(item?.id ?? opportunity.id, dedupeKey),
    dedupeKey,
    symbol: normalizedSymbol,
    grade: grade(item?.grade ?? opportunity.metadata?.grade, score),
    score,
    confidence,
    status,
    expiresAt,
    expiresMs,
    rank: positiveInteger(item?.rank, 100, 1, 10_000),
    rankScore: clamp(item?.rankScore ?? score),
    direction: text(item?.direction ?? opportunity.direction, 'LONG').toUpperCase(),
    timeframe,
    family,
    duplicateCount: Math.max(0, Math.floor(finite(item?.duplicateCount, 0))),
    confirmationCount: Math.max(1, Math.floor(finite(item?.confirmationCount, 1))),
    firstSeenAt: iso(item?.firstSeenAt ?? opportunity.createdAt, nowMs),
    lastSeenAt: iso(item?.lastSeenAt ?? item?.observedAt ?? opportunity.createdAt, nowMs),
  };
}

function compareRows(left, right) {
  return left.rank - right.rank
    || (GRADE_PRIORITY[right.grade] ?? 0) - (GRADE_PRIORITY[left.grade] ?? 0)
    || right.rankScore - left.rankScore
    || right.score - left.score
    || right.confidence - left.confidence
    || left.symbol.localeCompare(right.symbol);
}

export function createLiveScannerSnapshot(selection, {
  now = Date.now(),
  topN = DEFAULT_TOP_N,
} = {}) {
  const nowMs = timestamp(now);
  const normalizedTopN = positiveInteger(topN, DEFAULT_TOP_N);
  const selected = Array.isArray(selection?.selected) ? selection.selected : [];
  const unique = new Map();
  let expiredHidden = 0;
  let inactiveHidden = 0;
  let duplicatesHidden = 0;

  for (const item of selected) {
    const row = normalizedRow(item, nowMs);
    if (!row) continue;
    if (row.status !== ACTIVE_STATUS) {
      inactiveHidden += 1;
      continue;
    }
    if (row.expiresMs <= nowMs) {
      expiredHidden += 1;
      continue;
    }
    const existing = unique.get(row.dedupeKey);
    if (!existing) {
      unique.set(row.dedupeKey, row);
      continue;
    }
    duplicatesHidden += 1;
    if (compareRows(row, existing) < 0) unique.set(row.dedupeKey, row);
  }

  const rows = [...unique.values()]
    .sort(compareRows)
    .slice(0, normalizedTopN)
    .map((row, index) => Object.freeze({
      ...row,
      rank: index + 1,
      expiry: row.expiresAt,
      observationOnly: true,
      executionEnabled: false,
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
    }));
  const nextExpiryAt = rows.length
    ? rows.reduce((earliest, row) => row.expiresMs < earliest.expiresMs ? row : earliest).expiresAt
    : null;

  return deepFreeze({
    schema: LIVE_SCANNER_SCHEMA,
    schemaVersion: LIVE_SCANNER_VERSION,
    updatedAt: new Date(nowMs).toISOString(),
    topN: normalizedTopN,
    rows,
    opportunities: rows,
    opportunitySelection: selection,
    summary: {
      active: finite(selection?.summary?.active, rows.length),
      displayed: rows.length,
      omitted: Math.max(0, finite(selection?.summary?.active, rows.length) - rows.length),
      duplicatesHidden: finite(selection?.summary?.duplicatesRemoved, 0) + duplicatesHidden,
      expiredHidden: finite(selection?.summary?.expired, 0) + expiredHidden,
      inactiveHidden,
      nextExpiryAt,
    },
    observationOnly: true,
    executionEnabled: false,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}

export function mergeLiveScannerSelection(previousSnapshot, incoming, {
  now = Date.now(),
  topN = DEFAULT_TOP_N,
  ttlMs = DEFAULT_TTL_MS,
  maxTtlMs = DEFAULT_MAX_TTL_MS,
  minimumScore = 0,
  minimumConfidence = 0,
} = {}) {
  const nowMs = timestamp(now);
  const normalizedTopN = positiveInteger(topN, DEFAULT_TOP_N);
  const normalizedTtl = positiveDuration(ttlMs, DEFAULT_TTL_MS);
  const normalizedMaxTtl = positiveDuration(maxTtlMs, DEFAULT_MAX_TTL_MS, normalizedTtl, 7 * 24 * 60 * 60_000);
  const manager = createOpportunityManager({
    topN: normalizedTopN,
    defaultTtlMs: normalizedTtl,
    maxTtlMs: normalizedMaxTtl,
    minimumScore: clamp(minimumScore),
    minimumConfidence: clamp(minimumConfidence),
    now: () => new Date(nowMs),
  });
  const previousInputs = managerSelectionInputs(previousSnapshot?.opportunitySelection ?? previousSnapshot);
  const nextInputs = incomingInputs(incoming, { ttlMs: normalizedTtl });
  const selection = manager.manage([...previousInputs, ...nextInputs], { now: nowMs, topN: normalizedTopN });
  return createLiveScannerSnapshot(selection, { now: nowMs, topN: normalizedTopN });
}

const LIVE_SCANNER_STYLE = `
<style id="dashboardLiveScannerStyles">
.dls-panel{margin:14px 0;padding:16px;border:1px solid rgba(64,118,158,.55);border-radius:18px;background:linear-gradient(145deg,rgba(7,25,43,.96),rgba(3,13,24,.99));color:#dceafa;scroll-margin-top:90px}.dls-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap}.dls-kicker{font-size:9px;letter-spacing:.16em;color:#72b4e5;font-weight:900}.dls-head h3{margin:4px 0 0;font-size:19px}.dls-meta{display:flex;gap:7px;flex-wrap:wrap;align-items:center}.dls-pill{padding:6px 9px;border:1px solid rgba(90,141,181,.5);border-radius:999px;font-size:9px;color:#9fc2df}.dls-pill.live{color:#58dfa1;border-color:#318861}.dls-wrap{overflow:auto;margin-top:13px;border:1px solid rgba(55,95,128,.42);border-radius:13px}.dls-table{width:100%;border-collapse:collapse;min-width:760px;font-size:10px}.dls-table th,.dls-table td{padding:10px 9px;text-align:left;border-bottom:1px solid rgba(54,91,124,.35);white-space:nowrap}.dls-table th{font-size:8px;letter-spacing:.1em;color:#7f9bb4;background:rgba(6,22,37,.94);position:sticky;top:0}.dls-table tbody tr:last-child td{border-bottom:0}.dls-rank{font-weight:900;color:#86c8f5}.dls-symbol{font-size:12px;font-weight:900}.dls-grade{display:inline-flex;min-width:38px;justify-content:center;padding:5px 7px;border-radius:999px;border:1px solid currentColor;font-weight:900}.dls-grade.AAA,.dls-grade.AA{color:#58dfa1}.dls-grade.A,.dls-grade.BBB{color:#f4c46d}.dls-grade.BB,.dls-grade.REJECT{color:#ff8491}.dls-status{color:#58dfa1;font-weight:900}.dls-expiry{font-variant-numeric:tabular-nums}.dls-empty,.dls-error{margin-top:13px;padding:20px;text-align:center;border:1px dashed rgba(78,121,158,.5);border-radius:13px;color:#8faac1}.dls-error{color:#ff929d}.dls-foot{margin-top:9px;color:#7894ad;font-size:9px;line-height:1.5}@media(max-width:640px){.dls-panel{padding:12px}.dls-head h3{font-size:16px}}
</style>`;

const LIVE_SCANNER_SCRIPT = `
<script id="dashboardLiveScannerScript">
(function(){
  const endpoint='${LIVE_SCANNER_API_PATH}';
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const numeric=(value,digits=1)=>Number.isFinite(Number(value))?Number(value).toFixed(digits):'—';
  let rows=[];
  function panel(){
    let node=document.getElementById('dashboard-live-scanner');
    if(node)return node;
    node=document.createElement('section');node.id='dashboard-live-scanner';node.className='dls-panel';node.setAttribute('aria-live','polite');
    const main=document.querySelector('main');
    if(main)main.insertBefore(node,main.firstChild);else document.body.appendChild(node);
    return node;
  }
  function remaining(expiresAt){
    const ms=Date.parse(expiresAt)-Date.now();
    if(!Number.isFinite(ms)||ms<=0)return 'Expired';
    const total=Math.ceil(ms/1000),minutes=Math.floor(total/60),seconds=total%60;
    return minutes+'m '+String(seconds).padStart(2,'0')+'s';
  }
  function safeRows(value){
    const unique=new Map();
    for(const item of Array.isArray(value)?value:[]){
      if(!item||String(item.status).toUpperCase()!=='ACTIVE'||Date.parse(item.expiresAt)<=Date.now())continue;
      const key=String(item.dedupeKey||[item.symbol,item.direction,item.timeframe,item.family].join('|'));
      const existing=unique.get(key);
      if(!existing||Number(item.rank||999)<Number(existing.rank||999))unique.set(key,item);
    }
    return [...unique.values()].sort((a,b)=>Number(a.rank||999)-Number(b.rank||999));
  }
  function render(snapshot){
    rows=safeRows(snapshot?.rows||snapshot?.opportunities);
    const node=panel(),summary=snapshot?.summary||{};
    const body=rows.map(item=>'<tr data-expires="'+esc(item.expiresAt)+'"><td class="dls-rank">#'+esc(item.rank)+'</td><td class="dls-symbol">'+esc(item.symbol)+'</td><td><span class="dls-grade '+esc(item.grade)+'">'+esc(item.grade)+'</span></td><td>'+numeric(item.score)+'</td><td>'+numeric(item.confidence)+'</td><td class="dls-status">'+esc(item.status)+'</td><td class="dls-expiry">'+esc(remaining(item.expiresAt))+'</td></tr>').join('');
    node.innerHTML='<div class="dls-head"><div><div class="dls-kicker">OPPORTUNITY MANAGER · LIVE</div><h3>Dashboard Live Scanner</h3></div><div class="dls-meta"><span class="dls-pill live">OBSERVATION ONLY</span><span class="dls-pill">'+esc(rows.length)+' / '+esc(snapshot?.topN??rows.length)+' ACTIVE</span><span class="dls-pill">UPDATED '+esc(new Date(snapshot?.updatedAt||Date.now()).toLocaleTimeString())+'</span></div></div>'+
      (body?'<div class="dls-wrap"><table class="dls-table"><thead><tr><th>RANK</th><th>SYMBOL</th><th>GRADE</th><th>SCORE</th><th>CONFIDENCE</th><th>STATUS</th><th>EXPIRY</th></tr></thead><tbody>'+body+'</tbody></table></div>':'<div class="dls-empty">No active, non-duplicate opportunities are available.</div>')+
      '<div class="dls-foot">Expired and duplicate opportunities are hidden automatically. Execution controls are intentionally unavailable. Hidden duplicates: '+esc(summary.duplicatesHidden??0)+' · Hidden expired: '+esc(summary.expiredHidden??0)+'</div>';
  }
  function tick(){
    const node=panel();
    for(const cell of node.querySelectorAll('tr[data-expires] .dls-expiry')){
      const row=cell.closest('tr'),value=remaining(row?.dataset?.expires);
      if(value==='Expired'){row?.remove();continue;}cell.textContent=value;
    }
  }
  async function refresh(){
    try{
      const response=await fetch(endpoint,{cache:'no-store'}),payload=await response.json();
      if(!response.ok||!payload.ok)throw new Error(payload.error||'Live scanner request failed');
      render(payload.liveScanner);
    }catch(error){panel().innerHTML='<div class="dls-error">Dashboard Live Scanner unavailable: '+esc(error.message||error)+'</div>';}
  }
  panel();refresh();setInterval(refresh,5000);setInterval(tick,1000);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  window.refreshDashboardLiveScanner=refresh;
})();
</script>`;

export async function enhanceLiveScannerDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.toLowerCase().includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('dashboardLiveScannerScript')) {
    return new Response(html, { status: response.status, statusText: response.statusText, headers: response.headers });
  }
  const enhanced = html
    .replace('</head>', `${LIVE_SCANNER_STYLE}</head>`)
    .replace('</body>', `${LIVE_SCANNER_SCRIPT}</body>`);
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.set('cache-control', 'no-store');
  return new Response(enhanced, { status: response.status, statusText: response.statusText, headers });
}
