// MOE-AI System Health Page
import { useSystemHealth, useLiveReadiness } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

export default function SystemPage({ }: Props) {
  const { data: health, loading, refresh } = useSystemHealth(60_000);
  const { data: readiness } = useLiveReadiness(60_000);

  const h = health as Record<string, unknown> ?? {};

  const rows = [
    { k: 'Cloudflare Worker',      ok: h.cloudflareOk as boolean,      v: h.workerVersion ? `v${h.workerVersion}` : 'متصل' },
    { k: 'Webull API',             ok: h.webullOk as boolean,          v: String(h.webullMode ?? '—') },
    { k: 'قاعدة البيانات D1',     ok: h.databaseOk as boolean,        v: 'Cloudflare D1' },
    { k: 'الإشعارات',              ok: h.notificationsOk as boolean,   v: 'Push Service' },
    { k: 'الطوابير (Queues)',      ok: h.queuesOk as boolean,          v: 'Cloudflare Queues' },
    { k: 'بيانات السوق',           ok: (h as Record<string,unknown>).marketDataOk as boolean, v: 'Finnhub / Alpaca' },
  ] as { k: string; ok: boolean | undefined; v: string }[];

  const counters = [
    { k: 'الأخطاء',    v: (h.errorCount   as number) ?? 0, bad: true },
    { k: 'التحذيرات',  v: (h.warningCount as number) ?? 0, bad: false },
  ];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">حالة النظام</div>
          <div className="page-sub">Cloudflare Infrastructure · MOE-AI</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻ تحديث</button>
        </div>
      </div>

      {/* Counters */}
      <div className="grid-4" style={{ marginBottom: 14 }}>
        {counters.map(c => (
          <div key={c.k} className="metric-card">
            <div className="metric-label">{c.k}</div>
            <div className={`metric-value ${c.v > 0 && c.bad ? 'loss' : 'neutral'}`}>{c.v}</div>
          </div>
        ))}
        <div className="metric-card">
          <div className="metric-label">آخر مسح</div>
          <div className="metric-value neutral" style={{ fontSize: 14 }}>
            {h.lastScanAt ? new Date(h.lastScanAt as string).toLocaleTimeString('ar-SA') : '—'}
          </div>
        </div>
        <div className="metric-card">
          <div className="metric-label">آخر أمر</div>
          <div className="metric-value neutral" style={{ fontSize: 14 }}>
            {h.lastOrderAt ? new Date(h.lastOrderAt as string).toLocaleTimeString('ar-SA') : '—'}
          </div>
        </div>
      </div>

      {/* Service status */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>حالة الخدمات</div>
        {loading && !health
          ? <div className="empty"><span className="spinner" /></div>
          : rows.map(r => (
            <div key={r.k} className="health-row">
              <span className={`dot ${r.ok ? 'green' : r.ok === false ? 'red' : 'yellow'}`} />
              <div>
                <div className="health-label">{r.k}</div>
                <div className="health-detail">{r.v}</div>
              </div>
              <span className={`badge ${r.ok ? 'badge-green' : r.ok === false ? 'badge-red' : 'badge-yellow'}`}>
                {r.ok ? 'يعمل' : r.ok === false ? 'خطأ' : 'غير معروف'}
              </span>
            </div>
          ))}
      </div>

      {/* Live readiness */}
      <div className="card">
        <div className="panel-title" style={{ marginBottom: 12 }}>جاهزية التداول الحقيقي</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span className={`dot ${readiness?.ready ? 'green' : 'red'}`} style={{ width: 14, height: 14 }} />
          <span style={{ fontSize: 16, fontWeight: 800 }}>
            {readiness?.ready ? '✓ النظام جاهز للتداول الحقيقي' : '✗ النظام غير جاهز للتداول الحقيقي'}
          </span>
        </div>
        {(readiness?.missingSecrets ?? []).length > 0 && (
          <div style={{ padding: 12, background: 'var(--red-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--red-bdr)', marginBottom: 12 }}>
            <div style={{ color: 'var(--red)', fontWeight: 700, marginBottom: 8 }}>مفاتيح API مفقودة في Cloudflare Secrets:</div>
            {readiness!.missingSecrets!.map(s => (
              <div key={s} style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>• {s}</div>
            ))}
          </div>
        )}
        {readiness?.gates && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
            {Object.entries(readiness.gates).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px', background: 'var(--surface-2)', borderRadius: 8, border: `1px solid ${v?'var(--green-bdr)':'var(--red-bdr)'}` }}>
                <span className={`dot ${v?'green':'red'}`} />
                <span style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>{k}</span>
                <span style={{ fontSize: 10, color: v?'var(--green)':'var(--red)' }}>{v?'✓':'✗'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
