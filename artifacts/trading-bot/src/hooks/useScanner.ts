// MOE-AI — Scanner data hook
import { useState, useEffect, useCallback, useRef } from 'react';
import { API_BASE } from '../lib/config';
import type { TradingMode } from '../lib/config';

export interface LiveQuote {
  symbol:    string;
  price:     number;
  open:      number;
  high:      number;
  low:       number;
  volume:    number;
  prevClose: number;
  changeAmt: number;
  changePct: number;
  fetchedAt: string;
}

export interface ScanCandidate {
  symbol:      string;
  score:       number;
  confidence:  'HIGH' | 'MEDIUM';
  price:       number;
  ema9:        number;
  ema21:       number;
  rsi14:       number;
  volumeRatio: number;
  reasons:     string[];
  entry:       number;
  stopLoss:    number;
  takeProfit:  number;
  trailPct:    number;
  scannedAt:   string;
}

export interface ScannerPosition {
  id:            string;
  symbol:        string;
  quantity:      number;
  entryPrice:    number;
  currentPrice:  number;
  highestPrice:  number;
  stopLoss:      number;
  takeProfit:    number;
  hardStop:      number;
  trailPct:      number;
  tpPct:         number;
  confidence:    'HIGH' | 'MEDIUM';
  score:         number;
  status:        'OPEN' | 'CLOSED';
  mode:          TradingMode;
  openedAt:      string;
  updatedAt:     string;
  closedAt?:     string;
  exitPrice?:    number;
  pnl?:          number;
  closeReason?:  string;
}

export interface ScanResult {
  mode:              string;
  scanned:           number;
  candidates:        ScanCandidate[];
  ordersPlaced:      number;
  positionsManaged:  number;
  errors:            string[];
  ms:                number;
}

export interface ScannerConfig {
  tpPct:        number;
  trailPct:     number;
  hardStopPct:  number;
  priceMin:     number;
  priceMax:     number;
  riskPct:      number;
  maxPositions: number;
}

interface ScanRun {
  id:               string;
  mode:             string;
  scanned_count:    number;
  candidates_count: number;
  orders_placed:    number;
  positions_managed:number;
  duration_ms:      number;
  ran_at:           string;
}

// Scanner.tsx currently performs its market-data analysis in the browser. These
// module-level markers let this hook recognize that explicit user scan and then
// bridge it to the Worker exactly once. Passive quote polling never submits an
// order, and LIVE mode is never bridged.
let localScanObservedAt = 0;
let localScanRequests = 0;
let fetchObserverInstalled = false;

function installLocalScanObserver() {
  if (fetchObserverInstalled || typeof window === 'undefined') return;
  fetchObserverInstalled = true;
  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string'
      ? input
      : input instanceof URL
        ? input.toString()
        : input.url;
    if (
      url.includes('query2.finance.yahoo.com/v8/finance/chart/') &&
      url.includes('interval=15m') &&
      url.includes('range=5d')
    ) {
      localScanObservedAt = Date.now();
      localScanRequests += 1;
    }
    return originalFetch(input, init);
  }) as typeof window.fetch;
}

function normalizeScanResult(raw: Record<string, unknown>): ScanResult {
  return {
    mode:             String(raw.mode ?? 'SANDBOX'),
    scanned:          Number(raw.scanned ?? 0),
    candidates:       Array.isArray(raw.candidates) ? raw.candidates as ScanCandidate[]
                      : Array.isArray(raw.signals) ? raw.signals as ScanCandidate[]
                      : [],
    ordersPlaced:     Number(raw.ordersPlaced ?? 0),
    positionsManaged: Number(raw.positionsManaged ?? 0),
    errors:           Array.isArray(raw.errors) ? raw.errors as string[] : [],
    ms:               Number(raw.ms ?? 0),
  };
}

async function requestWorkerScan(): Promise<ScanResult> {
  const res = await fetch(`${API_BASE}/api/scanner/run`, { method: 'POST', mode: 'cors' });
  const raw = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok) {
    const message = String(raw.error ?? raw.code ?? `Scanner HTTP ${res.status}`);
    throw new Error(message);
  }
  return normalizeScanResult(raw);
}

export function useScanner(mode: TradingMode) {
  const [positions,   setPositions]   = useState<ScannerPosition[]>([]);
  const [history,     setHistory]     = useState<ScannerPosition[]>([]);
  const [lastResult,  setLastResult]  = useState<ScanResult | null>(null);
  const [runs,        setRuns]        = useState<ScanRun[]>([]);
  const [config,      setConfig]      = useState<ScannerConfig | null>(null);
  const [watchlist,   setWatchlist]   = useState<string[]>([]);
  const [quotes,      setQuotes]      = useState<LiveQuote[]>([]);
  const [quotesAt,    setQuotesAt]    = useState<string>('');
  const [scanning,    setScanning]    = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');
  const quotesTimer   = useRef<ReturnType<typeof setInterval> | null>(null);
  const bridgeLock    = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [posRes, histRes, runsRes, cfgRes, wlRes] = await Promise.all([
        fetch(`${API_BASE}/api/scanner/positions`, { mode: 'cors' }),
        fetch(`${API_BASE}/api/scanner/history?limit=50`, { mode: 'cors' }),
        fetch(`${API_BASE}/api/scanner/runs?limit=20`, { mode: 'cors' }),
        fetch(`${API_BASE}/api/scanner/config`, { mode: 'cors' }),
        fetch(`${API_BASE}/api/scanner/watchlist`, { mode: 'cors' }),
      ]);
      if (posRes.ok)  { const d = await posRes.json();  setPositions(d.data ?? []); }
      if (histRes.ok) { const d = await histRes.json(); setHistory(d.data ?? []); }
      if (runsRes.ok) { const d = await runsRes.json(); setRuns(d.data ?? []); }
      if (cfgRes.ok)  { setConfig(await cfgRes.json()); }
      if (wlRes.ok) {
        const d = await wlRes.json();
        const syms: string[] = d.symbols ?? [];
        setWatchlist(syms);
        try { localStorage.setItem('moe_watchlist', JSON.stringify(syms)); } catch {}
      } else {
        try {
          const stored = localStorage.getItem('moe_watchlist');
          if (stored) { const parsed = JSON.parse(stored); if (Array.isArray(parsed)) setWatchlist(parsed); }
        } catch {}
      }
      setError('');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const runScan = useCallback(async (): Promise<ScanResult | null> => {
    if (mode !== 'SANDBOX') {
      setError('Automated scanner execution is restricted to SANDBOX mode.');
      return null;
    }
    setScanning(true);
    try {
      const data = await requestWorkerScan();
      setLastResult(data);
      setError(data.errors.length ? data.errors.join(' · ') : '');
      await load();
      return data;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      return null;
    } finally {
      setScanning(false);
    }
  }, [load, mode]);

  const loadQuotes = useCallback(async () => {
    try {
      // Scanner.tsx calls loadQuotes immediately after a deliberate local scan.
      // Bridge only that fresh scan to the Worker, once, and only in SANDBOX.
      const freshLocalScan = localScanRequests > 0 && Date.now() - localScanObservedAt < 15_000;
      if (mode === 'SANDBOX' && freshLocalScan && !bridgeLock.current) {
        localScanRequests = 0;
        bridgeLock.current = true;
        setScanning(true);
        try {
          const data = await requestWorkerScan();
          setLastResult(data);
          setError(data.errors.length ? data.errors.join(' · ') : '');
          await load();
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
        } finally {
          setScanning(false);
          bridgeLock.current = false;
        }
      }

      const res = await fetch(`${API_BASE}/api/scanner/quotes`, { mode: 'cors' });
      if (res.ok) {
        const d = await res.json() as { quotes?: LiveQuote[]; fetchedAt?: string };
        setQuotes(d.quotes ?? []);
        setQuotesAt(d.fetchedAt ?? new Date().toISOString());
      }
    } catch { /* quote polling is non-fatal */ }
  }, [load, mode]);

  useEffect(() => {
    installLocalScanObserver();
    load();
    loadQuotes();
    quotesTimer.current = setInterval(loadQuotes, 30_000);
    return () => { if (quotesTimer.current) clearInterval(quotesTimer.current); };
  }, [load, loadQuotes]);

  const updateWatchlist = useCallback(async (symbol: string, action: 'add' | 'remove') => {
    const sym = symbol.toUpperCase();
    fetch(`${API_BASE}/api/scanner/watchlist`, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: sym, action }),
    }).catch(() => {});
    setWatchlist(prev => {
      const next = action === 'add'
        ? [...new Set([...prev, sym])]
        : prev.filter(s => s !== sym);
      try { localStorage.setItem('moe_watchlist', JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const saveConfig = useCallback(async (cfg: Partial<ScannerConfig>): Promise<{ ok: boolean; error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/scanner/config`, {
        method: 'POST', mode: 'cors',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      const data = await res.json() as { ok?: boolean; config?: ScannerConfig; error?: string };
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      if (data.config) setConfig(data.config);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, []);

  const closePosition = useCallback(async (posId: string): Promise<{ ok: boolean; pnl?: number; error?: string }> => {
    try {
      const res = await fetch(`${API_BASE}/api/scanner/positions/${posId}/close`, {
        method: 'POST', mode: 'cors',
      });
      const data = await res.json() as { ok?: boolean; pnl?: number; error?: string };
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      await load();
      return { ok: true, pnl: data.pnl };
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, [load]);

  return {
    positions, history, quotes, quotesAt, lastResult, runs, config,
    watchlist, scanning, loading, error,
    runScan, reload: load, loadQuotes,
    updateWatchlist, saveConfig, closePosition,
  };
}
