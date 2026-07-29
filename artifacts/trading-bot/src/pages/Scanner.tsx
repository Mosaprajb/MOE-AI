// MOE-AI — Scanner Page (main product)
import { useState, useEffect, useRef, useCallback } from 'react';
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

// ── UT Bot — MOERAND Simple signal engine ────────────────────────────────────
type YFCandle = { open: number; high: number; low: number; close: number; volume: number };

/** Wilder's ATR */
function calcATR(highs: number[], lows: number[], closes: number[], period: number): number[] {
  const n = highs.length;
  if (n < 2) return highs.map(() => 0);
  const tr = highs.map((h, i) => {
    const l = lows[i], pc = i > 0 ? closes[i - 1] : l;
    return Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc));
  });
  const warmup = Math.min(period, n);
  const seed = tr.slice(0, warmup).reduce((a, b) => a + b, 0) / warmup;
  const out: number[] = new Array(warmup).fill(seed);
  for (let i = warmup; i < n; i++) out.push((out[out.length - 1] * (period - 1) + tr[i]) / period);
  return out.slice(0, n);
}

/** Heikin Ashi conversion */
function toHA(o: number[], h: number[], l: number[], c: number[]) {
  const haC = o.map((_, i) => (o[i] + h[i] + l[i] + c[i]) / 4);
  const haO: number[] = [(o[0] + c[0]) / 2];
  for (let i = 1; i < o.length; i++) haO.push((haO[i - 1] + haC[i - 1]) / 2);
  return { haO, haH: h.map((v, i) => Math.max(v, haO[i], haC[i])), haL: l.map((v, i) => Math.min(v, haO[i], haC[i])), haC };
}

interface UTBotResult {
  signal:       'BUY' | 'SELL' | null;
  trailingStop: number;
  atrNow:       number;
  entry:        number;   // actual close price
  takeProfit:   number;
  stopLoss:     number;
  aboveTS:      boolean;  // price currently above trailing stop
}

function calcUTBot(
  candles: YFCandle[],
  keyValue: number, atrPeriod: number, useHA: boolean, tpPct: number, slPct: number,
): UTBotResult | null {
  if (candles.length < atrPeriod + 2) return null;
  let opens  = candles.map(c => c.open);
  let highs  = candles.map(c => c.high);
  let lows   = candles.map(c => c.low);
  let closes = candles.map(c => c.close);
  if (useHA) { const ha = toHA(opens, highs, lows, closes); opens = ha.haO; highs = ha.haH; lows = ha.haL; closes = ha.haC; }

  const atr = calcATR(highs, lows, closes, atrPeriod);
  const n = closes.length;
  const ts: number[] = new Array(n).fill(0);
  ts[0] = closes[0];
  for (let i = 1; i < n; i++) {
    const prev = ts[i - 1], c = closes[i], pc = closes[i - 1];
    const nl = keyValue * (atr[i] ?? atr[atr.length - 1]);
    if      (c > prev && pc > prev) ts[i] = Math.max(prev, c - nl);
    else if (c < prev && pc < prev) ts[i] = Math.min(prev, c + nl);
    else if (c > prev)              ts[i] = c - nl;
    else                            ts[i] = c + nl;
  }

  let lastSignal: 'BUY' | 'SELL' | null = null;
  for (let i = 1; i < n; i++) {
    const c = closes[i], pc = closes[i - 1];
    if      (c > ts[i] && pc <= ts[i - 1]) lastSignal = 'BUY';
    else if (c < ts[i] && pc >= ts[i - 1]) lastSignal = 'SELL';
  }

  const price = candles.at(-1)!.close;   // always use real close for price display
  const tsNow = ts.at(-1)!;
  const atrNow = atr.at(-1) ?? 0;
  return {
    signal: lastSignal, trailingStop: tsNow, atrNow, entry: price,
    takeProfit: price * (1 + tpPct / 100),
    stopLoss: Math.max(tsNow, price * (1 - slPct / 100)),
    aboveTS: price > tsNow,
  };
}

// ── Local Positions (localStorage) ───────────────────────────────────────────
interface LocalPosition {
  id: string; symbol: string;
  entryPrice: number; takeProfit: number; stopLoss: number; currentPrice: number;
  openedAt: string; status: 'OPEN' | 'CLOSED';
  exitPrice?: number; pnlPct?: number;
  closeReason?: 'TP' | 'SL' | 'SIGNAL' | 'MANUAL'; closedAt?: string; useSL: boolean;
}

function useLocalPositions() {
  const [positions, setPositions] = useState<LocalPosition[]>(() => {
    try { const s = localStorage.getItem('moe_positions'); return s ? JSON.parse(s) : []; } catch { return []; }
  });
  const posRef = useRef<LocalPosition[]>([]);
  posRef.current = positions;

  const save = (ps: LocalPosition[]) => {
    setPositions(ps);
    try { localStorage.setItem('moe_positions', JSON.stringify(ps)); } catch {}
  };

  const openPos = useCallback((sym: string, entry: number, tp: number, sl: number, useSL: boolean) => {
    if (posRef.current.some(p => p.symbol === sym && p.status === 'OPEN')) return false;
    save([...posRef.current, {
      id: Date.now().toString(36), symbol: sym, entryPrice: entry,
      takeProfit: tp, stopLoss: sl, currentPrice: entry,
      openedAt: new Date().toISOString(), status: 'OPEN', useSL,
    }]);
    return true;
  }, []);

  const closePos = useCallback((id: string, reason: LocalPosition['closeReason'], exitPrice: number) => {
    save(posRef.current.map(p => p.id !== id || p.status !== 'OPEN' ? p : {
      ...p, status: 'CLOSED' as const, exitPrice, closeReason: reason,
      closedAt: new Date().toISOString(), pnlPct: ((exitPrice - p.entryPrice) / p.entryPrice) * 100,
    }));
  }, []);

  // Accept a symbol→price map to batch-update all open positions from live quotes
  const updateAndCheck = useCallback((priceMap: Record<string, number>) => {
    const next = posRef.current.map(p => {
      if (p.status !== 'OPEN') return p;
      const price = priceMap[p.symbol];
      if (price == null || price <= 0) return p;
      const up = { ...p, currentPrice: price };
      const pnlPct = ((price - p.entryPrice) / p.entryPrice) * 100;
      if (price >= p.takeProfit)          return { ...up, status: 'CLOSED' as const, exitPrice: price, closeReason: 'TP'     as const, closedAt: new Date().toISOString(), pnlPct };
      if (p.useSL && price <= p.stopLoss) return { ...up, status: 'CLOSED' as const, exitPrice: price, closeReason: 'SL'     as const, closedAt: new Date().toISOString(), pnlPct };
      return up;
    });
    save(next);
  }, []);

  return { positions, openPos, closePos, updateAndCheck };
}

interface SearchResult { symbol: string; name: string; exchange: string; type: string; }
interface StockDetail {
  symbol: string; price: number; changeAmt: number; changePct: number;
  volume: number; high: number; low: number; signal: UTBotResult | null;
}

function StockSearch({
  onAdd, showToast, config, onFocusScan, scanning, onOpenTrade,
}: {
  onAdd: (sym: string) => Promise<void>;
  showToast: (m: string, t?: 'success'|'error') => void;
  config: import('../hooks/useScanner').ScannerConfig | null;
  onFocusScan: (sym: string) => Promise<void>;
  scanning: boolean;
  onOpenTrade: (sym: string, sig: UTBotResult) => void;
}) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState<SearchResult[]>([]);
  const [detail,   setDetail]   = useState<StockDetail | null>(null);
  const [open,     setOpen]     = useState(false);
  const [loading,  setLoading]  = useState(false);
  const [focusing, setFocusing] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const fn = (e: MouseEvent) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', fn);
    return () => document.removeEventListener('mousedown', fn);
  }, []);

  const search = (q: string) => {
    setQuery(q);
    if (!q.trim()) { setResults([]); setOpen(false); return; }
    const hits = searchStocks(q);
    setResults(hits.map(h => ({ symbol: h.symbol, name: h.name, exchange: 'US', type: 'EQUITY' })));
    setOpen(hits.length > 0);
  };

  const selectSymbol = async (sym: string) => {
    setOpen(false); setQuery(sym); setDetail(null); setLoading(true);
    try {
      const yfRes = await fetch(
        `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=15m&range=5d&includePrePost=false`,
        { mode: 'cors', headers: { Accept: 'application/json' } }
      ).catch(() => null);
      if (yfRes?.ok) {
        const data = await yfRes.json() as {
          chart?: { result?: [{ meta?: Record<string, number | null>; indicators?: { quote?: [{
            open?: (number|null)[]; high?: (number|null)[]; low?: (number|null)[];
            close?: (number|null)[]; volume?: (number|null)[];
          }] } }] };
        };
        const r = data?.chart?.result?.[0], meta = r?.meta, q0 = r?.indicators?.quote?.[0];
        if (meta && q0) {
          const rawO = q0.open ?? [], rawH = q0.high ?? [], rawL = q0.low ?? [];
          const rawC = q0.close ?? [], rawV = q0.volume ?? [];
          const candles: YFCandle[] = [];
          rawC.forEach((c, i) => {
            if (c !== null && c > 0) candles.push({
              open: Number(rawO[i] ?? c), high: Number(rawH[i] ?? c),
              low:  Number(rawL[i] ?? c), close: c, volume: Number(rawV[i] ?? 0),
            });
          });
          const price     = Number(meta.regularMarketPrice) || (candles.at(-1)?.close ?? 0);
          const prevClose = Number(meta.chartPreviousClose)  || price;
          const kv = config?.keyValue ?? 1, atrP = config?.atrPeriod ?? 8;
          setDetail({
            symbol: sym, price,
            changeAmt: price - prevClose,
            changePct: prevClose > 0 ? ((price - prevClose) / prevClose) * 100 : 0,
            volume: Number(meta.regularMarketVolume)  || 0,
            high:   Number(meta.regularMarketDayHigh) || 0,
            low:    Number(meta.regularMarketDayLow)  || 0,
            signal: calcUTBot(candles, kv, atrP, config?.useHeikinAshi ?? false, config?.tpPct ?? 3, config?.hardStopPct ?? 2),
          });
          return;
        }
      }
      showToast(`No data for ${sym}`, 'error');
    } catch { showToast(`Failed to load ${sym}`, 'error'); }
    finally { setLoading(false); }
  };

  const doAction = async () => {
    if (!detail || focusing || scanning) return;
    setFocusing(true);
    try {
      await onAdd(detail.symbol);
      if (detail.signal?.signal === 'BUY') {
        onOpenTrade(detail.symbol, detail.signal);
      } else {
        await onFocusScan(detail.symbol);
      }
    } finally { setFocusing(false); }
  };

  const fmtL  = (n?: number) => n != null ? `$${n.toFixed(2)}` : '—';
  const fmtKL = (n: number) => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : String(n);
  const chClr = (n: number) => n >= 0 ? 'var(--green)' : 'var(--red)';
  const sig = detail?.signal;
  const ctaBg = !sig ? '#334155'
    : sig.signal === 'BUY'  ? '#16a34a'
    : sig.signal === 'SELL' ? '#7f1d1d'
    : sig.aboveTS ? '#0ea5e9' : '#475569';
  const ctaLabel = !sig ? '🔍 Analyzing…'
    : sig.signal === 'BUY'  ? '🟢 Open Trade'
    : sig.signal === 'SELL' ? '🔴 Sell Signal — Watch'
    : sig.aboveTS           ? '📊 Above TS — Add & Watch'
    :                         '⏳ Below Trailing Stop';

  return (
    <div ref={wrapRef} style={{ marginBottom: 14, position: 'relative' }}>
      {/* Search input */}
      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, maxWidth: 440 }}>
          <span style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', fontSize: 16, pointerEvents: 'none', color: 'var(--muted)' }}>🔍</span>
          <input className="input" style={{ paddingLeft: 34, fontSize: 14 }}
            placeholder="Search ticker — PATH, TSLA, NVDA…"
            value={query}
            onChange={e => search(e.target.value)}
            onFocus={() => results.length > 0 && setOpen(true)}
            onKeyDown={e => { if (e.key === 'Enter' && query.trim()) { setOpen(false); selectSymbol(query.trim().toUpperCase()); } }}
          />
          {loading && <span style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)' }}><span className="spinner" style={{ width: 14, height: 14 }} /></span>}
        </div>
        {query && <button className="btn btn-ghost btn-sm" onClick={() => { setQuery(''); setResults([]); setDetail(null); setOpen(false); }}>Clear</button>}
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

      {loading && !detail && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, color: 'var(--muted)', fontSize: 13 }}>
          <span className="spinner" /> Analyzing {query}…
        </div>
      )}

      {/* UT Bot analysis card */}
      {detail && !loading && (
        <div style={{
          marginTop: 10, borderRadius: 14, overflow: 'hidden', background: 'var(--surface)',
          border: `1px solid ${sig?.signal === 'BUY' ? '#22d39066' : sig?.signal === 'SELL' ? '#dc262644' : 'var(--border)'}`,
        }}>
          {/* Price + signal */}
          <div style={{ padding: '14px 16px 10px', display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 150 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                <span style={{ fontSize: 18, fontWeight: 900 }}>{detail.symbol}</span>
                {sig && (
                  <span className={`signal-pill ${sig.signal === 'BUY' ? 'signal-high' : sig.signal === 'SELL' ? 'badge badge-red' : 'badge badge-muted'}`}>
                    {sig.signal ?? (sig.aboveTS ? 'ABOVE TS' : 'BELOW TS')}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 22, fontWeight: 900 }}>{fmtL(detail.price)}</div>
              <div style={{ fontSize: 12, color: chClr(detail.changeAmt), fontWeight: 700, marginTop: 2 }}>
                {detail.changeAmt >= 0 ? '+' : ''}{detail.changeAmt.toFixed(2)} ({detail.changePct >= 0 ? '+' : ''}{detail.changePct.toFixed(2)}%)
              </div>
              <div style={{ fontSize: 10, color: 'var(--muted)', marginTop: 3 }}>
                Vol {fmtKL(detail.volume)} · H {fmtL(detail.high)} · L {fmtL(detail.low)}
              </div>
            </div>

            {sig ? (
              <div style={{ flex: 1, minWidth: 220 }}>
                <div style={{ fontSize: 10, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 8 }}>
                  UT Bot · Key {config?.keyValue ?? 1} · ATR({config?.atrPeriod ?? 8}){config?.useHeikinAshi ? ' · HA' : ''}
                </div>
                <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 10 }}>
                  {[
                    { label: 'Trail Stop', val: fmtL(sig.trailingStop), clr: sig.aboveTS ? 'var(--green)' : 'var(--red)' },
                    { label: 'ATR',        val: sig.atrNow.toFixed(3),  clr: '' },
                    { label: `TP +${config?.tpPct ?? 3}%`, val: fmtL(sig.takeProfit), clr: 'var(--green)' },
                    { label: 'SL',         val: fmtL(sig.stopLoss),     clr: 'var(--red)' },
                  ].map(it => (
                    <div key={it.label}>
                      <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase' }}>{it.label}</div>
                      <div style={{ fontWeight: 700, fontSize: 13, color: it.clr || 'var(--text)' }}>{it.val}</div>
                    </div>
                  ))}
                </div>
                <div style={{ fontSize: 11, fontWeight: 600, color: sig.aboveTS ? 'var(--green)' : 'var(--red)' }}>
                  {sig.aboveTS ? '▲ Price above trailing stop' : '▼ Price below trailing stop'}
                </div>
                {sig.signal && (
                  <div style={{ marginTop: 4, fontSize: 11, fontWeight: 700, color: sig.signal === 'BUY' ? 'var(--green)' : 'var(--red)' }}>
                    {sig.signal === 'BUY' ? '🟢 BUY crossover — entry confirmed' : '🔴 SELL crossover — avoid entry'}
                  </div>
                )}
              </div>
            ) : (
              <div style={{ flex: 1, color: 'var(--muted)', fontSize: 12, paddingTop: 6 }}>
                Not enough candle history for UT Bot (need {(config?.atrPeriod ?? 8) + 2}+ candles).
              </div>
            )}
          </div>

          {/* Action bar */}
          <div style={{ padding: '10px 16px 14px', display: 'flex', gap: 8, borderTop: '1px solid var(--border)' }}>
            <button
              className="btn"
              disabled={focusing || scanning}
              onClick={doAction}
              style={{ flex: 1, fontWeight: 800, fontSize: 13, background: ctaBg, color: '#fff', border: 'none', opacity: (focusing || scanning) ? 0.7 : 1 }}
            >
              {(focusing || scanning) ? <><span className="spinner" style={{ width: 13, height: 13, marginRight: 6 }} />Processing…</> : ctaLabel}
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
                <span className="sig-px-label">ATR</span>
                <span>{c.rsi14.toFixed(3)}</span>
              </div>
              <div className="sig-px-item">
                <span className="sig-px-label">TS Dist</span>
                <span style={{ color: 'var(--green)' }}>{c.volumeRatio.toFixed(2)}%</span>
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

// ── Positions Panel ───────────────────────────────────────────────────────────
function PositionsPanel({ positions, onClose }: {
  positions: LocalPosition[];
  onClose: (id: string, reason: LocalPosition['closeReason'], price: number) => void;
}) {
  const open   = positions.filter(p => p.status === 'OPEN');
  const closed = positions.filter(p => p.status === 'CLOSED').slice(-5).reverse();
  if (positions.length === 0) return null;
  return (
    <div style={{ marginTop: 16, marginBottom: 18 }}>
      {open.length > 0 && (
        <>
          <div className="panel-title" style={{ marginBottom: 10 }}>Open Trades · {open.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {open.map(p => {
              const pnlPct = ((p.currentPrice - p.entryPrice) / p.entryPrice) * 100;
              const clr = pnlPct >= 0 ? 'var(--green)' : 'var(--red)';
              const tpHit = p.currentPrice >= p.takeProfit;
              const slHit = p.useSL && p.currentPrice <= p.stopLoss;
              return (
                <div key={p.id} style={{
                  padding: '12px 14px', borderRadius: 12, background: 'var(--surface)',
                  border: `1px solid ${tpHit ? 'var(--green)' : slHit ? 'var(--red)' : 'var(--border)'}`,
                }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontWeight: 900, fontSize: 15 }}>{p.symbol}</span>
                      <span className="badge badge-green">OPEN</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontSize: 15, fontWeight: 900, color: clr }}>{pnlPct >= 0 ? '+' : ''}{pnlPct.toFixed(2)}%</span>
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => onClose(p.id, 'MANUAL', p.currentPrice)}>Close</button>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 16, fontSize: 12, flexWrap: 'wrap' }}>
                    {[
                      { label: 'Entry',   val: fmt(p.entryPrice),    clr: '' },
                      { label: 'Current', val: fmt(p.currentPrice),  clr },
                      { label: 'TP',      val: fmt(p.takeProfit),    clr: 'var(--green)' },
                      ...(p.useSL ? [{ label: 'SL', val: fmt(p.stopLoss), clr: 'var(--red)' }] : []),
                    ].map(it => (
                      <div key={it.label}>
                        <div style={{ color: 'var(--muted)', fontSize: 9, fontWeight: 700, textTransform: 'uppercase' }}>{it.label}</div>
                        <div style={{ fontWeight: 700, color: it.clr || 'var(--text)' }}>{it.val}</div>
                      </div>
                    ))}
                  </div>
                  {(tpHit || slHit) && (
                    <div style={{ marginTop: 8, fontSize: 11, fontWeight: 700, color: tpHit ? 'var(--green)' : 'var(--red)' }}>
                      {tpHit ? '🎯 Take Profit reached!' : '⚠️ Stop Loss reached!'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </>
      )}
      {closed.length > 0 && (
        <>
          <div className="panel-title" style={{ marginBottom: 8, marginTop: 14 }}>Recent Closed · {closed.length}</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            {closed.map(p => (
              <div key={p.id} style={{ padding: '9px 14px', borderRadius: 10, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <span style={{ fontWeight: 800, fontSize: 13 }}>{p.symbol}</span>
                  <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--muted)' }}>
                    {p.closeReason === 'TP' ? '🎯 TP' : p.closeReason === 'SL' ? '🛑 SL' : p.closeReason === 'SIGNAL' ? '📊 Signal' : '✋ Manual'}
                  </span>
                </div>
                <span style={{ fontWeight: 900, color: (p.pnlPct ?? 0) >= 0 ? 'var(--green)' : 'var(--red)' }}>
                  {(p.pnlPct ?? 0) >= 0 ? '+' : ''}{(p.pnlPct ?? 0).toFixed(2)}%
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── Scanner Page Root ─────────────────────────────────────────────────────────
export default function ScannerPage({ mode, showToast }: Props) {
  const {
    positions, quotes, watchlist, scanning, lastResult, config, saveConfig,
    runScan, loadQuotes, updateWatchlist,
  } = useScanner(mode);

  const localPos = useLocalPositions();
  const autoRef  = useRef<ReturnType<typeof setInterval> | null>(null);
  const [autoScan,      setAutoScan]      = useState(false);
  const [localScanning, setLocalScanning] = useState(false);
  const [localResult,   setLocalResult]   = useState<ScanResult | null>(null);
  const [showConfig,    setShowConfig]    = useState(false);
  const scanLock = useRef(false);

  // Refresh positions on quote updates
  useEffect(() => {
    if (quotes.length === 0) return;
    const pm = Object.fromEntries(quotes.map((q: { symbol: string; price?: number; lastPrice?: number }) => [q.symbol, q.price ?? q.lastPrice ?? 0]));
    localPos.updateAndCheck(pm);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quotes]);

  const cands: ScanCandidate[] = localResult?.candidates ?? [];
  const isScanning = localScanning;

  // ── Open trade handler ────────────────────────────────────────────────────
  const onOpenTrade = (sym: string, sig: UTBotResult) => {
    localPos.openPos(sym, sig.entry, sig.takeProfit, sig.stopLoss, config?.useSL ?? true);
    showToast(`🟢 Paper trade opened: ${sym} @ $${sig.entry.toFixed(2)}`, 'success');
  };

  // ── Local scan — UT Bot strategy, runs entirely in browser ───────────────
  const runLocalScan = async (): Promise<ScanResult | null> => {
    if (scanLock.current) return null;
    scanLock.current = true;
    setLocalScanning(true);
    const t0 = Date.now();
    try {
      const syms = watchlist.length > 0 ? watchlist : STOCK_LIST.slice(0, 30).map(s => s.symbol);
      const BATCH = 5;
      const allCands: ScanCandidate[] = [];
      const kv  = config?.keyValue ?? 1, atrP = config?.atrPeriod ?? 8;
      const useHA = config?.useHeikinAshi ?? false;
      const tpPct = config?.tpPct ?? 3, slPct = config?.hardStopPct ?? 2;

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
              chart?: { result?: [{ meta?: Record<string, number | null>; indicators?: { quote?: [{
                open?: (number|null)[]; high?: (number|null)[]; low?: (number|null)[];
                close?: (number|null)[]; volume?: (number|null)[];
              }] } }] };
            };
            const q0 = data?.chart?.result?.[0], meta = q0?.meta, q = q0?.indicators?.quote?.[0];
            if (!meta || !q) return null;
            const rawO = q.open ?? [], rawH = q.high ?? [], rawL = q.low ?? [];
            const rawC = q.close ?? [], rawV = q.volume ?? [];
            const candles: YFCandle[] = [];
            rawC.forEach((c, idx) => {
              if (c !== null && c > 0) candles.push({
                open: Number(rawO[idx] ?? c), high: Number(rawH[idx] ?? c),
                low: Number(rawL[idx] ?? c), close: c, volume: Number(rawV[idx] ?? 0),
              });
            });
            const price = Number(meta.regularMarketPrice) || (candles.at(-1)?.close ?? 0);
            if (price < (config?.priceMin ?? 1) || price > (config?.priceMax ?? 999)) return null;
            const sc = calcUTBot(candles, kv, atrP, useHA, tpPct, slPct);
            if (!sc || sc.signal !== 'BUY') return null;
            const tsDist = sc.trailingStop > 0 ? ((price - sc.trailingStop) / price) * 100 : 0;
            return {
              symbol: sym, score: 9, confidence: 'HIGH',
              price, ema9: sc.trailingStop, ema21: sc.trailingStop,
              rsi14: sc.atrNow, volumeRatio: tsDist,
              reasons: ['✅ UT Bot BUY crossover'],
              entry: sc.entry, stopLoss: sc.stopLoss, takeProfit: sc.takeProfit,
              trailPct: config?.trailPct ?? 2, scannedAt: new Date().toISOString(),
            } as ScanCandidate;
          } catch { return null; }
        }));
        settled.forEach(r => { if (r.status === 'fulfilled' && r.value) allCands.push(r.value); });
      }

      // Auto-open for watchlist symbols that have a BUY signal (no duplicate)
      allCands.forEach(c => {
        if (!watchlist.includes(c.symbol)) return;
        if (localPos.positions.some(p => p.symbol === c.symbol && p.status === 'OPEN')) return;
        localPos.openPos(c.symbol, c.entry, c.takeProfit, c.stopLoss, config?.useSL ?? true);
      });

      allCands.sort((a, b) => b.score - a.score);
      const result: ScanResult = {
        mode, scanned: syms.length, candidates: allCands,
        ordersPlaced: 0, positionsManaged: 0, errors: [], ms: Date.now() - t0,
      };
      setLocalResult(result);
      return result;
    } finally { scanLock.current = false; setLocalScanning(false); }
  };

  const handleScanRef = useRef<() => Promise<void>>(async () => {});
  const handleScan = async () => {
    _lastScanAt = Date.now();
    const result = await runLocalScan();
    if (result) {
      const cnt = result.candidates.length;
      showToast(
        cnt > 0 ? `✓ Scan done — ${cnt} BUY signal${cnt !== 1 ? 's' : ''}` : '✓ Scan done — no signals',
        cnt > 0 ? 'success' : undefined,
      );
      if (cnt > 0) {
        const syms = result.candidates.slice(0, 3).map(c => c.symbol).join(', ');
        sendNotif(`MOE-AI UT Bot · ${cnt} BUY`, `${syms}${cnt > 3 ? ` +${cnt - 3}` : ''}`);
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

      {/* Stock search + UT Bot analysis */}
      <StockSearch
        onAdd={sym => updateWatchlist(sym, 'add')}
        showToast={showToast}
        config={config}
        scanning={scanning || localScanning}
        onOpenTrade={onOpenTrade}
        onFocusScan={async (sym) => {
          await updateWatchlist(sym, 'add');
          showToast(`Focusing on ${sym} — scanning…`, 'success');
          await handleScanRef.current();
        }}
      />

      {/* Paper positions */}
      <PositionsPanel positions={localPos.positions} onClose={localPos.closePos} />

      {/* Controls: run scan + watchlist */}
      <ScannerControls
        watchlist={watchlist}
        scanning={isScanning}
        lastResult={localResult}
        onScan={handleScan}
        onAdd={sym => updateWatchlist(sym, 'add').then(() => showToast(`Added ${sym}`, 'success'))}
        onRemove={sym => updateWatchlist(sym, 'remove').then(() => showToast(`Removed ${sym}`))}
      />

      {/* Auto-scan + strategy config + notifications */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 6, flexWrap: 'wrap' }}>
        <label className="toggle" style={{ cursor: 'pointer' }}>
          <input type="checkbox" checked={autoScan} onChange={async e => {
            const next = e.target.checked;
            setAutoScan(next);
            if (next) await requestNotifPermission();
            showToast(next ? 'Auto-scan ON — every 5 min' : 'Auto-scan OFF', next ? 'success' : undefined);
          }} />
          <div className="toggle-track" />
          <div className="toggle-thumb" />
        </label>
        <span style={{ fontSize: 13, fontWeight: 600 }}>Auto-scan every 5 min</span>
        <span style={{ fontSize: 11, color: 'var(--muted)' }}>· UT Bot strategy</span>
        <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }} onClick={() => setShowConfig(v => !v)}>
          {showConfig ? '▲ Hide Config' : '⚙️ Strategy Config'}
        </button>
        {getNotifPerm() !== 'unsupported' && (
          <button className="btn btn-ghost btn-sm" style={{ fontSize: 11 }}
            onClick={async () => {
              const ok = await requestNotifPermission();
              showToast(ok ? '🔔 Notifications enabled' : '🔕 Blocked — check browser', ok ? 'success' : 'error');
            }}
          >
            {getNotifPerm() === 'granted' ? '🔔 Notifs on' : '🔕 Enable notifs'}
          </button>
        )}
      </div>

      {/* UT Bot strategy config panel */}
      {showConfig && (
        <div style={{ marginBottom: 18, padding: '14px 16px', borderRadius: 12, background: 'var(--surface)', border: '1px solid var(--border)' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '.04em', marginBottom: 12 }}>
            MOERAND · UT Bot Config
          </div>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            {([
              { label: 'Key Value',   key: 'keyValue',    val: config?.keyValue    ?? 1,   min: 0.1, max: 10,  step: 0.1 },
              { label: 'ATR Period',  key: 'atrPeriod',   val: config?.atrPeriod   ?? 8,   min: 1,   max: 50,  step: 1 },
              { label: 'TP %',        key: 'tpPct',       val: config?.tpPct       ?? 3,   min: 0.5, max: 20,  step: 0.5 },
              { label: 'Stop %',      key: 'hardStopPct', val: config?.hardStopPct ?? 2,   min: 0.5, max: 10,  step: 0.5 },
              { label: 'Min Price $', key: 'priceMin',    val: config?.priceMin    ?? 1,   min: 0.5, max: 500, step: 0.5 },
              { label: 'Max Price $', key: 'priceMax',    val: config?.priceMax    ?? 999, min: 10,  max: 5000,step: 10 },
            ] as const).map(f => (
              <div key={f.key}>
                <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>{f.label}</div>
                <input type="number" className="input" style={{ width: 80, fontSize: 13, padding: '4px 8px' }}
                  min={f.min} max={f.max} step={f.step} defaultValue={f.val}
                  onBlur={e => saveConfig({ [f.key]: Number(e.target.value) })}
                />
              </div>
            ))}
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Heikin Ashi</div>
              <label className="toggle" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={config?.useHeikinAshi ?? false} onChange={e => saveConfig({ useHeikinAshi: e.target.checked })} />
                <div className="toggle-track" /><div className="toggle-thumb" />
              </label>
            </div>
            <div>
              <div style={{ fontSize: 9, color: 'var(--muted)', fontWeight: 700, textTransform: 'uppercase', marginBottom: 6 }}>Use Stop Loss</div>
              <label className="toggle" style={{ cursor: 'pointer' }}>
                <input type="checkbox" checked={config?.useSL ?? true} onChange={e => saveConfig({ useSL: e.target.checked })} />
                <div className="toggle-track" /><div className="toggle-thumb" />
              </label>
            </div>
          </div>
        </div>
      )}

      {/* Main grid: market + UT Bot signals */}
      <div className="scanner-main-grid">
        <div>
          <MarketGrid quotes={quotes} watchlist={watchlist} scanning={isScanning} candidates={cands} />
        </div>
        <div>
          <div className="panel-title" style={{ marginBottom: 12 }}>UT Bot BUY Signals · {cands.length}</div>
          <SignalsPanel candidates={cands} />
        </div>
      </div>
    </div>
  );
}
