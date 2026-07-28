// MOE-AI Orders Page
import { useDashboard } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';
import type { Order } from '../lib/types';

const fmt = (v?: number) => Number.isFinite(v) ? `$${v!.toFixed(2)}` : '—';
const STATUS_MAP: Record<string, string> = {
  PENDING:'badge-yellow', OPEN:'badge-green', FILLED:'badge-green',
  PARTIALLY_FILLED:'badge-yellow', CANCELLED:'badge-muted',
  REJECTED:'badge-red', EXPIRED:'badge-muted',
};

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

export default function OrdersPage({ mode }: Props) {
  const { data, loading, error, refresh } = useDashboard(mode, 15_000);
  const orders: Order[] = data?.orders ?? [];

  const groups = orders.reduce<Record<string, Order[]>>((g, o) => {
    const k = ['OPEN','PENDING','PARTIALLY_FILLED'].includes(o.status) ? 'نشط' : 'مكتمل';
    (g[k] ??= []).push(o); return g;
  }, {});

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">الأوامر</div>
          <div className="page-sub">{orders.length} أمر · {mode}</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻ تحديث</button>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--red-bdr)', color: 'var(--red)', marginBottom: 14 }}>خطأ: {error}</div>}

      {loading && !data
        ? <div className="card"><div className="empty"><span className="spinner" /></div></div>
        : orders.length === 0
        ? <div className="card"><div className="empty">لا توجد أوامر في وضع {mode}</div></div>
        : Object.entries(groups).map(([group, groupOrders]) => (
          <div key={group} className="card" style={{ marginBottom: 14 }}>
            <div className="panel-head">
              <div className="panel-subtitle">{group}</div>
              <span className="panel-count">{groupOrders.length}</span>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>الرمز</th><th>الاتجاه</th><th>النوع</th><th>الكمية</th><th>السعر</th><th>المنفذ</th><th>الحالة</th><th>الوقت</th>
                </tr></thead>
                <tbody>
                  {groupOrders.map((o: Order) => (
                    <tr key={o.id}>
                      <td className="col-symbol">{o.symbol}</td>
                      <td><span className={`badge ${o.side==='BUY'?'badge-green':'badge-red'}`}>{o.side}</span></td>
                      <td style={{ color: 'var(--muted)', fontSize: 12 }}>{o.type}</td>
                      <td className="col-number">{o.quantity?.toFixed(0)}</td>
                      <td className="col-number">{fmt(o.price)}</td>
                      <td className="col-number">{fmt(o.avgFillPrice)}</td>
                      <td><span className={`badge ${STATUS_MAP[o.status]??'badge-muted'}`}>{o.status}</span></td>
                      <td style={{ color: 'var(--muted)', fontSize: 11 }}>
                        {o.createdAt ? new Date(o.createdAt).toLocaleString('ar-SA') : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
    </div>
  );
}
