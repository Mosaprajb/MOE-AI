// MOE-AI Trade Alerts — browser notifications + in-app toasts on open/close
import { useEffect, useRef } from 'react';
import type { Position } from '../lib/types';
import type { TradingMode } from '../lib/config';

type ToastFn = (msg: string, type?: 'success' | 'error', ms?: number) => void;

function fmt(v: number) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(v);
}

function sendBrowserNotification(title: string, body: string) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  try {
    new Notification(title, {
      body,
      icon: '/favicon.ico',
      badge: '/favicon.ico',
      tag: title,           // collapse duplicates
      requireInteraction: false,
    });
  } catch { /* Safari private mode blocks Notification constructor */ }
}

export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted')  return true;
  if (Notification.permission === 'denied')   return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function useTradeAlerts(
  positions: Position[],
  mode: TradingMode,
  showToast: ToastFn,
) {
  // Map of position key → Position from previous poll
  const prevRef      = useRef<Map<string, Position> | null>(null);
  // Skip alerts on the very first data load (don't fire for pre-existing positions)
  const isFirstRef   = useRef(true);

  // Request browser notification permission once on mount
  useEffect(() => {
    requestNotificationPermission();
  }, []);

  useEffect(() => {
    // Key by symbol — Webull sometimes regenerates IDs, symbol is stable
    const key = (p: Position) => `${p.symbol}::${p.side}`;
    const current = new Map(positions.map(p => [key(p), p]));

    // First load: seed the map, don't fire alerts
    if (isFirstRef.current) {
      if (positions.length > 0 || prevRef.current !== null) {
        prevRef.current  = current;
        isFirstRef.current = false;
      }
      return;
    }

    const prev = prevRef.current ?? new Map<string, Position>();

    // ── Trade Opened ──────────────────────────────────────────────────────────
    for (const [k, pos] of current) {
      if (!prev.has(k)) {
        const title = `🟢 Trade Opened · ${pos.symbol}`;
        const body  = `${pos.side} ${pos.quantity} share${pos.quantity !== 1 ? 's' : ''} @ ${fmt(pos.averagePrice)} [${mode}]`;
        showToast(`${title} — ${body}`, 'success', 6000);
        sendBrowserNotification(title, body);
      }
    }

    // ── Trade Closed ──────────────────────────────────────────────────────────
    for (const [k, pos] of prev) {
      if (!current.has(k)) {
        const pnl    = pos.unrealizedPnl ?? 0;
        const pnlStr = `${pnl >= 0 ? '+' : ''}${fmt(pnl)}`;
        const title  = `${pnl >= 0 ? '✅' : '🔴'} Trade Closed · ${pos.symbol}`;
        const body   = `${pos.side} exited · P&L ${pnlStr} [${mode}]`;
        showToast(`${title} — ${body}`, pnl >= 0 ? 'success' : 'error', 8000);
        sendBrowserNotification(title, body);
      }
    }

    prevRef.current = current;
  }, [positions, mode, showToast]);
}
