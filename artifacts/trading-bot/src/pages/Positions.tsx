// MOE-AI Positions Page
import { useDashboard } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';
import type { Position } from '../lib/types';

const fmt    = (v?: number) => Number.isFinite(v) ? `$${v!.toFixed(2)}` : '—';
const fmtNum = (v?: number, d = 0) => Number.isFinite(v) ? v!.toFixed(d) : '—';

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

export default function PositionsPage({ mode }: Props) {
  const { data, loading, error, refresh } = useDashboard(mode, 15_000);
  const positions: Position[] = data?.positions ?? [];
  const totalPnl = positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">الصفقات المفتوحة</div>
          <div className="page-sub">{positions.length} صفقة نشطة · {mode}</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻ تحديث</button>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor: 'var(--red-bdr)', color: 'var(--red)', marginBottom: 14 }}>خطأ: {error}</div>}

      {/* Summary */}
      <div className="grid-4" style={{ marginBottom: 14 }}>
        <div className="metric-card">
          <div className="metric-label">إجمالي الصفقات</div>
          <div className="metric-value neutral">{positions.length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">الربح/الخسارة الكلي</div>
          <div className={`metric-value ${totalPnl >= 0 ? 'profit' : 'loss'}`}>{fmt(totalPnl)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">القيمة السوقية</div>
          <div className="metric-value neutral">{fmt(positions.reduce((s, p) => s + (p.marketValue ?? 0), 0))}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">متوسط الربح</div>
          <div className={`metric-value ${totalPnl >= 0 ? 'profit' : 'loss'}`}>
            {positions.length ? `${(positions.reduce((s,p)=>s+(p.pnlPercent??0),0)/positions.length).toFixed(2)}%` : '—'}
          </div>
        </div>
      </div>

      {/* Positions */}
      {loading && !data
        ? <div className="card"><div className="empty"><span className="spinner" /></div></div>
        : positions.length === 0
        ? <div className="card"><div className="empty">لا توجد صفقات مفتوحة في وضع {mode}</div></div>
        : positions.map((p: Position) => (
          <div key={p.id} className="card" style={{ marginBottom: 10 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 12, marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 22, fontWeight: 900 }}>{p.symbol}</div>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{p.company ?? ''}</div>
                </div>
                <span className={`badge ${p.side === 'LONG' ? 'badge-green' : 'badge-red'}`}>{p.side}</span>
              </div>
              <div style={{ textAlign: 'left' }}>
                <div style={{ fontSize: 20, fontWeight: 900, color: p.unrealizedPnl >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {fmt(p.unrealizedPnl)}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>
                  {p.pnlPercent >= 0 ? '+' : ''}{p.pnlPercent?.toFixed(2)}%
                </div>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6,1fr)', gap: 10 }}>
              {[
                { k: 'الكمية',     v: fmtNum(p.quantity) },
                { k: 'الدخول',    v: fmt(p.averagePrice) },
                { k: 'السعر الحالي', v: fmt(p.currentPrice) },
                { k: 'وقف الخسارة', v: fmt(p.stopLoss) },
                { k: 'الهدف',     v: fmt(p.takeProfit) },
                { k: 'القيمة',    v: fmt(p.marketValue) },
              ].map(item => (
                <div key={item.k} style={{ background: 'var(--surface-2)', borderRadius: 8, padding: '8px 12px' }}>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{item.k}</div>
                  <div style={{ fontWeight: 800, fontSize: 13 }}>{item.v}</div>
                </div>
              ))}
            </div>

            {p.entryReason && (
              <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted)', background: 'var(--surface-2)', borderRadius: 8, padding: '10px 14px' }}>
                <b style={{ color: 'var(--text)', marginLeft: 6 }}>السبب:</b>{p.entryReason}
              </div>
            )}
          </div>
        ))}
    </div>
  );
}
