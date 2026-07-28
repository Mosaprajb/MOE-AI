// MOE-AI Risk Management Page
import { useDashboard, useLiveReadiness } from '../hooks/useApi';
import type { TradingMode } from '../lib/config';

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

function RiskBar({ label, value, max, unit = '%', danger = 80, warn = 60 }: {
  label: string; value: number; max: number; unit?: string; danger?: number; warn?: number;
}) {
  const pct = Math.min((value / max) * 100, 100);
  const cls = pct >= danger ? 'danger' : pct >= warn ? 'warn' : '';
  return (
    <div className="risk-meter">
      <div className="risk-row">
        <span className="risk-label">{label}</span>
        <span className="risk-value" style={{ color: cls === 'danger' ? 'var(--red)' : cls === 'warn' ? 'var(--yellow)' : 'var(--green)' }}>
          {value.toFixed(2)}{unit} / {max}{unit}
        </span>
      </div>
      <div className="risk-bar">
        <div className={`risk-fill ${cls}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function RiskPage({ mode }: Props) {
  const { data } = useDashboard(mode, 30_000);
  const { data: readiness } = useLiveReadiness(60_000);

  const risk    = data?.risk    ?? {};
  const safety  = data?.safety  ?? {};
  const positions = data?.positions ?? [];

  const openRisk = risk.openRiskPct  ?? 0;
  const dailyLoss = risk.dailyLossPct ?? 0;
  const heat = risk.portfolioHeat ?? 0;

  const gates = readiness?.gates ?? {};
  const missingSecrets = readiness?.missingSecrets ?? [];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">إدارة المخاطر</div>
          <div className="page-sub">نظام الحماية النشط · {mode}</div>
        </div>
        <div className="page-actions">
          <span className={`badge ${safety.killSwitch ? 'badge-red' : 'badge-green'}`}>
            {safety.killSwitch ? '🔴 Kill Switch مفعّل' : '🟢 Kill Switch معطّل'}
          </span>
        </div>
      </div>

      {/* Risk meters */}
      <div className="grid-2" style={{ marginBottom: 14 }}>
        <div className="card">
          <div className="panel-title" style={{ marginBottom: 12 }}>مستوى المخاطر الحالية</div>
          <RiskBar label="المخاطر المفتوحة" value={openRisk} max={risk.maxOpenRiskPct ?? 2} />
          <RiskBar label="الخسارة اليومية" value={dailyLoss} max={risk.maxDailyLossPct ?? 2} />
          <RiskBar label="حرارة المحفظة" value={heat} max={risk.maxPortfolioHeat ?? 6} />
          <RiskBar label="الصفقات المفتوحة" value={risk.openPositions ?? positions.length} max={risk.maxOpenPositions ?? 4} unit="" danger={90} warn={75} />
          <RiskBar label="صفقات اليوم" value={risk.dailyTrades ?? 0} max={risk.maxDailyTrades ?? 8} unit="" danger={90} warn={75} />
        </div>

        <div className="card">
          <div className="panel-title" style={{ marginBottom: 12 }}>حدود المخاطر المضبوطة</div>
          {[
            { k: 'أقصى صفقات مفتوحة',   v: `${risk.maxOpenPositions ?? 4}` },
            { k: 'أقصى صفقات يومية',    v: `${risk.maxDailyTrades ?? 8}` },
            { k: 'أقصى خسارة يومية',    v: `${risk.maxDailyLossPct ?? 2}%` },
            { k: 'أقصى مخاطر مفتوحة',   v: `${risk.maxOpenRiskPct ?? 2}%` },
            { k: 'أقصى حرارة محفظة',    v: `${risk.maxPortfolioHeat ?? 6}%` },
          ].map(item => (
            <div key={item.k} className="setting-row">
              <div className="setting-info"><b>{item.k}</b></div>
              <b style={{ color: 'var(--cyan)', fontWeight: 800 }}>{item.v}</b>
            </div>
          ))}
        </div>
      </div>

      {/* Safety gates */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>بوابات الأمان للتداول الحقيقي</div>
        {Object.entries(gates).length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 10 }}>
            {Object.entries(gates).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 12px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)', border: `1px solid ${v ? 'var(--green-bdr)' : 'var(--red-bdr)'}` }}>
                <span className={`dot ${v ? 'green' : 'red'}`} />
                <span style={{ fontSize: 11, fontWeight: 700 }}>{k}</span>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty">بوابات الأمان غير متاحة في هذا الوضع</div>
        )}
        {missingSecrets.length > 0 && (
          <div style={{ marginTop: 14, padding: 12, background: 'var(--red-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--red-bdr)' }}>
            <div style={{ color: 'var(--red)', fontWeight: 700, marginBottom: 8 }}>⚠ مفاتيح API مفقودة في Cloudflare:</div>
            {missingSecrets.map(s => (
              <div key={s} style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4 }}>• {s}</div>
            ))}
          </div>
        )}
      </div>

      {/* Open position risk detail */}
      {positions.length > 0 && (
        <div className="card">
          <div className="panel-title" style={{ marginBottom: 12 }}>تفاصيل مخاطر الصفقات المفتوحة</div>
          <div className="table-wrap">
            <table>
              <thead><tr>
                <th>الرمز</th><th>الاتجاه</th><th>الكمية</th><th>الدخول</th><th>وقف الخسارة</th><th>المخاطرة بالدولار</th><th>الربح/الخسارة</th>
              </tr></thead>
              <tbody>
                {positions.map(p => {
                  const risk$ = p.quantity * (p.averagePrice - (p.stopLoss ?? p.averagePrice * 0.98));
                  return (
                    <tr key={p.id}>
                      <td className="col-symbol">{p.symbol}</td>
                      <td><span className={`badge ${p.side==='LONG'?'badge-green':'badge-red'}`}>{p.side}</span></td>
                      <td className="col-number">{p.quantity.toFixed(0)}</td>
                      <td className="col-number">${p.averagePrice?.toFixed(2)}</td>
                      <td className="col-number" style={{ color: 'var(--red)' }}>${p.stopLoss?.toFixed(2) ?? '—'}</td>
                      <td className="col-number" style={{ color: 'var(--yellow)' }}>${risk$.toFixed(2)}</td>
                      <td className={p.unrealizedPnl >= 0 ? 'col-profit' : 'col-loss'}>${p.unrealizedPnl?.toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
