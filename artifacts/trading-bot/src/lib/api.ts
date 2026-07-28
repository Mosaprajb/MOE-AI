// MOE-AI API Client — connects to Cloudflare Worker
import { API_BASE } from './config';
import type { TradingMode } from './config';
import type { DashboardPayload, Decision, Trade } from './types';

class ApiError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const url = `${API_BASE}${path}`;
  const res  = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    mode:  'cors',
    cache: 'no-store',
  });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try { const j = await res.json() as { error?: string }; msg = j.error ?? msg; } catch {}
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
export async function fetchDashboard(mode: TradingMode = 'SANDBOX'): Promise<DashboardPayload> {
  const seg = mode === 'LIVE' ? 'live' : 'sandbox';
  try {
    return await request<DashboardPayload>(`/api/trading/${seg}/dashboard`);
  } catch {
    const [account, positions, orders] = await Promise.allSettled([
      request<unknown>(`/api/trading/${seg}/account`),
      request<{ data?: unknown[] }>(`/api/trading/${seg}/positions`),
      request<{ data?: unknown[] }>(`/api/trading/${seg}/orders`),
    ]);
    return {
      account:   account.status   === 'fulfilled' ? account.value as Record<string, unknown>   : {},
      positions: positions.status === 'fulfilled' ? (positions.value as { data?: unknown[] }).data ?? [] as never[] : [],
      orders:    orders.status    === 'fulfilled' ? (orders.value as { data?: unknown[] }).data ?? [] as never[] : [],
      safety: {},
      updatedAt: new Date().toISOString(),
    } as DashboardPayload;
  }
}

// ── Decisions ─────────────────────────────────────────────────────────────────
export async function fetchDecisions(limit = 50): Promise<Decision[]> {
  const r = await request<{ decisions?: Decision[] }>(`/api/tradingview/decisions?limit=${limit}`);
  return Array.isArray(r.decisions) ? r.decisions : [];
}

// ── Trades ────────────────────────────────────────────────────────────────────
export async function fetchTrades(limit = 100, mode?: TradingMode): Promise<Trade[]> {
  const qs = new URLSearchParams({ limit: String(limit) });
  if (mode) qs.set('mode', mode);
  const r = await request<{ trades?: Trade[] }>(`/api/trading/trades?${qs}`);
  return Array.isArray(r.trades) ? r.trades : [];
}

// ── Live readiness ────────────────────────────────────────────────────────────
export async function fetchLiveReadiness(): Promise<{
  ready: boolean; missingSecrets?: string[]; gates?: Record<string, boolean>;
}> {
  return request('/api/trading/live/readiness');
}

// ── System health ─────────────────────────────────────────────────────────────
export async function fetchSystemHealth(): Promise<Record<string, unknown>> {
  try { return await request('/api/system/health'); }
  catch {
    try { return await request('/api/health'); }
    catch { return { cloudflareOk: false, webullOk: false, databaseOk: false }; }
  }
}

// ── Trading mode ──────────────────────────────────────────────────────────────
export async function fetchMode(): Promise<{ mode: TradingMode; killSwitch: boolean }> {
  return request('/api/trading/mode');
}

export async function setMode(mode: TradingMode): Promise<{ success: boolean; mode: TradingMode }> {
  return request('/api/trading/mode', {
    method: 'POST', body: JSON.stringify({ mode }),
  });
}

// ── Kill switch ───────────────────────────────────────────────────────────────
export async function triggerKillSwitch(enabled: boolean): Promise<{ success: boolean }> {
  return request('/api/trading/kill-switch', {
    method: 'POST', body: JSON.stringify({ enabled }),
  });
}

// ── Submit order ──────────────────────────────────────────────────────────────
export async function submitOrder(payload: {
  symbol: string; side: 'BUY'|'SELL'; type: string;
  quantity: number; price?: number; stopPrice?: number;
  mode: TradingMode; idempotencyKey: string;
}): Promise<{ orderId?: string; status?: string; error?: string }> {
  return request('/api/trading/orders', { method: 'POST', body: JSON.stringify(payload) });
}
