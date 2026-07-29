// MOE-AI — App Shell v2 (Scanner-first)
import { useCallback, useEffect, useState } from 'react';
import { API_BASE, LS_MODE } from './lib/config';
import type { TradingMode } from './lib/config';
import { isSessionValid, createSession, clearSession, hasPinSet, setPin, verifyPin } from './lib/auth';
import { useMarketClock } from './hooks/useMarketClock';
import type { MarketSession } from './hooks/useMarketClock';

import ScannerPage  from './pages/Scanner';
import PositionsPage from './pages/Positions';
import HistoryPage  from './pages/History';
import SettingsPage from './pages/Settings';

type Page = 'scanner' | 'positions' | 'history' | 'settings';

const NAV: { id: Page; icon: string; label: string }[] = [
  { id: 'scanner',   icon: '📡', label: 'Scanner'   },
  { id: 'positions', icon: '◈',  label: 'Positions' },
  { id: 'history',   icon: '⟳',  label: 'History'   },
  { id: 'settings',  icon: '⚙',  label: 'Settings'  },
];

const SESSION_STYLE: Record<MarketSession, { bg: string; color: string }> = {
  'CORE':        { bg: 'rgba(34,211,144,.15)',  color: '#22d390' },
  'PRE-MARKET':  { bg: 'rgba(255,209,102,.15)', color: '#ffd166' },
  'AFTER-HOURS': { bg: 'rgba(255,209,102,.15)', color: '#ffd166' },
  'CLOSED':      { bg: 'rgba(100,116,139,.15)', color: '#64748b' },
};

// ── PIN Login ─────────────────────────────────────────────────────────────────
function LoginScreen({ onAuth }: { onAuth: () => void }) {
  const [pin, setPin_]    = useState('');
  const [mode, setMode]   = useState<'enter' | 'set' | 'confirm'>('enter');
  const [confirm, setConf]= useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => { setMode(hasPinSet() ? 'enter' : 'set'); }, []);

  const doShake = () => {
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
      else    { setError('Incorrect PIN'); doShake(); }
    } else if (mode === 'set') {
      setConf(next); setMode('confirm'); setPin_('');
    } else {
      if (next === confirm) { await setPin(confirm); createSession(); onAuth(); }
      else { setError('PINs do not match'); doShake(); setMode('set'); setConf(''); }
    }
  };

  const digits = ['1','2','3','4','5','6','7','8','9','','0','DEL'];

  return (
    <div className="login-screen">
      <div className={`login-card${shake ? ' shake' : ''}`}>
        <div className="login-logo">M</div>
        <div style={{ fontSize: 22, fontWeight: 800 }}>MOE-AI</div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>
          Auto Scanner ·{' '}
          {mode === 'enter' ? 'Enter PIN' : mode === 'set' ? 'Set a 6-digit PIN' : 'Confirm PIN'}
        </div>
        {error && <div style={{ color: 'var(--red)', fontSize: 12, marginTop: 10, fontWeight: 700 }}>{error}</div>}
        <div className="pin-dots">
          {[0,1,2,3,4,5].map(i => (
            <div key={i} className={`pin-dot${pin.length > i ? ' filled' : ''}`} />
          ))}
        </div>
        <div className="pin-pad">
          {digits.map((d, i) => (
            <button key={i} className={`pin-key${d === 'DEL' ? ' del' : ''}`}
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
  const clock = useMarketClock();
  const ses = SESSION_STYLE[clock.session];

  return (
    <header className="topbar">
      <div className="brand">
        <div className="logo">M</div>
        <div>
          <div className="brand-name">MOE-AI</div>
          <div className="brand-sub">Auto Scanner</div>
        </div>
      </div>

      <div className="topbar-spacer" />

      {/* Market clock — desktop */}
      <div className="topbar-clock">
        <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {clock.timeET} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>ET</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{clock.nextLabel}</div>
        </div>
        <div style={{ padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 800,
          background: ses.bg, color: ses.color, border: `1px solid ${ses.color}44` }}>
          {clock.session}
        </div>
      </div>

      {/* Session badge — mobile only */}
      <div className="topbar-session-badge" style={{ display: 'none',
        padding: '3px 7px', borderRadius: 6, fontSize: 10, fontWeight: 800,
        background: ses.bg, color: ses.color, border: `1px solid ${ses.color}44` }}>
        {clock.session}
      </div>

      <div className="conn-pill">
        <span className={`conn-dot ${connected ? 'live' : 'error'}`} />
        <span className="topbar-conn-text">{connected ? 'Connected' : 'Offline'}</span>
      </div>

      <div className="mode-switch">
        <button className={mode === 'SANDBOX' ? 'active-sandbox' : ''} onClick={() => onModeChange('SANDBOX')}>DEMO</button>
        <button className={mode === 'LIVE' ? 'active-live' : ''} onClick={() => { if (mode !== 'LIVE') setConfirmLive(true); }}>LIVE</button>
      </div>

      <button className={`kill-switch-btn${killSwitch ? ' engaged' : ''}`}
        onClick={() => onKillSwitch(!killSwitch)}
        title={killSwitch ? 'Kill Switch ENGAGED' : 'Kill Switch disarmed'}>
        {killSwitch ? '🔴 KILL' : '🟢 ARM'}
      </button>

      <button className="btn btn-ghost btn-sm topbar-logout" onClick={onLogout}>Logout</button>

      {confirmLive && (
        <div className="modal-overlay" onClick={() => setConfirmLive(false)}>
          <div className="modal" onClick={e => e.stopPropagation()}>
            <div className="modal-title" style={{ color: 'var(--red)' }}>⚠ Switch to Live Trading</div>
            <div className="modal-body">
              Live mode places <b>real orders</b> on your Webull live account. Ensure your credentials are configured and you understand the risk before proceeding.
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
      {NAV.map(item => (
        <button key={item.id}
          className={`nav-item${page === item.id ? ' active' : ''}`}
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
  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-items">
        {NAV.map(item => (
          <button key={item.id}
            className={`bottom-nav-item${page === item.id ? ' active' : ''}`}
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
  const [page, setPage]             = useState<Page>('scanner');
  const [killSwitch, setKillSwitch] = useState(
    () => localStorage.getItem('moe-kill-switch') === 'true'
  );
  const [connected, setConnected]   = useState(false);
  const [toast, setToast]           = useState<{ msg: string; type?: 'success'|'error' } | null>(null);

  useEffect(() => {
    const check = async () => {
      try { const r = await fetch(`${API_BASE}/`, { mode: 'cors', cache: 'no-store' }); setConnected(r.ok); }
      catch { setConnected(false); }
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
    try {
      await fetch(`${API_BASE}/api/trading/mode`, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: m }),
      });
    } catch { /* KV not provisioned */ }
  }, [showToast]);

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
  }, [showToast]);

  const handleLogout = useCallback(() => { clearSession(); setAuthed(false); }, []);

  if (!authed) return <LoginScreen onAuth={() => setAuthed(true)} />;

  const shared = { mode, showToast };

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
          {page === 'scanner'   && <ScannerPage   {...shared} />}
          {page === 'positions' && <PositionsPage {...shared} />}
          {page === 'history'   && <HistoryPage   {...shared} />}
          {page === 'settings'  && <SettingsPage  {...shared} />}
        </main>
      </div>
      <BottomNav page={page} onChange={setPage} />
      {toast && (
        <div className="toast-container">
          <div className={`toast${toast.type ? ` ${toast.type}` : ''}`}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
