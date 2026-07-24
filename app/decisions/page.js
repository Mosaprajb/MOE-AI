'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { BACKGROUND_ALERTS_URL } from '../../lib/backgroundAlerts';

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : '—';
}

function numberOrDash(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

function statusLabel(item) {
  if (item.submitted) return 'SANDBOX SUBMITTED';
  if (item.accepted) return 'ACCEPTED';
  return 'REJECTED';
}

export default function DecisionsPage() {
  const [decisions, setDecisions] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [filter, setFilter] = useState('ALL');

  const load = useCallback(async () => {
    try {
      setError('');
      const response = await fetch(`${BACKGROUND_ALERTS_URL}/api/tradingview/decisions?limit=100`, {
        method: 'GET',
        mode: 'cors',
        cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Decision service returned ${response.status}`);
      setDecisions(Array.isArray(payload.decisions) ? payload.decisions : []);
      setUpdatedAt(new Date());
      setStatus('ready');
    } catch (loadError) {
      setError(loadError.message || 'Could not load decision history');
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
    const timer = window.setInterval(load, 15_000);
    return () => window.clearInterval(timer);
  }, [load]);

  const visible = useMemo(() => decisions.filter((item) => {
    if (filter === 'ACCEPTED') return item.accepted;
    if (filter === 'REJECTED') return !item.accepted;
    if (filter === 'SUBMITTED') return item.submitted;
    return true;
  }), [decisions, filter]);

  const totals = useMemo(() => ({
    all: decisions.length,
    accepted: decisions.filter((item) => item.accepted).length,
    rejected: decisions.filter((item) => !item.accepted).length,
    submitted: decisions.filter((item) => item.submitted).length,
  }), [decisions]);

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>MOE AI · TRADINGVIEW</p>
            <h1 style={styles.title}>Decision History</h1>
            <p style={styles.subtitle}>Live MOERAND signals, safety decisions, scores and Webull Sandbox status.</p>
          </div>
          <div style={styles.headerActions}>
            <a href="../" style={styles.linkButton}>Back to MOERAND</a>
            <button type="button" onClick={load} style={styles.primaryButton}>Refresh</button>
          </div>
        </header>

        <section style={styles.summaryGrid}>
          <Summary label="Signals" value={totals.all} />
          <Summary label="Accepted" value={totals.accepted} positive />
          <Summary label="Rejected" value={totals.rejected} warning />
          <Summary label="Submitted" value={totals.submitted} />
        </section>

        <section style={styles.toolbar}>
          <div style={styles.filters}>
            {['ALL', 'ACCEPTED', 'REJECTED', 'SUBMITTED'].map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setFilter(item)}
                style={{ ...styles.filterButton, ...(filter === item ? styles.filterButtonActive : {}) }}
              >
                {item}
              </button>
            ))}
          </div>
          <span style={styles.updated}>
            {updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Connecting…'}
          </span>
        </section>

        {status === 'loading' && <div style={styles.notice}>Loading MOE decisions…</div>}
        {error && <div style={{ ...styles.notice, ...styles.error }}>{error}</div>}
        {status === 'ready' && visible.length === 0 && (
          <div style={styles.notice}>No TradingView decisions stored yet. The next webhook signal will appear here automatically.</div>
        )}

        <section style={styles.list}>
          {visible.map((item) => (
            <article key={item.signalId} style={styles.card}>
              <div style={styles.cardTop}>
                <div style={styles.symbolBlock}>
                  <span style={styles.symbol}>{item.symbol || '—'}</span>
                  <span style={styles.side}>{item.side || '—'} {item.timeframe ? `· ${item.timeframe}` : ''}</span>
                </div>
                <span style={{
                  ...styles.status,
                  ...(item.submitted ? styles.submitted : item.accepted ? styles.accepted : styles.rejected),
                }}>
                  {statusLabel(item)}
                </span>
              </div>

              <div style={styles.metrics}>
                <Metric label="ENTRY" value={money(item.entry)} />
                <Metric label="STOP" value={money(item.stopLoss)} />
                <Metric label="TARGET" value={money(item.takeProfit)} />
                <Metric label="SCORE" value={`${numberOrDash(item.score)}/100`} />
                <Metric label="R:R" value={numberOrDash(item.riskReward, 2)} />
                <Metric label="QTY" value={numberOrDash(item.quantity)} />
              </div>

              <div style={styles.details}>
                <div><b>Mode:</b> {item.mode || '—'}</div>
                <div><b>Risk budget:</b> {money(item.sizing?.riskBudget)}</div>
                <div><b>Estimated risk:</b> {money(item.sizing?.estimatedRisk)}</div>
                <div><b>Created:</b> {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</div>
              </div>

              {item.reasons?.length > 0 && (
                <div style={styles.reasons}>
                  <b>Decision reasons</b>
                  <ul style={styles.reasonList}>
                    {item.reasons.map((reason) => <li key={reason}>{reason}</li>)}
                  </ul>
                </div>
              )}

              {item.message && <p style={styles.message}>{item.message}</p>}
            </article>
          ))}
        </section>
      </section>
    </main>
  );
}

function Summary({ label, value, positive, warning }) {
  return (
    <div style={{ ...styles.summaryCard, ...(positive ? styles.summaryPositive : {}), ...(warning ? styles.summaryWarning : {}) }}>
      <small style={styles.summaryLabel}>{label}</small>
      <strong style={styles.summaryValue}>{value}</strong>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div style={styles.metric}>
      <small style={styles.metricLabel}>{label}</small>
      <strong style={styles.metricValue}>{value}</strong>
    </div>
  );
}

const styles = {
  page: { minHeight: '100vh', background: '#07110d', color: '#edf7f2', padding: '28px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' },
  shell: { width: 'min(1180px, 100%)', margin: '0 auto' },
  header: { display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 24 },
  eyebrow: { color: '#36dc91', letterSpacing: '0.16em', fontSize: 12, fontWeight: 800, margin: '0 0 8px' },
  title: { fontSize: 'clamp(32px, 5vw, 54px)', margin: 0, lineHeight: 1 },
  subtitle: { color: '#94a89e', maxWidth: 680, marginTop: 12 },
  headerActions: { display: 'flex', gap: 10 },
  linkButton: { color: '#d6e8df', border: '1px solid #29443a', borderRadius: 12, padding: '11px 14px', textDecoration: 'none', fontWeight: 700 },
  primaryButton: { background: '#21c77a', color: '#04130d', border: 0, borderRadius: 12, padding: '11px 18px', fontWeight: 900, cursor: 'pointer' },
  summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 18 },
  summaryCard: { background: '#101d18', border: '1px solid #22372f', borderRadius: 16, padding: 18 },
  summaryPositive: { borderColor: '#1f7a52' },
  summaryWarning: { borderColor: '#83483e' },
  summaryLabel: { color: '#8ea198', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' },
  summaryValue: { fontSize: 30 },
  toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 },
  filters: { display: 'flex', gap: 8, flexWrap: 'wrap' },
  filterButton: { background: '#0d1814', color: '#a9bbb2', border: '1px solid #263c33', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 12 },
  filterButtonActive: { background: '#1dbd72', color: '#03110b', borderColor: '#1dbd72' },
  updated: { color: '#74877e', fontSize: 13 },
  notice: { background: '#101d18', border: '1px solid #263c33', borderRadius: 16, padding: 20, color: '#a8bab1' },
  error: { borderColor: '#8b3e36', color: '#ffb9ad' },
  list: { display: 'grid', gap: 14 },
  card: { background: 'linear-gradient(180deg, #111f19 0%, #0d1814 100%)', border: '1px solid #243a31', borderRadius: 18, padding: 18, boxShadow: '0 16px 40px rgba(0,0,0,.22)' },
  cardTop: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', marginBottom: 16 },
  symbolBlock: { display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' },
  symbol: { fontSize: 24, fontWeight: 900 },
  side: { color: '#8ca097', fontWeight: 800 },
  status: { borderRadius: 999, padding: '7px 11px', fontWeight: 900, fontSize: 11, letterSpacing: '0.06em' },
  accepted: { background: '#123f2c', color: '#62efac' },
  rejected: { background: '#48231f', color: '#ff9d90' },
  submitted: { background: '#193b58', color: '#8fd0ff' },
  metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: 8, marginBottom: 14 },
  metric: { background: '#09130f', borderRadius: 12, padding: 12, border: '1px solid #1c3028' },
  metricLabel: { color: '#6f847a', display: 'block', marginBottom: 5, fontSize: 10, letterSpacing: '0.1em' },
  metricValue: { fontSize: 16 },
  details: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, color: '#9badA4', fontSize: 13 },
  reasons: { marginTop: 14, background: '#1d1714', border: '1px solid #4f3029', borderRadius: 12, padding: 13, color: '#ffc0b5' },
  reasonList: { margin: '8px 0 0', paddingLeft: 20 },
  message: { margin: '14px 0 0', color: '#8fa29a', fontSize: 13 },
};