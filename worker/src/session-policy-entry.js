import worker, { AlertCoordinator as BaseAlertCoordinator } from './pin-session-entry.js';
import { getSessionAlertStatus, processSessionAlerts } from './session-alert-service.js';
import {
  authoritativeSignalPayload,
  currentTradingSession,
  sessionAllowed,
  validateDeclaredSignalSession,
} from './trading-session-service.js';

const POLICY_KEY = 'trading-session-policy:v1';
const POLICY_VERSION = 2;
const POLICY_PATH = '/api/trading/session-policy';
const SESSION_ALERTS_PATH = '/api/trading/session-alerts';
const SIGNAL_PATH = '/api/tradingview/signal';
const DASHBOARD_PATHS = new Set(['/', '/moe-ai', '/moe-ai/', '/dashboard', '/dashboard/']);
const PRESETS = Object.freeze({
  CORE_ONLY: ['CORE'],
  PREMARKET_ONLY: ['PREMARKET'],
  AFTER_HOURS_ONLY: ['AFTER_HOURS'],
  OVERNIGHT_ONLY: ['OVERNIGHT'],
  PREMARKET_AND_OVERNIGHT: ['PREMARKET', 'OVERNIGHT'],
  EXTENDED_SESSIONS: ['PREMARKET', 'AFTER_HOURS'],
  ALL_SESSIONS: ['PREMARKET', 'CORE', 'AFTER_HOURS', 'OVERNIGHT'],
});

function secureJson(payload, status = 200) {
  return Response.json(payload, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

function defaultPreset(env = {}) {
  const configured = String(env.MOE_TRADING_SESSION_POLICY_DEFAULT || 'ALL_SESSIONS').trim().toUpperCase();
  return PRESETS[configured] ? configured : 'ALL_SESSIONS';
}

function normalizePreset(value, env = {}) {
  const preset = String(value || defaultPreset(env)).trim().toUpperCase();
  if (!PRESETS[preset]) throw new Error('Unsupported trading-session policy.');
  return preset;
}

function policySnapshot(saved, env = {}) {
  const preset = normalizePreset(saved?.preset, env);
  return {
    version: POLICY_VERSION,
    preset,
    allowedSessions: [...PRESETS[preset]],
    updatedAt: saved?.updatedAt || null,
    updatedBy: saved?.updatedBy || null,
  };
}

function scannerEnvironment(env, policy, session) {
  if (!policy || !sessionAllowed(policy, session)) {
    return {
      ...env,
      AUTO_SCANNER_ENABLED: 'false',
      WEBULL_AUTOMATION_ARMED: 'false',
      WEBULL_LIVE_AUTOMATION_ARMED: 'false',
      MOE_ACTIVE_TRADING_SESSION: session?.key || 'UNKNOWN',
      MOE_TRADING_SESSION_ALLOWED: 'false',
      MOE_SESSION_POLICY_HEALTH: policy ? 'BLOCKED_BY_POLICY' : 'READ_FAILED',
    };
  }

  const hoursMode = session.key === 'CORE'
    ? 'CORE'
    : session.key === 'OVERNIGHT'
      ? 'AUTO'
      : 'ALL';
  return {
    ...env,
    AUTO_SCANNER_TRADING_HOURS: hoursMode,
    AUTO_SCANNER_OVERNIGHT_ENABLED: policy.allowedSessions.includes('OVERNIGHT') ? 'true' : 'false',
    MOE_ACTIVE_TRADING_SESSION: session.key,
    MOE_TRADING_SESSION_ALLOWED: 'true',
    MOE_ALLOWED_TRADING_SESSIONS: policy.allowedSessions.join(','),
    MOE_SESSION_POLICY_HEALTH: 'HEALTHY',
  };
}

function secureHeaders(response) {
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  return headers;
}

async function enhanceDashboard(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!contentType.includes('text/html')) return response;
  const html = await response.text();
  if (html.includes('moerandSessionPolicyPanel')) {
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers: secureHeaders(response),
    });
  }

  const style = `<style id="moerandSessionPolicyStyles">
  #sessionPolicyPanel{margin-top:12px;padding:14px;border:1px solid rgba(74,116,153,.5);border-radius:14px;background:linear-gradient(145deg,rgba(8,27,45,.94),rgba(4,14,26,.98));color:#dbe8f5}
  .session-policy-head{display:flex;justify-content:space-between;gap:12px;align-items:flex-start;flex-wrap:wrap}.session-policy-head strong{display:block;font-size:14px}.session-policy-head span{display:block;margin-top:5px;color:#8fa4bf;font-size:10px;line-height:1.55}.session-policy-state{padding:7px 10px;border:1px solid #38678e;border-radius:999px;color:#9bd2ff;font-size:9px;font-weight:900;white-space:nowrap}
  .session-policy-controls{display:grid;grid-template-columns:minmax(220px,1fr) auto;gap:9px;margin-top:12px}.session-policy-select,.session-policy-save{min-height:42px;border:1px solid #365a7a;border-radius:10px;background:#0c2136;color:#edf4ff;padding:9px 11px;font-weight:800}.session-policy-save{cursor:pointer;background:#155b43;border-color:#2c9a70}.session-policy-save:disabled{opacity:.55;cursor:wait}
  .session-policy-note{margin-top:10px;padding:9px 10px;border:1px solid rgba(54,89,124,.4);border-radius:9px;background:rgba(6,18,32,.62);color:#91a8bf;font-size:9px;line-height:1.6}.session-policy-note.allowed{border-color:#28684c;color:#83e9b2}
  @media(max-width:620px){.session-policy-controls{grid-template-columns:1fr}}
  </style>`;

  const script = `<script id="moerandSessionPolicyPanel">
  (function(){
    const labels={
      CORE_ONLY:'السوق العادي فقط',
      PREMARKET_ONLY:'ما قبل السوق فقط',
      AFTER_HOURS_ONLY:'ما بعد السوق فقط',
      OVERNIGHT_ONLY:'الأوفرنايت فقط',
      PREMARKET_AND_OVERNIGHT:'ما قبل السوق + الأوفرنايت',
      EXTENDED_SESSIONS:'ما قبل السوق + ما بعد السوق',
      ALL_SESSIONS:'كل الجلسات',
    };
    const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
    function notify(message,type){
      const toast=document.getElementById('controlToast');
      if(!toast){window.alert(message);return;}
      toast.textContent=message;toast.className='control-toast show '+(type||'success');
      setTimeout(()=>toast.className='control-toast',7000);
    }
    function mount(){
      if(document.getElementById('sessionPolicyPanel'))return document.getElementById('sessionPolicyPanel');
      const actions=document.querySelector('.live-actions');if(!actions)return null;
      const panel=document.createElement('section');panel.id='sessionPolicyPanel';
      panel.innerHTML='<div class="session-policy-head"><div><strong>الجلسات المسموح بالتداول فيها</strong><span>سيصلك تنبيه مستقل عند افتتاح وانتهاء كل جلسة، سواء كانت مفعلة للتداول أم لا.</span></div><span class="session-policy-state" id="sessionPolicyState">تحميل...</span></div><div class="session-policy-controls"><select class="session-policy-select" id="sessionPolicySelect">'+Object.entries(labels).map(([value,label])=>'<option value="'+value+'">'+esc(label)+'</option>').join('')+'</select><button class="session-policy-save" id="sessionPolicySave" type="button">حفظ الجلسات</button></div><div class="session-policy-note" id="sessionPolicyNote">جارٍ قراءة الجلسة الحالية...</div>';
      const simple=document.getElementById('simpleTradingControls');
      if(simple&&simple.parentNode===actions)simple.insertAdjacentElement('afterend',panel);else actions.appendChild(panel);
      document.getElementById('sessionPolicySave').onclick=save;
      return panel;
    }
    function render(payload){
      mount();
      const select=document.getElementById('sessionPolicySelect');if(select)select.value=payload.policy.preset;
      const session=payload.currentSession||{};const allowed=payload.currentSessionAllowed===true;
      const state=document.getElementById('sessionPolicyState');if(state)state.textContent=(labels[payload.policy.preset]||payload.policy.preset)+' · '+(allowed?'مسموح الآن':'غير مسموح الآن');
      const note=document.getElementById('sessionPolicyNote');if(note){note.className='session-policy-note '+(allowed?'allowed':'');note.textContent='الجلسة الحالية: '+(session.labelAr||session.label||'CLOSED')+' · '+(allowed?'الماسح مسموح له بالعمل عند تحقق شروط الصفقة.':'لن تُرسل صفقات حتى تبدأ جلسة مسموحة.')+' · تنبيهات الافتتاح والانتهاء مفعلة.';}
    }
    async function load(){
      mount();
      try{const response=await fetch('/api/trading/session-policy',{cache:'no-store'});const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر قراءة الجلسات');render(payload);}catch(error){notify(error.message||String(error),'error');}
    }
    async function save(){
      const button=document.getElementById('sessionPolicySave');const select=document.getElementById('sessionPolicySelect');
      const pin=typeof window.__getMoerandControlPin==='function'?window.__getMoerandControlPin('أدخل رمز التحكم لحفظ جلسات التداول.'):window.prompt('أدخل رمز التحكم لحفظ جلسات التداول.');
      if(!pin)return;
      button.disabled=true;
      try{
        const response=await fetch('/api/trading/session-policy',{method:'PUT',headers:{'content-type':'application/json'},body:JSON.stringify({pin,preset:select.value,actor:'DASHBOARD_OWNER'})});
        const payload=await response.json();if(!response.ok||!payload.ok)throw new Error(payload.error||'تعذر حفظ الجلسات');render(payload);notify('تم حفظ جلسات التداول وتطبيقها على Live وSandbox.','success');
      }catch(error){notify('تعذر حفظ الجلسات: '+(error.message||error),'error');}
      finally{button.disabled=false;}
    }
    const start=()=>{mount();load();setInterval(load,30000);};
    if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',start);else start();
    setTimeout(mount,700);
  })();
  </script>`;

  const enhanced = html.replace('</head>', `${style}</head>`).replace('</body>', `${script}</body>`);
  return new Response(enhanced, {
    status: response.status,
    statusText: response.statusText,
    headers: secureHeaders(response),
  });
}

export class AlertCoordinator extends BaseAlertCoordinator {
  async getTradingSessionPolicy() {
    const saved = await this.ctx.storage.get(POLICY_KEY);
    return policySnapshot(saved, this.env);
  }

  async updateTradingSessionPolicy(payload = {}) {
    await this.verifyLiveControlPin(payload.pin);
    const preset = normalizePreset(payload.preset, this.env);
    const saved = {
      version: POLICY_VERSION,
      preset,
      updatedAt: new Date().toISOString(),
      updatedBy: String(payload.actor || 'OWNER').slice(0, 64),
    };
    await this.ctx.storage.put(POLICY_KEY, saved);
    return policySnapshot(saved, this.env);
  }

  async processTradingSessionAlerts(payload = {}) {
    return processSessionAlerts(this.ctx.storage, payload, this.env);
  }

  async getTradingSessionAlertStatus() {
    return getSessionAlertStatus(this.ctx.storage);
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

async function policyStatus(env, date = new Date()) {
  const policy = await coordinator(env).getTradingSessionPolicy();
  const currentSession = currentTradingSession(date);
  return {
    policy,
    currentSession,
    currentSessionAllowed: sessionAllowed(policy, currentSession),
  };
}

async function authoritativeRequest(request, session, date = new Date()) {
  const contentType = request.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) return request;
  const payload = await request.clone().json();
  const validation = validateDeclaredSignalSession(payload, session);
  if (!validation.matches) {
    const error = new Error('Signal-declared session does not match the authoritative server session.');
    error.validation = validation;
    throw error;
  }
  const headers = new Headers(request.headers);
  headers.set('content-type', 'application/json');
  return new Request(request.url, {
    method: request.method,
    headers,
    body: JSON.stringify(authoritativeSignalPayload(payload, session, date)),
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === POLICY_PATH) {
      if (request.method === 'GET') {
        try { return secureJson({ ok: true, ...(await policyStatus(env)) }); }
        catch (error) { return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Trading-session policy failed' }, 500); }
      }
      if (request.method === 'PUT') {
        let payload;
        try { payload = await request.json(); } catch { return secureJson({ ok: false, error: 'Invalid JSON payload' }, 400); }
        try {
          const policy = await coordinator(env).updateTradingSessionPolicy(payload);
          const currentSession = currentTradingSession();
          return secureJson({ ok: true, policy, currentSession, currentSessionAllowed: sessionAllowed(policy, currentSession) });
        } catch (error) {
          return secureJson({ ok: false, blocked: true, error: error instanceof Error ? error.message : 'Trading-session policy update failed' }, 423);
        }
      }
      return secureJson({ ok: false, error: 'Method not allowed' }, 405);
    }

    if (url.pathname === SESSION_ALERTS_PATH && request.method === 'GET') {
      try { return secureJson({ ok: true, alerts: await coordinator(env).getTradingSessionAlertStatus() }); }
      catch (error) { return secureJson({ ok: false, error: error instanceof Error ? error.message : 'Session-alert status failed' }, 500); }
    }

    let effectiveRequest = request;
    if (url.pathname === SIGNAL_PATH && request.method === 'POST') {
      try {
        const status = await policyStatus(env);
        if (!status.currentSessionAllowed) {
          return secureJson({
            ok: false,
            accepted: false,
            submitted: false,
            blocked: true,
            error: `Trading is disabled for the current ${status.currentSession.label} session by the owner session policy.`,
            sessionPolicy: status.policy,
            currentSession: status.currentSession,
          }, 423);
        }
        effectiveRequest = await authoritativeRequest(request, status.currentSession);
      } catch (error) {
        return secureJson({
          ok: false,
          accepted: false,
          submitted: false,
          blocked: true,
          error: error instanceof Error ? error.message : 'Trading-session safety check failed.',
          sessionValidation: error?.validation || null,
        }, 423);
      }
    }

    const response = await worker.fetch(effectiveRequest, env, ctx);
    return DASHBOARD_PATHS.has(url.pathname) ? enhanceDashboard(response) : response;
  },

  async scheduled(controller, env, ctx) {
    const observedAt = new Date(Number(controller?.scheduledTime) || Date.now());
    const session = currentTradingSession(observedAt);
    let policy = null;
    try {
      policy = await coordinator(env).getTradingSessionPolicy();
    } catch (error) {
      console.error('Trading-session policy read failed; scanner and order automation are fail-closed.', error);
    }

    if (policy) {
      const stub = coordinator(env);
      ctx.waitUntil(stub.processTradingSessionAlerts({
        observedAt: observedAt.toISOString(),
        currentSession: session,
        policy,
      }).catch((error) => {
        console.error('Trading-session alert delivery failed', error);
      }));
    }

    return worker.scheduled(controller, scannerEnvironment(env, policy, session), ctx);
  },
};

export { currentTradingSession, sessionAllowed, policySnapshot };
