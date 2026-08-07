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
  takeProfitEnabled: boolean;
  takeProfitPct: number;
  trailingEnabled: boolean;
  trailActivationUsd: number;
  trailInitialStopOffsetUsd: number;
  trailTriggerStepUsd: number;
  trailStopMoveUsd: number;
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
    takeProfitEnabled: true,
    takeProfitPct: 3,
    trailingEnabled: false,
    trailActivationUsd: 0.05,
    trailInitialStopOffsetUsd: 0.02,
    trailTriggerStepUsd: 0.05,
    trailStopMoveUsd: 0.01,
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

function clamp(value: unknown, fallback: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, asFiniteNumber(value, fallback)));
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
  const allowedSessions = sanitizeSessions(input.allowedSessions, current.allowedSessions);
  // Webull overnight trading supports LIMIT + DAY orders only. If NIGHT is
  // selected, keep the account fail-safe by normalizing TIF to DAY instead of
  // allowing a GTC value that the broker can reject during the overnight window.
  const requestedTimeInForce = input.timeInForce === 'GTC' ? 'GTC' : 'DAY';
  const timeInForce: TradingTimeInForce = allowedSessions.includes('NIGHT')
    ? 'DAY'
    : requestedTimeInForce;

  const trailActivationUsd = clamp(
    input.trailActivationUsd,
    current.trailActivationUsd,
    0.01,
    100,
  );
  const trailInitialStopOffsetUsd = clamp(
    input.trailInitialStopOffsetUsd,
    current.trailInitialStopOffsetUsd,
    0,
    100,
  );
  const trailTriggerStepUsd = clamp(
    input.trailTriggerStepUsd,
    current.trailTriggerStepUsd,
    0.01,
    100,
  );
  const trailStopMoveUsd = clamp(
    input.trailStopMoveUsd,
    current.trailStopMoveUsd,
    0.01,
    100,
  );

  return {
    mode,
    allowedSessions,
    timeInForce,
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
    stopLossPct: clamp(input.stopLossPct, current.stopLossPct, 0.01, 50),
    takeProfitEnabled: input.takeProfitEnabled !== false,
    takeProfitPct: clamp(input.takeProfitPct, current.takeProfitPct, 0.01, 100),
    trailingEnabled: input.trailingEnabled === true,
    trailActivationUsd,
    trailInitialStopOffsetUsd,
    trailTriggerStepUsd,
    trailStopMoveUsd,
    blockIfPosition: input.blockIfPosition !== false,
    sessionOpenOnly: true,
    sessionTz: 'America/New_York',
    sessionStart: '09:30',
    sessionEnd: '16:00',
  };
}

export function isTradingSettingsConfigured(settings: TradingSettings): boolean {
  const baseConfigured = settings.allowedSessions.length > 0
    && settings.shareQuantity >= 1
    && settings.maxTradeAmountUsd > 0
    && settings.stopLossEnabled
    && settings.stopLossPct > 0
    && settings.takeProfitEnabled
    && settings.takeProfitPct > 0;
  if (!baseConfigured) return false;
  if (!settings.trailingEnabled) return true;

  return settings.trailActivationUsd > 0
    && settings.trailInitialStopOffsetUsd >= 0
    && settings.trailInitialStopOffsetUsd < settings.trailActivationUsd
    && settings.trailTriggerStepUsd > 0
    && settings.trailStopMoveUsd > 0
    && settings.trailStopMoveUsd <= settings.trailTriggerStepUsd;
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
