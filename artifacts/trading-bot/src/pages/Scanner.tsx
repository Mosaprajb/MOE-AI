// MOE-AI — Scanner Page (main product)
import { useState, useEffect, useRef } from 'react';
import type { TradingMode } from '../lib/config';
import { API_BASE } from '../lib/config';
import { useScanner } from '../hooks/useScanner';
import { useDashboard } from '../hooks/useApi';
import type { ScanCandidate, ScanResult, ScannerPosition, LiveQuote } from '../hooks/useScanner';

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

// Static list for instant local autocomplete — no network needed
const STOCK_LIST: { symbol: string; name: string }[] = [
  { symbol:'AAPL',  name:'Apple Inc.' },
  { symbol:'MSFT',  name:'Microsoft Corp.' },
  { symbol:'GOOGL', name:'Alphabet Inc.' },
  { symbol:'AMZN',  name:'Amazon.com Inc.' },
  { symbol:'NVDA',  name:'NVIDIA Corp.' },
  { symbol:'META',  name:'Meta Platforms' },
  { symbol:'TSLA',  name:'Tesla Inc.' },
  { symbol:'BRK.B', name:'Berkshire Hathaway B' },
  { symbol:'UNH',   name:'UnitedHealth Group' },
  { symbol:'LLY',   name:'Eli Lilly and Co.' },
  { symbol:'JPM',   name:'JPMorgan Chase' },
  { symbol:'V',     name:'Visa Inc.' },
  { symbol:'XOM',   name:'Exxon Mobil' },
  { symbol:'AVGO',  name:'Broadcom Inc.' },
  { symbol:'PG',    name:'Procter & Gamble' },
  { symbol:'MA',    name:'Mastercard' },
  { symbol:'JNJ',   name:'Johnson & Johnson' },
  { symbol:'COST',  name:'Costco Wholesale' },
  { symbol:'ABBV',  name:'AbbVie Inc.' },
  { symbol:'ORCL',  name:'Oracle Corp.' },
  { symbol:'MRK',   name:'Merck & Co.' },
  { symbol:'CVX',   name:'Chevron Corp.' },
  { symbol:'NFLX',  name:'Netflix Inc.' },
  { symbol:'AMD',   name:'Advanced Micro Devices' },
  { symbol:'CRM',   name:'Salesforce Inc.' },
  { symbol:'WMT',   name:'Walmart Inc.' },
  { symbol:'BAC',   name:'Bank of America' },
  { symbol:'KO',    name:'Coca-Cola Co.' },
  { symbol:'PEP',   name:'PepsiCo Inc.' },
  { symbol:'ADBE',  name:'Adobe Inc.' },
  { symbol:'TMO',   name:'Thermo Fisher Scientific' },
  { symbol:'CSCO',  name:'Cisco Systems' },
  { symbol:'ACN',   name:'Accenture' },
  { symbol:'MCD',   name:'McDonald\'s Corp.' },
  { symbol:'ABT',   name:'Abbott Laboratories' },
  { symbol:'TXN',   name:'Texas Instruments' },
  { symbol:'AMGN',  name:'Amgen Inc.' },
  { symbol:'LIN',   name:'Linde PLC' },
  { symbol:'DHR',   name:'Danaher Corp.' },
  { symbol:'INTU',  name:'Intuit Inc.' },
  { symbol:'QCOM',  name:'Qualcomm Inc.' },
  { symbol:'CAT',   name:'Caterpillar Inc.' },
  { symbol:'GILD',  name:'Gilead Sciences' },
  { symbol:'GS',    name:'Goldman Sachs' },
  { symbol:'BA',    name:'Boeing Co.' },
  { symbol:'SPGI',  name:'S&P Global' },
  { symbol:'AXP',   name:'American Express' },
  { symbol:'UNP',   name:'Union Pacific' },
  { symbol:'HON',   name:'Honeywell Intl.' },
  { symbol:'SBUX',  name:'Starbucks Corp.' },
  { symbol:'BKNG',  name:'Booking Holdings' },
  { symbol:'MS',    name:'Morgan Stanley' },
  { symbol:'BLK',   name:'BlackRock Inc.' },
  { symbol:'ISRG',  name:'Intuitive Surgical' },
  { symbol:'DE',    name:'Deere & Company' },
  { symbol:'NOW',   name:'ServiceNow Inc.' },
  { symbol:'GE',    name:'GE Aerospace' },
  { symbol:'RTX',   name:'RTX Corp.' },
  { symbol:'ADI',   name:'Analog Devices' },
  { symbol:'VRTX',  name:'Vertex Pharmaceuticals' },
  { symbol:'REGN',  name:'Regeneron Pharma' },
  { symbol:'PANW',  name:'Palo Alto Networks' },
  { symbol:'AMAT',  name:'Applied Materials' },
  { symbol:'LRCX',  name:'Lam Research' },
  { symbol:'MU',    name:'Micron Technology' },
  { symbol:'KLAC',  name:'KLA Corp.' },
  { symbol:'MELI',  name:'MercadoLibre' },
  { symbol:'UBER',  name:'Uber Technologies' },
  { symbol:'SNOW',  name:'Snowflake Inc.' },
  { symbol:'COIN',  name:'Coinbase Global' },
  { symbol:'PLTR',  name:'Palantir Technologies' },
  { symbol:'SHOP',  name:'Shopify Inc.' },
  { symbol:'SQ',    name:'Block Inc.' },
  { symbol:'PYPL',  name:'PayPal Holdings' },
  { symbol:'SPOT',  name:'Spotify Technology' },
  { symbol:'DKNG',  name:'DraftKings Inc.' },
  { symbol:'RBLX',  name:'Roblox Corp.' },
  { symbol:'RIVN',  name:'Rivian Automotive' },
  { symbol:'LCID',  name:'Lucid Group' },
  { symbol:'NIO',   name:'NIO Inc.' },
  { symbol:'XPEV',  name:'XPeng Inc.' },
  { symbol:'LI',    name:'Li Auto Inc.' },
  { symbol:'HOOD',  name:'Robinhood Markets' },
  { symbol:'SOFI',  name:'SoFi Technologies' },
  { symbol:'AFRM',  name:'Affirm Holdings' },
  { symbol:'UPST',  name:'Upstart Holdings' },
  { symbol:'OPEN',  name:'Opendoor Technologies' },
  { symbol:'ABNB',  name:'Airbnb Inc.' },
  { symbol:'DASH',  name:'DoorDash Inc.' },
  { symbol:'LYFT',  name:'Lyft Inc.' },
  { symbol:'ZM',    name:'Zoom Video Comm.' },
  { symbol:'CRWD',  name:'CrowdStrike Holdings' },
  { symbol:'ZS',    name:'Zscaler Inc.' },
  { symbol:'OKTA',  name:'Okta Inc.' },
  { symbol:'NET',   name:'Cloudflare Inc.' },
  { symbol:'DDOG',  name:'Datadog Inc.' },
  { symbol:'GTLB',  name:'GitLab Inc.' },
  { symbol:'HUBS',  name:'HubSpot Inc.' },
  { symbol:'WDAY',  name:'Workday Inc.' },
  { symbol:'VEEV',  name:'Veeva Systems' },
  { symbol:'TTD',   name:'The Trade Desk' },
  { symbol:'ROKU',  name:'Roku Inc.' },
  { symbol:'TWLO',  name:'Twilio Inc.' },
  { symbol:'U',     name:'Unity Software' },
  { symbol:'IONQ',  name:'IonQ Inc.' },
  { symbol:'QUBT',  name:'Quantum Computing' },
  { symbol:'MSTR',  name:'MicroStrategy Inc.' },
  { symbol:'SMCI',  name:'Super Micro Computer' },
  { symbol:'ARM',   name:'ARM Holdings' },
  { symbol:'ASML',  name:'ASML Holding' },
  { symbol:'TSM',   name:'Taiwan Semiconductor' },
  { symbol:'INTC',  name:'Intel Corp.' },
  { symbol:'WDC',   name:'Western Digital' },
  { symbol:'STX',   name:'Seagate Technology' },
  { symbol:'NXPI',  name:'NXP Semiconductors' },
  { symbol:'ON',    name:'onsemi' },
  { symbol:'MRVL',  name:'Marvell Technology' },
  { symbol:'GFS',   name:'GlobalFoundries' },
  { symbol:'F',     name:'Ford Motor Co.' },
  { symbol:'GM',    name:'General Motors' },
  { symbol:'TM',    name:'Toyota Motor' },
  { symbol:'HMC',   name:'Honda Motor' },
  { symbol:'STLA',  name:'Stellantis N.V.' },
  { symbol:'SPY',   name:'SPDR S&P 500 ETF' },
  { symbol:'QQQ',   name:'Invesco QQQ Trust' },
  { symbol:'DIA',   name:'SPDR Dow Jones ETF' },
  { symbol:'IWM',   name:'iShares Russell 2000' },
  { symbol:'VTI',   name:'Vanguard Total Market' },
  { symbol:'ARKK',  name:'ARK Innovation ETF' },
  { symbol:'SOXS',  name:'Direxion Semi Bear 3x' },
  { symbol:'SOXL',  name:'Direxion Semi Bull 3x' },
  { symbol:'TQQQ',  name:'ProShares Ultra QQQ 3x' },
  { symbol:'SQQQ',  name:'ProShares UltraPro S QQQ' },
  { symbol:'XLF',   name:'Financial Select ETF' },
  { symbol:'XLK',   name:'Technology Select ETF' },
  { symbol:'XLE',   name:'Energy Select ETF' },
  { symbol:'GLD',   name:'SPDR Gold Shares' },
  { symbol:'SLV',   name:'iShares Silver Trust' },
];

function searchStocks(q: string): { symbol: string; name: string }[] {
  const upper = q.toUpperCase().trim();
  if (!upper) return [];
  return STOCK_LIST.filter(
    s => s.symbol.startsWith(upper) || s.name.toUpperCase().includes(upper)
  ).slice(0, 10);
}

// ── Local EMA / RSI scoring engine ───────────────────────────────────────────
function calcEMA(prices: number[], period: number): number[] {
  if (!prices.length) return [];
  const k = 2 / (period + 1);
  const out = [prices[0]];
  for (let i = 1; i < prices.length; i++) out.push(prices[i] * k + out[i - 1] * (1 - k));
  return out;
}
function calcRSI(prices: number[], period = 14): number {
  if (prices.length < period + 1) return 50;
  const ch = prices.slice(1).map((p, i) => p - prices[i]);
  let ag = 0, al = 0;
  for (let i = 0; i < period; i++) { ag += Math.max(0, ch[i]); al += Math.max(0, -ch[i]); }
  ag /= period; al /= period;
  for (let i = period; i < ch.length; i++) {
    ag = (ag * (period - 1) + Math.max(0,  ch[i])) / period;
    al = (al * (period - 1) + Math.max(0, -ch[i])) / period;
  }
  return al === 0 ? 100 : 100 - 100 / (1 + ag / al);
}
interface LocalScore {
  score: number; confidence: 'HIGH' | 'MEDIUM' | 'NONE';
  reasons: string[]; entry: number; takeProfit: number; stopLoss: number;
  ema9: number; ema21: number; rsi14: number; volumeRatio: number;
}
function scoreFromCandles(
  candles: { close: number; volume: number }[],
  config: import('../hooks/useScanner').ScannerConfig | null,
): LocalScore | null {
  if (candles.length < 22) return null;
  const closes  = candles.map(c => c.close);
  const volumes = candles.map(c => c.volume);
  const e9  = calcEMA(closes, 9);
  const e21 = calcEMA(closes, 21);
  const rsi = calcRSI(closes);
  const price = closes.at(-1)!;
  const prev  = closes.at(-2) ?? price;
  const ema9  = e9.at(-1)!;
  const ema21 = e21.at(-1)!;
  const v20   = volumes.slice(-20);
  const avgV  = v20.reduce((a, b) => a + b, 0) / Math.max(v20.length, 1);
  const volR  = avgV > 0 ? (volumes.at(-1) ?? 0) / avgV : 1;
  let score = 0; const reasons: string[] = [];
  if (ema9 > ema21)               { score += 3; reasons.push('EMA9 > EMA21'); }
  if (rsi >= 45 && rsi <= 65)     { score += 2; reasons.push(`RSI ${rsi.toFixed(0)}`); }
  else if (rsi >= 40)             { score += 1; reasons.push(`RSI ${rsi.toFixed(0)}`); }
  if (volR >= 1.5)                { score += 2; reasons.push(`Vol ${volR.toFixed(1)}x`); }
  else if (volR >= 1.2)           { score += 1; reasons.push(`Vol ${volR.toFixed(1)}x`); }
  if (price > ema9)               { score += 2; reasons.push('Price > EMA9'); }
  if (price > prev)               { score += 1; reasons.push('Bullish candle'); }
  const confidence: 'HIGH' | 'MEDIUM' | 'NONE' = score >= 7 ? 'HIGH' : score >= 5 ? 'MEDIUM' : 'NONE';
  const tpPct = config?.tpPct       ?? 3;
  const slPct = config?.hardStopPct ?? 2;
  return { score, confidence, reasons, entry: price,
    takeProfit: price * (1 + tpPct / 100), stopLoss: price * (1 - slPct / 100),
    ema9, ema21, rsi14: rsi, volumeRatio: volR };
}

interface SearchResult { symbol: string; name: string; exchange: string; type: string; }
interface StockDetail {
  symbol: string; price: number; changeAmt: number; changePct: number;
  volume: number; high: number; low: number; score: LocalScore | null;
}

function StockSearch({
  onAdd, showToast, config, onFocusScan, scanning,
}: {
  onAdd: (sym: string) => Promise<void>;
  showToast: (m: string, t?: 'success'|'error') => void;
  config: import('../hooks/useScanner').ScannerConfig | null;
  onFocusScan: (sym: string) => Promise<void>;
  scanning: boolean;
}) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<SearchResult[]>([]);
  const [detail,   setDetail]   = useState<StockDetail | null>(null);
  const [open,     setOpen]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [focusing, setFocusing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const fn = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  // Instant local search — no network, no CORS issues
  const search = (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    const hits = searchStocks(q);
    setResults(hits.map(h => ({ symbol: h.symbol, name: h.name, exchange: 'US', type: 'EQUITY' })));
    setOpen(hits.length > 0);
  };

  const selectSymbol = async (sym: string) => {
    setOpen(false);
    setQuery(sym);
    setDetail(null);
    setLoading(true);
    try {
      // 15-minute candles give price meta AND candle history for local scoring
      const yfRes = await fetch(
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=15m&range=5d&includePrePost=false`,
        { mode: 'cors', headers: { Accept: 'application/json' } }
      ).catch(() => null);
      if (yfRes?.ok) {
        const data  = await yfRes.json() as {
          chart?: { result?: [{ meta?: Record<string, number | null>; indicators?: { quote?: [{ close?: (number|null)[]; volume?: (number|null)[] }] } }] };
        };
        const r     = data?.chart?.result?.[0];
        const meta  = r?.meta;
        const q0    = r?.indicators?.quote?.[0];
        if (meta && q0) {
          const rawC = q0.close  ?? [];
          const rawV = q0.volume ?? [];
          const candles = rawC.reduce<{ close: number; volume: number }[]>((acc, c, i) => {
            if (c !== null && c > 0) acc.push({ close: c, volume: Number(rawV[i] ?? 0) });
            return acc;
          }, []);
          const price     = Number(meta.regularMarketPrice)     || (candles.at(-1)?.close ?? 0);
          const prevClose = Number(meta.chartPreviousClose)      || price;
          setDetail({
            symbol: sym, price,
            changeAmt: price - prevClose,
            changePct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
            volume: Number(meta.regularMarketVolume)  || 0,
            high:   Number(meta.regularMarketDayHigh) || 0,
            low:    Number(meta.regularMarketDayLow)  || 0,
            score:  scoreFromCandles(candles, config),
          });
          return;
        }
      }
      showToast(`No data for ${sym}`, 'error');
    } catch { showToast(`Failed to load ${sym}`, 'error'); }
    finally { setLoading(false); }
  };

  const doFocusScan = async () => {
    if (!detail || focusing || scanning) return;
    setFocusing(true);
    try { await onFocusScan(detail.symbol); }
    finally { setFocusing(false); }
  };

  const fmtL  = (n?: number) => n != null ? `$${n.toFixed(2)}` : '—';
  const fmtKL = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
  const chClr = (n: number) => n >= 0 ? 'var(--green)' : 'var(--red)';
  const s = detail?.score;
  const ctaBg    = !s ? '#334155' : s.confidence === 'HIGH' ? 'var(--green)' : s.confidence === 'MEDIUM' ? '#d97706' : '#475569';
  const ctaLabel = !s ? '🎯 Focus Scan'
    : s.confidence === 'HIGH'   ? '🟢 BUY Signal — Focus Scan'
    : s.confidence === 'MEDIUM' ? '🟡 Setup Found — Focus Scan'
    :                             '🔍 No Setup — Add & Watch';

  return (
    <div ref={wrapRef} style={{ marginBottom: 14, position: 'relative' }}>
      {/* Search input */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 440 }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 16, pointerEvents: 'none', color: 'var(--muted)' }}>🔍</span>
          <input
            className="input"
            style={{ paddingLeft: 34, fontSize: 14 }}
            placeholder="Search to analyze — TSLA, AAPL, NVDA…"
            value={query}
            onChange={e => search(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={e => { if (e.key === 'Enter' && query.trim()) { setOpen(false); selectSymbol(query.trim().toUpperCase()); } }}
          />
          {loading && (
            <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}>
              <span className="spinner" style={{ width: 14, height: 14 }} />
            </span>
          )}
        </div>
        {query && (
          <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setResults([]); setDetail(null); setOpen(false); }}>Clear</button>
        )}
      </div>

      {/* Dropdown */}
      {open && results.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, maxWidth: 440, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, marginTop: 4, zIndex: 200, boxShadow: '0 12px 40px rgba(0,0,0,.5)', overflow: 'hidden' }}>
          {results.map(r => (
            <div key={r.symbol}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', cursor: 'pointer', borderBottom: '1px solid var(--border)', transition: 'background .12s' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface-2)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              onClick={() => selectSymbol(r.symbol)}
            >
              <div>
                <span style={{ fontWeight: 800, fontSize: 14 }}>{r.symbol}</span>
                <span style={{ marginLeft: 8, color: 'var(--muted)', fontSize: 12 }}>{r.name}</span>
              </div>
              <span style={{ fontSize: 10, color: 'var(--cyan)', marginLeft: 8 }}>Analyze →</span>
            </div>
          ))}
        </div>
      )}

      {/* Loading state */}
      {loading && !detail && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>
          <span className="spinner" /> Analyzing {query}…
        </div>
      )}

      {/* Analysis card */}
      {detail && !loading && (
        <div style={{
          marginTop: 10, borderRadius: 14, overflow: 'hidden',
          background: 'var(--surface)',
          border: `1px solid ${s?.confidence === 'HIGH' ? '#22d39066' : s?.confidence === 'MEDIUM' ? '#d9770644' : 'var(--border)'}`,
        }}>
          {/* Price row */}
          <div style={{ padding: '14px 16px 10px', display: 'flex', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 140 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 18, fontWeight: 900 }}>{detail.symbol}</span>
                {s && (
                  <span className={`signal-pill ${s.confidence === 'HIGH' ? 'signal-high' : s.confidence === 'MEDIUM' ? 'signal-med' : 'badge badge-muted'}`}>
                    {s.confidence === 'NONE' ? 'WAIT' : s.confidence}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 22, fontWeight: 900, lineHeight: 1.1 }}>{fmtL(detail.price)}</div>
              <div style={{ fontSize: 12, color: chClr(detail.changeAmt), fontWeight: 700, marginTop: 2 }}>
                {detail.changeAmt >= 0 ? '+' : ''}{detail.changeAmt.toFixed(2)} ({detail.changePct >= 0 ? '+' : ''}{detail.changePct.toFixed(2)}%)
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                Vol {fmtKL(detail.volume)} · H {fmtL(detail.high)} · L {fmtL(detail.low)}
              </div>
            </div>

            {/* Score block */}
            {s ? (
              <div style={{ flex: 1, minWidth: 200 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                  <div style={{ flex: 1, height: 8, background: 'var(--border)', borderRadius: 4, overflow: 'hidden' }}>
                    <div style={{ width: `${s.score * 10}%`, height: '100%', borderRadius: 4, transition: 'width .5s ease', background: s.score >= 7 ? 'var(--green)' : s.score >= 5 ? '#d97706' : '#64748b' }} />
                  </div>
                  <span style={{ fontWeight: 900, fontSize: 16, minWidth: 36, color: s.score >= 7 ? 'var(--green)' : s.score >= 5 ? '#d97706' : 'var(--muted)' }}>{s.score}/10</span>
                </div>
                {s.confidence !== 'NONE' && (
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                    {[
                      { label: 'Entry', val: fmtL(s.entry),      clr: '' },
                      { label: 'TP',    val: fmtL(s.takeProfit), clr: 'var(--green)' },
                      { label: 'SL',    val: fmtL(s.stopLoss),   clr: 'var(--red)' },
                      { label: 'EMA9',  val: fmtL(s.ema9),       clr: '' },
                      { label: 'RSI',   val: s.rsi14.toFixed(0), clr: '' },
                    ].map(it => (
                      <div key={it.label}>
                        <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{it.label}</div>
                        <div style={{ fontWeight: 700, fontSize: 12, color: it.clr || 'var(--text)' }}>{it.val}</div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                  {s.reasons.map((r, i) => <span key={i} className="reason-tag">{r}</span>)}
                  {s.confidence === 'NONE' && <span style={{ fontSize: 11, color: 'var(--muted)' }}>No BUY setup — conditions not aligned.</span>}
                </div>
              </div>
            ) : (
              <div style={{ flex: 1, color: 'var(--muted)', fontSize: 12, paddingTop: 6 }}>Insufficient candle history for scoring.</div>
            )}
          </div>

          {/* Action bar */}
          <div style={{ padding: '10px 16px 14px', display: 'flex', gap: 8, borderTop: '1px solid var(--border)' }}>
            <button
              className="btn"
              disabled={focusing || scanning}
              onClick={doFocusScan}
              style={{ flex: 1, fontWeight: 800, fontSize: 13, background: ctaBg, color: '#fff', border: 'none', opacity: (focusing || scanning) ? 0.7 : 1 }}
            >
              {(focusing || scanning)
                ? <><span className="spinner" style={{ width: 13, height: 13, marginRight: 6 }} />Scanning…</>
                : ctaLabel}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setDetail(null); setQuery(''); }}>✕</button>
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
              <span className="scan-stat"><b style={{ color: (lastResult.candidates?.length ?? 0) > 0 ? 'var(--green)' : 'var(--muted)' }}>{lastResult.candidates?.length ?? 0}</b> <span>signals</span></span>
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
    positions, quotes, watchlist, scanning, lastResult, config,
    runScan, loadQuotes, updateWatchlist,
  } = useScanner(mode);

  const autoRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [autoScan,      setAutoScan]      = useState(false);
  const [localScanning, setLocalScanning] = useState(false);
  const [localResult,   setLocalResult]   = useState<ScanResult | null>(null);
  const scanLock = useRef(false);

  // Extract candidates from local result
  const cands: ScanCandidate[] = localResult?.candidates ?? [];
  const isScanning = localScanning;

  // ── Local scan — runs entirely in the browser using Yahoo Finance ─────────
  const runLocalScan = async (): Promise<ScanResult | null> => {
    if (scanLock.current) return null;
    scanLock.current = true;
    setLocalScanning(true);
    const t0 = Date.now();
    try {
      const syms = watchlist.length > 0
        ? watchlist
        : STOCK_LIST.slice(0, 30).map(s => s.symbol);

      // Fetch in batches of 5 to stay within Yahoo Finance rate limits
      const BATCH = 5;
      const allCands: ScanCandidate[] = [];

      for (let i = 0; i < syms.length; i += BATCH) {
        const batch = syms.slice(i, i + BATCH);
        const settled = await Promise.allSettled(batch.map(async (sym) => {
          try {
            const r = await fetch(
              `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=15m&range=5d&includePrePost=false`,
              { mode: 'cors', headers: { Accept: 'application/json' } }
            ).catch(() => null);
            if (!r?.ok) return null;
            const data = await r.json() as {
              chart?: { result?: [{
                meta?: Record<string, number | null>;
                indicators?: { quote?: [{ close?: (number|null)[]; volume?: (number|null)[] }] };
              }] };
            };
            const q0   = data?.chart?.result?.[0];
            const meta = q0?.meta;
            const q    = q0?.indicators?.quote?.[0];
            if (!meta || !q) return null;
            const rawC = q.close  ?? [];
            const rawV = q.volume ?? [];
            const candles = rawC.reduce<{ close: number; volume: number }[]>((acc, c, idx) => {
              if (c !== null && c > 0) acc.push({ close: c, volume: Number(rawV[idx] ?? 0) });
              return acc;
            }, []);
            const price = Number(meta.regularMarketPrice) || (candles.at(-1)?.close ?? 0);
            if (price < (config?.priceMin ?? 1) || price > (config?.priceMax ?? 999)) return null;
            const sc = scoreFromCandles(candles, config);
            if (!sc || sc.confidence === 'NONE') return null;
            return {
              symbol: sym, score: sc.score, confidence: sc.confidence,
              price, ema9: sc.ema9, ema21: sc.ema21, rsi14: sc.rsi14,
              volumeRatio: sc.volumeRatio, reasons: sc.reasons,
              entry: sc.entry, stopLoss: sc.stopLoss, takeProfit: sc.takeProfit,
              trailPct: config?.trailPct ?? 2,
              scannedAt: new Date().toISOString(),
            } as ScanCandidate;
          } catch { return null; }
        }));
        settled.forEach(r => { if (r.status === 'fulfilled' && r.value) allCands.push(r.value); });
      }

      allCands.sort((a, b) => b.score - a.score);
      const result: ScanResult = {
        mode, scanned: syms.length, candidates: allCands,
        ordersPlaced: 0, positionsManaged: 0, errors: [], ms: Date.now() - t0,
      };
      setLocalResult(result);
      return result;
    } finally {
      scanLock.current = false;
      setLocalScanning(false);
    }
  };

  // Use a stable ref so the auto-scan interval never re-registers on re-renders
  const handleScanRef = useRef<() => Promise<void>>(async () => {});

  const handleScan = async () => {
    _lastScanAt = Date.now();
    const result = await runLocalScan();
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

      {/* Stock search + analysis */}
      <StockSearch
        onAdd={sym => updateWatchlist(sym, 'add')}
        showToast={showToast}
        config={config}
        scanning={scanning}
        onFocusScan={async (sym) => {
          await updateWatchlist(sym, 'add');
          showToast(`Focusing on ${sym} — scanning…`, 'success');
          await handleScanRef.current();
        }}
      />

      {/* Controls: run scan + watchlist */}
      <ScannerControls
        watchlist={watchlist}
        scanning={isScanning}
        lastResult={localResult}
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
            scanning={isScanning}
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
