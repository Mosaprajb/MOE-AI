// MOE-AI Dashboard
import { useMemo } from 'react';
import { useDashboard, useDecisions } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';
import type { Position, Order, Decision } from '../lib/types';

const fmt    = (v: number | undefined, dec = 2) =>
  Number.isFinite(v) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dec }).format(v!) : '—';
const fmtPct = (v: number | undefined) => Number.isFinite(v) ? `${v! >= 0 ? '+' : ''}${v!.toFixed(2)}%` : '—';
const fmtNum = (v: number | undefined, dec = 0) => Number.isFinite(v) ? v!.toFixed(dec) : '—';

function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    OPEN: 'badge-green', FILLED: 'badge-green', SUBMITTED: 'badge-green',
    PENDING: 'badge-yellow', WORKING: 'badge-yellow',
    CANCELLED: 'badge-muted', REJECTED: 'badge-red', FAILED: 'badge-red',
    LONG: 'badge-green', SHORT: 'badge-red',
    BUY: 'badge-green', SELL: 'badge-red',
  };
  return <span className={`badge ${map[value?.toUpperCase()] ?? 'badge-muted'}`}>{value}</span>;
}

interface Props { mode: TradingMode; showToast: (msg: string, type?: 'success'|'error') => void; }

export default function DashboardPage({ mode }: Props) {
  const { data, loading, error, lastUpdated } = useDashboard(mode, 15_000);
  const { data: decisions } = useDecisions(15_000);

  const account   = data?.account   ?? {};
  const positions: Position[] = data?.positions ?? [];
  const orders:    Order[]    = data?.orders    ?? [];
  const safety    = data?.safety    ?? {};

  const openPnl   = useMemo(() => positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0), [positions]);
  const acceptedCount = useMemo(() => decisions?.filter((d: Decision) => d.accepted).length ?? 0, [decisions]);

  const metrics = [
    { label: 'Account Value',  value: fmt(account.accountValue),  sub: mode },
    { label: 'Buying Power',   value: fmt(account.buyingPower),   sub: 'Available' },
    { label: 'Day P&L',        value: fmtPct(account.dayPnl !== undefined ? (account.dayPnl / (account.accountValue ?? 1)) * 100 : undefined), sub: fmt(account.dayPnl), pnl: account.dayPnl },
    { label: 'Open P&L',       value: fmt(openPnl), sub: `${positions.length} position${positions.length !== 1 ? 's' : ''}`, pnl: openPnl },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">
            {loading && !data ? 'Loading…' : error ? `Error: ${error}` : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : ''}
          </div>
        </div>
        <div className="page-actions">
          <div className="conn-pill">
            <span className={`conn-dot ${safety.webullConnected ? 'live' : 'error'}`} />
            Webull {safety.webullMode ?? '—'}
          </div>
          <span className={`badge ${mode === 'LIVE' ? 'badge-red' : 'badge-green'}`}>{mode}</span>
        </div>
      </div>

      {/* Kill switch warning */}
      {safety.killSwitch && (
        <div className="card" style={{ background: 'var(--red-bg)', borderColor: 'var(--red-bdr)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔴</span>
          <div>
            <b style={{ color: 'var(--red)' }}>Kill Switch Engaged</b>
            <span style={{ color: 'var(--muted)', fontSize: 12, marginLeft: 8 }}>— no orders will execute until disarmed</span>
          </div>
        </div>
      )}

      {/* Metrics */}
      <div className="grid-4" style={{ marginBottom: 14 }}>
        {metrics.map(m => (
          <div key={m.label} className="metric-card">
            <div className="metric-label">{m.label}</div>
            <div className={`metric-value ${m.pnl !== undefined ? (m.pnl >= 0 ? 'profit' : 'loss') : 'neutral'}`}>
              {m.value}
            </div>
            <div className="metric-change" style={{ color: 'var(--muted)' }}>{m.sub}</div>
          </div>
        ))}
      </div>

      {/* TradingView signal log */}
      {decisions && decisions.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="panel-head">
            <div>
              <div className="panel-title">TradingView Signals</div>
              <div className="panel-subtitle">Recent alerts received</div>
            </div>
            <span className="panel-count">{acceptedCount} executed</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Symbol</th><th>Action</th><th>Entry</th><th>Stop</th><th>Target</th><th>Mode</th><th>Result</th><th>Time</th>
              </tr></thead>
              <tbody>
                {decisions.slice(0, 8).map((d: Decision) => (
                  <tr key={d.signalId}>
                    <td className="col-symbol">{d.symbol}</td>
                    <td><StatusBadge value={d.side ?? d.signal ?? '—'} /></td>
                    <td className="col-number">{fmt(d.entry)}</td>
                    <td className="col-number">{fmt(d.stop)}</td>
                    <td className="col-number">{fmt(d.target)}</td>
                    <td><span className={`badge ${d.mode === 'LIVE' ? 'badge-red' : 'badge-muted'}`}>{d.mode ?? '—'}</span></td>
                    <td>
                      <span className={`badge ${d.submitted ? 'badge-blue' : d.accepted ? 'badge-green' : 'badge-red'}`}>
                        {d.submitted ? 'Executed' : d.accepted ? 'Accepted' : 'Rejected'}
                      </span>
                    </td>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{new Date(d.createdAt).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-2-1" style={{ gap: 14 }}>
        {/* Open positions */}
        <div className="card">
          <div className="panel-head">
            <div>
              <div className="panel-title">Open Positions</div>
              <div className="panel-subtitle">Active trades via Webull</div>
            </div>
            <span className="panel-count">{positions.length}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>Symbol</th><th>Side</th><th>Qty</th><th>Avg Price</th><th>Cur Price</th><th>Stop</th><th>Target</th><th>P&amp;L</th>
              </tr></thead>
              <tbody>
                {positions.length === 0
                  ? <tr><td colSpan={8} className="empty">{loading && !data ? 'Loading…' : 'No open positions'}</td></tr>
                  : positions.map((p: Position) => (
                    <tr key={p.id}>
                      <td className="col-symbol">{p.symbol}</td>
                      <td><StatusBadge value={p.side} /></td>
                      <td className="col-number">{fmtNum(p.quantity)}</td>
                      <td className="col-number">{fmt(p.averagePrice)}</td>
                      <td className="col-number">{fmt(p.currentPrice)}</td>
                      <td className="col-number" style={{ color: 'var(--red)' }}>{fmt(p.stopLoss)}</td>
                      <td className="col-number" style={{ color: 'var(--green)' }}>{fmt(p.takeProfit)}</td>
                      <td><span className={p.unrealizedPnl >= 0 ? 'col-profit' : 'col-loss'}>{fmt(p.unrealizedPnl)}</span></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Active orders */}
        <div className="card">
          <div className="panel-head">
            <div>
              <div className="panel-title">Active Orders</div>
              <div className="panel-subtitle">Working orders</div>
            </div>
            <span className="panel-count">{orders.length}</span>
          </div>
          {orders.length === 0
            ? <div className="empty">{loading && !data ? 'Loading…' : 'No active orders'}</div>
            : orders.map((o: Order) => (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <b>{o.symbol}</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{o.side} · {o.type}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b>{fmtNum(o.quantity)} shares</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{fmt(o.price)}</div>
                </div>
                <StatusBadge value={o.status} />
              </div>
            ))}
        </div>
      </div>

      {/* Safety status */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div className="panel-title">Safety Status</div>
        </div>
        <div className="grid-4">
          {[
            { k: 'Webull',        v: safety.webullMode ?? '—',                             ok: safety.webullConnected },
            { k: 'Kill Switch',   v: safety.killSwitch ? 'Engaged' : 'Disarmed',           ok: !safety.killSwitch },
            { k: 'Mode',          v: safety.mode ?? mode,                                   ok: safety.mode === 'SANDBOX' },
            { k: 'Execution',     v: safety.executionAllowed ? 'Allowed' : 'Blocked',      ok: !!safety.executionAllowed },
          ].map(item => (
            <div key={item.k} style={{ padding: '12px 0' }}>
              <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 700 }}>{item.k}</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span className={`dot ${item.ok ? 'green' : 'red'}`} />
                <span style={{ fontWeight: 800 }}>{item.v}</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
