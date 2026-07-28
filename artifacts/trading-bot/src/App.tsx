// MOE-AI Personal Trading Platform — App Shell
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, LS_MODE } from './lib/config';
import type { TradingMode } from './lib/config';
import { isSessionValid, createSession, clearSession, hasPinSet, setPin, verifyPin } from './lib/auth';
import { useMarketClock } from './hooks/useMarketClock';
import type { MarketSession } from './hooks/useMarketClock';

import DashboardPage from './pages/Dashboard';
import PositionsPage from './pages/Positions';
import OrdersPage    from './pages/Orders';
import TradesPage    from './pages/Trades';
import SystemPage    from './pages/System';
import SettingsPage  from './pages/Settings';

type Page = 'dashboard' | 'positions' | 'orders' | 'trades' | 'system' | 'settings';

const NAV_TRADING: { id: Page; icon: string; label: string }[] = [
  { id: 'dashboard', icon: '⬡', label: 'Dashboard'  },
  { id: 'positions', icon: '◈', label: 'Positions'  },
  { id: 'orders',    icon: '≡', label: 'Orders'     },
  { id: 'trades',    icon: '⟳', label: 'History'    },
];
const NAV_SYSTEM: { id: Page; icon: string; label: string }[] = [
  { id: 'system',   icon: '◎', label: 'System'   },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

// ── PIN Login ─────────────────────────────────────────────────────────────────
function LoginScreen({ onAuth }: { onAuth: () => void }) {
  const [pin, setPin_]     = useState('');
  const [mode, setMode]    = useState<'enter' | 'set' | 'confirm'>('enter');
  const [confirm, setConf] = useState('');
  const [error, setError]  = useState('');
  const [shaking, setShake]= useState(false);

  useEffect(() => { setMode(hasPinSet() ? 'enter' : 'set'); }, []);

  const shake = () => {
    setShake(true);
    setTimeout(() => { setShake(false); setPin_(''); setError(''); }, 600);
  };

  const handleKey = async (d: string) => {
    if (d === 'DEL') { setPin_(p => p.slice(0, -1)); return; }
    const next = pin + d;
    setPin_(next);
    if (next.length < 6) return;

    if (mode === 'enter') {
      const ok = await verifyPin(next);
      if (ok) { createSession(); onAuth(); }
      else    { setError('Incorrect PIN'); shake(); }
    } else if (mode === 'set') {
      setConf(next); setMode('confirm'); setPin_('');
    } else if (mode === 'confirm') {
      if (next === confirm) { await setPin(confirm); createSession(); onAuth(); }
      else { setError('PINs do not match'); shake(); setMode('set'); setConf(''); }
    }
  };

  const digits = ['1','2','3','4','5','6','7','8','9','','0','DEL'];

  return (
    <div className="login-screen">
      <div className={`login-card ${shaking ? 'shake' : ''}`} style={shaking ? { animation: 'shake .4s ease' } : {}}>
        <div className="login-logo">M</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>MOE-AI</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          Personal Trading Platform ·{' '}
          {mode === 'enter' ? 'Enter PIN' : mode === 'set' ? 'Set a new 6-digit PIN' : 'Confirm PIN'}
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

// ── Session colour map ────────────────────────────────────────────────────────
const SESSION_STYLE: Record<MarketSession, { bg: string; color: string }> = {
  'CORE':        { bg: 'rgba(34,197,94,.15)',  color: '#22c55e' },
  'PRE-MARKET':  { bg: 'rgba(251,191,36,.15)', color: '#fbbf24' },
  'AFTER-HOURS': { bg: 'rgba(251,191,36,.15)', color: '#fbbf24' },
  'CLOSED':      { bg: 'rgba(100,116,139,.15)',color: '#64748b' },
};

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
  const clock = useMarketClock();
  const sesStyle = SESSION_STYLE[clock.session];

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">M</div>
        <div>
          <div className="brand-name">MOE-AI</div>
          <div className="brand-sub">Auto Trader</div>
        </div>
      </div>

      <div className="topbar-spacer" />

      {/* ── Market Clock ── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginRight: 4 }}>
        <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, letterSpacing: '.03em', color: 'var(--fg)' }}>
            {clock.timeET} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>ET</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{clock.nextLabel}</div>
        </div>
        <div style={{
          padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 800,
          letterSpacing: '.05em', background: sesStyle.bg, color: sesStyle.color,
          border: `1px solid ${sesStyle.color}44`,
        }}>
          {clock.session}
        </div>
      </div>

      <div className="conn-pill">
        <span className={`conn-dot ${connected ? 'live' : 'error'}`} />
        {connected ? 'Worker Connected' : 'Disconnected'}
      </div>

      <div className="mode-switch">
        <button
          className={mode === 'SANDBOX' ? 'active-sandbox' : ''}
          onClick={() => onModeChange('SANDBOX')}>
          DEMO
        </button>
        <button
          className={mode === 'LIVE' ? 'active-live' : ''}
          onClick={() => { if (mode !== 'LIVE') setConfirmLive(true); }}>
          LIVE
        </button>
      </div>

      <button
        className={`kill-switch-btn ${killSwitch ? 'engaged' : ''}`}
        onClick={() => onKillSwitch(!killSwitch)}
        title={killSwitch ? 'Kill Switch ENGAGED — click to disarm' : 'Kill Switch disarmed — click to engage'}>
        {killSwitch ? '🔴 KILL' : '🟢 ARM'}
      </button>

      <button className="btn btn-ghost btn-sm" onClick={onLogout}>Logout</button>

      {confirmLive && (
        <div className="modal-overlay" onClick={() => setConfirmLive(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ color: 'var(--red)' }}>⚠ Switch to Live Trading</div>
            <div className="modal-body">
              You are about to switch to <b>LIVE MODE</b>. TradingView alerts will execute real orders on your Webull live account.<br /><br />
              Ensure your credentials are configured and the Kill Switch is in the correct state before proceeding.
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmLive(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={() => { onModeChange('LIVE'); setConfirmLive(false); }}>
                Confirm — Switch to LIVE
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
      <div className="nav-section-label">Trading</div>
      {NAV_TRADING.map(item => (
        <button key={item.id} className={`nav-item ${page === item.id ? 'active' : ''}`}
          onClick={() => onChange(item.id)}>
          <span className="nav-icon">{item.icon}</span>
          {item.label}
        </button>
      ))}
      <div className="nav-divider" />
      <div className="nav-section-label">System</div>
      {NAV_SYSTEM.map(item => (
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
  const all = [...NAV_TRADING, ...NAV_SYSTEM];
  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-items">
        {all.map(item => (
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
  const [authed, setAuthed]         = useState(() => isSessionValid());
  const [mode, setMode]             = useState<TradingMode>(
    () => (localStorage.getItem(LS_MODE) as TradingMode) ?? 'SANDBOX'
  );
  const [page, setPage]             = useState<Page>('dashboard');
  const [killSwitch, setKillSwitch] = useState(
    () => localStorage.getItem('moe-kill-switch') === 'true'
  );
  const [connected, setConnected]   = useState(false);
  const [toast, setToast]           = useState<{ msg: string; type?: 'success'|'error' } | null>(null);

  // Ping worker for connectivity
  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${API_BASE}/`, { mode: 'cors', cache: 'no-store' });
        setConnected(r.ok);
      } catch { setConnected(false); }
    };
    check();
    const t = setInterval(check, 30_000);
    return () => clearInterval(t);
  }, []);

  const showToast = useCallback((msg: string, type?: 'success'|'error', ms = 3200) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), ms);
  }, []);

  const handleModeChange = useCallback(async (m: TradingMode) => {
    setMode(m);
    localStorage.setItem(LS_MODE, m);
    showToast(`Switched to ${m === 'LIVE' ? 'Live Trading ⚠' : 'Demo Mode ✓'}`, m === 'LIVE' ? 'error' : 'success');
    // Persist mode to Worker KV so the webhook uses the correct account
    try {
      await fetch(`${API_BASE}/api/trading/mode`, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: m }),
      });
    } catch { /* KV not yet provisioned — local mode still set */ }
  }, []);

  const handleKillSwitch = useCallback(async (v: boolean) => {
    setKillSwitch(v);
    localStorage.setItem('moe-kill-switch', String(v));
    showToast(v ? '🔴 Kill Switch ENGAGED — trading halted' : '🟢 Kill Switch disarmed', v ? 'error' : 'success');
    try {
      await fetch(`${API_BASE}/api/trading/kill-switch`, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: v }),
      });
    } catch {}
  }, []);

  const handleLogout = useCallback(() => { clearSession(); setAuthed(false); }, []);

  if (!authed) return <LoginScreen onAuth={() => setAuthed(true)} />;

  const sharedProps = { mode, showToast };

  return (
    <div className="app-shell">
      <TopBar
        mode={mode}
        onModeChange={handleModeChange}
        killSwitch={killSwitch}
        onKillSwitch={handleKillSwitch}
        connected={connected}
        onLogout={handleLogout}
      />
      <div className="layout">
        <SideNav page={page} onChange={setPage} />
        <main className="main-content">
          {page === 'dashboard' && <DashboardPage {...sharedProps} />}
          {page === 'positions' && <PositionsPage  {...sharedProps} />}
          {page === 'orders'    && <OrdersPage     {...sharedProps} />}
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
