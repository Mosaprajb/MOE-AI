// MOE-AI API Client — connects to Cloudflare Worker
import { API_BASE, type TradingMode } from './config';
import type { DashboardPayload, Decision, Trade, SystemHealth } from './types';

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res = await fetch(url, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
    mode: 'cors',
    cache: 'no-store',
  });

  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json() as { error?: string }; msg = j.error ?? msg; } catch {}
    throw new ApiError(res.status, msg);
  }

  return res.json() as Promise<T>;
}

// ── Dashboard / Account ──────────────────────────────────────────────────────
export async function fetchDashboard(mode: TradingMode = 'SANDBOX'): Promise<DashboardPayload> {
  const isLive = mode === 'LIVE';
  // Try the dashboard endpoint; fallback to composing from individual endpoints
  try {
    return await request<DashboardPayload>(`/api/trading/${isLive ? 'live' : 'sandbox'}/dashboard`);
  } catch {
    // Compose from individual endpoints
    const [account, positions, orders] = await Promise.allSettled([
      request<unknown>(`/api/trading/${isLive ? 'live' : 'sandbox'}/account`),
      request<unknown>(`/api/trading/${isLive ? 'live' : 'sandbox'}/positions`),
      request<unknown>(`/api/trading/${isLive ? 'live' : 'sandbox'}/orders`),
    ]);
    return {
      account: account.status === 'fulfilled' ? account.value as Record<string, unknown> : {},
      positions: positions.status === 'fulfilled' ? (positions.value as { data?: unknown[] }).data ?? [] as never[] : [],
      orders: orders.status === 'fulfilled' ? (orders.value as { data?: unknown[] }).data ?? [] as never[] : [],
      safety: {},
      updatedAt: new Date().toISOString(),
    } as DashboardPayload;
  }
}

// ── Decisions ────────────────────────────────────────────────────────────────
export async function fetchDecisions(limit = 50): Promise<Decision[]> {
  const payload = await request<{ decisions?: Decision[] }>(
    `/api/tradingview/decisions?limit=${limit}`
  );
  return Array.isArray(payload.decisions) ? payload.decisions : [];
}

// ── Trades ───────────────────────────────────────────────────────────────────
export async function fetchTrades(limit = 100, mode?: TradingMode): Promise<Trade[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (mode) qs.set('mode', mode);
  const payload = await request<{ trades?: Trade[] }>(`/api/trading/trades?${qs}`);
  return Array.isArray(payload.trades) ? payload.trades : [];
}

// ── Live readiness ───────────────────────────────────────────────────────────
export async function fetchLiveReadiness(): Promise<{
  ready: boolean;
  missingSecrets?: string[];
  gates?: Record<string, boolean>;
}> {
  return request('/api/trading/live/readiness');
}

// ── System health ─────────────────────────────────────────────────────────────
export async function fetchSystemHealth(): Promise<Partial<SystemHealth>> {
  try {
    return await request<Partial<SystemHealth>>('/api/system/health');
  } catch {
    // Fallback: try the worker info endpoint
    try {
      return await request<Partial<SystemHealth>>('/api/health');
    } catch {
      return { cloudflareOk: false, webullOk: false, databaseOk: false, errorCount: 0, warningCount: 0 };
    }
  }
}

// ── Scanner / signals ─────────────────────────────────────────────────────────
export async function fetchScannerResults(): Promise<{ signals?: unknown[] }> {
  try {
    return await request('/api/scanner/results');
  } catch {
    return {};
  }
}

// ── Order submission ──────────────────────────────────────────────────────────
export async function submitOrder(payload: {
  symbol: string;
  side: 'BUY' | 'SELL';
  type: string;
  quantity: number;
  price?: number;
  stopPrice?: number;
  mode: TradingMode;
  idempotencyKey: string;
}): Promise<{ orderId?: string; status?: string; error?: string }> {
  return request('/api/trading/orders', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ── Kill switch ───────────────────────────────────────────────────────────────
export async function triggerKillSwitch(enabled: boolean): Promise<{ success: boolean }> {
  return request('/api/trading/kill-switch', {
    method: 'POST',
    body: JSON.stringify({ enabled }),
  });
}
