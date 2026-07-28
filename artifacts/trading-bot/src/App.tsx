// MOE-AI Personal Trading Platform — App Shell
import { useCallback, useEffect, useState } from 'react';
import { LS_MODE } from './lib/config';
import type { TradingMode } from './lib/config';
import { isSessionValid, createSession, clearSession, hasPinSet, setPin, verifyPin } from './lib/auth';

// ── Pages (lazy imports for now, inline components) ──────────────────────────
import DashboardPage  from './pages/Dashboard';
import ScannerPage    from './pages/Scanner';
import PositionsPage  from './pages/Positions';
import OrdersPage     from './pages/Orders';
import RiskPage       from './pages/Risk';
import SettingsPage   from './pages/Settings';
import TradesPage     from './pages/Trades';
import SystemPage     from './pages/System';

type Page = 'dashboard' | 'scanner' | 'positions' | 'orders' | 'risk' | 'settings' | 'trades' | 'system';

const NAV_ITEMS: { id: Page; icon: string; label: string }[] = [
  { id: 'dashboard',  icon: '⬡',  label: 'لوحة القيادة' },
  { id: 'scanner',    icon: '⌕',  label: 'الماسح'       },
  { id: 'positions',  icon: '◈',  label: 'الصفقات'      },
  { id: 'orders',     icon: '≡',  label: 'الأوامر'      },
  { id: 'risk',       icon: '⚠',  label: 'إدارة المخاطر' },
  { id: 'trades',     icon: '⟳',  label: 'السجل'        },
  { id: 'system',     icon: '◎',  label: 'حالة النظام'  },
  { id: 'settings',   icon: '⚙',  label: 'الإعدادات'   },
];

// ── PIN Login ────────────────────────────────────────────────────────────────
function LoginScreen({ onAuth }: { onAuth: () => void }) {
  const [pin, setPin_]     = useState('');
  const [mode, setMode]    = useState<'enter' | 'set' | 'confirm'>('enter');
  const [confirm, setConf] = useState('');
  const [error, setError]  = useState('');
  const [shaking, setShake]= useState(false);

  const noPinSet = !hasPinSet();

  useEffect(() => {
    if (!noPinSet) setMode('enter');
    else           setMode('set');
  }, [noPinSet]);

  const shake = () => {
    setShake(true);
    setTimeout(() => { setShake(false); setPin_(''); setError(''); }, 600);
  };

  const handleDigit = async (d: string) => {
    if (d === 'DEL') { setPin_(p => p.slice(0, -1)); return; }
    const next = pin + d;
    setPin_(next);

    if (next.length < 6) return;

    if (mode === 'enter') {
      const ok = await verifyPin(next);
      if (ok) { createSession(); onAuth(); }
      else    { setError('رمز PIN غير صحيح'); shake(); }
    } else if (mode === 'set') {
      setConf('');
      setMode('confirm');
      setPin_('');
    } else if (mode === 'confirm') {
      if (next === confirm || (confirm === '' && pin === next)) {
        // confirm was set as pin from previous step
        await setPin(confirm || next);
        createSession();
        onAuth();
      } else {
        setError('رمزا PIN غير متطابقَين'); shake();
        setMode('set'); setConf('');
      }
    }
  };

  // When first entering confirm mode, store the pin
  useEffect(() => {
    if (mode === 'confirm' && confirm === '' && pin === '') {
      // The pin was stored when transitioning; we need to capture it
    }
  }, [mode, confirm, pin]);

  const handleSetTransition = async (next: string) => {
    setConf(next);
    setMode('confirm');
    setPin_('');
  };

  const handleKey = async (d: string) => {
    if (d === 'DEL') { setPin_(p => p.slice(0, -1)); return; }
    const next = pin + d;
    setPin_(next);
    if (next.length < 6) return;

    if (mode === 'enter') {
      const ok = await verifyPin(next);
      if (ok) { createSession(); onAuth(); }
      else    { setError('رمز PIN غير صحيح'); shake(); }
    } else if (mode === 'set') {
      await handleSetTransition(next);
    } else if (mode === 'confirm') {
      if (next === confirm) { await setPin(confirm); createSession(); onAuth(); }
      else { setError('رمزا PIN غير متطابقَين'); shake(); setMode('set'); setConf(''); }
    }
  };

  const digits = ['1','2','3','4','5','6','7','8','9','','0','DEL'];

  return (
    <div className="login-screen">
      <div className={`login-card ${shaking ? 'shake' : ''}`} style={shaking ? { animation: 'shake .4s ease' } : {}}>
        <div className="login-logo">M</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>MOE-AI</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          منصة التداول الشخصية · {mode === 'enter' ? 'أدخل رمز PIN' : mode === 'set' ? 'اضبط رمز PIN جديداً (٦ أرقام)' : 'أعد إدخال رمز PIN للتأكيد'}
        </div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10, fontWeight: 700 }}>{error}</div>}
        <div className="pin-dots">
          {[0,1,2,3,4,5].map(i => (
            <div key={i} className={`pin-dot ${pin.length > i ? 'filled' : ''}`} />
          ))}
        </div>
        <div className="pin-pad">
          {digits.map((d, i) => (
            <button key={i} className={`pin-key ${d === 'DEL' ? 'del' : ''}`}
              onClick={() => d !== '' && handleKey(d)}
              disabled={d === ''}
              style={d === '' ? { visibility: 'hidden' } : {}}>
              {d === 'DEL' ? '⌫' : d}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Top Bar ───────────────────────────────────────────────────────────────────
function TopBar({
  mode, onModeChange, killSwitch, onKillSwitch, connected, onLogout,
}: {
  mode: TradingMode;
  onModeChange: (m: TradingMode) => void;
  killSwitch: boolean;
  onKillSwitch: (v: boolean) => void;
  connected: boolean;
  onLogout: () => void;
}) {
  const [confirmLive, setConfirmLive] = useState(false);

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">M</div>
        <div>
          <div className="brand-name">MOE-AI</div>
          <div className="brand-sub">منصة التداول الشخصية</div>
        </div>
      </div>

      <div className="topbar-spacer" />

      {/* Connection pill */}
      <div className="conn-pill">
        <span className={`conn-dot ${connected ? 'live' : 'error'}`} />
        {connected ? 'Cloudflare متصل' : 'غير متصل'}
      </div>

      {/* Mode switch */}
      <div className="mode-switch">
        <button
          className={mode === 'SANDBOX' ? 'active-sandbox' : ''}
          onClick={() => onModeChange('SANDBOX')}>
          SANDBOX
        </button>
        <button
          className={mode === 'LIVE' ? 'active-live' : ''}
          onClick={() => { if (mode !== 'LIVE') setConfirmLive(true); }}>
          LIVE
        </button>
      </div>

      {/* Kill switch */}
      <button
        className={`kill-switch-btn ${killSwitch ? 'engaged' : ''}`}
        onClick={() => onKillSwitch(!killSwitch)}
        title={killSwitch ? 'Kill Switch مفعّل — انقر للإيقاف' : 'Kill Switch معطّل — انقر للتفعيل'}>
        {killSwitch ? '🔴 KILL' : '🟢 ARM'}
      </button>

      {/* Logout */}
      <button className="btn btn-ghost btn-sm" onClick={onLogout}>خروج</button>

      {/* Live mode confirmation modal */}
      {confirmLive && (
        <div className="modal-overlay" onClick={() => setConfirmLive(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ color: 'var(--red)' }}>⚠ تفعيل وضع التداول الحقيقي</div>
            <div className="modal-body">
              أنت على وشك التبديل إلى <b>LIVE MODE</b>. سيتم تنفيذ الأوامر على الحساب الحقيقي في Webull.<br /><br />
              تأكد من أن جميع متطلبات الأمان مستوفاة وأن Kill Switch في الوضع الصحيح.
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmLive(false)}>إلغاء</button>
              <button className="btn btn-danger" onClick={() => { onModeChange('LIVE'); setConfirmLive(false); }}>
                تأكيد الدخول للـ LIVE
              </button>
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

// ── Side Nav ──────────────────────────────────────────────────────────────────
function SideNav({ page, onChange }: { page: Page; onChange: (p: Page) => void }) {
  return (
    <nav className="sidenav">
      <div className="nav-section-label">التداول</div>
      {NAV_ITEMS.slice(0, 5).map(item => (
        <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`}
          onClick={() => onChange(item.id)}>
          <span className="nav-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
      <div className="nav-divider" />
      <div className="nav-section-label">النظام</div>
      {NAV_ITEMS.slice(5).map(item => (
        <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`}
          onClick={() => onChange(item.id)}>
          <span className="nav-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
    </nav>
  );
}

// ── Bottom Nav (mobile) ───────────────────────────────────────────────────────
function BottomNav({ page, onChange }: { page: Page; onChange: (p: Page) => void }) {
  const items = NAV_ITEMS.slice(0, 5);
  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-items">
        {items.map(item => (
          <button key={item.id} className={`bottom-nav-item ${page === item.id ? 'active' : ''}`}
            onClick={() => onChange(item.id)}>
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        ))}
      </div>
    </nav>
  );
}

// ── App Root ──────────────────────────────────────────────────────────────────
export default function App() {
  const [authed, setAuthed]           = useState(() => isSessionValid());
  const [mode, setMode]               = useState<TradingMode>(
    () => (localStorage.getItem(LS_MODE) as TradingMode) ?? 'SANDBOX'
  );
  const [page, setPage]               = useState<Page>('dashboard');
  const [killSwitch, setKillSwitch]   = useState(
    () => localStorage.getItem('moe-kill-switch') === 'true' // default disengaged
  );
  const [connected, setConnected]     = useState(false);
  const [toast, setToast]             = useState<{ msg: string; type?: 'success' | 'error' } | null>(null);

  // Ping the Cloudflare Worker to check connectivity
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${import.meta.env.VITE_MOE_API_BASE_URL ?? 'https://moerand-alerts.mosaprajb.workers.dev'}/`, { mode: 'cors', cache: 'no-store' });
        setConnected(r.ok || r.status === 404); // 404 = worker is up but no root route
      } catch { setConnected(false); }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  const handleModeChange = useCallback((m: TradingMode) => {
    setMode(m);
    localStorage.setItem(LS_MODE, m);
    showToast(`تم التبديل إلى ${m === 'LIVE' ? 'التداول الحقيقي ⚠' : 'وضع Sandbox ✓'}`, m === 'LIVE' ? 'error' : 'success');
  }, []);

  const handleLogout = useCallback(() => {
    clearSession();
    setAuthed(false);
  }, []);

  const showToast = (msg: string, type?: 'success' | 'error') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3200);
  };

  if (!authed) return <LoginScreen onAuth={() => setAuthed(true)} />;

  const sharedProps = { mode, showToast };

  return (
    <div className="app-shell" dir="rtl">
      <TopBar
        mode={mode}
        onModeChange={handleModeChange}
        killSwitch={killSwitch}
        onKillSwitch={(v: boolean) => { setKillSwitch(v); localStorage.setItem('moe-kill-switch', String(v)); }}
        connected={connected}
        onLogout={handleLogout}
      />
      <div className="layout">
        <SideNav page={page} onChange={setPage} />
        <main className="main-content">
          {page === 'dashboard' && <DashboardPage {...sharedProps} />}
          {page === 'scanner'   && <ScannerPage   {...sharedProps} />}
          {page === 'positions' && <PositionsPage  {...sharedProps} />}
          {page === 'orders'    && <OrdersPage     {...sharedProps} />}
          {page === 'risk'      && <RiskPage        {...sharedProps} />}
          {page === 'trades'    && <TradesPage     {...sharedProps} />}
          {page === 'system'    && <SystemPage     {...sharedProps} />}
          {page === 'settings'  && <SettingsPage   {...sharedProps} />}
        </main>
      </div>
      <BottomNav page={page} onChange={setPage} />
      {toast && (
        <div className="toast-container">
          <div className={`toast ${toast.type ?? ''}`}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
