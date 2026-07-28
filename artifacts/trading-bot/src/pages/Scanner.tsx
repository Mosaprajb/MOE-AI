// MOE-AI — Scanner Page (English UI)
import { useState, useEffect, useRef } from 'react';

// ── Module-level timer state — survives page navigation ───────────────────────
// Stored outside the component so unmount/remount doesn't reset the clock.
let _lastScanAt  = 0;                    // epoch ms of the most recent completed scan
const INTERVAL_MS = 5 * 60 * 1000;      // 5 minutes

function remainingSec(): number {
  if (_lastScanAt === 0) return 0;       // never scanned → trigger immediately
  return Math.max(0, Math.ceil((INTERVAL_MS - (Date.now() - _lastScanAt)) / 1000));
}
import type { TradingMode } from '../lib/config';
import { useScanner } from '../hooks/useScanner';
import type { ScanCandidate, ScannerPosition } from '../hooks/useScanner';

interface Props { mode: TradingMode; showToast: (msg: string, type?: 'success' | 'error') => void; }

const CONF: Record<string, { bg: string; color: string; label: string }> = {
  HIGH:   { bg: 'rgba(34,197,94,.15)',  color: '#22c55e', label: '🟢 HIGH'   },
  MEDIUM: { bg: 'rgba(251,191,36,.15)', color: '#fbbf24', label: '🟡 MEDIUM' },
};

function fmt(n?: number, dec = 2) { return n != null ? `$${n.toFixed(dec)}` : '—'; }
function fmtPct(n?: number) { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—'; }
function pnlColor(v?: number) { return v == null ? '' : v >= 0 ? 'var(--green)' : 'var(--red)'; }
function today() { return new Date().toISOString().slice(0, 10); }

// ── Candidate Card ─────────────────────────────────────────────────────────────
function CandidateCard({ c }: { c: ScanCandidate }) {
  const [expanded, setExpanded] = useState(false);
  const cs     = CONF[c.confidence];
  const tpPct  = ((c.takeProfit - c.entry) / c.entry * 100).toFixed(2);
  const slPct  = ((c.stopLoss  - c.entry) / c.entry * 100).toFixed(2);
  return (
    <div className="card" style={{ cursor: 'pointer' }} onClick={() => setExpanded(e => !e)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ fontWeight: 800, fontSize: 16 }}>{c.symbol}</div>
          <div style={{ fontSize: 11, fontWeight: 700, padding: '2px 8px', borderRadius: 5,
            background: cs.bg, color: cs.color }}>{cs.label}</div>
          <div style={{ fontSize: 11, color: 'var(--muted)' }}>Score: {c.score}/10</div>
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
          <div style={{ fontSize: 11, color: 'var(--muted)', marginBottom: 6 }}>Entry signals:</div>
          {c.reasons.map((r, i) => (
            <div key={i} style={{ fontSize: 12, padding: '2px 0', display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ color: 'var(--green)' }}>✓</span> {r}
            </div>
          ))}
          <div style={{ marginTop: 8, display: 'flex', gap: 20, fontSize: 11, color: 'var(--muted)' }}>
            <span>RSI: {c.rsi14.toFixed(1)}</span>
            <span>EMA9: {fmt(c.ema9)}</span>
            <span>EMA21: {fmt(c.ema21)}</span>
            <span>Vol: ×{c.volumeRatio.toFixed(1)}</span>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Position Row ───────────────────────────────────────────────────────────────
function PositionRow({ p }: { p: ScannerPosition }) {
  const cs       = CONF[p.confidence];
  const pnlAmt   = p.currentPrice ? (p.currentPrice - p.entryPrice) * p.quantity : 0;
  const pnlPct   = p.entryPrice   ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100) : 0;
  const slPct    = p.entryPrice   ? ((p.stopLoss - p.entryPrice) / p.entryPrice * 100) : 0;
  const tpPct    = p.entryPrice   ? ((p.takeProfit - p.entryPrice) / p.entryPrice * 100) : 0;
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
            Entry {fmt(p.entryPrice)} · {p.quantity} shares
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontWeight: 700, color: pnlColor(pnlAmt) }}>{fmtPct(pnlPct)}</div>
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

      {/* SL / Price / TP */}
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11 }}>
        <span style={{ color: 'var(--red)' }}>SL {fmt(p.stopLoss)} ({slPct.toFixed(1)}%)</span>
        <span style={{ color: 'var(--fg)', fontWeight: 600 }}>{fmt(p.currentPrice)}</span>
        <span style={{ color: 'var(--green)' }}>TP {fmt(p.takeProfit)} (+{tpPct.toFixed(1)}%)</span>
      </div>
      <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 4 }}>
        Trail {p.trailPct}% · High {fmt(p.highestPrice)} · Score {p.score}/10
      </div>
    </div>
  );
}

// ── History Row ────────────────────────────────────────────────────────────────
function HistoryRow({ p }: { p: ScannerPosition }) {
  const cs     = CONF[p.confidence] ?? CONF.MEDIUM;
  const pnl    = p.pnl ?? 0;
  const pnlPct = p.entryPrice && p.exitPrice
    ? ((p.exitPrice - p.entryPrice) / p.entryPrice * 100) : 0;
  return (
    <tr>
      <td style={{ fontWeight: 700 }}>{p.symbol}</td>
      <td><span style={{ fontSize: 11, fontWeight: 700, padding: '1px 6px', borderRadius: 4,
        background: cs.bg, color: cs.color }}>{cs.label}</span></td>
      <td style={{ textAlign: 'right' }}>{p.quantity}</td>
      <td style={{ textAlign: 'right' }}>{fmt(p.entryPrice)}</td>
      <td style={{ textAlign: 'right' }}>{fmt(p.exitPrice)}</td>
      <td style={{ textAlign: 'right', color: pnlColor(pnl), fontWeight: 600 }}>{fmtPct(pnlPct)}</td>
      <td style={{ textAlign: 'right', color: pnlColor(pnl) }}>
        {pnl >= 0 ? '+' : ''}{pnl.toFixed(2)}
      </td>
      <td style={{ fontSize: 10, color: 'var(--muted)' }}>
        {p.closeReason ?? '—'}
      </td>
      <td style={{ fontSize: 10, color: 'var(--muted)' }}>
        {p.closedAt ? new Date(p.closedAt).toLocaleTimeString() : '—'}
      </td>
    </tr>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function ScannerPage({ mode, showToast }: Props) {
  const { positions, history, lastResult, runs, config, watchlist,
          scanning, loading, error, runScan, updateWatchlist } = useScanner(mode);
  const [newSymbol,    setNewSymbol]    = useState('');
  const [tab, setTab] = useState<'positions' | 'candidates' | 'history' | 'watchlist' | 'runs'>('positions');
  const [nextScanIn,   setNextScanIn]   = useState(0);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const runScanRef      = useRef(runScan);
  useEffect(() => { runScanRef.current = runScan; }, [runScan]);

  // Today's P&L from history
  const todayHistory  = history.filter(p => (p.closedAt ?? p.updatedAt ?? '').startsWith(today()));
  const todayPnl      = todayHistory.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const todayWinners  = todayHistory.filter(p => (p.pnl ?? 0) > 0).length;

  const doScan = async () => {
    const result = await runScanRef.current();
    _lastScanAt = Date.now();                // record when scan finished
    setNextScanIn(INTERVAL_MS / 1000);
    showToast(
      result
        ? `✅ Scan complete — ${result.candidates?.length ?? 0} candidates, ${result.ordersPlaced} orders`
        : '❌ Scan failed — check connection',
      result ? 'success' : 'error',
    );
  };

  // Auto-scan: picks up from module-level timestamp so navigation doesn't reset the clock
  useEffect(() => {
    let cancelled = false;

    const maybeScan = async () => {
      if (cancelled) return;
      doScan();
    };

    // On mount: initialise countdown from wherever the clock actually is
    const initial = remainingSec();
    setNextScanIn(initial);

    // If overdue (or first load), scan right away; otherwise wait out the remainder
    let firstTimer: ReturnType<typeof setTimeout>;
    if (initial === 0) {
      maybeScan();
      // Schedule recurring scans from now
      scanIntervalRef.current = setInterval(maybeScan, INTERVAL_MS);
    } else {
      // Wait until the next scheduled time, then go periodic
      firstTimer = setTimeout(() => {
        if (cancelled) return;
        maybeScan();
        scanIntervalRef.current = setInterval(maybeScan, INTERVAL_MS);
      }, initial * 1000);
    }

    // Countdown ticker — reads live remaining time every second
    countdownRef.current = setInterval(() => {
      setNextScanIn(remainingSec());
    }, 1000);

    return () => {
      cancelled = true;
      clearTimeout(firstTimer!);
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
    showToast(`${sym} added to watchlist`, 'success');
  };

  const mm = Math.floor(nextScanIn / 60);
  const ss = String(nextScanIn % 60).padStart(2, '0');

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>📡 Smart Scanner</h1>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            MOE Scalp v1 · {watchlist.length} stocks · {scanning ? '⏳ Scanning now…' : `⏱ Next scan in ${mm}:${ss}`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={doScan} disabled={scanning} style={{ minWidth: 120 }}>
          {scanning ? '⏳ Scanning…' : '🔍 Scan Now'}
        </button>
      </div>

      {/* Today's summary bar */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 100, padding: '8px 14px', borderRadius: 8,
          background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>TODAY P&L</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: pnlColor(todayPnl) }}>
            {todayPnl >= 0 ? '+' : ''}{todayPnl.toFixed(2)}$
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 100, padding: '8px 14px', borderRadius: 8,
          background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>TODAY TRADES</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{todayHistory.length}</div>
        </div>
        <div style={{ flex: 1, minWidth: 100, padding: '8px 14px', borderRadius: 8,
          background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>WIN RATE</div>
          <div style={{ fontWeight: 800, fontSize: 18, color: '#22c55e' }}>
            {todayHistory.length ? `${((todayWinners / todayHistory.length) * 100).toFixed(0)}%` : '—'}
          </div>
        </div>
        <div style={{ flex: 1, minWidth: 100, padding: '8px 14px', borderRadius: 8,
          background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 10, color: 'var(--muted)', marginBottom: 2 }}>OPEN</div>
          <div style={{ fontWeight: 800, fontSize: 18 }}>{positions.length}</div>
        </div>
      </div>

      {/* Config pills */}
      {config && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16 }}>
          {[
            { label: 'TP',          val: `+${config.tpPct}%`,            color: '#22c55e' },
            { label: 'Trail SL',    val: `${config.trailPct}%`,           color: '#fbbf24' },
            { label: 'Hard SL',     val: `-${config.hardStopPct}%`,       color: '#ef4444' },
            { label: 'Price Range', val: `$${config.priceMin}–$${config.priceMax}`, color: '#60a5fa' },
            { label: 'Risk',        val: `${config.riskPct}%`,            color: '#a78bfa' },
          ].map(pill => (
            <div key={pill.label} style={{ padding: '3px 10px', borderRadius: 6, fontSize: 11,
              background: `${pill.color}18`, color: pill.color, border: `1px solid ${pill.color}33`,
              fontWeight: 600 }}>
              {pill.label}: {pill.val}
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
          display: 'flex', gap: 20, fontSize: 12, flexWrap: 'wrap' }}>
          <span>🔍 Scanned: <b>{lastResult.scanned}</b></span>
          <span style={{ color: '#22c55e' }}>📊 Candidates: <b>{lastResult.candidates?.length ?? 0}</b></span>
          <span style={{ color: '#a78bfa' }}>📋 Orders: <b>{lastResult.ordersPlaced}</b></span>
          <span style={{ color: 'var(--muted)' }}>⏱ {lastResult.ms}ms</span>
          {(lastResult.errors?.length ?? 0) > 0 && (
            <span style={{ color: '#ef4444' }}>⚠ {lastResult.errors.length} errors</span>
          )}
        </div>
      )}

      {/* Scanning progress: show all stocks in watchlist */}
      {scanning && (
        <div style={{ padding: '12px 14px', background: 'rgba(251,191,36,.07)',
          border: '1px solid rgba(251,191,36,.2)', borderRadius: 8, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#fbbf24', fontWeight: 600, marginBottom: 8 }}>
            ⏳ Scanning {watchlist.length} stocks…
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {watchlist.map(sym => (
              <div key={sym} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11,
                background: 'rgba(251,191,36,.12)', color: '#fbbf24', fontWeight: 600,
                animation: 'pulse 1.5s infinite' }}>
                {sym}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 4, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {([
          { id: 'positions',  label: `Open (${positions.length})` },
          { id: 'candidates', label: `Candidates (${lastResult?.candidates?.length ?? 0})` },
          { id: 'history',    label: `History (${history.length})` },
          { id: 'watchlist',  label: `Watchlist (${watchlist.length})` },
          { id: 'runs',       label: `Runs (${runs.length})` },
        ] as { id: typeof tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, border: 'none',
              cursor: 'pointer', background: 'transparent',
              borderBottom: tab === t.id ? '2px solid var(--accent)' : '2px solid transparent',
              color: tab === t.id ? 'var(--accent)' : 'var(--muted)', marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab: Open Positions */}
      {tab === 'positions' && (
        <div>
          {loading && <div style={{ color: 'var(--muted)', textAlign: 'center', padding: 40 }}>Loading…</div>}
          {!loading && positions.length === 0 && (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📭</div>
              <div style={{ fontWeight: 600 }}>No open positions</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>Scan will open positions when high-confidence signals are found</div>
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
              <div>Scan in progress — candidates will appear here</div>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(lastResult?.candidates ?? []).map(c => <CandidateCard key={c.symbol} c={c} />)}
          </div>
        </div>
      )}

      {/* Tab: History */}
      {tab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 60, color: 'var(--muted)' }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>📋</div>
              <div style={{ fontWeight: 600 }}>No closed trades yet</div>
              <div style={{ fontSize: 12, marginTop: 6 }}>Closed positions will appear here after TP or SL is hit</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th>
                    <th>Confidence</th>
                    <th className="col-number">Qty</th>
                    <th className="col-number">Entry</th>
                    <th className="col-number">Exit</th>
                    <th className="col-number">P&L %</th>
                    <th className="col-number">P&L $</th>
                    <th>Reason</th>
                    <th>Closed</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(p => <HistoryRow key={p.id} p={p} />)}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Tab: Watchlist */}
      {tab === 'watchlist' && (
        <div>
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            <input
              value={newSymbol}
              onChange={e => setNewSymbol(e.target.value.toUpperCase())}
              onKeyDown={e => e.key === 'Enter' && handleAddSymbol()}
              placeholder="Add ticker (e.g. AAPL)"
              style={{ flex: 1, padding: '8px 12px', background: 'var(--card)',
                border: '1px solid var(--border)', borderRadius: 8, color: 'var(--fg)', fontSize: 13 }} />
            <button className="btn btn-primary" onClick={handleAddSymbol}>Add</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {watchlist.map(sym => (
              <div key={sym} style={{ display: 'flex', alignItems: 'center', gap: 4,
                padding: '4px 10px', background: 'var(--card)',
                border: '1px solid var(--border)', borderRadius: 6, fontSize: 12 }}>
                <span style={{ fontWeight: 700 }}>{sym}</span>
                <button onClick={() => updateWatchlist(sym, 'remove')}
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
                <th>Time</th>
                <th className="col-number">Scanned</th>
                <th className="col-number">Candidates</th>
                <th className="col-number">Orders</th>
                <th className="col-number">Managed</th>
                <th className="col-number">ms</th>
              </tr>
            </thead>
            <tbody>
              {runs.length === 0 && (
                <tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--muted)', padding: '30px 0' }}>No runs yet</td></tr>
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
