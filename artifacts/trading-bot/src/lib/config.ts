// MOE-AI API Configuration
// The Cloudflare Worker URL — can be overridden via env var
export const API_BASE =
  (import.meta.env.VITE_MOE_API_BASE_URL as string || 'https://moerand-alerts.mosaprajb.workers.dev').replace(/\/$/, '');

export const REFRESH_MS   = 15_000;
export const FAST_POLL_MS = 5_000;

export const APP_VERSION = '4.0';
export const STRATEGY_VERSION = 'MOE v6.3.1';

export const TRADING_MODES = ['SANDBOX', 'LIVE'] as const;
export type TradingMode = (typeof TRADING_MODES)[number];

// LocalStorage keys
export const LS_MODE      = 'moe-trading-mode';
export const LS_PIN_HASH  = 'moe-pin-hash';
export const LS_SESSION   = 'moe-session';
export const LS_WATCHLIST = 'moe-watchlist-v1';
export const LS_SYMBOLS   = 'moerand-symbols-v1';
export const LS_SETTINGS  = 'moe-settings-v1';

// Safety defaults (mirrors Cloudflare Worker config)
export const SAFETY_DEFAULTS = {
  killSwitch: false,
  liveUnlocked: false,
  liveAutomationArmed: false,
  liveOrderSubmission: false,
} as const;

export const LS_KILL_SWITCH = 'moe-kill-switch';
