// MOE-AI Settings Page
import { useState } from 'react';
import { LS_SETTINGS } from '../lib/config';
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
  const [apiBase,   setApiBase]   = useState(() =>
    localStorage.getItem('moe-api-base') ?? 'https://moerand-alerts.mosaprajb.workers.dev'
  );
  const [newPin,    setNewPin]    = useState('');
  const [confPin,   setConfPin]   = useState('');
  const [notifs,    setNotifs]    = useState(false);
  const [savingPin, setSavingPin] = useState(false);

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
          <span className={`badge ${Notification?.permission === 'granted' ? 'badge-green' : 'badge-yellow'}`}>
            {Notification?.permission ?? 'N/A'}
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
