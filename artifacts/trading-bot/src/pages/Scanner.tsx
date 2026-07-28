// MOE-AI — Scanner Page
import { useState, useEffect, useRef } from 'react';
import type { TradingMode } from '../lib/config';
import { useScanner } from '../hooks/useScanner';
import type { ScanCandidate, ScannerPosition, LiveQuote, ScanRun } from '../hooks/useScanner';

// ── Module-level timer — survives page navigation ─────────────────────────────
let _lastScanAt   = 0;
const INTERVAL_MS = 5 * 60 * 1000;
function remainingSec() {
  if (_lastScanAt === 0) return 0;
  return Math.max(0, Math.ceil((INTERVAL_MS - (Date.now() - _lastScanAt)) / 1000));
}

// ── Types & Helpers ───────────────────────────────────────────────────────────
interface Props { mode: TradingMode; showToast: (msg: string, type?: 'success' | 'error') => void; }
type Dir = 1 | -1;

const CONF: Record<string, { bg: string; color: string; label: string }> = {
  HIGH:   { bg: 'rgba(34,197,94,.15)',  color: '#22c55e', label: '🟢 HIGH'   },
  MEDIUM: { bg: 'rgba(251,191,36,.15)', color: '#fbbf24', label: '🟡 MEDIUM' },
};
function fmt(n?: number, dec = 2)  { return n != null ? `$${n.toFixed(dec)}` : '—'; }
function fmtPct(n?: number)        { return n != null ? `${n >= 0 ? '+' : ''}${n.toFixed(2)}%` : '—'; }
function pnlColor(v?: number)      { return v == null ? '' : v >= 0 ? 'var(--green)' : 'var(--red)'; }
function fmtVol(v: number)         { return v >= 1_000_000 ? `${(v/1_000_000).toFixed(1)}M` : v >= 1_000 ? `${(v/1_000).toFixed(0)}K` : String(v); }
function today()                   { return new Date().toISOString().slice(0, 10); }

// ── Sortable table header cell ────────────────────────────────────────────────
function Th({
  label, col, sort, dir, onSort, right,
}: {
  label: string; col: string; sort: string; dir: Dir;
  onSort: (c: string) => void; right?: boolean;
}) {
  const active = sort === col;
  return (
    <th
      onClick={() => onSort(col)}
      className={right ? 'col-number' : ''}
      style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
        color: active ? 'var(--accent)' : undefined }}
    >
      {label}{active ? (dir === -1 ? ' ▼' : ' ▲') : ' ⇅'}
    </th>
  );
}

function useSort<T extends string>(init: T, initDir: Dir = -1) {
  const [sort, setSort] = useState<T>(init);
  const [dir,  setDir]  = useState<Dir>(initDir);
  const onSort = (col: string) => {
    if (col === sort) setDir(d => (d === 1 ? -1 : 1));
    else { setSort(col as T); setDir(-1); }
  };
  return { sort, dir, onSort };
}

// ── Live Market Grid ──────────────────────────────────────────────────────────
type MarketSort = 'symbol' | 'price' | 'change' | 'volume';
function MarketGrid({
  quotes, watchlist, scanning, candidates, onRefresh, quotesAt,
}: {
  quotes: LiveQuote[]; watchlist: string[]; scanning: boolean;
  candidates: ScanCandidate[]; onRefresh: () => void; quotesAt: string;
}) {
  const { sort, dir, onSort } = useSort<MarketSort>('change');
  const [search, setSearch] = useState('');
  const candMap  = new Map(candidates.map(c => [c.symbol, c]));
  const quoteMap = new Map(quotes.map(q => [q.symbol, q]));

  const rows: (LiveQuote & { candidate?: ScanCandidate })[] = [
    ...watchlist.filter(s => !quoteMap.has(s)).map(s => ({
      symbol: s, price: 0, open: 0, high: 0, low: 0, volume: 0,
      prevClose: 0, changeAmt: 0, changePct: 0, fetchedAt: '',
      candidate: candMap.get(s),
    })),
    ...quotes.map(q => ({ ...q, candidate: candMap.get(q.symbol) })),
  ].filter(r => !search || r.symbol.includes(search.toUpperCase()));

  const sorted = [...rows].sort((a, b) => {
    let d = 0;
    if (sort === 'symbol')  d = a.symbol.localeCompare(b.symbol);
    if (sort === 'price')   d = a.price - b.price;
    if (sort === 'change')  d = a.changePct - b.changePct;
    if (sort === 'volume')  d = a.volume - b.volume;
    return d * dir;
  });

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:12, alignItems:'center', flexWrap:'wrap' }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter ticker…"
          style={{ padding:'5px 10px', background:'var(--card)', border:'1px solid var(--border)',
            borderRadius:6, color:'var(--fg)', fontSize:12, width:130 }} />
        <div style={{ fontSize:11, color:'var(--muted)', flex:1 }}>
          {quotes.length}/{watchlist.length} loaded · {quotesAt ? `updated ${new Date(quotesAt).toLocaleTimeString()}` : 'not loaded'}
        </div>
        <button className="btn btn-ghost btn-sm" onClick={onRefresh} disabled={scanning} style={{ fontSize:11 }}>
          {scanning ? '⏳' : '↻'} Refresh
        </button>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th label="Symbol" col="symbol" sort={sort} dir={dir} onSort={onSort} />
              <th style={{ width:80 }}>Signal</th>
              <Th label="Price"  col="price"  sort={sort} dir={dir} onSort={onSort} right />
              <Th label="Change" col="change" sort={sort} dir={dir} onSort={onSort} right />
              <th className="col-number">Day Range</th>
              <Th label="Volume" col="volume" sort={sort} dir={dir} onSort={onSort} right />
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
              const isUp = r.changePct >= 0;
              const clr  = r.price === 0 ? 'var(--muted)' : isUp ? '#22c55e' : '#ef4444';
              const cs   = r.candidate ? CONF[r.candidate.confidence] : null;
              return (
                <tr key={r.symbol} style={{ opacity: r.price === 0 ? 0.4 : 1 }}>
                  <td style={{ fontWeight:700 }}>{r.symbol}</td>
                  <td>
                    {cs
                      ? <span style={{ fontSize:10, fontWeight:700, padding:'1px 5px', borderRadius:4,
                          background:cs.bg, color:cs.color }}>{cs.label}</span>
                      : <span style={{ fontSize:10, color:'var(--muted)' }}>—</span>}
                  </td>
                  <td className="col-number" style={{ fontWeight:700 }}>
                    {r.price > 0 ? fmt(r.price) : '…'}
                  </td>
                  <td className="col-number" style={{ color:clr, fontWeight:600 }}>
                    {r.price > 0
                      ? <>{isUp?'+':''}{r.changeAmt.toFixed(2)} <span style={{ fontSize:10 }}>({fmtPct(r.changePct)})</span></>
                      : '…'}
                  </td>
                  <td className="col-number" style={{ fontSize:11, color:'var(--muted)' }}>
                    {r.price > 0 ? `${fmt(r.low)} – ${fmt(r.high)}` : '…'}
                  </td>
                  <td className="col-number" style={{ fontSize:11, color:'var(--muted)' }}>
                    {r.volume > 0 ? fmtVol(r.volume) : '…'}
                  </td>
                  <td className="col-number">
                    {r.candidate ? (
                      <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                        <div style={{ flex:1, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
                          <div style={{ width:`${r.candidate.score*10}%`, height:'100%',
                            background:r.candidate.score>=8?'#22c55e':r.candidate.score>=5?'#fbbf24':'#64748b' }} />
                        </div>
                        <span style={{ fontSize:10, color:'var(--muted)' }}>{r.candidate.score}/10</span>
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

// ── Candidates Table (sortable) ───────────────────────────────────────────────
type CandSort = 'symbol' | 'score' | 'price' | 'tp' | 'sl';
function CandidatesTable({ candidates }: { candidates: ScanCandidate[] }) {
  const { sort, dir, onSort } = useSort<CandSort>('score');
  const [search, setSearch] = useState('');

  const rows = candidates
    .filter(c => !search || c.symbol.includes(search.toUpperCase()))
    .slice()
    .sort((a, b) => {
      let d = 0;
      if (sort === 'symbol') d = a.symbol.localeCompare(b.symbol);
      if (sort === 'score')  d = a.score - b.score;
      if (sort === 'price')  d = a.price - b.price;
      if (sort === 'tp')     d = ((a.takeProfit - a.entry) / a.entry) - ((b.takeProfit - b.entry) / b.entry);
      if (sort === 'sl')     d = ((a.stopLoss  - a.entry) / a.entry) - ((b.stopLoss  - b.entry) / b.entry);
      return d * dir;
    });

  if (candidates.length === 0) return (
    <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
      <div style={{ fontSize:32, marginBottom:12 }}>🔍</div>
      <div>Run a scan to see candidates</div>
      <div style={{ fontSize:12, marginTop:6 }}>Threshold: HIGH ≥8 · MEDIUM ≥5</div>
    </div>
  );

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter ticker…"
          style={{ padding:'5px 10px', background:'var(--card)', border:'1px solid var(--border)',
            borderRadius:6, color:'var(--fg)', fontSize:12, width:130 }} />
        <span style={{ fontSize:11, color:'var(--muted)', alignSelf:'center' }}>
          {rows.length} of {candidates.length}
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th label="Symbol" col="symbol" sort={sort} dir={dir} onSort={onSort} />
              <th>Signal</th>
              <Th label="Score"  col="score"  sort={sort} dir={dir} onSort={onSort} right />
              <Th label="Price"  col="price"  sort={sort} dir={dir} onSort={onSort} right />
              <Th label="TP %"   col="tp"     sort={sort} dir={dir} onSort={onSort} right />
              <Th label="SL %"   col="sl"     sort={sort} dir={dir} onSort={onSort} right />
              <th className="col-number">RSI</th>
              <th className="col-number">Vol×</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(c => {
              const cs    = CONF[c.confidence];
              const tpPct = ((c.takeProfit - c.entry) / c.entry * 100);
              const slPct = ((c.stopLoss  - c.entry) / c.entry * 100);
              return (
                <tr key={c.symbol}>
                  <td style={{ fontWeight:700 }}>{c.symbol}</td>
                  <td><span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4,
                    background:cs.bg, color:cs.color }}>{cs.label}</span></td>
                  <td className="col-number">
                    <div style={{ display:'flex', alignItems:'center', gap:4 }}>
                      <div style={{ width:36, height:4, background:'var(--border)', borderRadius:2, overflow:'hidden' }}>
                        <div style={{ width:`${c.score*10}%`, height:'100%',
                          background:c.score>=8?'#22c55e':c.score>=5?'#fbbf24':'#64748b' }} />
                      </div>
                      <span style={{ fontSize:11 }}>{c.score}/10</span>
                    </div>
                  </td>
                  <td className="col-number" style={{ fontWeight:700 }}>{fmt(c.price)}</td>
                  <td className="col-number" style={{ color:'#22c55e', fontWeight:600 }}>+{tpPct.toFixed(2)}%</td>
                  <td className="col-number" style={{ color:'#ef4444' }}>{slPct.toFixed(2)}%</td>
                  <td className="col-number" style={{ fontSize:11, color:'var(--muted)' }}>{c.rsi14.toFixed(1)}</td>
                  <td className="col-number" style={{ fontSize:11, color:'var(--muted)' }}>×{c.volumeRatio.toFixed(1)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Open Positions Table (sortable) ───────────────────────────────────────────
type PosSort = 'symbol' | 'pnlPct' | 'pnlAmt' | 'entry' | 'current' | 'score';
function PositionsTable({ positions }: { positions: ScannerPosition[] }) {
  const { sort, dir, onSort } = useSort<PosSort>('pnlPct');
  const [search, setSearch] = useState('');

  const withCalc = positions.map(p => {
    const pnlAmt = p.currentPrice ? (p.currentPrice - p.entryPrice) * p.quantity : 0;
    const pnlPct = p.entryPrice   ? ((p.currentPrice - p.entryPrice) / p.entryPrice * 100) : 0;
    return { ...p, pnlAmt, pnlPct };
  });

  const rows = withCalc
    .filter(p => !search || p.symbol.includes(search.toUpperCase()))
    .slice()
    .sort((a, b) => {
      let d = 0;
      if (sort === 'symbol')  d = a.symbol.localeCompare(b.symbol);
      if (sort === 'pnlPct')  d = a.pnlPct  - b.pnlPct;
      if (sort === 'pnlAmt')  d = a.pnlAmt  - b.pnlAmt;
      if (sort === 'entry')   d = a.entryPrice   - b.entryPrice;
      if (sort === 'current') d = a.currentPrice - b.currentPrice;
      if (sort === 'score')   d = a.score - b.score;
      return d * dir;
    });

  if (positions.length === 0) return (
    <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
      <div style={{ fontSize:32, marginBottom:12 }}>📭</div>
      <div style={{ fontWeight:600 }}>No open positions</div>
      <div style={{ fontSize:12, marginTop:6 }}>Scanner opens positions when high-confidence signals are found</div>
    </div>
  );

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:12 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter ticker…"
          style={{ padding:'5px 10px', background:'var(--card)', border:'1px solid var(--border)',
            borderRadius:6, color:'var(--fg)', fontSize:12, width:130 }} />
        <span style={{ fontSize:11, color:'var(--muted)', alignSelf:'center' }}>
          {rows.length} of {positions.length} positions
        </span>
      </div>
      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th label="Symbol"  col="symbol"  sort={sort} dir={dir} onSort={onSort} />
              <th>Signal</th>
              <th className="col-number">Qty</th>
              <Th label="Entry"   col="entry"   sort={sort} dir={dir} onSort={onSort} right />
              <Th label="Current" col="current" sort={sort} dir={dir} onSort={onSort} right />
              <Th label="P&L %"   col="pnlPct"  sort={sort} dir={dir} onSort={onSort} right />
              <Th label="P&L $"   col="pnlAmt"  sort={sort} dir={dir} onSort={onSort} right />
              <th className="col-number">SL</th>
              <th className="col-number">TP</th>
              <Th label="Score"   col="score"   sort={sort} dir={dir} onSort={onSort} right />
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const cs     = CONF[p.confidence] ?? CONF.MEDIUM;
              const slPct  = ((p.stopLoss   - p.entryPrice) / p.entryPrice * 100);
              const tpPct  = ((p.takeProfit - p.entryPrice) / p.entryPrice * 100);
              const prog   = p.takeProfit > p.entryPrice
                ? Math.max(0, Math.min(100, ((p.currentPrice - p.entryPrice) / (p.takeProfit - p.entryPrice)) * 100)) : 0;
              return (
                <tr key={p.id}>
                  <td>
                    <div style={{ fontWeight:700 }}>{p.symbol}</div>
                    <div style={{ fontSize:10, color:'var(--muted)' }}>High: {fmt(p.highestPrice)}</div>
                  </td>
                  <td><span style={{ fontSize:10, fontWeight:700, padding:'1px 6px', borderRadius:4,
                    background:cs.bg, color:cs.color }}>{cs.label}</span></td>
                  <td className="col-number" style={{ fontSize:11 }}>{p.quantity}</td>
                  <td className="col-number">{fmt(p.entryPrice)}</td>
                  <td className="col-number" style={{ fontWeight:700 }}>{fmt(p.currentPrice)}</td>
                  <td className="col-number" style={{ color:pnlColor(p.pnlPct), fontWeight:700 }}>
                    {fmtPct(p.pnlPct)}
                    <div style={{ marginTop:2, height:3, background:'var(--border)', borderRadius:2, overflow:'hidden', minWidth:40 }}>
                      <div style={{ width:`${prog}%`, height:'100%',
                        background:p.pnlAmt>=0?'#22c55e':'#ef4444', borderRadius:2 }} />
                    </div>
                  </td>
                  <td className="col-number" style={{ color:pnlColor(p.pnlAmt) }}>
                    {p.pnlAmt>=0?'+':''}{p.pnlAmt.toFixed(2)}
                  </td>
                  <td className="col-number" style={{ fontSize:11, color:'#ef4444' }}>{slPct.toFixed(1)}%</td>
                  <td className="col-number" style={{ fontSize:11, color:'#22c55e' }}>+{tpPct.toFixed(1)}%</td>
                  <td className="col-number" style={{ fontSize:11, color:'var(--muted)' }}>{p.score}/10</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── History Table (sortable) ──────────────────────────────────────────────────
type HistSort = 'symbol' | 'pnlPct' | 'pnlAmt' | 'entry' | 'exit' | 'time';
function HistoryTable({ history }: { history: ScannerPosition[] }) {
  const { sort, dir, onSort } = useSort<HistSort>('time');
  const [search, setSearch] = useState('');

  const withCalc = history.map(p => {
    const pnlAmt = p.pnl ?? 0;
    const pnlPct = p.entryPrice && p.exitPrice
      ? ((p.exitPrice - p.entryPrice) / p.entryPrice * 100) : 0;
    return { ...p, pnlAmt, pnlPct };
  });

  const rows = withCalc
    .filter(p => !search || p.symbol.includes(search.toUpperCase()))
    .slice()
    .sort((a, b) => {
      let d = 0;
      if (sort === 'symbol') d = a.symbol.localeCompare(b.symbol);
      if (sort === 'pnlPct') d = a.pnlPct - b.pnlPct;
      if (sort === 'pnlAmt') d = a.pnlAmt - b.pnlAmt;
      if (sort === 'entry')  d = a.entryPrice - b.entryPrice;
      if (sort === 'exit')   d = (a.exitPrice ?? 0) - (b.exitPrice ?? 0);
      if (sort === 'time')   d = new Date(a.closedAt ?? 0).getTime() - new Date(b.closedAt ?? 0).getTime();
      return d * dir;
    });

  if (history.length === 0) return (
    <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
      <div style={{ fontSize:32, marginBottom:12 }}>📋</div>
      <div style={{ fontWeight:600 }}>No closed trades yet</div>
      <div style={{ fontSize:12, marginTop:6 }}>Closed positions appear here after TP or SL is hit</div>
    </div>
  );

  // Summary row
  const totalPnl  = withCalc.reduce((s, p) => s + p.pnlAmt, 0);
  const winners   = withCalc.filter(p => p.pnlAmt > 0).length;
  const winRate   = history.length ? ((winners / history.length) * 100).toFixed(0) : '0';

  return (
    <div>
      {/* Mini summary */}
      <div style={{ display:'flex', gap:10, marginBottom:12, flexWrap:'wrap' }}>
        {[
          { label:'Total P&L', val:`${totalPnl>=0?'+':''}${totalPnl.toFixed(2)}$`, color:pnlColor(totalPnl) },
          { label:'Trades',    val:String(history.length), color:'var(--fg)' },
          { label:'Win Rate',  val:`${winRate}%`, color:'#22c55e' },
          { label:'Winners',   val:String(winners), color:'#22c55e' },
          { label:'Losers',    val:String(history.length - winners), color:'#ef4444' },
        ].map(m => (
          <div key={m.label} style={{ padding:'6px 12px', borderRadius:7, background:'var(--card)',
            border:'1px solid var(--border)', minWidth:70 }}>
            <div style={{ fontSize:9, color:'var(--muted)', marginBottom:1, letterSpacing:'.04em' }}>{m.label}</div>
            <div style={{ fontWeight:700, fontSize:14, color:m.color }}>{m.val}</div>
          </div>
        ))}
      </div>

      <div style={{ display:'flex', gap:8, marginBottom:10 }}>
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Filter ticker…"
          style={{ padding:'5px 10px', background:'var(--card)', border:'1px solid var(--border)',
            borderRadius:6, color:'var(--fg)', fontSize:12, width:130 }} />
        <span style={{ fontSize:11, color:'var(--muted)', alignSelf:'center' }}>
          {rows.length} of {history.length}
        </span>
      </div>

      <div className="table-wrap">
        <table className="data-table">
          <thead>
            <tr>
              <Th label="Symbol" col="symbol" sort={sort} dir={dir} onSort={onSort} />
              <th>Signal</th>
              <th className="col-number">Qty</th>
              <Th label="Entry"  col="entry"  sort={sort} dir={dir} onSort={onSort} right />
              <Th label="Exit"   col="exit"   sort={sort} dir={dir} onSort={onSort} right />
              <Th label="P&L %"  col="pnlPct" sort={sort} dir={dir} onSort={onSort} right />
              <Th label="P&L $"  col="pnlAmt" sort={sort} dir={dir} onSort={onSort} right />
              <th>Reason</th>
              <Th label="Closed" col="time"   sort={sort} dir={dir} onSort={onSort} />
            </tr>
          </thead>
          <tbody>
            {rows.map(p => {
              const cs = CONF[p.confidence] ?? CONF.MEDIUM;
              return (
                <tr key={p.id}>
                  <td style={{ fontWeight:700 }}>{p.symbol}</td>
                  <td><span style={{ fontSize:10, fontWeight:700, padding:'1px 5px', borderRadius:4,
                    background:cs.bg, color:cs.color }}>{cs.label}</span></td>
                  <td className="col-number" style={{ fontSize:11 }}>{p.quantity}</td>
                  <td className="col-number">{fmt(p.entryPrice)}</td>
                  <td className="col-number">{fmt(p.exitPrice)}</td>
                  <td className="col-number" style={{ color:pnlColor(p.pnlPct), fontWeight:600 }}>{fmtPct(p.pnlPct)}</td>
                  <td className="col-number" style={{ color:pnlColor(p.pnlAmt) }}>
                    {p.pnlAmt>=0?'+':''}{p.pnlAmt.toFixed(2)}
                  </td>
                  <td style={{ fontSize:10, color:'var(--muted)' }}>{p.closeReason ?? '—'}</td>
                  <td style={{ fontSize:10, color:'var(--muted)', whiteSpace:'nowrap' }}>
                    {p.closedAt ? new Date(p.closedAt).toLocaleTimeString() : '—'}
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

// ── Runs Table (sortable) ─────────────────────────────────────────────────────
type RunSort = 'time' | 'scanned' | 'candidates' | 'orders' | 'managed' | 'ms';
function RunsTable({ runs }: { runs: ScanRun[] }) {
  const { sort, dir, onSort } = useSort<RunSort>('time');

  const rows = [...runs].sort((a, b) => {
    let d = 0;
    if (sort === 'time')       d = new Date(a.ran_at).getTime() - new Date(b.ran_at).getTime();
    if (sort === 'scanned')    d = a.scanned_count    - b.scanned_count;
    if (sort === 'candidates') d = a.candidates_count - b.candidates_count;
    if (sort === 'orders')     d = a.orders_placed    - b.orders_placed;
    if (sort === 'managed')    d = a.positions_managed - b.positions_managed;
    if (sort === 'ms')         d = a.duration_ms      - b.duration_ms;
    return d * dir;
  });

  if (runs.length === 0) return (
    <div style={{ textAlign:'center', padding:60, color:'var(--muted)' }}>
      <div style={{ fontSize:32, marginBottom:12 }}>📊</div>
      <div>No scan runs yet</div>
    </div>
  );

  return (
    <div className="table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <Th label="Time"       col="time"       sort={sort} dir={dir} onSort={onSort} />
            <Th label="Scanned"    col="scanned"    sort={sort} dir={dir} onSort={onSort} right />
            <Th label="Candidates" col="candidates" sort={sort} dir={dir} onSort={onSort} right />
            <Th label="Orders"     col="orders"     sort={sort} dir={dir} onSort={onSort} right />
            <Th label="Managed"    col="managed"    sort={sort} dir={dir} onSort={onSort} right />
            <Th label="ms"         col="ms"         sort={sort} dir={dir} onSort={onSort} right />
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td style={{ fontSize:11, whiteSpace:'nowrap' }}>{new Date(r.ran_at).toLocaleTimeString()}</td>
              <td className="col-number">{r.scanned_count}</td>
              <td className="col-number" style={{ color:r.candidates_count>0?'var(--green)':'var(--muted)' }}>{r.candidates_count}</td>
              <td className="col-number" style={{ color:r.orders_placed>0?'var(--accent)':'var(--muted)' }}>{r.orders_placed}</td>
              <td className="col-number">{r.positions_managed}</td>
              <td className="col-number" style={{ color:r.duration_ms>3000?'#ef4444':r.duration_ms>1500?'#fbbf24':'#22c55e', fontWeight:600 }}>
                {r.duration_ms}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Watchlist Tab ─────────────────────────────────────────────────────────────
type WlSort = 'alpha' | 'alpha-desc';
function WatchlistTab({
  watchlist, onAdd, onRemove,
}: { watchlist: string[]; onAdd: (sym: string) => void; onRemove: (sym: string) => void }) {
  const [newSym, setNewSym] = useState('');
  const [wlSort, setWlSort] = useState<WlSort>('alpha');

  const sorted = [...watchlist].sort((a, b) =>
    wlSort === 'alpha' ? a.localeCompare(b) : b.localeCompare(a)
  );

  return (
    <div>
      <div style={{ display:'flex', gap:8, marginBottom:14, flexWrap:'wrap', alignItems:'center' }}>
        <input value={newSym} onChange={e => setNewSym(e.target.value.toUpperCase())}
          onKeyDown={e => { if (e.key === 'Enter' && newSym.trim()) { onAdd(newSym.trim()); setNewSym(''); } }}
          placeholder="Add ticker (e.g. AAPL)"
          style={{ flex:1, minWidth:140, padding:'8px 12px', background:'var(--card)',
            border:'1px solid var(--border)', borderRadius:8, color:'var(--fg)', fontSize:13 }} />
        <button className="btn btn-primary" onClick={() => { if (newSym.trim()) { onAdd(newSym.trim()); setNewSym(''); } }}>
          Add
        </button>
        <button
          onClick={() => setWlSort(s => s === 'alpha' ? 'alpha-desc' : 'alpha')}
          style={{ padding:'6px 12px', background:'var(--card)', border:'1px solid var(--border)',
            borderRadius:6, color:'var(--muted)', cursor:'pointer', fontSize:11, fontWeight:600 }}>
          A–Z {wlSort === 'alpha' ? '▲' : '▼'}
        </button>
      </div>
      <div style={{ fontSize:11, color:'var(--muted)', marginBottom:8 }}>{watchlist.length} symbols</div>
      <div style={{ display:'flex', flexWrap:'wrap', gap:6 }}>
        {sorted.map(sym => (
          <div key={sym} style={{ display:'flex', alignItems:'center', gap:4,
            padding:'4px 10px', background:'var(--card)',
            border:'1px solid var(--border)', borderRadius:6, fontSize:12 }}>
            <span style={{ fontWeight:700 }}>{sym}</span>
            <button onClick={() => onRemove(sym)}
              style={{ background:'none', border:'none', color:'var(--muted)',
                cursor:'pointer', fontSize:14, lineHeight:1, padding:'0 2px' }}>×</button>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function ScannerPage({ mode, showToast }: Props) {
  const {
    positions, history, quotes, quotesAt, lastResult, runs, config,
    watchlist, scanning, loading, error, runScan, loadQuotes, updateWatchlist,
  } = useScanner(mode);

  const [tab,        setTab]        = useState<'market' | 'positions' | 'candidates' | 'history' | 'watchlist' | 'runs'>('market');
  const [nextScanIn, setNextScanIn] = useState(0);
  const scanIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const countdownRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const runScanRef      = useRef(runScan);
  useEffect(() => { runScanRef.current = runScan; }, [runScan]);

  const todayHistory = history.filter(p => (p.closedAt ?? p.updatedAt ?? '').startsWith(today()));
  const todayPnl     = todayHistory.reduce((s, p) => s + (p.pnl ?? 0), 0);
  const todayWinners = todayHistory.filter(p => (p.pnl ?? 0) > 0).length;
  const candidates   = lastResult?.candidates ?? [];

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

  const mm = Math.floor(nextScanIn / 60);
  const ss = String(nextScanIn % 60).padStart(2, '0');

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

      {/* Summary bar */}
      <div style={{ display:'flex', gap:10, marginBottom:16, flexWrap:'wrap' }}>
        {[
          { label:'TODAY P&L',    val:`${todayPnl>=0?'+':''}${todayPnl.toFixed(2)}$`, color:pnlColor(todayPnl) },
          { label:'TODAY TRADES', val:String(todayHistory.length), color:'var(--fg)' },
          { label:'WIN RATE',     val:todayHistory.length?`${((todayWinners/todayHistory.length)*100).toFixed(0)}%`:'—', color:'#22c55e' },
          { label:'OPEN POS.',    val:String(positions.length), color:'var(--fg)' },
          { label:'CANDIDATES',   val:String(candidates.length), color:candidates.length>0?'#fbbf24':'var(--muted)' },
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
            { label:'TP',    val:`+${config.tpPct}%`,      color:'#22c55e' },
            { label:'Trail', val:`${config.trailPct}%`,    color:'#fbbf24' },
            { label:'SL',    val:`-${config.hardStopPct}%`, color:'#ef4444' },
            { label:'Range', val:`$${config.priceMin}–$${config.priceMax}`, color:'#60a5fa' },
            { label:'Risk',  val:`${config.riskPct}%`,     color:'#a78bfa' },
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
          <span style={{ color: lastResult.ms > 3000 ? '#fbbf24' : 'var(--muted)' }}>⏱ {lastResult.ms}ms</span>
          {(lastResult.errors?.length ?? 0) > 0 && (
            <span style={{ color:'#ef4444' }} title={lastResult.errors.join('\n')}>
              ⚠ {lastResult.errors.length} errors (hover)
            </span>
          )}
        </div>
      )}

      {loading && !lastResult && (
        <div style={{ textAlign:'center', padding:40, color:'var(--muted)' }}>Loading…</div>
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

      {tab === 'market'     && <MarketGrid quotes={quotes} watchlist={watchlist} scanning={scanning}
        candidates={candidates} onRefresh={loadQuotes} quotesAt={quotesAt} />}
      {tab === 'positions'  && <PositionsTable positions={positions} />}
      {tab === 'candidates' && <CandidatesTable candidates={candidates} />}
      {tab === 'history'    && <HistoryTable history={history} />}
      {tab === 'watchlist'  && <WatchlistTab watchlist={watchlist}
        onAdd={async sym => { await updateWatchlist(sym, 'add');    showToast(`${sym} added`,   'success'); }}
        onRemove={async sym => { await updateWatchlist(sym, 'remove'); showToast(`${sym} removed`, 'success'); }} />}
      {tab === 'runs'       && <RunsTable runs={runs} />}
    </div>
  );
}
