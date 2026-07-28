// MOE-AI Dashboard Page
import { useMemo } from 'react';
import { useDashboard, useDecisions } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';
import type { Position, Order, Decision } from '../lib/types';

const fmt = (v: number | undefined, dec = 2) =>
  Number.isFinite(v) ? new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dec }).format(v!) : '—';
const fmtPct = (v: number | undefined) => Number.isFinite(v) ? `${v! >= 0 ? '+' : ''}${v!.toFixed(2)}%` : '—';
const fmtNum = (v: number | undefined, dec = 0) => Number.isFinite(v) ? v!.toFixed(dec) : '—';

function StatusBadge({ value }: { value: string }) {
  const map: Record<string, string> = {
    OPEN: 'badge-green', FILLED: 'badge-green', SUBMITTED: 'badge-green',
    PENDING: 'badge-yellow', WORKING: 'badge-yellow', RESERVED: 'badge-yellow',
    CANCELLED: 'badge-muted', REJECTED: 'badge-red', FAILED: 'badge-red',
    LONG: 'badge-green', SHORT: 'badge-red',
  };
  return <span className={`badge ${map[value?.toUpperCase()] ?? 'badge-muted'}`}>{value}</span>;
}

function PnlCell({ value }: { value: number }) {
  const cls = value >= 0 ? 'col-profit' : 'col-loss';
  return <span className={cls}>{fmt(value)}</span>;
}

interface Props { mode: TradingMode; showToast: (msg: string, type?: 'success' | 'error') => void; }

export default function DashboardPage({ mode }: Props) {
  const { data, loading, error, lastUpdated } = useDashboard(mode, 15_000);
  const { data: decisions } = useDecisions(10_000);

  const account  = data?.account  ?? {};
  const positions: Position[] = data?.positions ?? [];
  const orders:   Order[]    = data?.orders    ?? [];
  const safety   = data?.safety   ?? {};

  const openPnl  = useMemo(() => positions.reduce((s, p) => s + (p.unrealizedPnl ?? 0), 0), [positions]);
  const buyCount = useMemo(() => decisions?.filter((d: Decision) => d.accepted).length ?? 0, [decisions]);

  const metrics = [
    { label: 'قيمة الحساب',     value: fmt(account.accountValue),  sub: mode },
    { label: 'القدرة الشرائية',  value: fmt(account.buyingPower),   sub: 'Buying Power' },
    { label: 'ربح/خسارة اليوم', value: fmtPct(account.dayPnl !== undefined ? (account.dayPnl / (account.accountValue ?? 1)) * 100 : undefined), sub: fmt(account.dayPnl), pnl: account.dayPnl },
    { label: 'الربح/الخسارة المفتوح', value: fmt(openPnl), sub: `${positions.length} صفقة`, pnl: openPnl },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">لوحة القيادة</div>
          <div className="page-sub">
            {loading && !data ? 'جاري التحميل…' : error ? `خطأ: ${error}` : lastUpdated ? `آخر تحديث: ${lastUpdated.toLocaleTimeString('ar-SA')}` : ''}
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

      {/* Kill-switch warning */}
      {safety.killSwitch && (
        <div className="card" style={{ background: 'var(--red-bg)', borderColor: 'var(--red-bdr)', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 18 }}>🔴</span>
          <div>
            <b style={{ color: 'var(--red)' }}>Kill Switch مفعّل</b>
            <span style={{ color: 'var(--muted)', fontSize: 12, marginRight: 8 }}>— لن يتم تنفيذ أي أوامر حتى يتم إيقاف تشغيله</span>
          </div>
        </div>
      )}

      {/* Metric cards */}
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

      {/* Recent decisions */}
      {decisions && decisions.length > 0 && (
        <div className="card" style={{ marginBottom: 14 }}>
          <div className="panel-head">
            <div>
              <div className="panel-title">AI قرارات المحرك</div>
              <div className="panel-subtitle">آخر الإشارات</div>
            </div>
            <span className="panel-count">{buyCount} مقبول</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>الرمز</th><th>الإشارة</th><th>النقاط</th><th>الدخول</th><th>وقف الخسارة</th><th>الهدف</th><th>الحالة</th><th>الوقت</th>
              </tr></thead>
              <tbody>
                {decisions.slice(0, 8).map((d: Decision) => (
                  <tr key={d.signalId}>
                    <td className="col-symbol">{d.symbol}</td>
                    <td>{d.signal ?? d.side ?? '—'}</td>
                    <td className="col-number">{fmtNum(d.score)}</td>
                    <td className="col-number">{fmt(d.entry)}</td>
                    <td className="col-number">{fmt(d.stop)}</td>
                    <td className="col-number">{fmt(d.target)}</td>
                    <td><span className={`badge ${d.submitted ? 'badge-blue' : d.accepted ? 'badge-green' : 'badge-red'}`}>{d.submitted ? 'مُرسَل' : d.accepted ? 'مقبول' : 'مرفوض'}</span></td>
                    <td style={{ color: 'var(--muted)', fontSize: 11 }}>{new Date(d.createdAt).toLocaleTimeString('ar-SA')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="grid-2-1" style={{ gap: 14 }}>
        {/* Positions table */}
        <div className="card">
          <div className="panel-head">
            <div>
              <div className="panel-title">Webull Execution</div>
              <div className="panel-subtitle">الصفقات المفتوحة</div>
            </div>
            <span className="panel-count">{positions.length}</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>الرمز</th><th>الاتجاه</th><th>الكمية</th><th>الدخول</th><th>السعر الحالي</th><th>وقف الخسارة</th><th>الهدف</th><th>الربح/الخسارة</th>
              </tr></thead>
              <tbody>
                {positions.length === 0
                  ? <tr><td colSpan={8} className="empty">{loading && !data ? 'جاري التحميل…' : 'لا توجد صفقات مفتوحة'}</td></tr>
                  : positions.map((p: Position) => (
                    <tr key={p.id}>
                      <td className="col-symbol">{p.symbol}</td>
                      <td><StatusBadge value={p.side} /></td>
                      <td className="col-number">{fmtNum(p.quantity)}</td>
                      <td className="col-number">{fmt(p.averagePrice)}</td>
                      <td className="col-number">{fmt(p.currentPrice)}</td>
                      <td className="col-number" style={{ color: 'var(--red)' }}>{fmt(p.stopLoss)}</td>
                      <td className="col-number" style={{ color: 'var(--green)' }}>{fmt(p.takeProfit)}</td>
                      <td><PnlCell value={p.unrealizedPnl} /></td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Orders */}
        <div className="card">
          <div className="panel-head">
            <div>
              <div className="panel-title">الأوامر</div>
              <div className="panel-subtitle">الأوامر النشطة</div>
            </div>
            <span className="panel-count">{orders.length}</span>
          </div>
          {orders.length === 0
            ? <div className="empty">{loading && !data ? 'جاري التحميل…' : 'لا توجد أوامر نشطة'}</div>
            : orders.map((o: Order) => (
              <div key={o.id} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 10, padding: '12px 0', borderBottom: '1px solid var(--border)' }}>
                <div>
                  <b>{o.symbol}</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{o.side} · {o.type}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <b>{fmtNum(o.quantity)} سهم</b>
                  <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 3 }}>{fmt(o.price)}</div>
                </div>
                <StatusBadge value={o.status} />
              </div>
            ))}
        </div>
      </div>

      {/* Safety state */}
      <div className="card" style={{ marginTop: 14 }}>
        <div className="panel-head">
          <div className="panel-title">حالة الأمان</div>
        </div>
        <div className="grid-4">
          {[
            { k: 'وضع Webull', v: safety.webullMode ?? '—', ok: safety.webullConnected },
            { k: 'Kill Switch', v: safety.killSwitch ? 'مفعّل' : 'معطّل', ok: !safety.killSwitch },
            { k: 'وضع التداول', v: safety.mode ?? mode, ok: safety.mode === 'SANDBOX' },
            { k: 'التنفيذ', v: safety.executionAllowed ? 'مسموح' : 'محظور', ok: !safety.executionAllowed },
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
