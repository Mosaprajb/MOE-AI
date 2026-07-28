import worker, { AlertCoordinator } from './scanner-selection-direct-entry.js';

const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const SCRIPT_PATH = '/scanner-runtime-v4.js';
const BUILD_ID = 'scanner-runtime-v4-20260727';

function pageHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

function runtimeScript() {
  return `(() => {
  if (window.__moerandScannerRuntimeV4) return;
  window.__moerandScannerRuntimeV4 = true;

  let selectionBusy = false;
  let activityBusy = false;
  let rowTimer = null;
  let refreshTimer = null;

  const byId = (id) => document.getElementById(id);
  const buttons = () => Array.from(document.querySelectorAll('#scannerSelectionControls .scanner-selection-buttons button[data-level]'));
  const money = (value) => Number.isFinite(Number(value)) ? '$' + Number(value).toFixed(2) : '—';
  const compact = (value) => Number.isFinite(Number(value)) ? new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(Number(value)) : '—';
  const text = (value) => String(value ?? '');

  function message(value, type = '') {
    const node = byId('scannerSelectionMessage');
    if (!node) return;
    node.textContent = value;
    node.className = 'scanner-selection-message ' + type;
  }

  function ensureStatusBox() {
    const panel = byId('scannerSelectionControls');
    if (!panel) return null;
    panel.dataset.externalRuntime = '${BUILD_ID}';
    let box = byId('scannerSelectionRuntimeStatus');
    if (!box) {
      box = document.createElement('div');
      box.id = 'scannerSelectionRuntimeStatus';
      box.className = 'selection-runtime-status';
      box.innerHTML = '<span>الحالة الفعلية</span><strong id="scannerSelectionRuntimeValue">جارٍ التحقق...</strong>';
      panel.appendChild(box);
    }
    return box;
  }

  function paintSelection(settings = {}) {
    const level = text(settings.level).toUpperCase();
    buttons().forEach((button) => {
      button.classList.toggle('active', button.dataset.level === level);
      button.disabled = false;
    });
    const description = byId('scannerSelectionDescription');
    if (description) description.textContent = (settings.labelAr || level || '—') + ' · الحد الأولي ' + (settings.minimumScore ?? '—') + ' · ' + (settings.descriptionAr || '');
    const value = byId('scannerSelectionRuntimeValue');
    if (value) value.textContent = (settings.labelAr || level || '—') + ' · ' + (settings.minimumScore ?? '—') + ' · محفوظ';
  }

  async function loadSelection() {
    ensureStatusBox();
    try {
      const response = await fetch('/api/scanner/selection?t=' + Date.now(), { cache: 'no-store' });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'تعذر قراءة درجة اختيار الأسهم');
      paintSelection(payload.settings || {});
    } catch (error) {
      const value = byId('scannerSelectionRuntimeValue');
      if (value) value.textContent = 'تعذر التحقق';
      message(error.message || String(error), 'error');
    }
  }

  async function saveSelection(level, button) {
    if (selectionBusy) return;
    selectionBusy = true;
    buttons().forEach((item) => item.disabled = true);
    message('جارٍ تطبيق الدرجة المختارة...', '');
    try {
      const response = await fetch('/api/scanner/selection', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ level })
      });
      const payload = await response.json();
      if (!response.ok || !payload.ok) throw new Error(payload.error || 'تعذر حفظ درجة اختيار الأسهم');
      paintSelection(payload.settings || {});
      message('تم تطبيق ' + payload.settings.labelAr + ' (' + payload.settings.minimumScore + '). ستستخدمها دورة الماسح القادمة.', 'success');
    } catch (error) {
      message(error.message || String(error), 'error');
      await loadSelection();
    } finally {
      selectionBusy = false;
      buttons().forEach((item) => item.disabled = false);
    }
  }

  function setLiveState(state, label) {
    const card = byId('scannerLiveRuntime');
    if (card) card.dataset.liveState = state;
    const phase = byId('scannerRuntimePhase');
    if (phase) phase.textContent = label;
    const pulse = byId('scannerRuntimePulse');
    if (pulse) pulse.style.background = state === 'error' ? '#ff7f8c' : state === 'running' ? '#54dfa0' : '#78c8ff';
  }

  function showRow(row, index, total, activity) {
    if (!row) return;
    setLiveState('running', 'جارٍ فحص ' + (index + 1) + ' من ' + total);
    if (byId('scannerRuntimeSymbol')) byId('scannerRuntimeSymbol').textContent = text(row.symbol || '—').toUpperCase();
    if (byId('scannerRuntimePrice')) byId('scannerRuntimePrice').textContent = money(row.price ?? row.close);
    if (byId('scannerRuntimeOpen')) byId('scannerRuntimeOpen').textContent = money(row.open);
    if (byId('scannerRuntimeHigh')) byId('scannerRuntimeHigh').textContent = money(row.high);
    if (byId('scannerRuntimeLow')) byId('scannerRuntimeLow').textContent = money(row.low);
    if (byId('scannerRuntimeClose')) byId('scannerRuntimeClose').textContent = money(row.close ?? row.price);
    if (byId('scannerRuntimeBid')) byId('scannerRuntimeBid').textContent = money(row.bid);
    if (byId('scannerRuntimeAsk')) byId('scannerRuntimeAsk').textContent = money(row.ask);
    if (byId('scannerRuntimeVolume')) byId('scannerRuntimeVolume').textContent = compact(row.volume);
    if (byId('scannerRuntimeProfile')) byId('scannerRuntimeProfile').textContent = text(row.profile || '1m LIVE');
    const scanned = Number(activity.scannedCount || 0);
    const totalSymbols = Number(activity.totalSymbols || 0);
    if (byId('scannerRuntimeProgressText')) byId('scannerRuntimeProgressText').textContent = 'تم فحص ' + scanned + ' من ' + totalSymbols + ' · الدفعة ' + Number(activity.cycle || 0) + ' من ' + Number(activity.cycles || 0);
    if (byId('scannerRuntimeProgressBar')) byId('scannerRuntimeProgressBar').style.width = Math.min(100, scanned / Math.max(1, totalSymbols) * 100) + '%';
    if (byId('scannerRuntimeUpdated')) byId('scannerRuntimeUpdated').textContent = 'آخر تحديث: ' + new Date(activity.updatedAt || Date.now()).toLocaleTimeString('ar-US');
    document.querySelectorAll('#scannerRuntimeBatch .scanner-batch-item').forEach((item) => item.classList.toggle('active', item.dataset.symbol === text(row.symbol).toUpperCase()));
  }

  function renderActivity(activity = {}) {
    const rows = Array.isArray(activity.rows) ? activity.rows : [];
    const batch = byId('scannerRuntimeBatch');
    if (batch) {
      batch.innerHTML = rows.length
        ? rows.map((row) => '<div class="scanner-batch-item" data-symbol="' + text(row.symbol).toUpperCase() + '"><strong dir="ltr">' + text(row.symbol || '—').toUpperCase() + '</strong><span dir="ltr">' + money(row.price ?? row.close) + '</span><small>' + text(row.status || 'SCANNED').replaceAll('_', ' ') + '</small></div>').join('')
        : '<div class="scanner-runtime-message error">لم يعُد مصدر البيانات بأي أسهم في هذه الدفعة.</div>';
    }
    if (rowTimer) clearInterval(rowTimer);
    let index = 0;
    if (rows.length) {
      showRow(rows[0], 0, rows.length, activity);
      rowTimer = setInterval(() => {
        index = (index + 1) % rows.length;
        showRow(rows[index], index, rows.length, activity);
      }, 900);
    } else {
      setLiveState('error', 'لا توجد بيانات في الدفعة');
    }
    if (activity.ok) message('المسح يعمل: استلم أسعار ' + Number(activity.symbolsWithPrices || 0) + ' من ' + Number(activity.batch?.length || rows.length) + ' أسهم. عدد الفرص المطابقة مستقل عن عدد الأسهم المفحوصة.', 'success');
    else message('المسح بدأ لكن مصدر البيانات أعاد خطأ: ' + text(activity.error || 'خطأ غير معروف'), 'error');
  }

  function renderError(error, status) {
    setLiveState('error', 'توقف اتصال بيانات الماسح');
    if (byId('scannerRuntimeSymbol')) byId('scannerRuntimeSymbol').textContent = 'خطأ بيانات';
    const batch = byId('scannerRuntimeBatch');
    if (batch) batch.innerHTML = '<div class="scanner-runtime-message error">HTTP ' + status + ' · ' + text(error.message || error) + '</div>';
    if (byId('scannerRuntimeProgressText')) byId('scannerRuntimeProgressText').textContent = 'لم تبدأ دورة الأسعار بسبب خطأ الاتصال';
    if (byId('scannerRuntimeUpdated')) byId('scannerRuntimeUpdated').textContent = 'آخر محاولة: ' + new Date().toLocaleTimeString('ar-US');
    message('سبب توقف عرض الأسهم: ' + text(error.message || error), 'error');
  }

  async function runActivity(force = false) {
    if (activityBusy || document.hidden) return;
    activityBusy = true;
    setLiveState('loading', 'جارٍ الاتصال بمصدر بيانات الأسهم...');
    const button = byId('scannerDiagnosticNow');
    if (force && button) {
      button.disabled = true;
      button.textContent = 'جارٍ فحص الأسعار...';
    }
    let status = 0;
    try {
      const response = await fetch('/api/scanner/live-activity?t=' + Date.now(), { cache: 'no-store' });
      status = response.status;
      const raw = await response.text();
      let payload;
      try { payload = JSON.parse(raw); }
      catch { throw new Error('استجابة الماسح ليست JSON: ' + raw.slice(0, 120)); }
      if (!payload.activity) throw new Error(payload.error || 'لم تصل بيانات نشاط الماسح');
      renderActivity(payload.activity);
      if (!response.ok || payload.activity.ok === false) throw new Error(payload.activity.error || payload.error || 'فشل مصدر بيانات الماسح');
    } catch (error) {
      renderError(error, status || 'NETWORK');
    } finally {
      activityBusy = false;
      if (button) {
        button.disabled = false;
        button.textContent = 'فحص البيانات الآن';
      }
    }
  }

  function bind() {
    const panel = byId('scannerSelectionControls');
    const live = byId('scannerLiveRuntime');
    if (!panel || !live) return false;
    ensureStatusBox();
    buttons().forEach((button) => {
      button.onclick = (event) => {
        event.preventDefault();
        event.stopPropagation();
        saveSelection(button.dataset.level, button);
      };
    });
    const diagnostic = byId('scannerDiagnosticNow');
    if (diagnostic) diagnostic.onclick = (event) => {
      event.preventDefault();
      runActivity(true);
    };
    loadSelection();
    runActivity(true);
    if (refreshTimer) clearInterval(refreshTimer);
    refreshTimer = setInterval(() => runActivity(false), 15000);
    return true;
  }

  const start = () => {
    if (!bind()) setTimeout(start, 400);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true });
  else start();
})();`;
}

function scriptResponse() {
  return new Response(runtimeScript(), {
    headers: {
      'content-type': 'application/javascript; charset=utf-8',
      'cache-control': 'no-store, max-age=0',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function enhance(response) {
  const type = response.headers.get('content-type') || '';
  if (!type.includes('text/html')) return response;
  let html = await response.text();
  if (!html.includes(BUILD_ID)) {
    html = html.replace('</body>', `<script src="${SCRIPT_PATH}?v=${BUILD_ID}" defer data-build="${BUILD_ID}"></script></body>`);
  }
  return new Response(html, {
    status: response.status,
    statusText: response.statusText,
    headers: pageHeaders(response),
  });
}

export { AlertCoordinator };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === SCRIPT_PATH && request.method === 'GET') return scriptResponse();
    const response = await worker.fetch(request, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhance(response) : response;
  },
  scheduled(controller, env, ctx) {
    return worker.scheduled(controller, env, ctx);
  },
};
