// MOE-AI — App Shell v3 (safe Live observation controls)
import { Component, useCallback, useEffect, useState } from 'react';
import type { ErrorInfo, MouseEvent, ReactNode } from 'react';
import { API_BASE, LS_MODE } from './lib/config';
import type { TradingMode } from './lib/config';
import { isSessionValid, createSession, clearSession, hasPinSet, setPin, verifyPin } from './lib/auth';
import {
  fetchLiveControlStatus,
  summarizeLiveBlockers,
} from './lib/liveControl';
import type { LiveControlStatus } from './lib/liveControl';
import { useMarketClock } from './hooks/useMarketClock';
import type { MarketSession } from './hooks/useMarketClock';

import ScannerPage from './pages/Scanner';
import PositionsPage from './pages/Positions';
import HistoryPage from './pages/History';
import SettingsPage from './pages/Settings';

class PageErrorBoundary extends Component<
  { children: ReactNode; page: string },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[MOE-AI] Page crash:', error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{
          margin: '40px auto', maxWidth: 480, padding: 28,
          background: 'var(--surface)', border: '1px solid var(--red-bdr)',
          borderRadius: 14, textAlign: 'center',
        }}>
          <div style={{ fontSize: 32, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontWeight: 800, fontSize: 16, color: 'var(--red)', marginBottom: 8 }}>
            Page Error — {this.props.page}
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 20, fontFamily: 'monospace' }}>
            {String(this.state.error).slice(0, 200)}
          </div>
          <button className="btn btn-primary" onClick={() => this.setState({ error: null })}>
            Reload Page
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

type Page = 'scanner' | 'positions' | 'history' | 'settings';

const NAV: { id: Page; icon: string; label: string }[] = [
  { id: 'scanner', icon: '📡', label: 'Scanner' },
  { id: 'positions', icon: '◈', label: 'Positions' },
  { id: 'history', icon: '⟳', label: 'History' },
  { id: 'settings', icon: '⚙', label: 'Settings' },
];

const SESSION_STYLE: Record<MarketSession, { bg: string; color: string }> = {
  CORE: { bg: 'rgba(34,211,144,.15)', color: '#22d390' },
  'PRE-MARKET': { bg: 'rgba(255,209,102,.15)', color: '#ffd166' },
  'AFTER-HOURS': { bg: 'rgba(255,209,102,.15)', color: '#ffd166' },
  CLOSED: { bg: 'rgba(100,116,139,.15)', color: '#64748b' },
};

function LoginScreen({ onAuth }: { onAuth: () => void }) {
  const [pin, setPin_] = useState('');
  const [mode, setMode] = useState<'enter' | 'set' | 'confirm'>('enter');
  const [confirm, setConf] = useState('');
  const [error, setError] = useState('');
  const [shake, setShake] = useState(false);

  useEffect(() => { setMode(hasPinSet() ? 'enter' : 'set'); }, []);

  const doShake = () => {
    setShake(true);
    setTimeout(() => { setShake(false); setPin_(''); setError(''); }, 600);
  };

  const handleKey = async (digit: string) => {
    if (digit === 'DEL') { setPin_(value => value.slice(0, -1)); return; }
    const next = pin + digit;
    setPin_(next);
    if (next.length < 6) return;
    if (mode === 'enter') {
      const ok = await verifyPin(next);
      if (ok) { createSession(); onAuth(); }
      else { setError('Incorrect PIN'); doShake(); }
    } else if (mode === 'set') {
      setConf(next); setMode('confirm'); setPin_('');
    } else if (next === confirm) {
      await setPin(confirm); createSession(); onAuth();
    } else {
      setError('PINs do not match'); doShake(); setMode('set'); setConf('');
    }
  };

  const digits = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'DEL'];

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
          {[0, 1, 2, 3, 4, 5].map(index => (
            <div key={index} className={`pin-dot${pin.length > index ? ' filled' : ''}`} />
          ))}
        </div>
        <div className="pin-pad">
          {digits.map((digit, index) => (
            <button
              key={index}
              className={`pin-key${digit === 'DEL' ? ' del' : ''}`}
              onClick={() => digit !== '' && handleKey(digit)}
              disabled={digit === ''}
              style={digit === '' ? { visibility: 'hidden' } : {}}
            >
              {digit === 'DEL' ? '⌫' : digit}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

interface TopBarProps {
  mode: TradingMode;
  onModeChange: (mode: TradingMode) => void;
  killSwitch: boolean;
  onKillSwitch: (enabled: boolean) => void;
  connected: boolean;
  onLogout: () => void;
  liveStatus: LiveControlStatus | null;
  liveStatusLoading: boolean;
  liveStatusError: string | null;
}

function TopBar({
  mode,
  onModeChange,
  killSwitch,
  onKillSwitch,
  connected,
  onLogout,
  liveStatus,
  liveStatusLoading,
  liveStatusError,
}: TopBarProps) {
  const [confirmLive, setConfirmLive] = useState(false);
  const clock = useMarketClock();
  const sessionStyle = SESSION_STYLE[clock.session];
  const liveAvailable = liveStatus?.observationAllowed === true;
  const liveSummary = liveStatusError ?? summarizeLiveBlockers(liveStatus);

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

      <div className="topbar-clock">
        <div style={{ textAlign: 'right', lineHeight: 1.3 }}>
          <div style={{ fontFamily: 'monospace', fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>
            {clock.timeET} <span style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 400 }}>ET</span>
          </div>
          <div style={{ fontSize: 10, color: 'var(--muted)' }}>{clock.nextLabel}</div>
        </div>
        <div style={{
          padding: '3px 9px', borderRadius: 6, fontSize: 11, fontWeight: 800,
          background: sessionStyle.bg, color: sessionStyle.color,
          border: `1px solid ${sessionStyle.color}44`,
        }}>
          {clock.session}
        </div>
      </div>

      <div className="topbar-session-badge" style={{
        display: 'none', padding: '3px 7px', borderRadius: 6,
        fontSize: 10, fontWeight: 800, background: sessionStyle.bg,
        color: sessionStyle.color, border: `1px solid ${sessionStyle.color}44`,
      }}>
        {clock.session}
      </div>

      <div className="conn-pill">
        <span className={`conn-dot ${connected ? 'live' : 'error'}`} />
        <span className="topbar-conn-text">{connected ? 'Connected' : 'Offline'}</span>
      </div>

      <div className="mode-switch">
        <button
          className={mode === 'SANDBOX' ? 'active-sandbox' : ''}
          onClick={() => onModeChange('SANDBOX')}
        >
          DEMO
        </button>
        <button
          className={mode === 'LIVE' ? 'active-live' : ''}
          onClick={() => setConfirmLive(true)}
          disabled={liveStatusLoading}
          title={liveAvailable ? 'Open Live account in read-only mode' : liveSummary}
        >
          {mode === 'LIVE' ? 'LIVE · VIEW' : 'LIVE'}
        </button>
      </div>

      <button
        className={`kill-switch-btn${killSwitch ? ' engaged' : ''}`}
        onClick={() => onKillSwitch(!killSwitch)}
        disabled={mode === 'LIVE'}
        title={mode === 'LIVE'
          ? 'Kill-switch changes are locked while viewing the Live account'
          : killSwitch ? 'Kill Switch ENGAGED' : 'Kill Switch disarmed'}
      >
        {mode === 'LIVE' ? '🔒 READ ONLY' : killSwitch ? '🔴 KILL' : '🟢 ARM'}
      </button>

      <button className="btn btn-ghost btn-sm topbar-logout" onClick={onLogout}>Logout</button>

      {confirmLive && (
        <div className="modal-overlay" onClick={() => setConfirmLive(false)}>
          <div className="modal" onClick={(event: MouseEvent<HTMLDivElement>) => event.stopPropagation()}>
            <div className="modal-title" style={{ color: liveAvailable ? 'var(--text)' : 'var(--red)' }}>
              {liveAvailable ? 'Open Live Account · Read Only' : 'Live View Unavailable'}
            </div>
            <div className="modal-body">
              {liveAvailable ? (
                <>
                  This changes only the dashboard view. The server execution mode remains{' '}
                  <b>{liveStatus?.currentMode ?? 'SANDBOX'}</b>. Orders, automated scans,
                  TradingView Live execution, and mobile close actions remain blocked.
                </>
              ) : (
                <>
                  {liveStatusLoading ? 'Checking the server Live policy…' : liveSummary}
                  <div style={{ marginTop: 10, color: 'var(--muted)', fontSize: 12 }}>
                    Configure the production Webull broker secrets before opening the Live account view.
                    No secret values are shown in the dashboard.
                  </div>
                </>
              )}
            </div>
            <div className="modal-actions">
              <button className="btn btn-ghost" onClick={() => setConfirmLive(false)}>Close</button>
              {liveAvailable && (
                <button
                  className="btn btn-primary"
                  onClick={() => { onModeChange('LIVE'); setConfirmLive(false); }}
                >
                  Open Read-only View
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </header>
  );
}

function LiveReadOnlyBanner({
  status,
  onReturnToDemo,
}: {
  status: LiveControlStatus | null;
  onReturnToDemo: () => void;
}) {
  const blockers = status?.blockers.slice(0, 4) ?? [];
  return (
    <div style={{
      marginBottom: 14,
      padding: '14px 16px',
      borderRadius: 12,
      border: '1px solid rgba(255, 107, 107, .5)',
      background: 'rgba(255, 107, 107, .08)',
      display: 'flex',
      gap: 14,
      alignItems: 'flex-start',
      justifyContent: 'space-between',
      flexWrap: 'wrap',
    }}>
      <div style={{ minWidth: 240, flex: 1 }}>
        <div style={{ fontWeight: 900, color: 'var(--red)', letterSpacing: '.04em' }}>
          LIVE ACCOUNT · READ ONLY
        </div>
        <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.5, color: 'var(--text)' }}>
          Broker data may be viewed, but the server execution mode remains{' '}
          <b>{status?.currentMode ?? 'SANDBOX'}</b>. This screen cannot submit orders,
          run the scanner, arm TradingView Live execution, or clear Live safety gates.
        </div>
        {blockers.length > 0 && (
          <div style={{ marginTop: 8, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {blockers.map(blocker => (
              <span key={blocker.code} style={{
                padding: '3px 7px', borderRadius: 6, fontSize: 10,
                background: 'rgba(255,255,255,.06)', color: 'var(--muted)',
                border: '1px solid rgba(255,255,255,.08)',
              }} title={blocker.message}>
                {blocker.code}
              </span>
            ))}
          </div>
        )}
      </div>
      <button className="btn btn-ghost btn-sm" onClick={onReturnToDemo}>Return to Demo</button>
    </div>
  );
}

function SideNav({
  page,
  mode,
  onChange,
}: {
  page: Page;
  mode: TradingMode;
  onChange: (page: Page) => void;
}) {
  return (
    <nav className="sidenav">
      {NAV.map(item => {
        const disabled = mode === 'LIVE' && item.id === 'scanner';
        return (
          <button
            key={item.id}
            className={`nav-item${page === item.id ? ' active' : ''}`}
            onClick={() => !disabled && onChange(item.id)}
            disabled={disabled}
            title={disabled ? 'Scanner execution is unavailable in Live read-only view' : undefined}
            style={disabled ? { opacity: .42, cursor: 'not-allowed' } : undefined}
          >
            <span className="nav-icon">{item.icon}</span>
            {item.label}
          </button>
        );
      })}
    </nav>
  );
}

function BottomNav({
  page,
  mode,
  onChange,
}: {
  page: Page;
  mode: TradingMode;
  onChange: (page: Page) => void;
}) {
  return (
    <nav className="bottom-nav">
      <div className="bottom-nav-items">
        {NAV.map(item => {
          const disabled = mode === 'LIVE' && item.id === 'scanner';
          return (
            <button
              key={item.id}
              className={`bottom-nav-item${page === item.id ? ' active' : ''}`}
              onClick={() => !disabled && onChange(item.id)}
              disabled={disabled}
              title={disabled ? 'Scanner unavailable in Live read-only view' : undefined}
              style={disabled ? { opacity: .42, cursor: 'not-allowed' } : undefined}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export default function App() {
  const [authed, setAuthed] = useState(() => isSessionValid());
  const [mode, setMode] = useState<TradingMode>(() =>
    localStorage.getItem(LS_MODE) === 'LIVE' ? 'LIVE' : 'SANDBOX');
  const [page, setPage] = useState<Page>('scanner');
  const [killSwitch, setKillSwitch] = useState(
    () => localStorage.getItem('moe-kill-switch') === 'true');
  const [connected, setConnected] = useState(false);
  const [toast, setToast] = useState<{ msg: string; type?: 'success' | 'error' } | null>(null);
  const [liveStatus, setLiveStatus] = useState<LiveControlStatus | null>(null);
  const [liveStatusLoading, setLiveStatusLoading] = useState(true);
  const [liveStatusError, setLiveStatusError] = useState<string | null>(null);

  const showToast = useCallback((msg: string, type?: 'success' | 'error', ms = 3200) => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), ms);
  }, []);

  useEffect(() => {
    const check = async () => {
      try {
        const response = await fetch(`${API_BASE}/`, { mode: 'cors', cache: 'no-store' });
        setConnected(response.ok);
      } catch {
        setConnected(false);
      }
    };
    check();
    const timer = setInterval(check, 30_000);
    return () => clearInterval(timer);
  }, []);

  const refreshLiveStatus = useCallback(async () => {
    setLiveStatusLoading(true);
    try {
      const status = await fetchLiveControlStatus();
      setLiveStatus(status);
      setLiveStatusError(null);
      if (mode === 'LIVE' && !status.observationAllowed) {
        setMode('SANDBOX');
        localStorage.setItem(LS_MODE, 'SANDBOX');
        showToast('Live view closed because the server policy is unavailable or blocked.', 'error');
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Live policy request failed';
      setLiveStatusError(message);
      setLiveStatus(null);
      if (mode === 'LIVE') {
        setMode('SANDBOX');
        localStorage.setItem(LS_MODE, 'SANDBOX');
        showToast('Live view failed closed to Demo because policy verification failed.', 'error');
      }
    } finally {
      setLiveStatusLoading(false);
    }
  }, [mode, showToast]);

  useEffect(() => {
    refreshLiveStatus();
    const timer = setInterval(refreshLiveStatus, 30_000);
    return () => clearInterval(timer);
  }, [refreshLiveStatus]);

  useEffect(() => {
    if (mode === 'LIVE' && page === 'scanner') setPage('positions');
  }, [mode, page]);

  const handleModeChange = useCallback((requestedMode: TradingMode) => {
    if (requestedMode === 'LIVE' && liveStatus?.observationAllowed !== true) {
      showToast(liveStatusError ?? summarizeLiveBlockers(liveStatus), 'error');
      return;
    }
    setMode(requestedMode);
    localStorage.setItem(LS_MODE, requestedMode);
    if (requestedMode === 'LIVE') {
      setPage(currentPage => currentPage === 'scanner' ? 'positions' : currentPage);
      showToast('Live account view opened — read-only. Execution remains in Sandbox.', 'success');
    } else {
      showToast('Demo view active ✓', 'success');
    }
  }, [liveStatus, liveStatusError, showToast]);

  const handleKillSwitch = useCallback(async (enabled: boolean) => {
    if (mode === 'LIVE') {
      showToast('Safety controls are locked in Live read-only view.', 'error');
      return;
    }
    setKillSwitch(enabled);
    localStorage.setItem('moe-kill-switch', String(enabled));
    showToast(
      enabled ? '🔴 Kill Switch ENGAGED — trading halted' : '🟢 Kill Switch disarmed',
      enabled ? 'error' : 'success',
    );
    try {
      const response = await fetch(`${API_BASE}/api/trading/kill-switch`, {
        method: 'POST',
        mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(payload.error ?? `HTTP ${response.status}`);
      }
    } catch (error) {
      setKillSwitch(!enabled);
      localStorage.setItem('moe-kill-switch', String(!enabled));
      showToast(`Kill-switch update failed: ${String(error).replace('Error: ', '')}`, 'error');
    }
  }, [mode, showToast]);

  const handleLogout = useCallback(() => {
    clearSession();
    localStorage.setItem(LS_MODE, 'SANDBOX');
    setMode('SANDBOX');
    setAuthed(false);
  }, []);

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
        liveStatus={liveStatus}
        liveStatusLoading={liveStatusLoading}
        liveStatusError={liveStatusError}
      />
      <div className="layout">
        <SideNav page={page} mode={mode} onChange={setPage} />
        <main className="main-content">
          {mode === 'LIVE' && (
            <LiveReadOnlyBanner
              status={liveStatus}
              onReturnToDemo={() => handleModeChange('SANDBOX')}
            />
          )}
          <PageErrorBoundary page={page}>
            {page === 'scanner' && <ScannerPage {...shared} />}
            {page === 'positions' && <PositionsPage {...shared} />}
            {page === 'history' && <HistoryPage {...shared} />}
            {page === 'settings' && <SettingsPage {...shared} />}
          </PageErrorBoundary>
        </main>
      </div>
      <BottomNav page={page} mode={mode} onChange={setPage} />
      {toast && (
        <div className="toast-container">
          <div className={`toast${toast.type ? ` ${toast.type}` : ''}`}>{toast.msg}</div>
        </div>
      )}
    </div>
  );
}
