// MOE-AI — Scanner Page
import { useState, useEffect, useRef } from 'react';
import type { TradingMode } from '../lib/config';
import { useScanner } from '../hooks/useScanner';
import type { ScanCandidate, ScannerPosition } from '../hooks/useScanner';

interface Props { mode: TradingMode; showToast: (msg: string, type?: 'success' | 'error') => void; }

const CONF_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  HIGH:   { bg: 'rgba(34,197,94,.15)',   color: '#22c55e', label: '🟢 عالية' },
  MEDIUM: { bg: 'rgba(251,191,36,.15)',  color: '#fbbf24', label: '🟡 متوسطة' },
};

function fmt(n?: number, dec = 2) { return n != null ? `$${n.toFixed(dec)}` : '—'; }
function fmtPct(n?: number) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—'; }
function pnlColor(v?: number) { return v == null ? '' : v >= 0 ? 'var(--green)' : 'var(--red)'; }

// ── Candidate Card ────────────────────────────────────────────────────────────
function CandidateCard({ c }: { c: ScanCandidate }) {
  const [expanded, setExpanded] = useState(false);
  const cs = CONF_STYLE[c.confidence];
  const tpPct = ((c.takeProfit - c.entry) / c.entry * 100).toFixed(2);
  const slPct = ((c.stopLoss  - c.entry) / c.entry * 100).toFixed(2);
  return (
    <div className="card" style={{ cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{c.symbol}</div>
          <div style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
            background: cs.bg, color: cs.color }}>{cs.label}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>نقاط: {c.score}/10</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700 }}>{fmt(c.price)}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>
            TP {fmt(c.takeProfit)} <span style={{ color: 'var(--green)' }}>(+{tpPct}%)</span>
          </div>
        </div>
      </div>

      {/* Score bar */}
      <div style={{ marginTop: 8, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
        <div style={{ width: `${c.score * 10}%`, height: '100%',
          background: c.score >= 8 ? '#22c55e' : c.score >= 5 ? '#fbbf24' : '#64748b',
          borderRadius: 2, transition: 'width .4s' }} />
      </div>

      {/* SL / TP row */}
      <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 12 }}>
        <span style={{ color: 'var(--red)' }}>SL {fmt(c.stopLoss)} ({slPct}%)</span>
        <span style={{ color: 'var(--green)' }}>TP {fmt(c.takeProfit)} (+{tpPct}%)</span>
        <span style={{ color: 'var(--muted)' }}>Trail {c.trailPct}%</span>
      </div>

      {/* Expanded reasons */}
      {expanded && (
        <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>مؤشرات الدخول:</div>
          {c.reasons.map((r, i) => (
            <div key={i} style={{ fontSize: 12, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--green)' }}>✓</span> {r}
            </div>
          ))}
          <div style={{ marginTop: 8, display: 'flex', gap: 20, fontSize: 11, color: 'var(--muted)' }}>
            <span>RSI: {c.rsi14.toFixed(1)}</span>
            <span>EMA9: {fmt(c.ema9)}</span>
            <span>EMA21: {fmt(c.ema21)}</span>
            <span>حجم: ×{c.volumeRatio.toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Position Row ──────────────────────────────────────────────────────────────
function PositionRow({ p }: { p: ScannerPosition }) {
  const cs = CONF_STYLE[p.confidence];
  const pnlAmt = p.currentPrice ? (p.currentPrice - p.entryPrice) * p.quantity : 0;
  const pnlPct = p.entryPrice ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100) : 0;
  const slPct  = p.entryPrice ? ((p.stopLoss - p.entryPrice) / p.entryPrice * 100) : 0;
  const tpPct  = p.entryPrice ? ((p.takeProfit - p.entryPrice) / p.entryPrice * 100) : 0;
  // progress bar: how far price is between entry and TP
  const progress = p.takeProfit > p.entryPrice
    ? Math.max(0, Math.min(100, ((p.currentPrice - p.entryPrice) / (p.takeProfit - p.entryPrice)) * 100))
    : 0;

  return (
    <div className="card" style={{ padding: '12px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={{ fontWeight: 800 }}>{p.symbol}</span>
            <span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
              background: cs.bg, color: cs.color }}>{cs.label}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>
            دخول {fmt(p.entryPrice)} · {p.quantity} سهم
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, color: pnlColor(pnlAmt) }}>
            {fmtPct(pnlPct)}
          </div>
          <div style={{ fontSize: 12, color: pnlColor(pnlAmt) }}>
            {pnlAmt >= 0 ? '+' : ''}{pnlAmt.toFixed(2)}$
          </div>
        </div>
      </div>

      {/* Progress bar: entry → TP */}
      <div style={{ margin: '10px 0 4px', height: 6, background: 'var(--border)', borderRadius: 3, overflow: 'hidden' }}>
        <div style={{ width: `${progress}%`, height: '100%',
          background: pnlAmt >= 0 ? '#22c55e' : '#ef4444',
          borderRadius: 3, transition: 'width .4s' }} />
      </div>

      {/* SL / Price / TP row */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: 'var(--red)' }}>SL {fmt(p.stopLoss)} ({slPct.toFixed(1)}%)</span>
        <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{fmt(p.currentPrice)}</span>
        <span style={{ color: 'var(--green)' }}>TP {fmt(p.takeProfit)} (+{tpPct.toFixed(1)}%)</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
        Trail {p.trailPct}% · Highest {fmt(p.highestPrice)} · Score {p.score}/10
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ScannerPage({ mode, showToast }: Props) {
  const { positions, lastResult, runs, config, watchlist, scanning, loading,
          error, runScan, updateWatchlist } = useScanner(mode);
  const [newSymbol, setNewSymbol] = useState('');
  const [tab, setTab] = useState<'positions' | 'candidates' | 'watchlist' | 'runs'>('positions');
  const [nextScanIn, setNextScanIn] = useState(0);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);

  // Keep a stable ref so the interval always calls the latest version
  const runScanRef = useRef(runScan);
  useEffect(() => { runScanRef.current = runScan; }, [runScan]);

  const handleScan = async () => {
    const result = await runScanRef.current();
    showToast(
      result
        ? `✅ فحص مكتمل — ${result.candidates?.length ?? 0} مرشح، ${result.ordersPlaced} أوامر`
        : '❌ فشل الفحص — تحقق من الاتصال',
      result ? 'success' : 'error',
    );
  };

  // Auto-scan: run immediately on mount, then every 5 minutes
  const INTERVAL_MS = 5 * 60 * 1000;
  useEffect(() => {
    let cancelled = false;

    const doScan = async () => {
      if (cancelled) return;
      const result = await runScanRef.current();
      if (cancelled) return;
      showToast(
        result
          ? `✅ فحص مكتمل — ${result.candidates?.length ?? 0} مرشح، ${result.ordersPlaced} أوامر`
          : '❌ فشل الفحص — تحقق من الاتصال',
        result ? 'success' : 'error',
      );
      setNextScanIn(INTERVAL_MS / 1000);
    };

    // Run immediately
    doScan();

    // Countdown ticker
    setNextScanIn(INTERVAL_MS / 1000);
    countdownRef.current = setInterval(() => {
      setNextScanIn(prev => (prev <= 1 ? INTERVAL_MS / 1000 : prev - 1));
    }, 1000);

    // Auto-scan every 5 min
    scanIntervalRef.current = setInterval(() => {
      doScan();
    }, INTERVAL_MS);

    return () => {
      cancelled = true;
      if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
      if (countdownRef.current)    clearInterval(countdownRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleAddSymbol = async () => {
    const sym = newSymbol.trim().toUpperCase();
    if (!sym) return;
    await updateWatchlist(sym, 'add');
    setNewSymbol('');
    showToast(`${sym} أضيف للقائمة ✓`, 'success');
  };

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>📡 الماسح الذكي</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            MOE Scalp v1 · {watchlist.length} سهم · {scanning
              ? '⏳ جارٍ الفحص الآن…'
              : `⏱ فحص تلقائي بعد ${Math.floor(nextScanIn / 60)}:${String(nextScanIn % 60).padStart(2, '0')}`}
          </div>
        </div>
        <button
          className="btn btn-primary"
          onClick={handleScan}
          disabled={scanning}
          style={{ minWidth: 130 }}>
          {scanning ? '⏳ جارٍ الفحص…' : '🔍 فحص الآن'}
        </button>
      </div>

      {/* Config pills */}
      {config && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 20 }}>
          {[
            { label: 'TP', val: `+${config.tpPct}%`,      color: '#22c55e' },
            { label: 'Trail SL', val: `${config.trailPct}%`, color: '#fbbf24' },
            { label: 'Hard SL',  val: `-${config.hardStopPct}%`, color: '#ef4444' },
            { label: 'نطاق السعر', val: `$${config.priceMin}-$${config.priceMax}`, color: '#60a5fa' },
            { label: 'مخاطرة',  val: `${config.riskPct}%`, color: '#a78bfa' },
          ].map(p => (
            <div key={p.label} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11,
              background: `${p.color}18`, color: p.color, border: `1px solid ${p.color}33`,
              fontWeight: 600 }}>
              {p.label}: {p.val}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding: '10px 14px', background: 'rgba(239,68,68,.1)',
          border: '1px solid rgba(239,68,68,.3)', borderRadius: 8, color: '#ef4444',
          fontSize: 12, marginBottom: 16 }}>
          {error}
        </div>
      )}

      {/* Last scan summary */}
      {lastResult && (
        <div style={{ padding: '10px 14px', background: 'rgba(96,165,250,.08)',
          border: '1px solid rgba(96,165,250,.2)', borderRadius: 8, marginBottom: 16,
          display: 'flex', gap: 20, fontSize: 12 }}>
          <span>🔍 فُحص: <b>{lastResult.scanned}</b></span>
          <span style={{ color: '#22c55e' }}>📊 مرشح: <b>{lastResult.candidates?.length ?? 0}</b></span>
          <span style={{ color: '#a78bfa' }}>📋 أوامر: <b>{lastResult.ordersPlaced}</b></span>
          <span style={{ color: 'var(--muted)' }}>⏱ {lastResult.ms}ms</span>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 0 }}>
        {([
          { id: 'positions',  label: `صفقات مفتوحة (${positions.length})` },
          { id: 'candidates', label: `المرشحون (${lastResult?.candidates?.length ?? 0})` },
          { id: 'watchlist',  label: `قائمة الأسهم (${watchlist.length})` },
          { id: 'runs',       label: `سجل الفحص (${runs.length})` },
        ] as { id: typeof tab; label: string }[]).map(t => (
          <button key={t.id}
            onClick={() => setTab(t.id)}
            style={{
              padding: '8px 14px', fontSize: 12, fontWeight: 600, border: 'none', cursor: 'pointer',
              background: 'transparent', borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--muted)', marginBottom: -1,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Open Positions */}
      {tab === 'positions' && (
        <div>
          {loading && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>جارٍ التحميل…</div>}
          {!loading && positions.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              <div>لا توجد صفقات مفتوحة حالياً</div>
              <div style={{ fontSize: 12, marginTop: 8 }}>اضغط "فحص الآن" لبحث عن فرص تداول</div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {positions.map(p => <PositionRow key={p.id} p={p} />)}
          </div>
        </div>
      )}

      {/* Tab: Candidates */}
      {tab === 'candidates' && (
        <div>
          {!lastResult && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>🔍</div>
              <div>لم يتم الفحص بعد</div>
              <div style={{ fontSize: 12, marginTop: 8 }}>اضغط "فحص الآن" لعرض المرشحين</div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(lastResult?.candidates ?? []).map(c => <CandidateCard key={c.symbol} c={c} />)}
          </div>
        </div>
      )}

      {/* Tab: Watchlist */}
      {tab === 'watchlist' && (
        <div>
          {/* Add symbol */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              value={newSymbol}
              onChange={e => setNewSymbol(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleAddSymbol()}
              placeholder="أضف رمز سهم (مثال: AAPL)"
              style={{ flex: 1, padding: '8px 12px', background: 'var(--card)',
                border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg)', fontSize: 13 }} />
            <button className="btn btn-primary" onClick={handleAddSymbol}>إضافة</button>
          </div>
          {/* Grid of symbols */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {watchlist.map(sym => (
              <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', background: 'var(--card)', border: '1px solid var(--border)',
                borderRadius: 6, fontSize: 12 }}>
                <span style={{ fontWeight: 700 }}>{sym}</span>
                <button
                  onClick={() => updateWatchlist(sym, 'remove')}
                  style={{ background: 'none', border: 'none', color: 'var(--muted)',
                    cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: '0 2px' }}>
                  ×
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab: Scan Runs */}
      {tab === 'runs' && (
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>الوقت</th>
                <th className="col-number">فُحص</th>
                <th className="col-number">مرشح</th>
                <th className="col-number">أوامر</th>
                <th className="col-number">إدارة</th>
                <th className="col-number">مدة (ms)</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: '30px 0' }}>لا يوجد سجل بعد</td></tr>
              )}
              {runs.map(r => (
                <tr key={r.id}>
                  <td style={{ fontSize: 11 }}>{new Date(r.ran_at).toLocaleTimeString()}</td>
                  <td className="col-number">{r.scanned_count}</td>
                  <td className="col-number" style={{ color: r.candidates_count > 0 ? 'var(--green)' : 'var(--muted)' }}>{r.candidates_count}</td>
                  <td className="col-number" style={{ color: r.orders_placed > 0 ? 'var(--accent)' : 'var(--muted)' }}>{r.orders_placed}</td>
                  <td className="col-number">{r.positions_managed}</td>
                  <td className="col-number" style={{ color: 'var(--muted)' }}>{r.duration_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
