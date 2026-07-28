// MOE-AI Trade History Page
import { useState } from 'react';
import { useTrades } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';

const fmt = (v?: number) => Number.isFinite(v) ? `$${v!.toFixed(2)}` : '—';

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

export default function TradesPage({ mode }: Props) {
  const { data: trades, loading, error, refresh } = useTrades(mode, 30_000);
  const [filter, setFilter] = useState<'ALL'|'OPEN'|'CLOSED'>('ALL');

  const filtered = (trades ?? []).filter(t => filter === 'ALL' || t.status === filter);
  const closed   = (trades ?? []).filter(t => t.status === 'CLOSED');
  const wins     = closed.filter(t => (t.pnl ?? 0) > 0).length;
  const totalPnl = closed.reduce((s, t) => s + (t.pnl ?? 0), 0);

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">سجل التداول</div>
          <div className="page-sub">{(trades ?? []).length} عملية · {mode}</div>
        </div>
        <div className="page-actions">
          {(['ALL','OPEN','CLOSED'] as const).map(f => (
            <button key={f} className={`btn btn-sm ${filter===f?'btn-primary':'btn-ghost'}`}
              onClick={() => setFilter(f)}>{f==='ALL'?'الكل':f==='OPEN'?'مفتوح':'مغلق'}</button>
          ))}
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid-4" style={{ marginBottom: 14 }}>
        <div className="metric-card">
          <div className="metric-label">إجمالي الصفقات</div>
          <div className="metric-value neutral">{(trades ?? []).length}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">ربح/خسارة كلي</div>
          <div className={`metric-value ${totalPnl >= 0 ? 'profit' : 'loss'}`}>{fmt(totalPnl)}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">نسبة الفوز</div>
          <div className="metric-value neutral">{closed.length ? `${((wins/closed.length)*100).toFixed(1)}%` : '—'}</div>
        </div>
        <div className="metric-card">
          <div className="metric-label">صفقات منغلقة</div>
          <div className="metric-value neutral">{closed.length}</div>
        </div>
      </div>

      {error && <div className="card" style={{ borderColor:'var(--red-bdr)', color:'var(--red)', marginBottom:14 }}>خطأ: {error}</div>}

      <div className="card">
        {loading && !trades
          ? <div className="empty"><span className="spinner" /></div>
          : filtered.length === 0
          ? <div className="empty">لا توجد بيانات تداول</div>
          : (
            <div className="table-wrap">
              <table>
                <thead><tr>
                  <th>الرمز</th><th>الاتجاه</th><th>الكمية</th><th>الدخول</th><th>الخروج</th>
                  <th>الربح/الخسارة</th><th>%</th><th>الإشارة</th><th>النقاط</th><th>الحالة</th><th>التاريخ</th>
                </tr></thead>
                <tbody>
                  {filtered.map(t => (
                    <tr key={t.id}>
                      <td className="col-symbol">{t.symbol}</td>
                      <td><span className={`badge ${t.side==='BUY'?'badge-green':'badge-red'}`}>{t.side}</span></td>
                      <td className="col-number">{t.quantity?.toFixed(0)}</td>
                      <td className="col-number">{fmt(t.entryPrice)}</td>
                      <td className="col-number">{fmt(t.exitPrice)}</td>
                      <td className={t.pnl !== undefined ? (t.pnl >= 0 ? 'col-profit' : 'col-loss') : ''}>
                        {fmt(t.pnl)}
                      </td>
                      <td style={{ color: t.pnlPct !== undefined ? (t.pnlPct >= 0 ? 'var(--green)' : 'var(--red)') : 'var(--muted)', fontSize: 12 }}>
                        {t.pnlPct !== undefined ? `${t.pnlPct >= 0?'+':''}${t.pnlPct?.toFixed(2)}%` : '—'}
                      </td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>{t.signal ?? '—'}</td>
                      <td className="col-number" style={{ color: 'var(--cyan)' }}>{t.score ?? '—'}</td>
                      <td><span className={`badge ${t.status==='OPEN'?'badge-green':t.status==='CLOSED'?'badge-muted':'badge-yellow'}`}>{t.status}</span></td>
                      <td style={{ fontSize: 11, color: 'var(--muted)' }}>
                        {new Date(t.openedAt).toLocaleDateString('ar-SA')}
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
