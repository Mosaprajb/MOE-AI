// MOE-AI Orders Page
import { useDashboard } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';
import type { Order } from '../lib/types';

const fmt    = (v: number | undefined) =>
  Number.isFinite(v) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v!) : '—';
const fmtNum = (v: number | undefined) => Number.isFinite(v) ? v!.toFixed(0) : '—';

const STATUS_CLASS: Record<string, string> = {
  OPEN:             'badge-green',
  FILLED:           'badge-green',
  SUBMITTED:        'badge-green',
  PENDING:          'badge-yellow',
  WORKING:          'badge-yellow',
  PARTIALLY_FILLED: 'badge-yellow',
  CANCELLED:        'badge-muted',
  EXPIRED:          'badge-muted',
  REJECTED:         'badge-red',
  FAILED:           'badge-red',
};

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

export default function OrdersPage({ mode }: Props) {
  const { data, loading, error, refresh, lastUpdated } = useDashboard(mode, 15_000);
  const orders: Order[] = data?.orders ?? [];

  const filled   = orders.filter(o => o.status === 'FILLED').length;
  const pending  = orders.filter(o => ['PENDING','WORKING','PARTIALLY_FILLED'].includes(o.status)).length;
  const buyCount = orders.filter(o => o.side === 'BUY').length;

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">Orders</div>
          <div className="page-sub">
            {loading && !data ? 'Loading…' : error ? `Error: ${error}` : lastUpdated ? `Updated ${lastUpdated.toLocaleTimeString()}` : 'Order history from Webull'}
          </div>
        </div>
        <div className="page-actions">
          <span className={`badge ${mode === 'LIVE' ? 'badge-red' : 'badge-green'}`}>{mode}</span>
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻ Refresh</button>
        </div>
      </div>

      <div className="grid-4" style={{ marginBottom: 14 }}>
        <div className="metric-card">
          <div className="metric-label">Total Orders</div>
          <div className="metric-value neutral">{orders.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Filled</div>
          <div className="metric-value profit">{filled}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Pending</div>
          <div className="metric-value neutral">{pending}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">Buy / Sell</div>
          <div className="metric-value neutral">{buyCount} / {orders.length - buyCount}</div>
        </div>
      </div>

      <div className="card">
        {loading && !data
          ? <div className="empty"><span className="spinner" /></div>
          : orders.length === 0
            ? (
              <div className="empty" style={{ padding: 48 }}>
                <div style={{ fontSize: 32, marginBottom: 12 }}>≡</div>
                <div style={{ fontWeight: 700, marginBottom: 6 }}>No orders yet</div>
                <div style={{ color: 'var(--muted)', fontSize: 13 }}>
                  Orders placed by TradingView alerts appear here
                </div>
              </div>
            )
            : (
              <div className="table-wrap">
                <table>
                  <thead><tr>
                    <th>Symbol</th>
                    <th>Side</th>
                    <th>Type</th>
                    <th>Qty</th>
                    <th>Price</th>
                    <th>Stop</th>
                    <th>Filled</th>
                    <th>Fill Price</th>
                    <th>Status</th>
                    <th>Time</th>
                  </tr></thead>
                  <tbody>
                    {orders.map((o: Order) => (
                      <tr key={o.id}>
                        <td className="col-symbol">{o.symbol}</td>
                        <td>
                          <span className={`badge ${o.side === 'BUY' ? 'badge-green' : 'badge-red'}`}>{o.side}</span>
                        </td>
                        <td><span className="badge badge-muted">{o.type}</span></td>
                        <td className="col-number">{fmtNum(o.quantity)}</td>
                        <td className="col-number">{fmt(o.price)}</td>
                        <td className="col-number">{fmt(o.stopPrice)}</td>
                        <td className="col-number">{fmtNum(o.filled)}</td>
                        <td className="col-number">{fmt(o.avgFillPrice)}</td>
                        <td>
                          <span className={`badge ${STATUS_CLASS[o.status?.toUpperCase()] ?? 'badge-muted'}`}>
                            {o.status}
                          </span>
                        </td>
                        <td style={{ color: 'var(--muted)', fontSize: 11 }}>
                          {new Date(o.createdAt).toLocaleString()}
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
