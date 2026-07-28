// MOE-AI — TradingView Signals hook
import { useState, useEffect, useCallback } from 'react';
import { API_BASE } from '../lib/config';
import type { TradingMode } from '../lib/config';

export interface TVSignal {
  signalId:     string;
  symbol:       string;
  side:         'BUY' | 'SELL';
  signal:       string | null;
  entry:        number | null;
  stop:         number | null;
  target:       number | null;
  qty:          number | null;
  accepted:     boolean;
  submitted:    boolean;
  rejectReason: string | null;
  mode:         string;
  createdAt:    string;
}

export interface WbPosition {
  symbol:           string;
  quantity:         number;
  avgCost:          number;
  lastPrice:        number;
  marketValue:      number;
  unrealizedPnl:    number;
  unrealizedPnlPct: number;
  side:             string;
}

export interface AccountInfo {
  buyingPower:    number;
  cash:           number;
  marketValue:    number;
  unrealizedPnl:  number;
  totalEquity:    number;
}

export interface DashboardData {
  account:   AccountInfo;
  positions: WbPosition[];
  orders:    unknown[];
  safety: {
    killSwitch:       boolean;
    mode:             string;
    webullConnected:  boolean;
    executionAllowed: boolean;
  };
}

export function useSignals(mode: TradingMode) {
  const [signals,   setSignals]   = useState<TVSignal[]>([]);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [sigRes, dashRes] = await Promise.all([
        fetch(`${API_BASE}/api/tradingview/decisions?mode=${mode}&limit=100`, { mode: 'cors' }),
        fetch(`${API_BASE}/api/trading/${mode.toLowerCase()}/dashboard`,      { mode: 'cors' }),
      ]);
      if (sigRes.ok)  { const d = await sigRes.json() as { decisions: TVSignal[] }; setSignals(d.decisions ?? []); }
      if (dashRes.ok) { setDashboard(await dashRes.json() as DashboardData); }
      setError('');
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  }, [mode]);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const sendTestSignal = useCallback(async (symbol: string, action: 'buy' | 'sell') => {
    const res = await fetch(`${API_BASE}/api/tradingview/webhook`, {
      method:  'POST',
      mode:    'cors',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ symbol: symbol.toUpperCase(), action, qty: 1 }),
    });
    const data = await res.json();
    setTimeout(load, 1500);
    return data as { accepted: boolean; reason?: string; orderId?: string; signalId: string };
  }, [load]);

  return { signals, dashboard, loading, error, reload: load, sendTestSignal };
}
