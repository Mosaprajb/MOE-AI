// MOE-AI — Scanner Page
import { useState, useEffect, useRef } from 'react';
import type { TradingMode } from '../lib/config';
import { useScanner } from '../hooks/useScanner';
import type { ScanCandidate, ScannerPosition, LiveQuote } from '../hooks/useScanner';

// ── Module-level timer — survives page navigation ─────────────────────────────
let _lastScanAt   = 0;
const INTERVAL_MS = 5 * 60 * 1000;
function remainingSec() {
  if (_lastScanAt === 0) return 0;
  return Math.max(0, Math.ceil((INTERVAL_MS - (Date.now() - _lastScanAt)) / 1000));
}

// ── Helpers ───────────────────────────────────────────────────────────────────
interface Props { mode: TradingMode; showToast: (msg: string, type?: 'success' | 'error') => void; }

const CONF: Record<string, { bg: string; color: string; label: string }> = {
  HIGH:   { bg: 'rgba(34,197,94,.15)',  color: '#22c55e', label: '🟢 HIGH'   },
  MEDIUM: { bg: 'rgba(251,191,36,.15)', color: '#fbbf24', label: '🟡 MEDIUM' },
};
function fmt(n?: number, dec = 2)  { return n != null ? `$${n.toFixed(dec)}` : '—'; }
function fmtPct(n?: number)        { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—'; }
function pnlColor(v?: number)      { return v == null ? '' : v >= 0 ? 'var(--green)' : 'var(--red)'; }
function fmtVol(v: number)         { return v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v/1_000).toFixed(0)}K` : String(v); }
function today()                   { return new Date().toISOString().slice(0, 10); }

// ── Live Market Grid ──────────────────────────────────────────────────────────
function MarketGrid({
  quotes, watchlist, scanning, candidates, onRefresh, quotesAt,
}: {
  quotes:     LiveQuote[];
  watchlist:  string[];
  scanning:   boolean;
  candidates: ScanCandidate[];
  onRefresh:  () => void;
  quotesAt:   string;
}) {
  const [sort, setSort] = useState<'symbol' | 'price' | 'change' | 'volume'>('change');
  const [dir,  setDir]  = useState<1 | -1>(-1);          // -1 = desc
  const [search, setSearch] = useState('');

  const candMap = new Map(candidates.map(c => [c.symbol, c]));

  // Merge watchlist (to show 0-price stubs for stocks not yet fetched)
  const quoteMap = new Map(quotes.map(q => [q.symbol, q]));
  const rows: (LiveQuote & { candidate?: ScanCandidate })[] = [
    ...watchlist
      .filter(sym => !quoteMap.has(sym))
      .map(sym => ({
        symbol: sym, price: 0, open: 0, high: 0, low: 0,
        volume: 0, prevClose: 0, changeAmt: 0, changePct: 0,
        fetchedAt: '', candidate: candMap.get(sym),
      })),
    ...quotes.map(q => ({ ...q, candidate: candMap.get(q.symbol) })),
  ].filter(r => !search || r.symbol.includes(search.toUpperCase()));

  const sorted = [...rows].sort((a, b) => {
    let diff = 0;
    if (sort === 'symbol')  diff = a.symbol.localeCompare(b.symbol);
    if (sort === 'price')   diff = a.price - b.price;
    if (sort === 'change')  diff = a.changePct - b.changePct;
    if (sort === 'volume')  diff = a.volume - b.volume;
    return diff * dir;
  });

  const handleSort = (col: typeof sort) => {
    if (col === sort) setDir(d => d === 1 ? -1 : 1);
    else { setSort(col); setDir(-1); }
  };
  const sortIcon = (col: typeof sort) => sort === col ? (dir === -1 ? ' ▼' : ' ▲') : '';

  const updatedStr = quotesAt ? new Date(quotesAt).toLocaleTimeString() : '—';

  return (
    <div>
      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter ticker…"
          style={{ padding: '5px 10px', background: 'var(--card)', border: '1px solid var(--border)',
            borderRadius: 6, color: 'var(--fg)', fontSize: 12, width: 130 }}
        />
        <div style={{ fontSize: 11, color: 'var(--muted)', flex: 1 }}>
          {quotes.length}/{watchlist.length} loaded · updated {updatedStr}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={scanning} style={{ fontSize: 11 }}>
          {scanning ? '⏳' : '↻'} Refresh
        </button>
      </div>

      {/* Table */}
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <th onClick={() => handleSort('symbol')} style={{ cursor:'pointer' }}>Symbol{sortIcon('symbol')}</th>
              <th style={{ width: 80 }}>Signal</th>
              <th className="col-number" onClick={() => handleSort('price')}  style={{ cursor:'pointer' }}>Price{sortIcon('price')}</th>
              <th className="col-number" onClick={() => handleSort('change')} style={{ cursor:'pointer' }}>Change{sortIcon('change')}</th>
              <th className="col-number">Day Range</th>
              <th className="col-number" onClick={() => handleSort('volume')} style={{ cursor:'pointer' }}>Volume{sortIcon('volume')}</th>
              <th className="col-number">Score</th>
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && (
              <tr><td colSpan={7} style={{ textAlign:'center', color:'var(--muted)', padding:'30px 0' }}>
                {scanning ? 'Fetching prices…' : 'No data — tap Refresh'}
              </td></tr>
            )}
            {sorted.map(r => {
              const isUp   = r.changePct >= 0;
              const clr    = r.price === 0 ? 'var(--muted)' : isUp ? '#22c55e' : '#ef4444';
              const cand   = r.candidate;
              const cs     = cand ? CONF[cand.confidence] : null;
              return (
                <tr key={r.symbol} style={{ opacity: r.price === 0 ? 0.4 : 1 }}>
                  <td style={{ fontWeight: 700 }}>{r.symbol}</td>
                  <td>
                    {cs
                      ? <span style={{ fontSize: 10, fontWeight: 700, padding: '1px 5px',
                          borderRadius: 4, background: cs.bg, color: cs.color }}>{cs.label}</span>
                      : <span style={{ fontSize: 10, color: 'var(--muted)' }}>—</span>}
                  </td>
                  <td className="col-number" style={{ fontWeight: 700 }}>
                    {r.price > 0 ? fmt(r.price) : '…'}
                  </td>
                  <td className="col-number" style={{ color: clr, fontWeight: 600 }}>
                    {r.price > 0 ? (
                      <>
                        {isUp ? '+' : ''}{r.changeAmt.toFixed(2)}{' '}
                        <span style={{ fontSize: 10 }}>({fmtPct(r.changePct)})</span>
                      </>
                    ) : '…'}
                  </td>
                  <td className="col-number" style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {r.price > 0 ? `${fmt(r.low)} – ${fmt(r.high)}` : '…'}
                  </td>
                  <td className="col-number" style={{ fontSize: 11, color: 'var(--muted)' }}>
                    {r.volume > 0 ? fmtVol(r.volume) : '…'}
                  </td>
                  <td className="col-number">
                    {cand ? (
                      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                        <div style={{ flex:1, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
                          <div style={{ width:`${cand.score*10}%`, height:'100%',
                            background: cand.score>=8?'#22c55e':cand.score>=5?'#fbbf24':'#64748b' }} />
                        </div>
                        <span style={{ fontSize:10, color:'var(--muted)', whiteSpace:'nowrap' }}>{cand.score}/10</span>
                      </div>
                    ) : <span style={{ color:'var(--muted)', fontSize:11 }}>—</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Candidate Card ────────────────────────────────────────────────────────────
function CandidateCard({ c }: { c: ScanCandidate }) {
  const [expanded, setExpanded] = useState(false);
  const cs    = CONF[c.confidence];
  const tpPct = ((c.takeProfit - c.entry) / c.entry * 100).toFixed(2);
  const slPct = ((c.stopLoss  - c.entry) / c.entry * 100).toFixed(2);
  return (
    <div className="card" style={{ cursor:'pointer' }} onClick={() => setExpanded(e => !e)}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10 }}>
          <div style={{ fontWeight:800, fontSize:16 }}>{c.symbol}</div>
          <div style={{ fontSize:11, fontWeight:700, padding:'2px 8px', borderRadius:5,
            background:cs.bg, color:cs.color }}>{cs.label}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>Score: {c.score}/10</div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontWeight:700 }}>{fmt(c.price)}</div>
          <div style={{ fontSize:11, color:'var(--muted)' }}>
            TP {fmt(c.takeProfit)} <span style={{ color:'var(--green)' }}>(+{tpPct}%)</span>
          </div>
        </div>
      </div>
      <div style={{ marginTop:8, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
        <div style={{ width:`${c.score*10}%`, height:'100%',
          background:c.score>=8?'#22c55e':c.score>=5?'#fbbf24':'#64748b',
          borderRadius:2, transition:'width .4s' }} />
      </div>
      <div style={{ display:'flex', gap:16, marginTop:6, fontSize:12 }}>
        <span style={{ color:'var(--red)' }}>SL {fmt(c.stopLoss)} ({slPct}%)</span>
        <span style={{ color:'var(--green)' }}>TP {fmt(c.takeProfit)} (+{tpPct}%)</span>
        <span style={{ color:'var(--muted)' }}>Trail {c.trailPct}%</span>
      </div>
      {expanded && (
        <div style={{ marginTop:10, paddingTop:10, borderTop:'1px solid var(--border)' }}>
          <div style={{ fontSize:11, color:'var(--muted)', marginBottom:6 }}>Entry signals:</div>
          {c.reasons.map((r, i) => (
            <div key={i} style={{ fontSize:12, padding:'2px 0', display:'flex', alignItems:'center', gap:6 }}>
              <span style={{ color:'var(--green)' }}>✓</span> {r}
            </div>
          ))}
          <div style={{ marginTop:8, display:'flex', gap:20, fontSize:11, color:'var(--muted)' }}>
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

// ── Position Row ──────────────────────────────────────────────────────────────
function PositionRow({ p }: { p: ScannerPosition }) {
  const cs       = CONF[p.confidence];
  const pnlAmt   = p.currentPrice ? (p.currentPrice - p.entryPrice) * p.quantity : 0;
  const pnlPct   = p.entryPrice   ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100) : 0;
  const slPct    = p.entryPrice   ? ((p.stopLoss - p.entryPrice) / p.entryPrice * 100) : 0;
  const tpPct    = p.entryPrice   ? ((p.takeProfit - p.entryPrice) / p.entryPrice * 100) : 0;
  const progress = p.takeProfit > p.entryPrice
    ? Math.max(0, Math.min(100, ((p.currentPrice - p.entryPrice) / (p.takeProfit - p.entryPrice)) * 100)) : 0;
  return (
    <div className="card" style={{ padding:'12px 16px' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
        <div>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <span style={{ fontWeight:800 }}>{p.symbol}</span>
            <span style={{ fontSize:11, fontWeight:700, padding:'1px 6px', borderRadius:4,
              background:cs.bg, color:cs.color }}>{cs.label}</span>
          </div>
          <div style={{ fontSize:12, color:'var(--muted)', marginTop:2 }}>
            Entry {fmt(p.entryPrice)} · {p.quantity} shares
          </div>
        </div>
        <div style={{ textAlign:'right' }}>
          <div style={{ fontWeight:700, color:pnlColor(pnlAmt) }}>{fmtPct(pnlPct)}</div>
          <div style={{ fontSize:12, color:pnlColor(pnlAmt) }}>{pnlAmt>=0?'+':''}{pnlAmt.toFixed(2)}$</div>
        </div>
      </div>
      <div style={{ margin:'10px 0 4px', height:6, background:'var(--border)', borderRadius:3, overflow:'hidden' }}>
        <div style={{ width:`${progress}%`, height:'100%',
          background:pnlAmt>=0?'#22c55e':'#ef4444', borderRadius:3, transition:'width .4s' }} />
      </div>
      <div style={{ display:'flex', justifyContent:'space-between', fontSize:11 }}>
        <span style={{ color:'var(--red)' }}>SL {fmt(p.stopLoss)} ({slPct.toFixed(1)}%)</span>
        <span style={{ fontWeight:600 }}>{fmt(p.currentPrice)}</span>
        <span style={{ color:'var(--green)' }}>TP {fmt(p.takeProfit)} (+{tpPct.toFixed(1)}%)</span>
      </div>
      <div style={{ fontSize:10, color:'var(--muted)', marginTop:4 }}>
        Trail {p.trailPct}% · High {fmt(p.highestPrice)} · Score {p.score}/10
      </div>
    </div>
  );
}

// ── History Row ───────────────────────────────────────────────────────────────
function HistoryRow({ p }: { p: ScannerPosition }) {
  const cs     = CONF[p.confidence] ?? CONF.MEDIUM;
  const pnl    = p.pnl ?? 0;
  const pnlPct = p.entryPrice && p.exitPrice
    ? ((p.exitPrice - p.entryPrice) / p.entryPrice * 100) : 0;
  return (
    <tr>
      <td style={{ fontWeight:700 }}>{p.symbol}</td>
      <td><span style={{ fontSize:11, fontWeight:700, padding:'1px 6px', borderRadius:4,
        background:cs.bg, color:cs.color }}>{cs.label}</span></td>
      <td className="col-number">{p.quantity}</td>
      <td className="col-number">{fmt(p.entryPrice)}</td>
      <td className="col-number">{fmt(p.exitPrice)}</td>
      <td className="col-number" style={{ color:pnlColor(pnl), fontWeight:600 }}>{fmtPct(pnlPct)}</td>
      <td className="col-number" style={{ color:pnlColor(pnl) }}>{pnl>=0?'+':''}{pnl.toFixed(2)}</td>
      <td style={{ fontSize:10, color:'var(--muted)' }}>{p.closeReason ?? '—'}</td>
      <td style={{ fontSize:10, color:'var(--muted)' }}>
        {p.closedAt ? new Date(p.closedAt).toLocaleTimeString() : '—'}
      </td>
    </tr>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ScannerPage({ mode, showToast }: Props) {
  const {
    positions, history, quotes, quotesAt, lastResult, runs, config,
    watchlist, scanning, loading, error, runScan, loadQuotes, updateWatchlist,
  } = useScanner(mode);

  const [newSymbol, setNewSymbol] = useState('');
  const [tab,       setTab]       = useState<'market' | 'positions' | 'candidates' | 'history' | 'watchlist' | 'runs'>('market');
  const [nextScanIn, setNextScanIn] = useState(0);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const runScanRef      = useRef(runScan);
  useEffect(() => { runScanRef.current = runScan; }, [runScan]);

  // Today's P&L from history
  const todayHistory = history.filter(p => (p.closedAt ?? p.updatedAt ?? '').startsWith(today()));
  const todayPnl     = todayHistory.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const todayWinners = todayHistory.filter(p => (p.pnl ?? 0) > 0).length;

  const doScan = async () => {
    const result = await runScanRef.current();
    _lastScanAt = Date.now();
    setNextScanIn(INTERVAL_MS / 1000);
    showToast(
      result
        ? `✅ Scan complete — ${result.candidates?.length ?? 0} candidates, ${result.ordersPlaced} orders`
        : '❌ Scan failed — check connection',
      result ? 'success' : 'error',
    );
  };

  // Auto-scan: timer persists across navigation via module-level _lastScanAt
  useEffect(() => {
    let cancelled = false;
    const maybeScan = () => { if (!cancelled) doScan(); };
    const initial   = remainingSec();
    setNextScanIn(initial);

    let firstTimer: ReturnType<typeof setTimeout>;
    if (initial === 0) {
      maybeScan();
      scanIntervalRef.current = setInterval(maybeScan, INTERVAL_MS);
    } else {
      firstTimer = setTimeout(() => {
        if (cancelled) return;
        maybeScan();
        scanIntervalRef.current = setInterval(maybeScan, INTERVAL_MS);
      }, initial * 1000);
    }
    countdownRef.current = setInterval(() => setNextScanIn(remainingSec()), 1000);
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
    showToast(`${sym} added`, 'success');
  };

  const mm = Math.floor(nextScanIn / 60);
  const ss = String(nextScanIn % 60).padStart(2, '0');
  const candidates = lastResult?.candidates ?? [];

  return (
    <div className="page">
      {/* Header */}
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:16 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom:2 }}>📡 Smart Scanner</h1>
          <div style={{ fontSize:12, color:'var(--muted)' }}>
            MOE Scalp v1 · {watchlist.length} stocks ·{' '}
            {scanning ? '⏳ Scanning now…' : `⏱ Next scan in ${mm}:${ss}`}
          </div>
        </div>
        <button className="btn btn-primary" onClick={doScan} disabled={scanning} style={{ minWidth:120 }}>
          {scanning ? '⏳ Scanning…' : '🔍 Scan Now'}
        </button>
      </div>

      {/* Today's summary bar */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        {[
          { label:'TODAY P&L',    val:`${todayPnl>=0?'+':''}${todayPnl.toFixed(2)}$`, color:pnlColor(todayPnl) },
          { label:'TODAY TRADES', val:String(todayHistory.length), color:'var(--fg)' },
          { label:'WIN RATE',     val:todayHistory.length?`${((todayWinners/todayHistory.length)*100).toFixed(0)}%`:'—', color:'#22c55e' },
          { label:'OPEN POS.',    val:String(positions.length), color:'var(--fg)' },
          { label:'CANDIDATES',   val:String(candidates.length), color: candidates.length>0?'#fbbf24':'var(--muted)' },
        ].map(m => (
          <div key={m.label} style={{ flex:1, minWidth:80, padding:'8px 12px', borderRadius:8,
            background:'var(--card)', border:'1px solid var(--border)' }}>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:2, letterSpacing:'.05em' }}>{m.label}</div>
            <div style={{ fontWeight:800, fontSize:16, color:m.color }}>{m.val}</div>
          </div>
        ))}
      </div>

      {/* Config pills */}
      {config && (
        <div style={{ display:'flex', gap:8, flexWrap:'wrap', marginBottom:14 }}>
          {[
            { label:'TP',    val:`+${config.tpPct}%`,           color:'#22c55e' },
            { label:'Trail', val:`${config.trailPct}%`,          color:'#fbbf24' },
            { label:'SL',    val:`-${config.hardStopPct}%`,      color:'#ef4444' },
            { label:'Range', val:`$${config.priceMin}–$${config.priceMax}`, color:'#60a5fa' },
            { label:'Risk',  val:`${config.riskPct}%`,           color:'#a78bfa' },
          ].map(p => (
            <div key={p.label} style={{ padding:'2px 8px', borderRadius:5, fontSize:11,
              background:`${p.color}18`, color:p.color, border:`1px solid ${p.color}33`, fontWeight:600 }}>
              {p.label}: {p.val}
            </div>
          ))}
        </div>
      )}

      {error && (
        <div style={{ padding:'10px 14px', background:'rgba(239,68,68,.1)',
          border:'1px solid rgba(239,68,68,.3)', borderRadius:8, color:'#ef4444',
          fontSize:12, marginBottom:14 }}>{error}</div>
      )}

      {/* Last scan summary */}
      {lastResult && (
        <div style={{ padding:'8px 14px', background:'rgba(96,165,250,.07)',
          border:'1px solid rgba(96,165,250,.2)', borderRadius:8, marginBottom:14,
          display:'flex', gap:16, fontSize:12, flexWrap:'wrap' }}>
          <span>🔍 Scanned: <b>{lastResult.scanned}</b></span>
          <span style={{ color:'#22c55e' }}>📊 Candidates: <b>{candidates.length}</b></span>
          <span style={{ color:'#a78bfa' }}>📋 Orders: <b>{lastResult.ordersPlaced}</b></span>
          <span style={{ color:'var(--muted)' }}>⏱ {lastResult.ms}ms</span>
          {(lastResult.errors?.length ?? 0) > 0 && (
            <span style={{ color:'#ef4444' }}>⚠ {lastResult.errors.length} errors</span>
          )}
        </div>
      )}

      {/* Tabs */}
      <div style={{ display:'flex', gap:2, marginBottom:14, borderBottom:'1px solid var(--border)', overflowX:'auto' }}>
        {([
          { id:'market',     label:`📈 Market (${quotes.length || watchlist.length})` },
          { id:'positions',  label:`Open (${positions.length})` },
          { id:'candidates', label:`Candidates (${candidates.length})` },
          { id:'history',    label:`History (${history.length})` },
          { id:'watchlist',  label:`Watchlist (${watchlist.length})` },
          { id:'runs',       label:`Runs (${runs.length})` },
        ] as { id: typeof tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)}
            style={{ padding:'8px 12px', fontSize:12, fontWeight:600, border:'none', cursor:'pointer',
              background:'transparent', whiteSpace:'nowrap',
              borderBottom:tab===t.id?'2px solid var(--accent)':'2px solid transparent',
              color:tab===t.id?'var(--accent)':'var(--muted)', marginBottom:-1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Market Tab ── */}
      {tab === 'market' && (
        <MarketGrid
          quotes={quotes}
          watchlist={watchlist}
          scanning={scanning}
          candidates={candidates}
          onRefresh={loadQuotes}
          quotesAt={quotesAt}
        />
      )}

      {/* ── Open Positions Tab ── */}
      {tab === 'positions' && (
        <div>
          {loading && <div style={{ color:'var(--muted)', textAlign:'center', padding:40 }}>Loading…</div>}
          {!loading && positions.length === 0 && (
            <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>📭</div>
              <div style={{ fontWeight:600 }}>No open positions</div>
              <div style={{ fontSize:12, marginTop:6 }}>Scanner opens positions when high-confidence signals are found</div>
            </div>
          )}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {positions.map(p => <PositionRow key={p.id} p={p} />)}
          </div>
        </div>
      )}

      {/* ── Candidates Tab ── */}
      {tab === 'candidates' && (
        <div>
          {!lastResult ? (
            <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>🔍</div>
              <div>Run a scan to see candidates</div>
            </div>
          ) : candidates.length === 0 ? (
            <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>😶</div>
              <div>No qualifying candidates this cycle</div>
              <div style={{ fontSize:12, marginTop:6 }}>Score threshold: HIGH ≥8 / MEDIUM ≥5</div>
            </div>
          ) : null}
          <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
            {candidates.map(c => <CandidateCard key={c.symbol} c={c} />)}
          </div>
        </div>
      )}

      {/* ── History Tab ── */}
      {tab === 'history' && (
        <div>
          {history.length === 0 ? (
            <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
              <div style={{ fontSize:32, marginBottom:12 }}>📋</div>
              <div style={{ fontWeight:600 }}>No closed trades yet</div>
              <div style={{ fontSize:12, marginTop:6 }}>Closed positions appear here after TP or SL is hit</div>
            </div>
          ) : (
            <div className="table-wrap">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>Symbol</th><th>Signal</th>
                    <th className="col-number">Qty</th>
                    <th className="col-number">Entry</th>
                    <th className="col-number">Exit</th>
                    <th className="col-number">P&L %</th>
                    <th className="col-number">P&L $</th>
                    <th>Reason</th><th>Closed</th>
                  </tr>
                </thead>
                <tbody>{history.map(p => <HistoryRow key={p.id} p={p} />)}</tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ── Watchlist Tab ── */}
      {tab === 'watchlist' && (
        <div>
          <div style={{ display:'flex', gap:8, marginBottom:14 }}>
            <input value={newSymbol} onChange={e => setNewSymbol(e.target.value.toUpperCase())}
              onKeyDown={e => e.key==='Enter' && handleAddSymbol()}
              placeholder="Add ticker (e.g. AAPL)"
              style={{ flex:1, padding:'8px 12px', background:'var(--card)',
                border:'1px solid var(--border)', borderRadius:8, color:'var(--fg)', fontSize:13 }} />
            <button className="btn btn-primary" onClick={handleAddSymbol}>Add</button>
          </div>
          <div style={{ display:'flex', flexWrap:'wrap', gap:8 }}>
            {watchlist.map(sym => (
              <div key={sym} style={{ display:'flex', alignItems:'center', gap:4,
                padding:'4px 10px', background:'var(--card)',
                border:'1px solid var(--border)', borderRadius:6, fontSize:12 }}>
                <span style={{ fontWeight:700 }}>{sym}</span>
                <button onClick={() => updateWatchlist(sym, 'remove')}
                  style={{ background:'none', border:'none', color:'var(--muted)',
                    cursor:'pointer', fontSize:14, lineHeight:1, padding:'0 2px' }}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Runs Tab ── */}
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
                <tr><td colSpan={6} style={{ textAlign:'center', color:'var(--muted)', padding:'30px 0' }}>No runs yet</td></tr>
              )}
              {runs.map(r => (
                <tr key={r.id}>
                  <td style={{ fontSize:11 }}>{new Date(r.ran_at).toLocaleTimeString()}</td>
                  <td className="col-number">{r.scanned_count}</td>
                  <td className="col-number" style={{ color:r.candidates_count>0?'var(--green)':'var(--muted)' }}>{r.candidates_count}</td>
                  <td className="col-number" style={{ color:r.orders_placed>0?'var(--accent)':'var(--muted)' }}>{r.orders_placed}</td>
                  <td className="col-number">{r.positions_managed}</td>
                  <td className="col-number" style={{ color:'var(--muted)' }}>{r.duration_ms}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
