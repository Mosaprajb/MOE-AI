// MOE-AI — Scanner data hook
import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../lib/config';
import type { TradingMode } from '../lib/config';

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
  const [lastResult,  setLastResult]  = useState<ScanResult | null>(null);
  const [runs,        setRuns]        = useState<ScanRun[]>([]);
  const [config,      setConfig]      = useState<ScannerConfig | null>(null);
  const [watchlist,   setWatchlist]   = useState<string[]>([]);
  const [scanning,    setScanning]    = useState(false);
  const [loading,     setLoading]     = useState(true);
  const [error,       setError]       = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [posRes, runsRes, cfgRes, wlRes] = await Promise.all([
        fetch(`${API_BASE}/api/scanner/positions`, { mode: 'cors' }),
        fetch(`${API_BASE}/api/scanner/runs?limit=10`, { mode: 'cors' }),
        fetch(`${API_BASE}/api/scanner/config`, { mode: 'cors' }),
        fetch(`${API_BASE}/api/scanner/watchlist`, { mode: 'cors' }),
      ]);
      if (posRes.ok)  { const d = await posRes.json();  setPositions(d.data ?? []); }
      if (runsRes.ok) { const d = await runsRes.json(); setRuns(d.data ?? []); }
      if (cfgRes.ok)  { setConfig(await cfgRes.json()); }
      if (wlRes.ok)   { const d = await wlRes.json(); setWatchlist(d.symbols ?? []); }
      setError('');
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runScan = useCallback(async () => {
    setScanning(true);
    try {
      const res  = await fetch(`${API_BASE}/api/scanner/run`, { method: 'POST', mode: 'cors' });
      const data = await res.json() as ScanResult;
      setLastResult(data);
      await load(); // refresh positions + runs
    } catch (e) { setError(String(e)); }
    finally { setScanning(false); }
  }, [load]);

  const updateWatchlist = useCallback(async (symbol: string, action: 'add' | 'remove') => {
    await fetch(`${API_BASE}/api/scanner/watchlist`, {
      method: 'POST', mode: 'cors',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ symbol: symbol.toUpperCase(), action }),
    });
    await load();
  }, [load]);

  return { positions, lastResult, runs, config, watchlist, scanning, loading, error, runScan, reload: load, updateWatchlist };
}
