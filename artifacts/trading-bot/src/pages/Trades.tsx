// MOE-AI Trade History Page
import { useTrades } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';
import type { Trade } from '../lib/types';

const fmt    = (v: number | undefined) =>
  Number.isFinite(v) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v!) : '—';
const fmtPct = (v: number | undefined) =>
  Number.isFinite(v) ? `${v! >= 0 ? '+' : ''}${v!.toFixed(2)}%` : '—';
const fmtNum = (v: number | undefined) => Number.isFinite(v) ? v!.toFixed(0) : '—';

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

export default function TradesPage({ mode }: Props) {
  const { data: trades, loading, error, refresh, lastUpdated } = useTrades(mode, 30_000);

  const list     = trades ?? [];
  const closed   = list.filter(t => t.status === 'CLOSED');
  const winners  = closed.filter(t => (t.pnl ?? 0) > 0);
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const winRate  = closed.length ? (winners.length / closed.length * 100) : 0;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Trade History</div>
          <div className="page-sub">
            {loading && !trades ? 'Loading…' : error ? `Error: ${error}` : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Closed trades from Webull'}
          </div>
        </div>
        <div className="page-actions">
          <span className={`badge ${mode === 'LIVE' ? 'badge-red' : 'badge-green'}`}>{mode}</span>
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻ Refresh</button>
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <div className="metric-card">
          <div className="metric-label">Total Trades</div>
          <div className="metric-value neutral">{list.length}</div>
          <div className="metric-change">{closed.length} closed</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Win Rate</div>
          <div className={`metric-value ${winRate >= 50 ? 'profit' : 'loss'}`}>
            {closed.length ? `${winRate.toFixed(1)}%` : '—'}
          </div>
          <div className="metric-change">{winners.length} winners</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Total P&amp;L</div>
          <div className={`metric-value ${totalPnl >= 0 ? 'profit' : 'loss'}`}>{fmt(totalPnl)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg P&amp;L</div>
          <div className={`metric-value ${totalPnl >= 0 ? 'profit' : 'loss'}`}>
            {closed.length ? fmt(totalPnl / closed.length) : '—'}
          </div>
        </div>
      </div>

      <div className="card">
        {loading && !trades
          ? <div className="empty"><span className="spinner" /></div>
          : list.length === 0
            ? (
              <div className="empty" style={{ padding: 48 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>⟳</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>No trades yet</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  Completed trades will appear here once your TradingView alerts start executing
                </div>
              </div>
            )
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Qty</th>
                    <th>Entry</th>
                    <th>Exit</th>
                    <th>P&amp;L</th>
                    <th>P&amp;L %</th>
                    <th>Status</th>
                    <th>Mode</th>
                    <th>Opened</th>
                    <th>Closed</th>
                  </tr></thead>
                  <tbody>
                    {list.map((t: Trade) => (
                      <tr key={t.id}>
                        <td className="col-symbol">{t.symbol}</td>
                        <td>
                          <span className={`badge ${t.side === 'BUY' ? 'badge-green' : 'badge-red'}`}>{t.side}</span>
                        </td>
                        <td className="col-number">{fmtNum(t.quantity)}</td>
                        <td className="col-number">{fmt(t.entryPrice)}</td>
                        <td className="col-number">{fmt(t.exitPrice)}</td>
                        <td>
                          <span className={(t.pnl ?? 0) >= 0 ? 'col-profit' : 'col-loss'}>
                            {fmt(t.pnl)}
                          </span>
                        </td>
                        <td>
                          <span className={(t.pnlPct ?? 0) >= 0 ? 'col-profit' : 'col-loss'}>
                            {fmtPct(t.pnlPct)}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${t.status === 'CLOSED' ? 'badge-muted' : t.status === 'OPEN' ? 'badge-green' : 'badge-red'}`}>
                            {t.status}
                          </span>
                        </td>
                        <td>
                          <span className={`badge ${t.mode === 'LIVE' ? 'badge-red' : 'badge-muted'}`}>{t.mode}</span>
                        </td>
                        <td style={{ color: 'var(--muted)', fontSize: 11 }}>{new Date(t.openedAt).toLocaleString()}</td>
                        <td style={{ color: 'var(--muted)', fontSize: 11 }}>{t.closedAt ? new Date(t.closedAt).toLocaleString() : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
      </div>
    </div>
  );
}
