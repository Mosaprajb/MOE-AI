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

  const loadQuotes = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE}/api/scanner/quotes`, { mode: 'cors' });
      if (res.ok) {
        const d = await res.json() as { quotes?: LiveQuote[]; fetchedAt?: string };
        setQuotes(d.quotes ?? []);
        setQuotesAt(d.fetchedAt ?? new Date().toISOString());
      }
    } catch { /* non-fatal */ }
  }, []);

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
        // Worker not deployed yet — fall back to localStorage
        try {
          const stored = localStorage.getItem('moe_watchlist');
          if (stored) { const p = JSON.parse(stored); if (Array.isArray(p)) setWatchlist(p); }
        } catch {}
      }
      setError('');
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  // Initial load + start quotes polling every 30 s
  useEffect(() => {
    load();
    loadQuotes();
    quotesTimer.current = setInterval(loadQuotes, 30_000);
    return () => { if (quotesTimer.current) clearInterval(quotesTimer.current); };
  }, [load, loadQuotes]);

  const runScan = useCallback(async (): Promise<ScanResult | null> => {
    setScanning(true);
    try {
      const res = await fetch(`${API_BASE}/api/scanner/run`, { method: 'POST', mode: 'cors' });
      const raw = await res.json() as Record<string, unknown>;
      // Normalize: old Worker may use 'signals' instead of 'candidates'
      const data: ScanResult = {
        mode:             String(raw.mode             ?? 'SANDBOX'),
        scanned:          Number(raw.scanned           ?? 0),
        candidates:       Array.isArray(raw.candidates) ? (raw.candidates as ScanCandidate[])
                        : Array.isArray(raw.signals)    ? (raw.signals    as ScanCandidate[])
                        : [],
        ordersPlaced:     Number(raw.ordersPlaced      ?? 0),
        positionsManaged: Number(raw.positionsManaged  ?? 0),
        errors:           Array.isArray(raw.errors) ? (raw.errors as string[]) : [],
        ms:               Number(raw.ms               ?? 0),
      };
      setLastResult(data);
      await load(); // refresh positions + runs
      return data;
    } catch (e) { setError(String(e)); return null; }
    finally { setScanning(false); }
  }, [load]);

  const updateWatchlist = useCallback(async (symbol: string, action: 'add' | 'remove') => {
    const sym = symbol.toUpperCase();
    // Best-effort sync to Worker (fire-and-forget)
    fetch(`${API_BASE}/api/scanner/watchlist`, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: sym, action }),
    }).catch(() => {});
    // Update local state + localStorage immediately (works offline / without Worker)
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
      await load(); // refresh positions
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
