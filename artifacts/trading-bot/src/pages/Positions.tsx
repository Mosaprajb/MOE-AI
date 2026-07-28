// MOE-AI Positions Page
import { useDashboard } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';
import type { Position } from '../lib/types';

const fmt    = (v: number | undefined) =>
  Number.isFinite(v) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v!) : '—';
const fmtPct = (v: number | undefined) =>
  Number.isFinite(v) ? `${v! >= 0 ? '+' : ''}${v!.toFixed(2)}%` : '—';
const fmtNum = (v: number | undefined) => Number.isFinite(v) ? v!.toFixed(0) : '—';

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

export default function PositionsPage({ mode }: Props) {
  const { data, loading, error, refresh, lastUpdated } = useDashboard(mode, 15_000);
  const positions: Position[] = data?.positions ?? [];

  const totalPnl  = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);
  const totalMkt  = positions.reduce((s, p) => s + (p.marketValue   ?? 0), 0);
  const longCount = positions.filter(p => p.side === 'LONG').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Positions</div>
          <div className="page-sub">
            {loading && !data ? 'Loading…' : error ? `Error: ${error}` : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Open positions via Webull'}
          </div>
        </div>
        <div className="page-actions">
          <span className={`badge ${mode === 'LIVE' ? 'badge-red' : 'badge-green'}`}>{mode}</span>
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻ Refresh</button>
        </div>
      </div>

      {/* Summary metrics */}
      <div className="grid-4" style={{ marginBottom: 14 }}>
        <div className="metric-card">
          <div className="metric-label">Open Positions</div>
          <div className="metric-value neutral">{positions.length}</div>
          <div className="metric-change">{longCount} long · {positions.length - longCount} short</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Market Value</div>
          <div className="metric-value neutral">{fmt(totalMkt)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Unrealized P&amp;L</div>
          <div className={`metric-value ${totalPnl >= 0 ? 'profit' : 'loss'}`}>{fmt(totalPnl)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Avg P&amp;L %</div>
          <div className={`metric-value ${totalPnl >= 0 ? 'profit' : 'loss'}`}>
            {fmtPct(positions.length ? positions.reduce((s, p) => s + (p.pnlPercent ?? 0), 0) / positions.length : undefined)}
          </div>
        </div>
      </div>

      <div className="card">
        {loading && !data
          ? <div className="empty"><span className="spinner" /></div>
          : positions.length === 0
            ? (
              <div className="empty" style={{ padding: 48 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>◈</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>No open positions</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  Positions appear here once TradingView alerts are executed on Webull
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
                    <th>Avg Price</th>
                    <th>Current Price</th>
                    <th>Market Value</th>
                    <th>Stop Loss</th>
                    <th>Take Profit</th>
                    <th>P&amp;L</th>
                    <th>P&amp;L %</th>
                  </tr></thead>
                  <tbody>
                    {positions.map((p: Position) => (
                      <tr key={p.id}>
                        <td className="col-symbol">{p.symbol}</td>
                        <td>
                          <span className={`badge ${p.side === 'LONG' ? 'badge-green' : 'badge-red'}`}>{p.side}</span>
                        </td>
                        <td className="col-number">{fmtNum(p.quantity)}</td>
                        <td className="col-number">{fmt(p.averagePrice)}</td>
                        <td className="col-number">{fmt(p.currentPrice)}</td>
                        <td className="col-number">{fmt(p.marketValue)}</td>
                        <td className="col-number" style={{ color: 'var(--red)' }}>{fmt(p.stopLoss) ?? '—'}</td>
                        <td className="col-number" style={{ color: 'var(--green)' }}>{fmt(p.takeProfit) ?? '—'}</td>
                        <td>
                          <span className={p.unrealizedPnl >= 0 ? 'col-profit' : 'col-loss'}>
                            {fmt(p.unrealizedPnl)}
                          </span>
                        </td>
                        <td>
                          <span className={p.pnlPercent >= 0 ? 'col-profit' : 'col-loss'}>
                            {fmtPct(p.pnlPercent)}
                          </span>
                        </td>
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
