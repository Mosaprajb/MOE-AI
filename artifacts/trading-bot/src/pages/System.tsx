// MOE-AI System Page — webhook setup + service health
import { useState } from 'react';
import { useSystemHealth, useLiveReadiness } from '../hooks/useApi';
import { API_BASE } from '../lib/config';
import type { TradingMode } from '../lib/config';

const WORKER_URL = 'https://moerand-alerts.mosaprajb.workers.dev';
const WEBHOOK_URL = `${WORKER_URL}/api/tradingview/webhook`;

const ALERT_PAYLOAD = `{
  "secret":  "{{your-MOE_WEBHOOK_SECRET}}",
  "symbol":  "{{ticker}}",
  "action":  "{{strategy.order.action}}",
  "qty":     10,
  "price":   {{close}},
  "stop":    {{low}},
  "target":  0
}`;

interface Props { mode: TradingMode; showToast: (msg: string, t?: 'success'|'error') => void; }

export default function SystemPage({ showToast }: Props) {
  const { data: health, loading, refresh } = useSystemHealth(60_000);
  const { data: readiness } = useLiveReadiness(60_000);
  const [copied, setCopied] = useState<'url' | 'payload' | null>(null);

  const h = (health ?? {}) as Record<string, unknown>;
  const tradingMode = typeof h.tradingMode === 'string' ? h.tradingMode : null;

  const copy = async (text: string, which: 'url' | 'payload') => {
    await navigator.clipboard.writeText(text);
    setCopied(which);
    showToast('Copied to clipboard ✓', 'success');
    setTimeout(() => setCopied(null), 2000);
  };

  const services = [
    { k: 'Cloudflare Worker', ok: h.cloudflareOk as boolean, v: h.workerVersion ? `v${h.workerVersion}` : 'Connected' },
    { k: 'Webull (Sandbox)',  ok: h.sandboxCredentials as boolean, v: h.sandboxCredentials ? 'Credentials set' : 'Credentials missing' },
    { k: 'Webull (Live)',     ok: h.liveCredentials as boolean,    v: h.liveCredentials    ? 'Credentials set' : 'Credentials missing' },
    { k: 'D1 Database',       ok: h.databaseOk as boolean,        v: 'Cloudflare D1 (trade history)' },
  ] as { k: string; ok: boolean | undefined; v: string }[];

  return (
    <div>
      <div className="page-header">
        <div>
          <div className="page-title">System</div>
          <div className="page-sub">TradingView webhook setup &amp; service health</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-ghost btn-sm" onClick={refresh}>↻ Refresh</button>
        </div>
      </div>

      {/* ── TradingView Webhook URL ─────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 14, borderColor: 'var(--green-bdr)' }}>
        <div className="panel-title" style={{ marginBottom: 14 }}>TradingView Webhook Setup</div>

        <div style={{ marginBottom: 20 }}>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Step 1 — Webhook URL (paste into TradingView alert)
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <div style={{
              flex: 1, padding: '12px 16px', background: 'var(--surface-2)',
              border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)',
              fontFamily: 'monospace', fontSize: 13, color: 'var(--cyan)',
              wordBreak: 'break-all',
            }}>
              {WEBHOOK_URL}
            </div>
            <button className="btn btn-primary btn-sm" style={{ flexShrink: 0 }}
              onClick={() => copy(WEBHOOK_URL, 'url')}>
              {copied === 'url' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
        </div>

        <div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            Step 2 — Alert Message JSON (paste into TradingView alert message box)
          </div>
          <div style={{ position: 'relative' }}>
            <pre style={{
              background: 'var(--surface-2)', border: '1px solid var(--border)',
              borderRadius: 'var(--radius-sm)', padding: '14px 16px',
              fontSize: 12, lineHeight: 1.7, color: 'var(--text)',
              fontFamily: 'monospace', overflow: 'auto',
            }}>
              {ALERT_PAYLOAD}
            </pre>
            <button
              className="btn btn-ghost btn-sm"
              style={{ position: 'absolute', top: 8, right: 8 }}
              onClick={() => copy(ALERT_PAYLOAD, 'payload')}>
              {copied === 'payload' ? '✓ Copied' : 'Copy'}
            </button>
          </div>
          <div style={{ marginTop: 10, padding: '10px 14px', background: 'var(--blue-bg)', border: '1px solid var(--blue-bdr)', borderRadius: 'var(--radius-sm)', fontSize: 12, color: 'var(--muted)', lineHeight: 1.7 }}>
            <b style={{ color: 'var(--cyan)' }}>Field notes:</b><br />
            • <b>action</b> — TradingView built-in: <code style={{ color: 'var(--cyan)' }}>{'{{strategy.order.action}}'}</code> outputs <code>buy</code> or <code>sell</code><br />
            • <b>qty</b> — fixed integer (shares). Adjust per symbol.<br />
            • <b>stop / target</b> — optional. Sent to Webull as part of the order.<br />
            • <b>secret</b> — replace with your <code style={{ color: 'var(--cyan)' }}>MOE_WEBHOOK_SECRET</code> from Cloudflare Secrets.<br />
            • Trading mode (Demo / Live) is controlled by the <b>DEMO / LIVE</b> toggle in the top bar.
          </div>
        </div>
      </div>

      {/* ── Service Status ─────────────────────────────────────────────── */}
      <div className="card" style={{ marginBottom: 14 }}>
        <div className="panel-title" style={{ marginBottom: 12 }}>Service Status</div>
        {loading && !health
          ? <div className="empty"><span className="spinner" /></div>
          : services.map(r => (
            <div key={r.k} className="health-row">
              <span className={`dot ${r.ok ? 'green' : r.ok === false ? 'red' : 'yellow'}`} />
              <div style={{ flex: 1 }}>
                <div className="health-label">{r.k}</div>
                <div className="health-detail">{r.v}</div>
              </div>
              <span className={`badge ${r.ok ? 'badge-green' : r.ok === false ? 'badge-red' : 'badge-yellow'}`}>
                {r.ok ? 'OK' : r.ok === false ? 'Error' : 'Unknown'}
              </span>
            </div>
          ))}

        {h.killSwitch !== undefined && (
          <div className="health-row">
            <span className={`dot ${h.killSwitch ? 'red' : 'green'}`} />
            <div style={{ flex: 1 }}>
              <div className="health-label">Kill Switch</div>
              <div className="health-detail">Worker-side state (from KV)</div>
            </div>
            <span className={`badge ${h.killSwitch ? 'badge-red' : 'badge-green'}`}>
              {h.killSwitch ? 'Engaged' : 'Disarmed'}
            </span>
          </div>
        )}

        {tradingMode && (
          <div className="health-row">
            <span className={`dot ${tradingMode === 'LIVE' ? 'red' : 'green'}`} />
            <div style={{ flex: 1 }}>
              <div className="health-label">Trading Mode</div>
              <div className="health-detail">Active account for webhook execution</div>
            </div>
            <span className={`badge ${tradingMode === 'LIVE' ? 'badge-red' : 'badge-green'}`}>
              {tradingMode}
            </span>
          </div>
        )}
      </div>

      {/* ── Live readiness ─────────────────────────────────────────────── */}
      <div className="card">
        <div className="panel-title" style={{ marginBottom: 12 }}>Live Trading Readiness</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <span className={`dot ${readiness?.ready ? 'green' : 'red'}`} style={{ width: 14, height: 14 }} />
          <span style={{ fontSize: 16, fontWeight: 800 }}>
            {readiness?.ready ? '✓ System ready for live trading' : '✗ Not ready for live trading'}
          </span>
        </div>

        {(readiness?.missingSecrets ?? []).length > 0 && (
          <div style={{ padding: 12, background: 'var(--red-bg)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--red-bdr)', marginBottom: 14 }}>
            <div style={{ color: 'var(--red)', fontWeight: 700, marginBottom: 8 }}>Missing Cloudflare Secrets:</div>
            {readiness!.missingSecrets!.map(s => (
              <div key={s} style={{ fontSize: 12, color: 'var(--muted)', marginTop: 4, fontFamily: 'monospace' }}>• {s}</div>
            ))}
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--muted)' }}>
              Set these via: <code style={{ color: 'var(--cyan)' }}>wrangler secret put {'{SECRET_NAME}'}</code>
            </div>
          </div>
        )}

        {readiness?.gates && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,1fr)', gap: 8 }}>
            {Object.entries(readiness.gates).map(([k, v]) => (
              <div key={k} style={{
                display: 'flex', alignItems: 'center', gap: 8, padding: '8px 12px',
                background: 'var(--surface-2)', borderRadius: 8,
                border: `1px solid ${v ? 'var(--green-bdr)' : 'var(--red-bdr)'}`,
              }}>
                <span className={`dot ${v ? 'green' : 'red'}`} />
                <span style={{ fontSize: 11, fontWeight: 700, flex: 1 }}>{k.replace(/([A-Z])/g, ' $1').trim()}</span>
                <span style={{ fontSize: 10, color: v ? 'var(--green)' : 'var(--red)' }}>{v ? '✓' : '✗'}</span>
              </div>
            ))}
          </div>
        )}

        <div style={{ marginTop: 14, fontSize: 12, color: 'var(--muted)', padding: '10px 14px', background: 'var(--surface-2)', borderRadius: 'var(--radius-sm)' }}>
          Worker URL: <code style={{ color: 'var(--cyan)' }}>{API_BASE}</code>
        </div>
      </div>
    </div>
  );
}
