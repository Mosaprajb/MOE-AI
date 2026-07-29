// MOE-AI — Scanner Page (main product)
import { useState, useEffect, useRef } from 'react';
import type { TradingMode } from '../lib/config';
import { API_BASE } from '../lib/config';
import { useScanner } from '../hooks/useScanner';
import { useDashboard } from '../hooks/useApi';
import type { ScanCandidate, ScannerPosition, LiveQuote } from '../hooks/useScanner';

// ── Browser notifications helper (safe in iframes / restricted contexts) ──────
function getNotifPerm(): NotificationPermission | 'unsupported' {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
    return Notification.permission;
  } catch { return 'unsupported'; }
}

async function requestNotifPermission(): Promise<boolean> {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return false;
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') return false;
    const result = await Notification.requestPermission();
    return result === 'granted';
  } catch { return false; }
}

function sendNotif(title: string, body: string) {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission !== 'granted') return;
    new Notification(title, { body, icon: '/favicon.ico', silent: false });
  } catch { /* ignore security errors in iframes */ }
}

interface Props { mode: TradingMode; showToast: (m: string, t?: 'success'|'error') => void; }

const fmt    = (n?: number) => n != null ? `$${n.toFixed(2)}` : '—';
const fmtK   = (n: number)  => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : String(n);
const fmtPct = (n: number, plus = false) => `${plus && n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
const pnlClr = (n: number) => n >= 0 ? 'var(--green)' : 'var(--red)';

// Countdown until next auto-scan
let _lastScanAt = 0;
const SCAN_INTERVAL = 5 * 60 * 1000;
function useScanCountdown(scanning: boolean) {
  const [sec, setSec] = useState(0);
  useEffect(() => {
    const t = setInterval(() => {
      if (_lastScanAt === 0) { setSec(0); return; }
      setSec(Math.max(0, Math.ceil((SCAN_INTERVAL - (Date.now() - _lastScanAt)) / 1000)));
    }, 1000);
    return () => clearInterval(t);
  }, [scanning]);
  return sec;
}

// ── Stock Search ──────────────────────────────────────────────────────────────
interface SearchResult { symbol: string; name: string; exchange: string; type: string; }
interface QuoteDetail {
  symbol: string;
  quote:  { price: number; changeAmt: number; changePct: number; volume: number; high: number; low: number; };
  scored: { score: number; confidence: string; reasons: string[]; takeProfit: number; stopLoss: number; entry: number; } | null;
}

function StockSearch({
  onAdd, showToast,
}: {
  onAdd: (sym: string) => void;
  showToast: (m: string, t?: 'success'|'error') => void;
}) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<SearchResult[]>([]);
  const [detail,   setDetail]   = useState<QuoteDetail | null>(null);
  const [open,     setOpen]     = useState(false);
  const [loadingS, setLoadingS] = useState(false);
  const [loadingD, setLoadingD] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const wrapRef     = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    debounceRef.current = setTimeout(async () => {
      setLoadingS(true);
      try {
        const res = await fetch(`${API_BASE}/api/scanner/search?q=${encodeURIComponent(q)}`, { mode: 'cors' });
        const d   = await res.json() as { results?: SearchResult[] };
        setResults(d.results ?? []);
        setOpen(true);
      } catch { /* silent */ }
      finally { setLoadingS(false); }
    }, 280);
  };

  const selectSymbol = async (sym: string) => {
    setOpen(false);
    setQuery(sym);
    setDetail(null);
    setLoadingD(true);
    try {
      const res = await fetch(`${API_BASE}/api/scanner/quote/${sym}`, { mode: 'cors' });
      if (!res.ok) { showToast(`No data for ${sym}`, 'error'); return; }
      const d = await res.json() as QuoteDetail;
      setDetail(d);
    } catch { showToast(`Failed to load ${sym}`, 'error'); }
    finally { setLoadingD(false); }
  };

  const pnlClr = (n: number) => n >= 0 ? 'var(--green)' : 'var(--red)';
  const fmt    = (n?: number) => n != null ? `$${n.toFixed(2)}` : '—';
  const fmtK   = (n: number) => n >= 1e6 ? `${(n/1e6).toFixed(1)}M` : n >= 1e3 ? `${(n/1e3).toFixed(0)}K` : String(n);

  return (
    <div ref={wrapRef} style={{ marginBottom: 14, position: 'relative' }}>
      {/* Search input */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 440 }}>
          <span style={{
            position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)',
            fontSize: 16, pointerEvents: 'none', color: 'var(--muted)',
          }}>🔍</span>
          <input
            className="input"
            style={{ paddingLeft: 34, fontSize: 14 }}
            placeholder="Search any stock — TSLA, AAPL, NVDA…"
            value={query}
            onChange={e => search(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
          />
          {loadingS && (
            <span style={{
              position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
            }}><span className="spinner" style={{ width: 14, height: 14 }} /></span>
          )}
        </div>
        {query && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setResults([]); setDetail(null); setOpen(false); }}>
            Clear
          </button>
        )}
      </div>

      {/* Dropdown results */}
      {open && results.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, maxWidth: 440,
          background: 'var(--surface)', border: '1px solid var(--border)',
          borderRadius: 10, marginTop: 4, zIndex: 200,
          boxShadow: '0 12px 40px rgba(0,0,0,.5)', overflow: 'hidden',
        }}>
          {results.map(r => (
            <div key={r.symbol}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)',
                transition: 'background .12s',
              }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => selectSymbol(r.symbol)}
            >
              <div>
                <span style={{ fontWeight: 800, fontSize: 14 }}>{r.symbol}</span>
                <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 12 }}>{r.name}</span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--dim)', marginLeft: 8, flexShrink: 0 }}>{r.exchange}</span>
            </div>
          ))}
        </div>
      )}

      {/* Detail card */}
      {loadingD && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, color: 'var(--muted)', fontSize: 13 }}>
          <span className="spinner" /> Loading data…
        </div>
      )}
      {detail && !loadingD && (
        <div style={{
          marginTop: 10, padding: '14px 16px', borderRadius: 12,
          background: 'var(--surface)', border: '1px solid var(--border)',
          display: 'flex', flexWrap: 'wrap', gap: 16, alignItems: 'flex-start',
        }}>
          {/* Symbol + price */}
          <div style={{ minWidth: 160 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <span style={{ fontSize: 20, fontWeight: 900 }}>{detail.symbol}</span>
              {detail.scored && (
                <span className={`signal-pill ${detail.scored.confidence === 'HIGH' ? 'signal-high' : detail.scored.confidence === 'MEDIUM' ? 'signal-med' : 'badge-muted badge'}`}>
                  {detail.scored.confidence === 'NONE' ? 'WAIT' : detail.scored.confidence}
                </span>
              )}
            </div>
            <div style={{ fontSize: 24, fontWeight: 900 }}>{fmt(detail.quote.price)}</div>
            <div style={{ fontSize: 13, color: pnlClr(detail.quote.changeAmt), fontWeight: 700 }}>
              {detail.quote.changeAmt >= 0 ? '+' : ''}{detail.quote.changeAmt.toFixed(2)} ({detail.quote.changePct >= 0 ? '+' : ''}{detail.quote.changePct.toFixed(2)}%)
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>
              Vol {fmtK(detail.quote.volume)} · H {fmt(detail.quote.high)} · L {fmt(detail.quote.low)}
            </div>
          </div>

          {/* Score + levels */}
          {detail.scored && detail.scored.confidence !== 'NONE' && (
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: 'flex', gap: 14, marginBottom: 8 }}>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Score</div>
                  <div style={{ fontSize: 22, fontWeight: 900, color: 'var(--cyan)' }}>{detail.scored.score}/10</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>Entry</div>
                  <div style={{ fontWeight: 700 }}>{fmt(detail.scored.entry)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>TP</div>
                  <div style={{ fontWeight: 700, color: 'var(--green)' }}>{fmt(detail.scored.takeProfit)}</div>
                </div>
                <div>
                  <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em' }}>SL</div>
                  <div style={{ fontWeight: 700, color: 'var(--red)' }}>{fmt(detail.scored.stopLoss)}</div>
                </div>
              </div>
              {detail.scored.reasons.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {detail.scored.reasons.slice(0, 4).map((r, i) => (
                    <span key={i} className="reason-tag">{r}</span>
                  ))}
                </div>
              )}
            </div>
          )}
          {detail.scored && detail.scored.confidence === 'NONE' && (
            <div style={{ color: 'var(--muted)', fontSize: 13, padding: '4px 0' }}>
              No setup detected — conditions not aligned for a BUY signal.
            </div>
          )}

          {/* Actions */}
          <div style={{ display: 'flex', gap: 8, alignSelf: 'center', flexShrink: 0 }}>
            <button className="btn btn-primary btn-sm" onClick={() => {
              onAdd(detail.symbol);
              showToast(`${detail.symbol} added to watchlist`, 'success');
            }}>
              + Add to Watchlist
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setDetail(null); setQuery(''); }}>
              ✕
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Account Bar ───────────────────────────────────────────────────────────────
function AccountBar({ mode }: { mode: TradingMode }) {
  const { data } = useDashboard(mode, 20_000);
  const acct = data?.account ?? {};
  const pos  = data?.positions ?? [];
  const openPnl = pos.reduce((s: number, p: { unrealizedPnl?: number }) => s + (p.unrealizedPnl ?? 0), 0);

  const items = [
    { label: 'Cash',        val: acct.cash        ? fmt(acct.cash)        : '—' },
    { label: 'Buying Power',val: acct.buyingPower ? fmt(acct.buyingPower) : '—' },
    { label: 'Account',     val: acct.accountValue? fmt(acct.accountValue): '—' },
    { label: 'Open P&L',    val: fmt(openPnl), color: pnlClr(openPnl) },
    { label: 'Day P&L',     val: acct.dayPnl != null ? `${acct.dayPnl >= 0?'+':''}${fmt(acct.dayPnl)}` : '—',
      color: acct.dayPnl != null ? pnlClr(acct.dayPnl) : undefined },
  ];

  return (
    <div className="account-bar">
      {items.map(it => (
        <div key={it.label} className="account-bar-item">
          <span className="account-bar-label">{it.label}</span>
          <span className="account-bar-val" style={{ color: it.color }}>{it.val}</span>
        </div>
      ))}
      <div style={{ marginLeft: 'auto' }}>
        <span className={`badge ${mode === 'LIVE' ? 'badge-red' : 'badge-green'}`}>{mode}</span>
      </div>
    </div>
  );
}

// ── Scanner Controls ──────────────────────────────────────────────────────────
function ScannerControls({
  watchlist, scanning, lastResult, onScan, onAdd, onRemove,
}: {
  watchlist: string[];
  scanning: boolean;
  lastResult: { scanned: number; candidates: ScanCandidate[]; ordersPlaced: number; ms: number } | null;
  onScan: () => void;
  onAdd: (s: string) => void;
  onRemove: (s: string) => void;
}) {
  const [input, setInput] = useState('');
  const countdown = useScanCountdown(scanning);

  const submit = () => {
    const sym = input.trim().toUpperCase();
    if (!sym || sym.length > 6) return;
    onAdd(sym);
    setInput('');
  };

  return (
    <div className="scanner-controls">
      {/* Run button + status */}
      <div className="scanner-run-row">
        <button
          className={`btn btn-scan${scanning ? ' scanning' : ''}`}
          onClick={onScan}
          disabled={scanning}>
          {scanning
            ? <><span className="pulse-dot" />Scanning…</>
            : <><span style={{ fontSize: 16 }}>▶</span> Run Scan</>}
        </button>

        <div className="scanner-status">
          {lastResult ? (
            <>
              <span className="scan-stat"><b>{lastResult.scanned}</b> <span>scanned</span></span>
              <span className="scan-sep" />
              <span className="scan-stat"><b style={{ color: lastResult.candidates.length ? 'var(--green)' : 'var(--muted)' }}>{lastResult.candidates.length}</b> <span>signals</span></span>
              <span className="scan-sep" />
              <span className="scan-stat"><b>{lastResult.ordersPlaced}</b> <span>orders</span></span>
              <span className="scan-sep" />
              <span className="scan-stat" style={{ color: 'var(--muted)' }}>{lastResult.ms}ms</span>
              {countdown > 0 && (
                <><span className="scan-sep" /><span className="scan-stat" style={{ color: 'var(--muted)' }}>next in {countdown}s</span></>
              )}
            </>
          ) : (
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>Press Run Scan to start</span>
          )}
        </div>
      </div>

      {/* Watchlist */}
      <div className="watchlist-row">
        <div className="watchlist-chips">
          {watchlist.map(sym => (
            <div key={sym} className="watchlist-chip">
              {sym}
              <button onClick={() => onRemove(sym)} className="chip-x">×</button>
            </div>
          ))}
          {watchlist.length === 0 && (
            <span style={{ color: 'var(--muted)', fontSize: 12 }}>Using default watchlist ({'>'}70 symbols)</span>
          )}
        </div>
        <div className="watchlist-input-row">
          <input
            className="input input-sym"
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6))}
            onKeyDown={e => e.key === 'Enter' && submit()}
            placeholder="Add ticker…"
            maxLength={6}
          />
          <button className="btn btn-ghost btn-sm" onClick={submit} disabled={!input.trim()}>Add</button>
        </div>
      </div>
    </div>
  );
}

// ── Live Market Grid ──────────────────────────────────────────────────────────
function MarketGrid({ quotes, watchlist, scanning, candidates }: {
  quotes: LiveQuote[]; watchlist: string[]; scanning: boolean; candidates: ScanCandidate[];
}) {
  const [filter, setFilter] = useState('');
  const candMap = new Map(candidates.map(c => [c.symbol, c]));
  const quoteMap = new Map(quotes.map(q => [q.symbol, q]));

  const rows = [
    ...watchlist.filter(s => !quoteMap.has(s)).map(s => ({
      symbol: s, price: 0, changePct: 0, changeAmt: 0, volume: 0, high: 0, low: 0, fetchedAt: '',
    })),
    ...quotes,
  ]
    .filter(r => !filter || r.symbol.includes(filter.toUpperCase()))
    .sort((a, b) => {
      const ca = candMap.get(a.symbol), cb = candMap.get(b.symbol);
      if (ca && !cb) return -1;
      if (!ca && cb) return 1;
      return (b.changePct ?? 0) - (a.changePct ?? 0);
    });

  return (
    <div className="market-grid-wrap">
      <div className="market-grid-header">
        <span className="panel-title">Market · {quotes.length}/{watchlist.length || '75+'}</span>
        <input className="input input-xs" value={filter}
          onChange={e => setFilter(e.target.value)} placeholder="Filter…" />
      </div>

      <div className="market-grid">
        {rows.length === 0 && (
          <div style={{ gridColumn: '1/-1', textAlign: 'center', padding: 30, color: 'var(--muted)', fontSize: 12 }}>
            {scanning ? 'Loading prices…' : 'No data'}
          </div>
        )}
        {rows.map(r => {
          const cand = candMap.get(r.symbol);
          const up   = r.price > 0 ? r.changePct >= 0 : null;
          const clr  = up === null ? 'var(--muted)' : up ? 'var(--green)' : 'var(--red)';
          return (
            <div key={r.symbol} className={`mkt-card${cand ? ' mkt-card-signal' : ''}`}
              style={{ opacity: r.price === 0 ? 0.45 : 1 }}>
              <div className="mkt-top">
                <span className="mkt-sym">{r.symbol}</span>
                {cand && (
                  <span className={`signal-pill ${cand.confidence === 'HIGH' ? 'signal-high' : 'signal-med'}`}>
                    {cand.confidence === 'HIGH' ? '🟢 BUY' : '🟡 WATCH'}
                  </span>
                )}
              </div>
              <div className="mkt-price" style={{ color: r.price > 0 ? 'var(--text)' : 'var(--muted)' }}>
                {r.price > 0 ? fmt(r.price) : '…'}
              </div>
              <div className="mkt-change" style={{ color: clr }}>
                {r.price > 0
                  ? <>{up ? '+' : ''}{r.changeAmt.toFixed(2)} <span>({fmtPct(r.changePct, true)})</span></>
                  : '—'}
              </div>
              {cand && (
                <div className="mkt-score">
                  <div className="score-bar-track">
                    <div className="score-bar-fill"
                      style={{ width: `${cand.score * 10}%`,
                        background: cand.score >= 8 ? 'var(--green)' : 'var(--yellow)' }} />
                  </div>
                  <span>{cand.score}/10</span>
                </div>
              )}
              {r.volume > 0 && (
                <div className="mkt-vol">{fmtK(r.volume)}</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── BUY Signals Panel ─────────────────────────────────────────────────────────
function SignalsPanel({ candidates }: { candidates: ScanCandidate[] }) {
  if (candidates.length === 0) return (
    <div className="signals-empty">
      <div style={{ fontSize: 36, marginBottom: 10 }}>🔍</div>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>No signals yet</div>
      <div style={{ fontSize: 12, color: 'var(--muted)' }}>Run a scan to find BUY candidates</div>
    </div>
  );

  return (
    <div className="signals-list">
      {candidates.map(c => {
        const tpPct = ((c.takeProfit - c.entry) / c.entry * 100);
        const slPct = ((c.stopLoss  - c.entry) / c.entry * 100);
        return (
          <div key={c.symbol} className={`signal-card ${c.confidence === 'HIGH' ? 'signal-card-high' : 'signal-card-med'}`}>
            <div className="sig-top">
              <div>
                <span className="sig-sym">{c.symbol}</span>
                <span className={`signal-pill ${c.confidence === 'HIGH' ? 'signal-high' : 'signal-med'}`} style={{ marginLeft: 8 }}>
                  {c.confidence}
                </span>
              </div>
              <div className="sig-score">
                <span>{c.score}</span>
                <span style={{ fontSize: 11, color: 'var(--muted)', fontWeight: 400 }}>/10</span>
              </div>
            </div>
            <div className="sig-prices">
              <div className="sig-px-item">
                <span className="sig-px-label">Entry</span>
                <span>{fmt(c.entry)}</span>
              </div>
              <div className="sig-px-item">
                <span className="sig-px-label">TP</span>
                <span style={{ color: 'var(--green)' }}>+{tpPct.toFixed(1)}%</span>
              </div>
              <div className="sig-px-item">
                <span className="sig-px-label">SL</span>
                <span style={{ color: 'var(--red)' }}>{slPct.toFixed(1)}%</span>
              </div>
              <div className="sig-px-item">
                <span className="sig-px-label">RSI</span>
                <span>{c.rsi14.toFixed(0)}</span>
              </div>
              <div className="sig-px-item">
                <span className="sig-px-label">Vol×</span>
                <span>{c.volumeRatio.toFixed(1)}</span>
              </div>
            </div>
            {c.reasons.length > 0 && (
              <div className="sig-reasons">
                {c.reasons.slice(0, 3).map((r, i) => <span key={i} className="reason-tag">{r}</span>)}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Open Positions Strip ──────────────────────────────────────────────────────
function OpenPositionsStrip({ positions }: { positions: ScannerPosition[] }) {
  if (positions.length === 0) return null;

  return (
    <div className="open-strip">
      <div className="panel-title" style={{ marginBottom: 10 }}>Open Positions · {positions.length}</div>
      <div className="pos-strip-grid">
        {positions.map(p => {
          const pnlAmt = (p.currentPrice - p.entryPrice) * p.quantity;
          const pnlPct = ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100;
          const slPct  = ((p.stopLoss - p.entryPrice) / p.entryPrice) * 100;
          return (
            <div key={p.id} className={`pos-strip-card ${pnlAmt >= 0 ? 'pos-green' : 'pos-red'}`}>
              <div className="pos-strip-top">
                <span className="pos-strip-sym">{p.symbol}</span>
                <span style={{ fontWeight: 800, color: pnlClr(pnlAmt) }}>
                  {pnlAmt >= 0 ? '+' : ''}{pnlAmt.toFixed(2)}
                </span>
              </div>
              <div className="pos-strip-row">
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>Entry {fmt(p.entryPrice)}</span>
                <span style={{ color: pnlClr(pnlAmt), fontWeight: 700 }}>{fmtPct(pnlPct, true)}</span>
              </div>
              <div className="pos-strip-row">
                <span style={{ color: 'var(--muted)', fontSize: 11 }}>SL {fmt(p.stopLoss)}</span>
                <span style={{ color: 'var(--red)', fontSize: 11 }}>{slPct.toFixed(1)}%</span>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Scanner Page Root ─────────────────────────────────────────────────────────
export default function ScannerPage({ mode, showToast }: Props) {
  const {
    positions, quotes, watchlist, scanning, lastResult,
    runScan, loadQuotes, updateWatchlist,
  } = useScanner(mode);

  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [autoScan, setAutoScan] = useState(false);

  // Extract candidates from lastResult
  const cands: ScanCandidate[] = lastResult?.candidates ?? [];

  // Use a stable ref so the auto-scan interval never re-registers on re-renders
  const handleScanRef = useRef<() => Promise<void>>(async () => {});

  const handleScan = async () => {
    _lastScanAt = Date.now();
    const result = await runScan();
    if (result) {
      const cnt  = result.candidates.length;
      const high = result.candidates.filter(c => c.confidence === 'HIGH').length;
      showToast(
        cnt > 0 ? `✓ Scan done — ${cnt} signal${cnt !== 1 ? 's' : ''} found` : '✓ Scan done — no signals',
        cnt > 0 ? 'success' : undefined,
      );
      if (cnt > 0) {
        const symbols = result.candidates.slice(0, 3).map(c => c.symbol).join(', ');
        sendNotif(
          `MOE-AI · ${cnt} BUY Signal${cnt !== 1 ? 's' : ''}`,
          `${high > 0 ? `${high} HIGH — ` : ''}${symbols}${cnt > 3 ? ` +${cnt - 3} more` : ''}`,
        );
      }
    }
    await loadQuotes();
  };
  handleScanRef.current = handleScan;

  // Auto-scan effect only re-runs when autoScan toggles, not on every render
  useEffect(() => {
    if (autoScan) {
      handleScanRef.current();
      autoRef.current = setInterval(() => handleScanRef.current(), SCAN_INTERVAL);
    } else {
      if (autoRef.current) clearInterval(autoRef.current);
    }
    return () => { if (autoRef.current) clearInterval(autoRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoScan]);

  return (
    <div>
      {/* Account metrics strip */}
      <AccountBar mode={mode} />

      {/* Stock search */}
      <StockSearch
        onAdd={sym => updateWatchlist(sym, 'add')}
        showToast={showToast}
      />

      {/* Controls: run scan + watchlist */}
      <ScannerControls
        watchlist={watchlist}
        scanning={scanning}
        lastResult={lastResult}
        onScan={handleScan}
        onAdd={sym => updateWatchlist(sym, 'add').then(() => showToast(`Added ${sym}`, 'success'))}
        onRemove={sym => updateWatchlist(sym, 'remove').then(() => showToast(`Removed ${sym}`))}
      />

      {/* Auto-scan + notification toggle */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18, flexWrap: 'wrap' }}>
        <label className="toggle" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={autoScan} onChange={async e => {
            const next = e.target.checked;
            setAutoScan(next);
            if (next) {
              // Request notification permission when enabling auto-scan
              await requestNotifPermission();
            }
            showToast(next ? 'Auto-scan ON — every 5 min' : 'Auto-scan OFF', next ? 'success' : undefined);
          }} />
          <div className="toggle-track" />
          <div className="toggle-thumb" />
        </label>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Auto-scan every 5 min</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>· Sandbox until you switch to Live</span>

        {/* Notification permission indicator — uses safe helper, no direct Notification.permission in JSX */}
        {getNotifPerm() !== 'unsupported' && (
          <button
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11 }}
            onClick={async () => {
              const ok = await requestNotifPermission();
              showToast(ok ? '🔔 Notifications enabled' : '🔕 Notifications blocked — check browser settings', ok ? 'success' : 'error');
            }}
          >
            {getNotifPerm() === 'granted' ? '🔔 Notifications on' : '🔕 Enable notifications'}
          </button>
        )}
      </div>

      {/* Main grid: market + signals */}
      <div className="scanner-main-grid">
        <div>
          <MarketGrid
            quotes={quotes}
            watchlist={watchlist}
            scanning={scanning}
            candidates={cands}
          />
        </div>
        <div>
          <div className="panel-title" style={{ marginBottom: 12 }}>
            BUY Signals · {cands.length}
          </div>
          <SignalsPanel candidates={cands} />
        </div>
      </div>

      {/* Open positions strip */}
      <OpenPositionsStrip positions={positions.filter(p => p.status === 'OPEN')} />
    </div>
  );
}
