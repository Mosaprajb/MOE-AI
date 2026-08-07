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
  trailingTriggerCents: number;
  trailingInitialStopProfitCents: number;
  trailingTriggerStepCents: number;
  trailingStopStepCents: number;
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

export type TradeProtectionPreview = {
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  trailingTriggerPrice: number;
  trailingInitialStopPrice: number;
  trailingStopPrice: number | null;
  trailingLevels: number;
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
    trailingEnabled: true,
    trailingTriggerCents: 5,
    trailingInitialStopProfitCents: 2,
    trailingTriggerStepCents: 5,
    trailingStopStepCents: 1,
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

function asPositiveInteger(value: unknown, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(asFiniteNumber(value, fallback))));
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

export function roundStockPrice(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Number(value.toFixed(value >= 1 ? 2 : 4));
}

export function trailingStopForPrice(
  settings: TradingSettings,
  entryPrice: number,
  highWaterPrice: number,
): { price: number | null; levels: number } {
  if (!settings.trailingEnabled || !(entryPrice > 0) || !(highWaterPrice > 0)) {
    return { price: null, levels: 0 };
  }

  // Calculate the ladder in integer cents so values such as 10.05 do not
  // drift across a threshold because of binary floating-point representation.
  const gainCents = Math.floor(((highWaterPrice - entryPrice) * 100) + 1e-7);
  if (gainCents < settings.trailingTriggerCents) {
    return { price: null, levels: 0 };
  }

  const levels = Math.max(
    0,
    Math.floor(
      (gainCents - settings.trailingTriggerCents)
        / settings.trailingTriggerStepCents,
    ),
  );
  const profitCents = settings.trailingInitialStopProfitCents
    + (levels * settings.trailingStopStepCents);

  return {
    price: roundStockPrice(entryPrice + (profitCents / 100)),
    levels,
  };
}

export function protectionPreview(
  settings: TradingSettings,
  entryPrice: number,
  highWaterPrice = entryPrice,
): TradeProtectionPreview {
  const entry = roundStockPrice(entryPrice);
  const trailing = trailingStopForPrice(settings, entry, highWaterPrice);
  return {
    entryPrice: entry,
    stopLossPrice: roundStockPrice(entry * (1 - (settings.stopLossPct / 100))),
    takeProfitPrice: roundStockPrice(entry * (1 + (settings.takeProfitPct / 100))),
    trailingTriggerPrice: roundStockPrice(entry + (settings.trailingTriggerCents / 100)),
    trailingInitialStopPrice: roundStockPrice(
      entry + (settings.trailingInitialStopProfitCents / 100),
    ),
    trailingStopPrice: trailing.price,
    trailingLevels: trailing.levels,
  };
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

  const trailingTriggerCents = asPositiveInteger(
    input.trailingTriggerCents,
    current.trailingTriggerCents,
    1,
    10_000,
  );
  const trailingInitialStopProfitCents = Math.max(
    0,
    Math.min(
      trailingTriggerCents - 1,
      Math.round(asFiniteNumber(
        input.trailingInitialStopProfitCents,
        current.trailingInitialStopProfitCents,
      )),
    ),
  );
  const trailingTriggerStepCents = asPositiveInteger(
    input.trailingTriggerStepCents,
    current.trailingTriggerStepCents,
    2,
    10_000,
  );
  const trailingStopStepCents = asPositiveInteger(
    input.trailingStopStepCents,
    current.trailingStopStepCents,
    1,
    Math.max(1, trailingTriggerStepCents - 1),
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
    stopLossPct: Math.max(
      0.1,
      Math.min(50, asFiniteNumber(input.stopLossPct, current.stopLossPct)),
    ),
    takeProfitEnabled: input.takeProfitEnabled !== false,
    takeProfitPct: Math.max(
      0.1,
      Math.min(100, asFiniteNumber(input.takeProfitPct, current.takeProfitPct)),
    ),
    trailingEnabled: input.trailingEnabled !== false,
    trailingTriggerCents,
    trailingInitialStopProfitCents,
    trailingTriggerStepCents,
    trailingStopStepCents,
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
    && settings.maxTradeAmountUsd > 0
    && settings.stopLossEnabled
    && settings.stopLossPct > 0
    && settings.takeProfitEnabled
    && settings.takeProfitPct > 0
    && (!settings.trailingEnabled || (
      settings.trailingTriggerCents > 0
      && settings.trailingInitialStopProfitCents >= 0
      && settings.trailingInitialStopProfitCents < settings.trailingTriggerCents
      && settings.trailingTriggerStepCents > 0
      && settings.trailingStopStepCents > 0
      && settings.trailingStopStepCents < settings.trailingTriggerStepCents
    ));
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
