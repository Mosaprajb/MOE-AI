// @ts-nocheck
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BACKGROUND_ALERTS_URL } from '../lib/backgroundAlerts.js';

function money(value) {
  const number = Number(value);
  return Number.isFinite(number) ? `$${number.toFixed(2)}` : '—';
}

function numberOrDash(value, digits = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toFixed(digits) : '—';
}

function safeReasons(value) {
  if (Array.isArray(value)) return value.map((item) => String(item)).filter(Boolean);
  if (typeof value === 'string' && value.trim()) return [value.trim()];
  return [];
}

function normalizeDecision(item, index) {
  const source = item && typeof item === 'object' ? item : {};
  const portfolio = source.portfolio && typeof source.portfolio === 'object' ? source.portfolio : {};
  const metrics = portfolio.metrics && typeof portfolio.metrics === 'object' ? portfolio.metrics : {};
  return {
    ...source,
    signalId: String(source.signalId || `decision-${index}-${source.createdAt || ''}`),
    reasons: safeReasons(source.reasons),
    portfolio: { ...portfolio, metrics },
  };
}

function statusLabel(item) {
  if (item.submitted) return 'SANDBOX SUBMITTED';
  if (item.accepted) return 'ACCEPTED';
  return 'REJECTED';
}

function cardTone(item) {
  if (item.submitted) return styles.cardSubmitted;
  if (item.accepted) return styles.cardAccepted;
  return styles.cardRejected;
}

function actionLabel(action) {
  const labels = {
    KEEP_PENDING_ORDER: 'Keep pending order',
    PROTECT_EXISTING_POSITION: 'Protect existing position',
    REVIEW_REPLACEMENT: 'Review replacement opportunity',
    BLOCK_DUPLICATE: 'Block duplicate exposure',
  };
  return labels[action] || String(action || '');
}

export default function DecisionsPage({ onBack }) {
  const [decisions, setDecisions] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [updatedAt, setUpdatedAt] = useState(null);
  const [filter, setFilter] = useState('ALL');
  const [query, setQuery] = useState('');
  const [live, setLive] = useState(true);
  const knownIds = useRef(new Set());

  const load = useCallback(async () => {
    try {
      setError('');
      const response = await fetch(`${BACKGROUND_ALERTS_URL}/api/tradingview/decisions?limit=100`, {
        method: 'GET', mode: 'cors', cache: 'no-store',
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || `Decision service returned ${response.status}`);
      const next = (Array.isArray(payload.decisions) ? payload.decisions : []).map(normalizeDecision);
      const previousIds = knownIds.current;
      const newest = next.find((item) => item.signalId && !previousIds.has(item.signalId));
      setDecisions(next);
      knownIds.current = new Set(next.map((item) => item.signalId).filter(Boolean));
      setUpdatedAt(new Date());
      setStatus('ready');

      if (newest && previousIds.size > 0 && 'Notification' in window && Notification.permission === 'granted') {
        new Notification(`${newest.symbol || 'MOERAND'} · ${statusLabel(newest)}`, {
          body: `${newest.side || ''} · Score ${numberOrDash(newest.score)}/100 · Entry ${money(newest.entry)}`,
        });
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Could not load decision history');
      setStatus('error');
    }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    if (!live) return undefined;
    const timer = window.setInterval(load, 5_000);
    return () => window.clearInterval(timer);
  }, [live, load]);

  const visible = useMemo(() => decisions.filter((item) => {
    if (filter === 'ACCEPTED' && !item.accepted) return false;
    if (filter === 'REJECTED' && item.accepted) return false;
    if (filter === 'SUBMITTED' && !item.submitted) return false;
    const text = `${item.symbol || ''} ${item.side || ''} ${item.reasons.join(' ')} ${item.portfolio?.action || ''}`.toLowerCase();
    return text.includes(query.trim().toLowerCase());
  }), [decisions, filter, query]);

  const totals = useMemo(() => {
    const accepted = decisions.filter((item) => item.accepted).length;
    const submitted = decisions.filter((item) => item.submitted).length;
    const scores = decisions.map((item) => Number(item.score)).filter((value) => Number.isFinite(value));
    return {
      all: decisions.length,
      accepted,
      rejected: decisions.length - accepted,
      submitted,
      acceptanceRate: decisions.length ? (accepted / decisions.length) * 100 : 0,
      averageScore: scores.length ? scores.reduce((sum, value) => sum + value, 0) / scores.length : 0,
    };
  }, [decisions]);

  async function enableNotifications() {
    if ('Notification' in window) await Notification.requestPermission();
  }

  return (
    <main style={styles.page}>
      <section style={styles.shell}>
        <header style={styles.header}>
          <div>
            <p style={styles.eyebrow}>MOE AI · TRADINGVIEW</p>
            <h1 style={styles.title}>Decision History</h1>
            <p style={styles.subtitle}>Live MOERAND signals, safety decisions, smart portfolio actions and Webull execution status.</p>
          </div>
          <div style={styles.headerActions}>
            <button type="button" onClick={onBack} style={styles.linkButton}>Back to MOERAND</button>
            <button type="button" onClick={enableNotifications} style={styles.linkButton}>Notifications</button>
            <button type="button" onClick={load} style={styles.primaryButton}>Refresh</button>
          </div>
        </header>

        <section style={styles.summaryGrid}>
          <Summary label="Signals" value={totals.all} />
          <Summary label="Accepted" value={totals.accepted} positive />
          <Summary label="Rejected" value={totals.rejected} warning />
          <Summary label="Submitted" value={totals.submitted} />
          <Summary label="Acceptance" value={`${totals.acceptanceRate.toFixed(0)}%`} positive />
          <Summary label="Avg score" value={totals.averageScore ? totals.averageScore.toFixed(0) : '—'} />
        </section>

        <section style={styles.toolbar}>
          <div style={styles.filters}>
            {['ALL', 'ACCEPTED', 'REJECTED', 'SUBMITTED'].map((item) => (
              <button key={item} type="button" onClick={() => setFilter(item)} style={{ ...styles.filterButton, ...(filter === item ? styles.filterButtonActive : {}) }}>{item}</button>
            ))}
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search symbol, reason or action" style={styles.search} />
          </div>
          <div style={styles.liveBlock}>
            <button type="button" onClick={() => setLive((value) => !value)} style={{ ...styles.liveButton, ...(live ? styles.liveOn : {}) }}>{live ? '● LIVE 5s' : '○ PAUSED'}</button>
            <span style={styles.updated}>{updatedAt ? `Updated ${updatedAt.toLocaleTimeString()}` : 'Connecting…'}</span>
          </div>
        </section>

        {status === 'loading' && <div style={styles.notice}>Loading MOE decisions…</div>}
        {error && <div style={{ ...styles.notice, ...styles.error }}>{error}</div>}
        {status === 'ready' && visible.length === 0 && <div style={styles.notice}>No decisions match the current filters. New TradingView signals appear automatically.</div>}

        <section style={styles.list}>
          {visible.map((item) => {
            const portfolio = item.portfolio || {};
            const metrics = portfolio.metrics || {};
            return (
              <article key={item.signalId} style={{ ...styles.card, ...cardTone(item) }}>
                <div style={styles.cardTop}>
                  <div style={styles.symbolBlock}><span style={styles.symbol}>{item.symbol || '—'}</span><span style={styles.side}>{item.side || '—'} {item.timeframe ? `· ${item.timeframe}` : ''}</span></div>
                  <span style={{ ...styles.status, ...(item.submitted ? styles.submitted : item.accepted ? styles.accepted : styles.rejected) }}>{statusLabel(item)}</span>
                </div>
                <div style={styles.metrics}>
                  <Metric label="ENTRY" value={money(item.entry)} /><Metric label="STOP" value={money(item.stopLoss)} /><Metric label="TARGET" value={money(item.takeProfit)} /><Metric label="SCORE" value={`${numberOrDash(item.score)}/100`} /><Metric label="R:R" value={numberOrDash(item.riskReward, 2)} /><Metric label="QTY" value={numberOrDash(item.quantity)} />
                </div>
                <div style={styles.details}><div><b>Mode:</b> {item.mode || '—'}</div><div><b>Risk budget:</b> {money(item.sizing?.riskBudget)}</div><div><b>Estimated risk:</b> {money(item.sizing?.estimatedRisk)}</div><div><b>Created:</b> {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</div></div>
                {portfolio.action && <section style={styles.actionPanel}><div style={styles.actionHeader}><span style={styles.actionTitle}>SMART PORTFOLIO ACTION</span><span style={styles.actionBadge}>{actionLabel(portfolio.action)}</span></div>{portfolio.actionReason && <p style={styles.actionReason}>{String(portfolio.actionReason)}</p>}<div style={styles.actionMetrics}><Metric label="OPEN POSITIONS" value={numberOrDash(metrics.openPositions)} /><Metric label="DAILY TRADES" value={`${numberOrDash(metrics.dailyTrades)}/${numberOrDash(metrics.maxDailyTrades)}`} /><Metric label="PORTFOLIO RISK" value={metrics.totalRiskPercent == null ? '—' : `${numberOrDash(metrics.totalRiskPercent, 2)}%`} /><Metric label="CORRELATION" value={metrics.correlationGroup || '—'} /></div><p style={styles.safetyNote}>Recommendation only. Automatic position closing or replacement remains disabled.</p></section>}
                {item.reasons.length > 0 && <div style={styles.reasons}><b>Decision reasons</b><ul style={styles.reasonList}>{item.reasons.map((reason, index) => <li key={`${reason}-${index}`}>{reason}</li>)}</ul></div>}
                {item.message && <p style={styles.message}>{String(item.message)}</p>}
              </article>
            );
          })}
        </section>
      </section>
    </main>
  );
}

function Summary({ label, value, positive, warning }) { return <div style={{ ...styles.summaryCard, ...(positive ? styles.summaryPositive : {}), ...(warning ? styles.summaryWarning : {}) }}><small style={styles.summaryLabel}>{label}</small><strong style={styles.summaryValue}>{value}</strong></div>; }
function Metric({ label, value }) { return <div style={styles.metric}><small style={styles.metricLabel}>{label}</small><strong style={styles.metricValue}>{value}</strong></div>; }

const styles = {
  page: { minHeight: '100vh', background: '#07110d', color: '#edf7f2', padding: '28px 16px 60px', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif' }, shell: { width: 'min(1180px, 100%)', margin: '0 auto' }, header: { display: 'flex', justifyContent: 'space-between', gap: 20, alignItems: 'flex-start', flexWrap: 'wrap', marginBottom: 24 }, eyebrow: { color: '#36dc91', letterSpacing: '0.16em', fontSize: 12, fontWeight: 800, margin: '0 0 8px' }, title: { fontSize: 'clamp(32px, 5vw, 54px)', margin: 0, lineHeight: 1 }, subtitle: { color: '#94a89e', maxWidth: 760, marginTop: 12 }, headerActions: { display: 'flex', gap: 10, flexWrap: 'wrap' }, linkButton: { color: '#d6e8df', background: 'transparent', border: '1px solid #29443a', borderRadius: 12, padding: '11px 14px', textDecoration: 'none', fontWeight: 700, cursor: 'pointer' }, primaryButton: { background: '#21c77a', color: '#04130d', border: 0, borderRadius: 12, padding: '11px 18px', fontWeight: 900, cursor: 'pointer' }, summaryGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 12, marginBottom: 18 }, summaryCard: { background: '#101d18', border: '1px solid #22372f', borderRadius: 16, padding: 18 }, summaryPositive: { borderColor: '#1f7a52' }, summaryWarning: { borderColor: '#83483e' }, summaryLabel: { color: '#8ea198', display: 'block', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.08em' }, summaryValue: { fontSize: 30 }, toolbar: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 18 }, filters: { display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }, filterButton: { background: '#0d1814', color: '#a9bbb2', border: '1px solid #263c33', borderRadius: 999, padding: '8px 12px', cursor: 'pointer', fontWeight: 800, fontSize: 12 }, filterButtonActive: { background: '#1dbd72', color: '#03110b', borderColor: '#1dbd72' }, search: { background: '#0d1814', color: '#edf7f2', border: '1px solid #263c33', borderRadius: 999, padding: '9px 14px', minWidth: 230, outline: 'none' }, liveBlock: { display: 'flex', alignItems: 'center', gap: 10 }, liveButton: { border: '1px solid #3a4b44', background: '#111b17', color: '#9badA4', borderRadius: 999, padding: '8px 12px', fontWeight: 900, cursor: 'pointer' }, liveOn: { color: '#53e99e', borderColor: '#237a50' }, updated: { color: '#74877e', fontSize: 13 }, notice: { background: '#101d18', border: '1px solid #263c33', borderRadius: 16, padding: 20, color: '#a8bab1' }, error: { borderColor: '#8b3e36', color: '#ffb9ad' }, list: { display: 'grid', gap: 14 }, card: { background: 'linear-gradient(180deg, #111f19 0%, #0d1814 100%)', border: '1px solid #243a31', borderLeftWidth: 5, borderRadius: 18, padding: 18, boxShadow: '0 16px 40px rgba(0,0,0,.22)' }, cardAccepted: { borderLeftColor: '#28cf82', background: 'linear-gradient(180deg, #10241b 0%, #0d1814 100%)' }, cardRejected: { borderLeftColor: '#e16c5c', background: 'linear-gradient(180deg, #211512 0%, #0d1814 100%)' }, cardSubmitted: { borderLeftColor: '#55b4f5', background: 'linear-gradient(180deg, #10202c 0%, #0d1814 100%)' }, cardTop: { display: 'flex', justifyContent: 'space-between', gap: 14, alignItems: 'center', marginBottom: 16 }, symbolBlock: { display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }, symbol: { fontSize: 24, fontWeight: 900 }, side: { color: '#8ca097', fontWeight: 800 }, status: { borderRadius: 999, padding: '7px 11px', fontWeight: 900, fontSize: 11, letterSpacing: '0.06em' }, accepted: { background: '#123f2c', color: '#62efac' }, rejected: { background: '#48231f', color: '#ff9d90' }, submitted: { background: '#193b58', color: '#8fd0ff' }, metrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(105px, 1fr))', gap: 8, marginBottom: 14 }, metric: { background: '#09130f', borderRadius: 12, padding: 12, border: '1px solid #1c3028' }, metricLabel: { color: '#6f847a', display: 'block', marginBottom: 5, fontSize: 10, letterSpacing: '0.1em' }, metricValue: { fontSize: 16 }, details: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 8, color: '#9badA4', fontSize: 13 }, actionPanel: { marginTop: 14, padding: 14, borderRadius: 14, background: '#101a22', border: '1px solid #2c536b' }, actionHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }, actionTitle: { color: '#8fd0ff', fontWeight: 900, fontSize: 11, letterSpacing: '0.1em' }, actionBadge: { background: '#193b58', color: '#a9dcff', borderRadius: 999, padding: '6px 10px', fontWeight: 800, fontSize: 12 }, actionReason: { color: '#c1d8e7', margin: '10px 0' }, actionMetrics: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: 8 }, safetyNote: { color: '#7893a3', fontSize: 12, margin: '10px 0 0' }, reasons: { marginTop: 14, background: '#1d1714', border: '1px solid #4f3029', borderRadius: 12, padding: 13, color: '#ffc0b5' }, reasonList: { margin: '8px 0 0', paddingLeft: 20 }, message: { margin: '14px 0 0', color: '#8fa29a', fontSize: 13 },
};
