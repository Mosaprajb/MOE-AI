// MOE-AI — TradingView Signals Page
import { useState } from 'react';
import { API_BASE } from '../lib/config';
import type { TradingMode } from '../lib/config';
import { useSignals } from '../hooks/useSignals';
import type { TVSignal, WbPosition } from '../hooks/useSignals';

interface Props {
  mode: TradingMode;
  showToast: (msg: string, type?: 'success' | 'error') => void;
}

const WEBHOOK_URL = `${API_BASE}/api/tradingview/webhook`;

// ── Helpers ───────────────────────────────────────────────────────────────────
function fmt(n: number | null | undefined, dec = 2) {
  return n != null ? `$${n.toFixed(dec)}` : '—';
}
function fmtPct(n: number | null | undefined) {
  return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—';
}
function ago(iso: string) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60)  return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── Copy button ───────────────────────────────────────────────────────────────
function CopyBtn({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    await navigator.clipboard.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button className="btn btn-ghost btn-sm" onClick={copy}
      style={{ fontSize: 11, padding: '4px 10px',
        color: copied ? 'var(--green)' : undefined,
        borderColor: copied ? 'var(--green-bdr)' : undefined }}>
      {copied ? '✓ Copied' : label}
    </button>
  );
}

// ── Alert JSON template ───────────────────────────────────────────────────────
function alertTemplate(secret: string) {
  return JSON.stringify({
    secret,
    symbol:  '{{ticker}}',
    action:  'buy',
    price:   '{{close}}',
    stop:    '{{low}}',
    qty:     10,
  }, null, 2);
}

// ── Setup Tab ─────────────────────────────────────────────────────────────────
function SetupTab({ showToast }: { showToast: Props['showToast'] }) {
  const [testSym, setTestSym] = useState('AAPL');
  const [testAction, setTestAction] = useState<'buy' | 'sell'>('buy');
  const [testing, setTesting] = useState(false);
  const secret = 'YOUR_MOE_WEBHOOK_SECRET';
  const json   = alertTemplate(secret);

  const steps = [
    { n: 1, title: 'Open TradingView', body: 'Go to tradingview.com → open any chart → click the Alarm icon (top bar).' },
    { n: 2, title: 'Create a new Alert', body: 'Choose your indicator or strategy condition, set the trigger.' },
    { n: 3, title: 'Set Webhook URL', body: 'In the "Notifications" tab → enable Webhook URL → paste the URL below.' },
    { n: 4, title: 'Set Alert Message', body: 'Switch to the "Message" tab → delete the default text → paste the JSON below. Replace YOUR_MOE_WEBHOOK_SECRET with the value of MOE_WEBHOOK_SECRET in your Cloudflare secrets.' },
    { n: 5, title: 'Save → Done', body: 'Click "Create". The next time your alert fires, MOE-AI will receive it and execute the order on Webull.' },
  ];

  const handleTest = async () => {
    setTesting(true);
    try {
      // This is deliberately a read-only health check. Never call the trading
      // webhook from the dashboard test button, because that could place an
      // order. The indicator's one-time test is the real webhook test.
      const res = await fetch(`${API_BASE}/api/health`, {
        method: 'GET', mode: 'cors', cache: 'no-store',
      });
      const d = await res.json() as {
        ok?: boolean;
        webullMode?: string;
        tradingMode?: string;
        error?: string;
        message?: string;
      };
      const failureReason = d.error ?? d.message ?? `Worker returned HTTP ${res.status}`;
      showToast(
        res.ok && d.ok
          ? `✅ Worker online — ${d.webullMode ?? d.tradingMode ?? 'ready'}`
          : `⚠ Signal rejected — ${failureReason}`,
        res.ok && d.ok ? 'success' : 'error',
      );
    } catch { showToast('❌ Could not reach worker', 'error'); }
    setTesting(false);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>

      {/* Webhook URL */}
      <div style={{ padding: 16, borderRadius: 12,
        background: 'rgba(34,211,144,.06)', border: '1.5px solid rgba(34,211,144,.25)' }}>
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--green)', letterSpacing: '.08em',
          marginBottom: 8, textTransform: 'uppercase' }}>
          📡 Webhook URL — paste this into TradingView
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <code style={{ flex: 1, fontFamily: 'monospace', fontSize: 12, color: 'var(--green)',
            background: 'rgba(0,0,0,.3)', padding: '8px 12px', borderRadius: 8,
            wordBreak: 'break-all', minWidth: 0 }}>
            {WEBHOOK_URL}
          </code>
          <CopyBtn text={WEBHOOK_URL} label="📋 Copy URL" />
        </div>
      </div>

      {/* Steps */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {steps.map(s => (
          <div key={s.n} style={{ display: 'flex', gap: 12, alignItems: 'flex-start',
            padding: '12px 14px', borderRadius: 10, background: 'var(--surface-2)',
            border: '1px solid var(--border)' }}>
            <div style={{ width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
              background: 'rgba(34,211,144,.15)', border: '1px solid rgba(34,211,144,.3)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 800, color: 'var(--green)' }}>
              {s.n}
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 3 }}>{s.title}</div>
              <div style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5 }}>{s.body}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Alert JSON */}
      <div style={{ borderRadius: 12, border: '1px solid var(--border)', overflow: 'hidden' }}>
        <div style={{ padding: '10px 14px', background: 'var(--surface-2)',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--muted)' }}>
            📝 Alert Message JSON
          </span>
          <CopyBtn text={json} label="📋 Copy JSON" />
        </div>
        <pre style={{ margin: 0, padding: '14px 16px', fontSize: 12, lineHeight: 1.6,
          fontFamily: 'monospace', color: 'var(--cyan)', background: 'rgba(0,0,0,.25)',
          overflowX: 'auto' }}>
          {json}
        </pre>
        <div style={{ padding: '8px 14px', background: 'var(--surface-2)',
          fontSize: 11, color: 'var(--muted)' }}>
          Supported actions: <code style={{ color:'var(--green)'}}>buy</code> · <code style={{color:'var(--red)'}}>sell</code> · <code style={{color:'var(--yellow)'}}>close</code>
          &nbsp;· Fields <code>stop</code>, <code>target</code>, <code>qty</code> are optional.
        </div>
      </div>

      {/* Quick test */}
      <div style={{ padding: '14px 16px', borderRadius: 12, background: 'var(--surface-2)',
        border: '1px solid var(--border)' }}>
        <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 10, color: 'var(--muted)' }}>
          🧪 Send Test Signal
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            value={testSym}
            onChange={e => setTestSym(e.target.value.toUpperCase())}
            placeholder="AAPL"
            style={{ width: 90, padding: '7px 10px', background: 'var(--bg)',
              border: '1px solid var(--border)', borderRadius: 7, color: 'var(--fg)',
              fontSize: 13, fontWeight: 700, textTransform: 'uppercase' }}
          />
          <select value={testAction} onChange={e => setTestAction(e.target.value as 'buy' | 'sell')}
            style={{ padding: '7px 10px', background: 'var(--bg)', border: '1px solid var(--border)',
              borderRadius: 7, color: 'var(--fg)', fontSize: 12 }}>
            <option value="buy">BUY</option>
            <option value="sell">SELL</option>
          </select>
          <button className="btn btn-primary btn-sm" onClick={handleTest} disabled={testing || !testSym}>
            {testing ? '⏳ Checking…' : '🔌 Check Worker'}
          </button>
          <span style={{ fontSize: 11, color: 'var(--muted)' }}>safe check — does not place an order</span>
        </div>
      </div>
    </div>
  );
}

// ── Signals Log Tab ───────────────────────────────────────────────────────────
function SignalsTab({ signals }: { signals: TVSignal[] }) {
  const [filter, setFilter] = useState<'all' | 'accepted' | 'rejected'>('all');

  const rows = signals.filter(s =>
    filter === 'all' ? true :
    filter === 'accepted' ? s.accepted :
    !s.accepted
  );

  if (signals.length === 0) return (
    <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--muted)' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📭</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>No signals received yet</div>
      <div style={{ fontSize: 12 }}>Configure TradingView with the webhook URL above, then trigger an alert.</div>
    </div>
  );

  return (
    <div>
      <div style={{ display: 'flex', gap: 6, marginBottom: 12 }}>
        {(['all', 'accepted', 'rejected'] as const).map(f => (
          <button key={f} className="btn btn-ghost btn-sm" onClick={() => setFilter(f)}
            style={{ textTransform: 'capitalize',
              background: filter === f ? 'rgba(34,211,144,.1)' : undefined,
              borderColor: filter === f ? 'var(--green-bdr)' : undefined,
              color: filter === f ? 'var(--green)' : undefined }}>
            {f} {f === 'all' ? `(${signals.length})` :
                 f === 'accepted' ? `(${signals.filter(s => s.accepted).length})` :
                 `(${signals.filter(s => !s.accepted).length})`}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: 'var(--muted)', alignSelf: 'center' }}>
          auto-refreshes every 30s
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Symbol</th>
              <th>Side</th>
              <th className="col-number">Entry</th>
              <th className="col-number">Stop</th>
              <th className="col-number">Target</th>
              <th className="col-number">Qty</th>
              <th>Mode</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(s => (
              <tr key={s.signalId}>
                <td style={{ fontSize: 11, color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                  {ago(s.createdAt)}
                  <div style={{ fontSize: 10 }}>{new Date(s.createdAt).toLocaleTimeString()}</div>
                </td>
                <td style={{ fontWeight: 800, fontSize: 14 }}>{s.symbol}</td>
                <td>
                  <span style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                    background: s.side === 'BUY' ? 'rgba(34,211,144,.15)' : 'rgba(255,105,115,.15)',
                    color: s.side === 'BUY' ? 'var(--green)' : 'var(--red)' }}>
                    {s.side}
                  </span>
                </td>
                <td className="col-number">{fmt(s.entry)}</td>
                <td className="col-number" style={{ color: 'var(--red)', fontSize: 12 }}>{fmt(s.stop)}</td>
                <td className="col-number" style={{ color: 'var(--green)', fontSize: 12 }}>{fmt(s.target)}</td>
                <td className="col-number" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {s.qty ?? '—'}
                </td>
                <td>
                  <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4,
                    background: s.mode === 'LIVE' ? 'rgba(255,105,115,.15)' : 'rgba(64,144,255,.15)',
                    color: s.mode === 'LIVE' ? 'var(--red)' : 'var(--blue)' }}>
                    {s.mode}
                  </span>
                </td>
                <td>
                  {s.accepted
                    ? <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--green)' }}>✓ Sent</span>
                    : <span style={{ fontSize: 11, color: 'var(--red)' }} title={s.rejectReason ?? ''}>
                        ✕ {s.rejectReason?.slice(0, 28) ?? 'Rejected'}
                      </span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Positions Tab ─────────────────────────────────────────────────────────────
function PositionsTab({ positions }: { positions: WbPosition[] }) {
  if (positions.length === 0) return (
    <div style={{ textAlign: 'center', padding: '50px 20px', color: 'var(--muted)' }}>
      <div style={{ fontSize: 36, marginBottom: 12 }}>📂</div>
      <div style={{ fontWeight: 700, fontSize: 15, marginBottom: 6 }}>No open positions</div>
      <div style={{ fontSize: 12 }}>Positions appear here after a BUY signal is accepted and executed on Webull.</div>
    </div>
  );

  const totalPnl = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
  const totalMv  = positions.reduce((s, p) => s + (p.marketValue ?? 0), 0);

  return (
    <div>
      {/* Summary */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap' }}>
        {[
          { label: 'OPEN POSITIONS', val: String(positions.length), color: 'var(--fg)' },
          { label: 'TOTAL P&L',   val: `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}$`,
            color: totalPnl >= 0 ? 'var(--green)' : 'var(--red)' },
          { label: 'MARKET VALUE', val: `$${totalMv.toFixed(0)}`, color: 'var(--fg)' },
        ].map(m => (
          <div key={m.label} style={{ flex: 1, minWidth: 90, padding: '8px 12px', borderRadius: 8,
            background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 2, letterSpacing: '.05em' }}>{m.label}</div>
            <div style={{ fontWeight: 800, fontSize: 16, color: m.color }}>{m.val}</div>
          </div>
        ))}
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th>Symbol</th>
              <th className="col-number">Qty</th>
              <th className="col-number">Avg Cost</th>
              <th className="col-number">Last</th>
              <th className="col-number">Mkt Value</th>
              <th className="col-number">P&L $</th>
              <th className="col-number">P&L %</th>
            </tr>
          </thead>
          <tbody>
            {positions.map(p => {
              const pnlColor = (p.unrealizedPnl ?? 0) >= 0 ? 'var(--green)' : 'var(--red)';
              return (
                <tr key={p.symbol}>
                  <td style={{ fontWeight: 800, fontSize: 14 }}>{p.symbol}</td>
                  <td className="col-number" style={{ fontSize: 12 }}>{p.quantity}</td>
                  <td className="col-number">{fmt(p.avgCost)}</td>
                  <td className="col-number" style={{ fontWeight: 700 }}>{fmt(p.lastPrice)}</td>
                  <td className="col-number" style={{ fontSize: 12, color: 'var(--muted)' }}>
                    {fmt(p.marketValue, 0)}
                  </td>
                  <td className="col-number" style={{ color: pnlColor, fontWeight: 700 }}>
                    {(p.unrealizedPnl ?? 0) >= 0 ? '+' : ''}{(p.unrealizedPnl ?? 0).toFixed(2)}
                  </td>
                  <td className="col-number" style={{ color: pnlColor }}>
                    {fmtPct(p.unrealizedPnlPct)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SignalsPage({ mode, showToast }: Props) {
  const { signals, dashboard, loading, error, reload } = useSignals(mode);
  const [tab, setTab] = useState<'setup' | 'signals' | 'positions'>('setup');

  const positions  = dashboard?.positions ?? [];
  const safety     = dashboard?.safety;
  const account    = dashboard?.account;
  const accepted   = signals.filter(s => s.accepted).length;
  const rejected   = signals.filter(s => !s.accepted).length;
  const totalPnl   = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>📡 TradingView Signals</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            Webhook bridge · {mode} mode ·{' '}
            {loading ? 'loading…' : `${signals.length} signals received`}
          </div>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={reload} disabled={loading}
          style={{ fontSize: 12 }}>
          {loading ? '⏳' : '↻'} Refresh
        </button>
      </div>

      {/* Safety + account status row */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
        {[
          {
            label: 'KILL SWITCH',
            val: safety?.killSwitch ? '🔴 ENGAGED' : '🟢 ARMED',
            color: safety?.killSwitch ? 'var(--red)' : 'var(--green)',
          },
          {
            label: 'WEBULL',
            val: safety?.webullConnected ? '✓ Connected' : '✕ Not connected',
            color: safety?.webullConnected ? 'var(--green)' : 'var(--muted)',
          },
          {
            label: 'BUYING POWER',
            val: account?.buyingPower ? `$${account.buyingPower.toFixed(0)}` : '—',
            color: 'var(--cyan)',
          },
          {
            label: 'SIGNALS IN',
            val: String(signals.length),
            color: 'var(--fg)',
          },
          {
            label: 'ACCEPTED',
            val: String(accepted),
            color: accepted > 0 ? 'var(--green)' : 'var(--muted)',
          },
          {
            label: 'OPEN P&L',
            val: positions.length ? `${totalPnl >= 0 ? '+' : ''}${totalPnl.toFixed(2)}$` : '—',
            color: totalPnl >= 0 ? 'var(--green)' : 'var(--red)',
          },
        ].map(m => (
          <div key={m.label} style={{ flex: 1, minWidth: 80, padding: '8px 12px', borderRadius: 8,
            background: 'var(--surface-2)', border: '1px solid var(--border)' }}>
            <div style={{ fontSize: 9, color: 'var(--muted)', marginBottom: 2, letterSpacing: '.05em' }}>
              {m.label}
            </div>
            <div style={{ fontWeight: 800, fontSize: 14, color: m.color }}>{m.val}</div>
          </div>
        ))}
      </div>

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, color: 'var(--red)',
          fontSize: 12, marginBottom: 14 }}>{error}</div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 2, marginBottom: 14,
        borderBottom: '1px solid var(--border)', overflowX: 'auto' }}>
        {([
          { id: 'setup',     label: '⚙ Setup TradingView' },
          { id: 'signals',   label: `📋 Signals (${signals.length})` },
          { id: 'positions', label: `📂 Positions (${positions.length})` },
        ] as { id: typeof tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 14px', fontSize: 12, fontWeight: 600, border: 'none',
              cursor: 'pointer', background: 'transparent', whiteSpace: 'nowrap',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--muted)', marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
        {rejected > 0 && (
          <span style={{ alignSelf: 'center', marginLeft: 6, fontSize: 11,
            color: 'var(--red)', fontWeight: 600 }}>
            ⚠ {rejected} rejected
          </span>
        )}
      </div>

      {tab === 'setup'     && <SetupTab showToast={showToast} />}
      {tab === 'signals'   && <SignalsTab signals={signals} />}
      {tab === 'positions' && <PositionsTab positions={positions} />}
    </div>
  );
}
