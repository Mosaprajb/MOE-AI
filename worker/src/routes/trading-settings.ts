import type { Env, TradingMode } from '../lib/types';

export type TradingWindow = 'CORE' | 'EXTENDED' | 'NIGHT';
export type TradingTimeInForce = 'DAY' | 'GTC';
export type WebullTradingSession = 'CORE' | 'ALL' | 'NIGHT';

export type TradingSettings = {
  mode: TradingMode;
  allowedSessions: TradingWindow[];
  timeInForce: TradingTimeInForce;
  shareQuantity: number;
  maxTradeAmountUsd: number;
  sizingSource: 'cash' | 'cash_plus_margin' | 'buying_power';
  maxCashPct: number;
  marginPct: number;
  maxPositionUsd: number;
  stopLossEnabled: boolean;
  stopLossPct: number;
  blockIfPosition: boolean;
  sessionOpenOnly: boolean;
  sessionTz: string;
  sessionStart: string;
  sessionEnd: string;
};

export type TradingWindowSnapshot = {
  window: TradingWindow | 'CLOSED';
  webullSession: WebullTradingSession | null;
  label: string;
  weekday: string;
  minutesET: number;
};

const LEGACY_SETTINGS_KEY = 'trading:settings';

function settingsKey(mode: TradingMode): string {
  return `trading:settings:${mode}`;
}

function defaultsForMode(mode: TradingMode): TradingSettings {
  return {
    mode,
    allowedSessions: ['CORE'],
    timeInForce: 'DAY',
    shareQuantity: 0,
    maxTradeAmountUsd: 0,
    sizingSource: 'cash_plus_margin',
    maxCashPct: 25,
    marginPct: 50,
    maxPositionUsd: 0,
    stopLossEnabled: true,
    stopLossPct: 2,
    blockIfPosition: true,
    sessionOpenOnly: true,
    sessionTz: 'America/New_York',
    sessionStart: '09:30',
    sessionEnd: '16:00',
  };
}

function asFiniteNumber(value: unknown, fallback: number): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function sanitizeSessions(value: unknown, fallback: TradingWindow[]): TradingWindow[] {
  if (!Array.isArray(value)) return fallback;
  const valid = new Set<TradingWindow>(['CORE', 'EXTENDED', 'NIGHT']);
  return [...new Set(
    value
      .map(item => String(item).trim().toUpperCase())
      .filter((item): item is TradingWindow => valid.has(item as TradingWindow)),
  )];
}

export function sanitizeTradingSettings(
  mode: TradingMode,
  input: Partial<TradingSettings>,
  current = defaultsForMode(mode),
): TradingSettings {
  const maxTradeAmountUsd = Math.max(
    0,
    asFiniteNumber(input.maxTradeAmountUsd ?? input.maxPositionUsd, current.maxTradeAmountUsd),
  );
  return {
    mode,
    allowedSessions: sanitizeSessions(input.allowedSessions, current.allowedSessions),
    timeInForce: input.timeInForce === 'GTC' ? 'GTC' : 'DAY',
    shareQuantity: Math.max(
      0,
      Math.floor(asFiniteNumber(input.shareQuantity, current.shareQuantity)),
    ),
    maxTradeAmountUsd,
    sizingSource: input.sizingSource === 'buying_power'
      ? 'buying_power'
      : input.sizingSource === 'cash'
        ? 'cash'
        : 'cash_plus_margin',
    maxCashPct: Math.max(
      1,
      Math.min(100, asFiniteNumber(input.maxCashPct, current.maxCashPct)),
    ),
    marginPct: Math.max(
      0,
      Math.min(100, asFiniteNumber(input.marginPct, current.marginPct)),
    ),
    maxPositionUsd: maxTradeAmountUsd,
    stopLossEnabled: input.stopLossEnabled !== false,
    stopLossPct: Math.max(
      0.1,
      Math.min(50, asFiniteNumber(input.stopLossPct, current.stopLossPct)),
    ),
    blockIfPosition: input.blockIfPosition !== false,
    sessionOpenOnly: true,
    sessionTz: 'America/New_York',
    sessionStart: '09:30',
    sessionEnd: '16:00',
  };
}

export function isTradingSettingsConfigured(settings: TradingSettings): boolean {
  return settings.allowedSessions.length > 0
    && settings.shareQuantity >= 1
    && settings.maxTradeAmountUsd > 0;
}

export async function getTradingSettings(
  env: Env,
  mode: TradingMode = 'SANDBOX',
): Promise<TradingSettings> {
  const defaults = defaultsForMode(mode);
  if (!env.CONFIG) return defaults;
  try {
    const saved = await env.CONFIG.get(settingsKey(mode), 'json') as Partial<TradingSettings> | null;
    if (saved) return sanitizeTradingSettings(mode, saved, defaults);

    // Preserve existing Paper settings while moving to per-account storage.
    if (mode === 'SANDBOX') {
      const legacy = await env.CONFIG.get(LEGACY_SETTINGS_KEY, 'json') as Partial<TradingSettings> | null;
      if (legacy) return sanitizeTradingSettings(mode, legacy, defaults);
    }
    return defaults;
  } catch {
    return defaults;
  }
}

export async function saveTradingSettings(
  env: Env,
  mode: TradingMode,
  input: Partial<TradingSettings>,
): Promise<TradingSettings> {
  if (!env.CONFIG) throw new Error('CONFIG KV is required to save trading settings');
  const current = await getTradingSettings(env, mode);
  const settings = sanitizeTradingSettings(mode, input, current);
  await env.CONFIG.put(settingsKey(mode), JSON.stringify(settings));
  return settings;
}

export function currentTradingWindow(date = new Date()): TradingWindowSnapshot {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const value = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  const weekday = value('weekday');
  const hour = Number(value('hour') === '24' ? '0' : value('hour'));
  const minute = Number(value('minute'));
  const minutesET = hour * 60 + minute;
  const isWeekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
  const overnightMorning = isWeekday && minutesET < 4 * 60;
  const overnightEvening = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'].includes(weekday)
    && minutesET >= 20 * 60;

  if (overnightMorning || overnightEvening) {
    return {
      window: 'NIGHT',
      webullSession: 'NIGHT',
      label: 'Overnight · 8:00 PM–4:00 AM ET',
      weekday,
      minutesET,
    };
  }
  if (isWeekday && minutesET >= 4 * 60 && minutesET < 9 * 60 + 30) {
    return {
      window: 'EXTENDED',
      webullSession: 'ALL',
      label: 'Pre-market · 4:00–9:30 AM ET',
      weekday,
      minutesET,
    };
  }
  if (isWeekday && minutesET >= 9 * 60 + 30 && minutesET < 16 * 60) {
    return {
      window: 'CORE',
      webullSession: 'CORE',
      label: 'Regular · 9:30 AM–4:00 PM ET',
      weekday,
      minutesET,
    };
  }
  if (isWeekday && minutesET >= 16 * 60 && minutesET < 20 * 60) {
    return {
      window: 'EXTENDED',
      webullSession: 'ALL',
      label: 'After-hours · 4:00–8:00 PM ET',
      weekday,
      minutesET,
    };
  }
  return {
    window: 'CLOSED',
    webullSession: null,
    label: 'Market closed',
    weekday,
    minutesET,
  };
}

export function isCurrentTradingWindowAllowed(
  settings: TradingSettings,
  snapshot = currentTradingWindow(),
): boolean {
  return snapshot.window !== 'CLOSED'
    && settings.allowedSessions.includes(snapshot.window);
}
