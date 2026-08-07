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
  trailingActivationCents: number;
  trailingInitialLockCents: number;
  trailingStepTriggerCents: number;
  trailingStepMoveCents: number;
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
    // Fail closed for accounts saved before take-profit support existed. The
    // native app must explicitly save the new protection settings before the
    // account is considered configured again.
    takeProfitEnabled: false,
    takeProfitPct: 2,
    trailingEnabled: false,
    trailingActivationCents: 5,
    trailingInitialLockCents: 2,
    trailingStepTriggerCents: 5,
    trailingStepMoveCents: 1,
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

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
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
  const allowedSessions = sanitizeSessions(input.allowedSessions, current.allowedSessions);
  // Webull overnight trading supports LIMIT + DAY orders only. If NIGHT is
  // selected, keep the account fail-safe by normalizing TIF to DAY instead of
  // allowing a GTC value that the broker can reject during the overnight window.
  const requestedTimeInForce = input.timeInForce === 'GTC'
    ? 'GTC'
    : input.timeInForce === 'DAY'
      ? 'DAY'
      : current.timeInForce;
  const timeInForce: TradingTimeInForce = allowedSessions.includes('NIGHT')
    ? 'DAY'
    : requestedTimeInForce;

  const trailingActivationCents = clamp(
    asFiniteNumber(input.trailingActivationCents, current.trailingActivationCents),
    0.01,
    10_000,
  );
  const requestedInitialLock = clamp(
    asFiniteNumber(input.trailingInitialLockCents, current.trailingInitialLockCents),
    0,
    10_000,
  );
  // A sell stop must remain below the activation market level. The initial
  // locked-profit offset is therefore always strictly smaller than activation.
  const trailingInitialLockCents = Math.min(
    requestedInitialLock,
    Math.max(0, trailingActivationCents - 0.01),
  );
  const trailingStepTriggerCents = clamp(
    asFiniteNumber(input.trailingStepTriggerCents, current.trailingStepTriggerCents),
    0.01,
    10_000,
  );
  const trailingStepMoveCents = Math.min(
    clamp(
      asFiniteNumber(input.trailingStepMoveCents, current.trailingStepMoveCents),
      0.01,
      10_000,
    ),
    trailingStepTriggerCents,
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
        : input.sizingSource === 'cash_plus_margin'
          ? 'cash_plus_margin'
          : current.sizingSource,
    maxCashPct: clamp(
      asFiniteNumber(input.maxCashPct, current.maxCashPct),
      1,
      100,
    ),
    marginPct: clamp(
      asFiniteNumber(input.marginPct, current.marginPct),
      0,
      100,
    ),
    maxPositionUsd: maxTradeAmountUsd,
    stopLossEnabled: input.stopLossEnabled === undefined
      ? current.stopLossEnabled
      : input.stopLossEnabled !== false,
    stopLossPct: clamp(
      asFiniteNumber(input.stopLossPct, current.stopLossPct),
      0.1,
      50,
    ),
    takeProfitEnabled: input.takeProfitEnabled === undefined
      ? current.takeProfitEnabled
      : input.takeProfitEnabled !== false,
    takeProfitPct: clamp(
      asFiniteNumber(input.takeProfitPct, current.takeProfitPct),
      0.1,
      100,
    ),
    trailingEnabled: input.trailingEnabled === undefined
      ? current.trailingEnabled
      : input.trailingEnabled === true,
    trailingActivationCents,
    trailingInitialLockCents,
    trailingStepTriggerCents,
    trailingStepMoveCents,
    blockIfPosition: input.blockIfPosition === undefined
      ? current.blockIfPosition
      : input.blockIfPosition !== false,
    sessionOpenOnly: true,
    sessionTz: 'America/New_York',
    sessionStart: '09:30',
    sessionEnd: '16:00',
  };
}

export function isTradingSettingsConfigured(settings: TradingSettings): boolean {
  const baseProtectionConfigured = settings.stopLossEnabled
    && settings.stopLossPct > 0
    && settings.takeProfitEnabled
    && settings.takeProfitPct > 0;
  const trailingConfigured = !settings.trailingEnabled || (
    settings.trailingActivationCents > 0
    && settings.trailingInitialLockCents >= 0
    && settings.trailingInitialLockCents < settings.trailingActivationCents
    && settings.trailingStepTriggerCents > 0
    && settings.trailingStepMoveCents > 0
    && settings.trailingStepMoveCents <= settings.trailingStepTriggerCents
  );

  return settings.allowedSessions.length > 0
    && settings.shareQuantity >= 1
    && settings.maxTradeAmountUsd > 0
    && baseProtectionConfigured
    && trailingConfigured;
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
