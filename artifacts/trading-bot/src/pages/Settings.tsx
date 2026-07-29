// MOE-AI — Settings Page
import { useEffect, useState } from 'react';
import { API_BASE } from '../lib/config';
import { setPin, hasPinSet } from '../lib/auth';
import type { TradingMode } from '../lib/config';
import type { ScannerConfig } from '../hooks/useScanner';

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="card" style={{ marginBottom: 14 }}>
      <div className="settings-section-title">{title}</div>
      {children}
    </div>
  );
}

export default function SettingsPage({ showToast }: Props) {
  // Worker URL
  const [apiBase, setApiBase] = useState(
    () => localStorage.getItem('moe-api-base') ?? 'https://moerand-alerts.mosaprajb.workers.dev'
  );

  // Trading controls
  const [cashPct,          setCashPct]          = useState('25');
  const [marginPct,        setMarginPct]         = useState('50');
  const [maxPositionUsd,   setMaxPositionUsd]    = useState('0');
  const [sizingSource,     setSizingSource]      = useState<'cash'|'cash_plus_margin'|'buying_power'>('cash_plus_margin');
  const [stopLossEnabled,  setStopLossEnabled]   = useState(true);
  const [stopLossPct,      setStopLossPct]       = useState('2');
  const [blockIfPosition,  setBlockIfPosition]   = useState(true);
  const [sessionOpenOnly,  setSessionOpenOnly]   = useState(true);
  const [sessionTz,        setSessionTz]         = useState('America/Chicago');
  const [sessionStart,     setSessionStart]      = useState('08:30');
  const [sessionEnd,       setSessionEnd]        = useState('15:00');
  const [loadingSettings,  setLoadingSettings]   = useState(true);
  const [savingSettings,   setSavingSettings]    = useState(false);

  // Scanner strategy
  const [scanTpPct,       setScanTpPct]       = useState('1.5');
  const [scanTrailPct,    setScanTrailPct]     = useState('1.0');
  const [scanHardStopPct, setScanHardStopPct] = useState('1.5');
  const [scanPriceMin,    setScanPriceMin]     = useState('10');
  const [scanPriceMax,    setScanPriceMax]     = useState('100');
  const [scanMaxPos,      setScanMaxPos]       = useState('4');
  const [loadingScanner,  setLoadingScanner]   = useState(true);
  const [savingScanner,   setSavingScanner]    = useState(false);

  // PIN
  const [newPin,  setNewPin]  = useState('');
  const [confPin, setConfPin] = useState('');
  const [savingPin, setSavingPin] = useState(false);

  // Load scanner config
  useEffect(() => {
    fetch(`${API_BASE}/api/scanner/config`, { cache: 'no-store' })
      .then(async r => {
        if (!r.ok) return;
        const d = await r.json() as Partial<ScannerConfig>;
        if (d.tpPct        != null) setScanTpPct(String(d.tpPct));
        if (d.trailPct     != null) setScanTrailPct(String(d.trailPct));
        if (d.hardStopPct  != null) setScanHardStopPct(String(d.hardStopPct));
        if (d.priceMin     != null) setScanPriceMin(String(d.priceMin));
        if (d.priceMax     != null) setScanPriceMax(String(d.priceMax));
        if (d.maxPositions != null) setScanMaxPos(String(d.maxPositions));
      })
      .catch(() => {})
      .finally(() => setLoadingScanner(false));
  }, []);

  const saveScannerStrategy = async () => {
    const tp    = Number(scanTpPct);
    const trail = Number(scanTrailPct);
    const hs    = Number(scanHardStopPct);
    const pmin  = Number(scanPriceMin);
    const pmax  = Number(scanPriceMax);
    const mpos  = Number(scanMaxPos);
    if (tp < 0.1 || tp > 20)    { showToast('Take Profit must be 0.1–20%', 'error'); return; }
    if (trail < 0.1 || trail > 20) { showToast('Trailing SL must be 0.1–20%', 'error'); return; }
    if (hs < 0.1 || hs > 30)    { showToast('Hard Stop must be 0.1–30%', 'error'); return; }
    if (pmin < 0 || pmax <= pmin){ showToast('Price range invalid', 'error'); return; }
    if (mpos < 1 || mpos > 20)  { showToast('Max positions must be 1–20', 'error'); return; }
    setSavingScanner(true);
    try {
      const res = await fetch(`${API_BASE}/api/scanner/config`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tpPct: tp, trailPct: trail, hardStopPct: hs,
          priceMin: pmin, priceMax: pmax, maxPositions: mpos }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast('Scanner strategy saved ✓', 'success');
    } catch (e) {
      showToast(`Save failed: ${String(e).replace('Error: ', '')}`, 'error');
    } finally { setSavingScanner(false); }
  };

  useEffect(() => {
    fetch(`${API_BASE}/api/trading/settings`, { cache: 'no-store' })
      .then(async r => {
        const d = await r.json() as { settings?: {
          maxCashPct?: number; marginPct?: number; maxPositionUsd?: number;
          stopLossEnabled?: boolean; stopLossPct?: number;
          sizingSource?: 'cash'|'cash_plus_margin'|'buying_power';
          blockIfPosition?: boolean; sessionOpenOnly?: boolean;
          sessionTz?: string; sessionStart?: string; sessionEnd?: string;
        }};
        const s = d.settings;
        if (s) {
          setCashPct(String(s.maxCashPct ?? 25));
          setMarginPct(String(s.marginPct ?? 50));
          setMaxPositionUsd(String(s.maxPositionUsd ?? 0));
          setStopLossEnabled(s.stopLossEnabled !== false);
          setStopLossPct(String(s.stopLossPct ?? 2));
          setSizingSource(
            s.sizingSource === 'buying_power' ? 'buying_power'
            : s.sizingSource === 'cash' ? 'cash'
            : 'cash_plus_margin'
          );
          setBlockIfPosition(s.blockIfPosition !== false);
          setSessionOpenOnly(s.sessionOpenOnly !== false);
          setSessionTz(s.sessionTz ?? 'America/Chicago');
          setSessionStart(s.sessionStart ?? '08:30');
          setSessionEnd(s.sessionEnd ?? '15:00');
        }
      })
      .catch(() => {})
      .finally(() => setLoadingSettings(false));
  }, []);

  const saveTradingControls = async () => {
    const pct    = Number(cashPct);
    const margin = Number(marginPct);
    const cap    = Number(maxPositionUsd);
    const slPct  = Number(stopLossPct);
    if (!Number.isFinite(pct)  || pct  < 1   || pct  > 100) { showToast('Cash % must be 1–100', 'error'); return; }
    if (!Number.isFinite(margin)|| margin < 0 || margin > 100){ showToast('Margin % must be 0–100', 'error'); return; }
    if (!Number.isFinite(cap)  || cap  < 0)                   { showToast('Max position must be ≥ 0', 'error'); return; }
    if (!Number.isFinite(slPct)|| slPct < 0.1 || slPct > 50) { showToast('Stop-loss must be 0.1–50%', 'error'); return; }
    setSavingSettings(true);
    try {
      const res = await fetch(`${API_BASE}/api/trading/settings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          maxCashPct: pct, marginPct: margin, maxPositionUsd: cap,
          stopLossEnabled, stopLossPct: slPct, sizingSource,
          blockIfPosition, sessionOpenOnly, sessionTz, sessionStart, sessionEnd,
        }),
      });
      const data = await res.json() as { error?: string };
      if (!res.ok) throw new Error(data.error ?? `HTTP ${res.status}`);
      showToast('Settings saved ✓', 'success');
    } catch (e) {
      showToast(`Save failed: ${String(e).replace('Error: ', '')}`, 'error');
    } finally {
      setSavingSettings(false);
    }
  };

  const savePin = async () => {
    if (newPin.length !== 6 || !/^\d{6}$/.test(newPin)) { showToast('PIN must be 6 digits', 'error'); return; }
    if (newPin !== confPin)                               { showToast('PINs do not match', 'error'); return; }
    setSavingPin(true);
    await setPin(newPin);
    setSavingPin(false);
    setNewPin(''); setConfPin('');
    showToast('PIN updated ✓', 'success');
  };

  return (
    <div>
      <div className="page-header">
        <div className="page-title">Settings</div>
      </div>

      {/* Worker */}
      <Section title="Cloudflare Worker">
        <div className="input-label">Worker API URL</div>
        <div className="input-group">
          <input className="input" value={apiBase}
            onChange={e => setApiBase(e.target.value)}
            placeholder="https://…workers.dev" />
          <button className="btn btn-primary" onClick={() => {
            localStorage.setItem('moe-api-base', apiBase.trim().replace(/\/$/, ''));
            showToast('Worker URL saved — reload the page', 'success');
          }}>Save</button>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          Change only if you deploy to a different Cloudflare account. Requires reload.
        </div>
      </Section>

      {/* Trading controls */}
      <Section title="Trading Controls">
        <div className="settings-info-box">
          Settings apply to the next BUY. SELL always closes the actual held quantity.
          {loadingSettings && <span style={{ marginLeft: 8, color: 'var(--muted)' }}>Loading…</span>}
        </div>

        {/* Sizing source */}
        <div className="settings-row-grid">
          <div>
            <div className="input-label">Sizing source</div>
            <select className="input" value={sizingSource}
              onChange={e => setSizingSource(e.target.value as typeof sizingSource)}>
              <option value="cash">Cash Balance only</option>
              <option value="cash_plus_margin">Cash + Margin</option>
              <option value="buying_power">Buying Power (full margin)</option>
            </select>
          </div>
          <div>
            <div className="input-label">Cash allocation per BUY (%)</div>
            <input className="input" type="number" min={1} max={100} step={1}
              value={cashPct} onChange={e => setCashPct(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>% of cash used per position</div>
          </div>
        </div>

        {sizingSource === 'cash_plus_margin' && (
          <div style={{ marginTop: 12 }}>
            <div className="input-label">Additional margin over cash (%)</div>
            <div style={{ maxWidth: 200 }}>
              <input className="input" type="number" min={0} max={100} step={0.5}
                value={marginPct} onChange={e => setMarginPct(e.target.value)} />
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Example: 25% cash + 50% margin → up to 75% of cash balance, capped by Webull Buying Power.
            </div>
          </div>
        )}

        <div style={{ marginTop: 12 }}>
          <div className="input-label">Max position value ($)</div>
          <div style={{ maxWidth: 200 }}>
            <input className="input" type="number" min={0} step={100}
              value={maxPositionUsd} onChange={e => setMaxPositionUsd(e.target.value)} />
          </div>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>0 = no dollar cap</div>
        </div>

        {/* Stop loss */}
        <div className="settings-divider" />
        <label className="setting-row" style={{ cursor: 'pointer' }}>
          <span className="setting-info">
            <b>Protective stop loss</b>
            <small>Place a broker-side STOP_LOSS order after each BUY.</small>
          </span>
          <input type="checkbox" checked={stopLossEnabled}
            onChange={e => setStopLossEnabled(e.target.checked)} />
        </label>
        {stopLossEnabled && (
          <div style={{ marginTop: 10, maxWidth: 200 }}>
            <div className="input-label">Max loss per position (%)</div>
            <input className="input" type="number" min={0.1} max={50} step={0.1}
              value={stopLossPct} onChange={e => setStopLossPct(e.target.value)} />
          </div>
        )}

        {/* Session */}
        <div className="settings-divider" />
        <label className="setting-row" style={{ cursor: 'pointer' }}>
          <span className="setting-info">
            <b>Open trades during regular session only</b>
            <small>SELL is always allowed. BUY is blocked outside session hours.</small>
          </span>
          <input type="checkbox" checked={sessionOpenOnly}
            onChange={e => setSessionOpenOnly(e.target.checked)} />
        </label>
        <label className="setting-row" style={{ cursor: 'pointer' }}>
          <span className="setting-info">
            <b>Block BUY when symbol already held</b>
            <small>Prevents duplicate positions.</small>
          </span>
          <input type="checkbox" checked={blockIfPosition}
            onChange={e => setBlockIfPosition(e.target.checked)} />
        </label>

        <div className="settings-row-grid" style={{ marginTop: 12 }}>
          <div>
            <div className="input-label">Timezone</div>
            <select className="input" value={sessionTz} onChange={e => setSessionTz(e.target.value)}>
              <option value="America/Chicago">Central (Chicago)</option>
              <option value="America/New_York">Eastern (New York)</option>
              <option value="America/Los_Angeles">Pacific (LA)</option>
              <option value="Asia/Riyadh">Riyadh</option>
              <option value="UTC">UTC</option>
            </select>
          </div>
          <div>
            <div className="input-label">Session</div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input className="input" type="time" value={sessionStart} onChange={e => setSessionStart(e.target.value)} style={{ flex: 1 }} />
              <span style={{ color: 'var(--muted)' }}>–</span>
              <input className="input" type="time" value={sessionEnd} onChange={e => setSessionEnd(e.target.value)} style={{ flex: 1 }} />
            </div>
          </div>
        </div>

        <button className="btn btn-primary" style={{ marginTop: 16 }}
          onClick={saveTradingControls}
          disabled={savingSettings || loadingSettings}>
          {savingSettings ? 'Saving…' : loadingSettings ? 'Loading…' : 'Save Trading Controls'}
        </button>
      </Section>

      {/* Scanner Strategy */}
      <Section title="Scanner Strategy">
        <div className="settings-info-box">
          Controls how the scanner scores stocks and manages positions.
          {loadingScanner && <span style={{ marginLeft: 8, color: 'var(--muted)' }}>Loading…</span>}
        </div>

        <div className="settings-row-grid">
          <div>
            <div className="input-label">Take Profit (%)</div>
            <input className="input" type="number" min={0.1} max={20} step={0.1}
              value={scanTpPct} onChange={e => setScanTpPct(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Target gain from entry. Default: 1.5%</div>
          </div>
          <div>
            <div className="input-label">Trailing Stop (%)</div>
            <input className="input" type="number" min={0.1} max={20} step={0.1}
              value={scanTrailPct} onChange={e => setScanTrailPct(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Trails highest price. Default: 1.0%</div>
          </div>
        </div>

        <div className="settings-row-grid" style={{ marginTop: 12 }}>
          <div>
            <div className="input-label">Hard Stop Loss (%)</div>
            <input className="input" type="number" min={0.1} max={30} step={0.1}
              value={scanHardStopPct} onChange={e => setScanHardStopPct(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Maximum loss floor. Default: 1.5%</div>
          </div>
          <div>
            <div className="input-label">Max open positions</div>
            <input className="input" type="number" min={1} max={20} step={1}
              value={scanMaxPos} onChange={e => setScanMaxPos(e.target.value)} />
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Scanner won't open more than this. Default: 4</div>
          </div>
        </div>

        <div className="settings-divider" />
        <div className="input-label" style={{ marginBottom: 8 }}>Price range filter ($)</div>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', maxWidth: 340 }}>
          <div style={{ flex: 1 }}>
            <input className="input" type="number" min={0} step={1}
              value={scanPriceMin} onChange={e => setScanPriceMin(e.target.value)}
              placeholder="Min" />
          </div>
          <span style={{ color: 'var(--muted)' }}>–</span>
          <div style={{ flex: 1 }}>
            <input className="input" type="number" min={1} step={10}
              value={scanPriceMax} onChange={e => setScanPriceMax(e.target.value)}
              placeholder="Max" />
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 6 }}>
          Only scan stocks within this price range. Default: $10–$100.
        </div>

        <button className="btn btn-primary" style={{ marginTop: 16 }}
          onClick={saveScannerStrategy}
          disabled={savingScanner || loadingScanner}>
          {savingScanner ? 'Saving…' : loadingScanner ? 'Loading…' : 'Save Scanner Strategy'}
        </button>
      </Section>

      {/* Security */}
      <Section title="Security">
        <div className="setting-row">
          <div className="setting-info">
            <b>Login PIN</b>
            <small>{hasPinSet() ? 'PIN is configured ✓' : 'No PIN set'}</small>
          </div>
        </div>
        <div className="settings-row-grid" style={{ marginTop: 12 }}>
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
          onClick={savePin} disabled={savingPin || newPin.length < 6}>
          {savingPin ? 'Saving…' : 'Update PIN'}
        </button>
      </Section>

      {/* Required secrets */}
      <Section title="Cloudflare Secrets">
        <div style={{ color: 'var(--muted)', fontSize: 13, lineHeight: 1.8 }}>
          Credentials are stored in <b style={{ color: 'var(--cyan)' }}>Cloudflare Secrets</b> — never entered here.<br />
          Use <code style={{ color: 'var(--cyan)', fontSize: 11 }}>wrangler secret put &lt;NAME&gt;</code> in <code>worker/</code>.
        </div>
        <div className="secrets-list">
          {[
            'MOE_WEBHOOK_SECRET',
            'WEBULL_SANDBOX_APP_KEY', 'WEBULL_SANDBOX_APP_SECRET',
            'WEBULL_SANDBOX_ACCESS_TOKEN', 'WEBULL_SANDBOX_ACCOUNT_ID',
          ].map(k => <div key={k} className="secret-item">{k}</div>)}
          <div style={{ fontSize: 11, color: 'var(--yellow)', marginTop: 12, fontWeight: 700, letterSpacing: '.04em' }}>FOR LIVE TRADING</div>
          {[
            'WEBULL_LIVE_APP_KEY', 'WEBULL_LIVE_APP_SECRET',
            'WEBULL_LIVE_ACCESS_TOKEN', 'WEBULL_LIVE_ACCOUNT_ID',
          ].map(k => <div key={k} className="secret-item" style={{ color: 'var(--yellow)' }}>{k}</div>)}
        </div>
      </Section>
    </div>
  );
}
