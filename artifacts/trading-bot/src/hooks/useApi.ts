// MOE-AI React Hooks — data fetching with auto-refresh
import { useCallback, useEffect, useRef, useState } from 'react';
import type { TradingMode } from '../lib/config';
import type { DashboardPayload, Decision, Trade } from '../lib/types';
import * as api from '../lib/api';

interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => void;
  lastUpdated: Date | null;
}

function usePolled<T>(
  fetcher: () => Promise<T>,
  intervalMs: number,
  enabled = true,
): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const result = await fetcher();
      if (mountedRef.current) {
        setData(result);
        setLastUpdated(new Date());
      }
    } catch (err) {
      if (mountedRef.current)
        setError(err instanceof Error ? err.message : 'Request failed');
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, [fetcher, enabled]);

  useEffect(() => {
    mountedRef.current = true;
    if (!enabled) return;
    load();
    timerRef.current = setInterval(load, intervalMs);
    return () => {
      mountedRef.current = false;
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [load, intervalMs, enabled]);

  return { data, loading, error, refresh: load, lastUpdated };
}

export function useDashboard(mode: TradingMode, intervalMs = 15_000) {
  const fetcher = useCallback(() => api.fetchDashboard(mode), [mode]);
  return usePolled<DashboardPayload>(fetcher, intervalMs);
}

export function useDecisions(intervalMs = 10_000) {
  const fetcher = useCallback(() => api.fetchDecisions(50), []);
  return usePolled<Decision[]>(fetcher, intervalMs);
}

export function useTrades(mode?: TradingMode, intervalMs = 30_000) {
  const fetcher = useCallback(() => api.fetchTrades(100, mode), [mode]);
  return usePolled<Trade[]>(fetcher, intervalMs);
}

export function useLiveReadiness(intervalMs = 30_000) {
  const fetcher = useCallback(() => api.fetchLiveReadiness(), []);
  return usePolled<{ ready: boolean; missingSecrets?: string[]; gates?: Record<string, boolean> }>(
    fetcher, intervalMs,
  );
}

export function useSystemHealth(intervalMs = 60_000) {
  const fetcher = useCallback(() => api.fetchSystemHealth(), []);
  return usePolled<Record<string, unknown>>(fetcher, intervalMs);
}
