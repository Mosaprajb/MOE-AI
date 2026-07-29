// MOE-AI Settings Page
import { useEffect, useState } from 'react';
import { API_BASE, LS_SETTINGS } from '../lib/config';
import { setPin, hasPinSet } from '../lib/auth';
import type { TradingMode } from '../lib/config';

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="panel-title" style={{ marginBottom: 14 }}>{title}</div>
      {children}
    </div>
  );
}

export default function SettingsPage({ showToast }: Props) {
  const notificationPermission = typeof Notification !== 'undefined'
    ? Notification.permission
    : 'unsupported';
  const [apiBase,   setApiBase]   = useState(() =>
    localStorage.getItem('moe-api-base') ?? 'https://moerand-alerts.mosaprajb.workers.dev'
  );
  const [newPin,    setNewPin]    = useState('');
  const [confPin,   setConfPin]   = useState('');
  const [notifs,    setNotifs]    = useState(false);
  const [savingPin, setSavingPin] = useState(false);
  const [cashPct, setCashPct] = useState('25');
  const [marginPct, setMarginPct] = useState('50');
  const [maxPositionUsd, setMaxPositionUsd] = useState('0');
  const [stopLossEnabled, setStopLossEnabled] = useState(true);
  const [stopLossPct, setStopLossPct] = useState('2');
  const [sizingSource, setSizingSource] = useState<'cash' | 'cash_plus_margin' | 'buying_power'>('cash_plus_margin');
  const [blockIfPosition, setBlockIfPosition] = useState(true);
  const [sessionOpenOnly, setSessionOpenOnly] = useState(true);
  const [sessionTz, setSessionTz] = useState('America/Chicago');
  const [sessionStart, setSessionStart] = useState('08:30');
  const [sessionEnd, setSessionEnd] = useState('15:00');
  const [loadingTradeSettings, setLoadingTradeSettings] = useState(true);
  const [savingTradeSettings, setSavingTradeSettings] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/trading/settings`, { cache: 'no-store' })
      .then(async r => {
        const data = await r.json() as { settings?: {
           maxCashPct?: number; marginPct?: number; maxPositionUsd?: number; stopLossEnabled?: boolean; stopLossPct?: number;
           sizingSource?: 'cash'|'cash_plus_margin'|'buying_power';
          blockIfPosition?: boolean; sessionOpenOnly?: boolean; sessionTz?: string;
          sessionStart?: string; sessionEnd?: string;
        }};
        const s = data.settings;
        if (s) {
          setCashPct(String(s.maxCashPct ?? 25));
          setMarginPct(String(s.marginPct ?? 50));
          setMaxPositionUsd(String(s.maxPositionUsd ?? 0));
          setStopLossEnabled(s.stopLossEnabled !== false);
          setStopLossPct(String(s.stopLossPct ?? 2));
           setSizingSource(s.sizingSource === 'buying_power'
             ? 'buying_power'
             : s.sizingSource === 'cash'
               ? 'cash'
               : 'cash_plus_margin');
          setBlockIfPosition(s.blockIfPosition !== false);
          setSessionOpenOnly(s.sessionOpenOnly !== false);
          setSessionTz(s.sessionTz ?? 'America/Chicago');
          setSessionStart(s.sessionStart ?? '08:30');
          setSessionEnd(s.sessionEnd ?? '15:00');
        }
      })
      .catch(() => {})
      .finally(() => setLoadingTradeSettings(false));
  }, []);

  const saveApiBase = () => {
    localStorage.setItem('moe-api-base', apiBase.trim().replace(/\/$/, ''));
    showToast('Worker URL saved — reload the page', 'success');
  };

  const handlePinSave = async () => {
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) {
      showToast('PIN must be exactly 6 digits', 'error'); return;
    }
    if (newPin !== confPin) {
      showToast('PINs do not match', 'error'); return;
    }
    setSavingPin(true);
    await setPin(newPin);
    setSavingPin(false);
    setNewPin(''); setConfPin('');
    showToast('PIN updated ✓', 'success');
  };

  const saveSettings = (key: string, val: unknown) => {
    const current = JSON.parse(localStorage.getItem(LS_SETTINGS) ?? '{}');
    localStorage.setItem(LS_SETTINGS, JSON.stringify({ ...current, [key]: val }));
  };

  const saveTradeSettings = async () => {
    const pct = Number(cashPct);
    const margin = Number(marginPct);
    const cap = Number(maxPositionUsd);
    const slPct = Number(stopLossPct);
    if (!Number.isFinite(pct) || pct < 1 || pct > 100) {
      showToast('Cash allocation must be between 1% and 100%', 'error'); return;
    }
    if (!Number.isFinite(cap) || cap < 0) {
      showToast('Maximum position value must be 0 or greater', 'error'); return;
    }
    if (!Number.isFinite(margin) || margin < 0 || margin > 100) {
      showToast('Margin percentage must be between 0% and 100%', 'error'); return;
    }
    if (!Number.isFinite(slPct) || slPct < 0.1 || slPct > 50) {
      showToast('Stop-loss percentage must be between 0.1% and 50%', 'error'); return;
    }
    setSavingTradeSettings(true);
    try {
      const res = await fetch(`${API_BASE}/api/trading/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxCashPct: pct, marginPct: margin, maxPositionUsd: cap, stopLossEnabled, stopLossPct: slPct, sizingSource,
          blockIfPosition, sessionOpenOnly, sessionTz, sessionStart, sessionEnd,
        }),
      });
      const data = await res.json() as { settings?: { maxCashPct?: number }; error?: string };
      if (!res.ok) throw new Error(data.error ?? `Worker returned HTTP ${res.status}`);
      showToast(`Trading settings saved — ${data.settings?.maxCashPct ?? pct}% of cash per BUY ✓`, 'success');
    } catch (err) {
      showToast(`Could not save trading settings: ${String(err).replace('Error: ', '')}`, 'error');
    } finally {
      setSavingTradeSettings(false);
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Settings</div>
        <div className="page-sub">MOE-AI configuration</div>
      </div>

      {/* Cloudflare Worker connection */}
      <Section title="Cloudflare Worker">
        <div style={{ marginBottom: 8 }}>
          <div className="input-label">Worker API URL</div>
          <div className="input-group">
            <input className="input" value={apiBase}
              onChange={e => setApiBase(e.target.value)}
              placeholder="https://moerand-alerts.mosaprajb.workers.dev" />
            <button className="btn btn-primary" onClick={saveApiBase}>Save</button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
            Override the Worker URL if you deploy to a different Cloudflare account. Requires a page reload.
          </div>
        </div>
      </Section>

      {/* Position sizing and session controls */}
       <Section title="Trading Controls">
        <div style={{ padding: '10px 12px', marginBottom: 14, borderRadius: 8,
          background: 'rgba(34,211,144,.07)', border: '1px solid rgba(34,211,144,.2)',
          color: 'var(--muted)', fontSize: 12, lineHeight: 1.55 }}>
          These settings are saved on the Worker and apply to the next TradingView BUY.
          SELL signals always close the actual open quantity.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div className="input-label">Cash allocation per BUY (%)</div>
            <input className="input" type="number" min={1} max={100} step={1}
              value={cashPct} onChange={e => setCashPct(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
              Example: 25% of Cash Balance, not margin.
            </div>
          </div>
          <div>
            <div className="input-label">Maximum position value ($)</div>
            <input className="input" type="number" min={0} step={100}
              value={maxPositionUsd} onChange={e => setMaxPositionUsd(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
              0 means no dollar cap.
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14,
          padding: '12px', borderRadius: 10, background: 'rgba(255,184,77,.07)',
          border: '1px solid rgba(255,184,77,.25)' }}>
          <label className="setting-row" style={{ cursor: 'pointer' }}>
            <span className="setting-info">
              <b>Protect new BUY positions with a stop loss</b>
              <small>Webull receives a protective stop with each new BUY. SELL signals still close the actual held quantity.</small>
            </span>
            <input type="checkbox" checked={stopLossEnabled}
              onChange={e => setStopLossEnabled(e.target.checked)} />
          </label>
          <div style={{ maxWidth: 260 }}>
            <div className="input-label">Maximum loss per position (%)</div>
            <input className="input" type="number" min={0.1} max={50} step={0.1}
              value={stopLossPct} onChange={e => setStopLossPct(e.target.value)}
              disabled={!stopLossEnabled} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
              Example: 2% on a $1,000 position exits near $980.
            </div>
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <div>
            <div className="input-label">Sizing source</div>
            <select className="input" value={sizingSource}
              onChange={e => setSizingSource(e.target.value as 'cash'|'cash_plus_margin'|'buying_power')}>
              <option value="cash">Cash Balance (recommended)</option>
              <option value="cash_plus_margin">Cash + Margin</option>
              <option value="buying_power">Buying Power (may use margin)</option>
            </select>
          </div>
          <div>
            <div className="input-label">Session timezone</div>
            <select className="input" value={sessionTz} onChange={e => setSessionTz(e.target.value)}>
              <option value="America/Chicago">Central — America/Chicago</option>
              <option value="America/New_York">Eastern — America/New_York</option>
              <option value="America/Los_Angeles">Pacific — America/Los_Angeles</option>
              <option value="Asia/Riyadh">Riyadh — Asia/Riyadh</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
        </div>
        {sizingSource === 'cash_plus_margin' && (
          <div style={{ marginTop: 12, maxWidth: 260 }}>
            <div className="input-label">Additional margin over cash (%)</div>
            <input className="input" type="number" min={0} max={100} step={0.5}
              value={marginPct} onChange={e => setMarginPct(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 5 }}>
              Example: 25% cash + 50% margin = up to 75% of cash balance, capped by Webull Buying Power.
            </div>
          </div>
        )}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          <label className="setting-row" style={{ cursor: 'pointer' }}>
            <span className="setting-info"><b>Open trades only during regular session</b>
              <small>Default: 08:30–15:00. SELL remains allowed outside the session.</small></span>
            <input type="checkbox" checked={sessionOpenOnly} onChange={e => setSessionOpenOnly(e.target.checked)} />
          </label>
          <label className="setting-row" style={{ cursor: 'pointer' }}>
            <span className="setting-info"><b>Block BUY when this symbol is already held</b>
              <small>Prevents duplicate positions and accidental over-allocation.</small></span>
            <input type="checkbox" checked={blockIfPosition} onChange={e => setBlockIfPosition(e.target.checked)} />
          </label>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 12 }}>
          <div>
            <div className="input-label">Session start</div>
            <input className="input" type="time" value={sessionStart} onChange={e => setSessionStart(e.target.value)} />
          </div>
          <div>
            <div className="input-label">Session end</div>
            <input className="input" type="time" value={sessionEnd} onChange={e => setSessionEnd(e.target.value)} />
          </div>
        </div>
        <button className="btn btn-primary" style={{ marginTop: 14 }}
          onClick={saveTradeSettings} disabled={savingTradeSettings || loadingTradeSettings}>
          {savingTradeSettings ? 'Saving…' : loadingTradeSettings ? 'Loading…' : 'Save Trading Controls'}
        </button>
      </Section>

      {/* Security */}
      <Section title="Security">
        <div className="setting-row">
          <div className="setting-info">
            <b>Login PIN</b>
            <small>{hasPinSet() ? 'PIN is set ✓' : 'No PIN set yet'}</small>
          </div>
        </div>
        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          <div>
            <div className="input-label">New PIN (6 digits)</div>
            <input className="input" type="password" maxLength={6} value={newPin}
              onChange={e => setNewPin(e.target.value.replace(/\D/g,'').slice(0,6))}
              placeholder="••••••" />
          </div>
          <div>
            <div className="input-label">Confirm PIN</div>
            <input className="input" type="password" maxLength={6} value={confPin}
              onChange={e => setConfPin(e.target.value.replace(/\D/g,'').slice(0,6))}
              placeholder="••••••" />
          </div>
        </div>
        <button className="btn btn-primary btn-sm" style={{ marginTop: 12 }}
          onClick={handlePinSave} disabled={savingPin || newPin.length < 6}>
          {savingPin ? 'Saving…' : 'Update PIN'}
        </button>
      </Section>

      {/* Notifications */}
      <Section title="Notifications">
        <div className="setting-row">
          <div className="setting-info">
            <b>Browser notifications</b>
            <small>Get notified when alerts are received</small>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={notifs} onChange={e => {
              setNotifs(e.target.checked);
              if (e.target.checked) {
                Notification.requestPermission().then(p => {
                  if (p !== 'granted') { setNotifs(false); showToast('Notification permission denied', 'error'); }
                  else { showToast('Notifications enabled ✓', 'success'); saveSettings('notifications', true); }
                });
              }
            }} />
            <div className="toggle-track" />
            <div className="toggle-thumb" />
          </label>
        </div>
        <div className="setting-row">
          <div className="setting-info">
            <b>Permission status</b>
            <small>{typeof Notification !== 'undefined' ? Notification.permission : 'Not supported'}</small>
          </div>
           <span className={`badge ${notificationPermission === 'granted' ? 'badge-green' : 'badge-yellow'}`}>
             {notificationPermission}
          </span>
        </div>
      </Section>

      {/* Cloudflare Secrets */}
      <Section title="Required Cloudflare Secrets">
        <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.9 }}>
          Webull credentials and the webhook secret must be stored in <b style={{ color: 'var(--cyan)' }}>Cloudflare Secrets</b> — never entered here.<br />
          Use <code style={{ color: 'var(--cyan)', fontSize: 11 }}>wrangler secret put {'<NAME>'}</code> in the <code>worker/</code> directory.
        </div>
        <div style={{ marginTop: 14, padding: 14, background: 'var(--surface-2)', borderRadius: 8, fontSize: 12 }}>
          <div style={{ marginBottom: 10, fontWeight: 800, color: 'var(--green)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Required secrets</div>
          {[
            'MOE_WEBHOOK_SECRET',
            'WEBULL_SANDBOX_APP_KEY', 'WEBULL_SANDBOX_APP_SECRET',
            'WEBULL_SANDBOX_ACCESS_TOKEN', 'WEBULL_SANDBOX_ACCOUNT_ID',
          ].map(k => (
            <div key={k} style={{ marginTop: 5, fontFamily: 'monospace', color: 'var(--cyan)' }}>• {k}</div>
          ))}
          <div style={{ marginTop: 14, marginBottom: 6, fontWeight: 800, color: 'var(--yellow)', textTransform: 'uppercase', letterSpacing: '.05em' }}>Live trading (add when ready)</div>
          {[
            'WEBULL_LIVE_APP_KEY', 'WEBULL_LIVE_APP_SECRET',
            'WEBULL_LIVE_ACCESS_TOKEN', 'WEBULL_LIVE_ACCOUNT_ID',
          ].map(k => (
            <div key={k} style={{ marginTop: 5, fontFamily: 'monospace', color: 'var(--yellow)' }}>• {k}</div>
          ))}
        </div>
      </Section>

      {/* System info */}
      <Section title="About">
        {[
          { k: 'Version',        v: '5.0' },
          { k: 'Mode',           v: 'TradingView → Cloudflare Worker → Webull' },
          { k: 'Broker',         v: 'Webull (Demo + Live)' },
          { k: 'Infrastructure', v: 'Cloudflare Workers + KV + D1' },
        ].map(item => (
          <div key={item.k} className="setting-row">
            <div className="setting-info"><b>{item.k}</b></div>
            <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 700 }}>{item.v}</span>
          </div>
        ))}
      </Section>
    </div>
  );
}
