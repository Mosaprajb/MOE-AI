import type { Env } from '../lib/types';

export type TradingSettings = {
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

const SETTINGS_KEY = 'trading:settings';

const defaults: TradingSettings = {
  sizingSource: 'cash_plus_margin',
  maxCashPct: 25,
  marginPct: 50,
  maxPositionUsd: 0,
  stopLossEnabled: true,
  stopLossPct: 2,
  blockIfPosition: true,
  sessionOpenOnly: true,
  sessionTz: 'America/Chicago',
  sessionStart: '08:30',
  sessionEnd: '15:00',
};

export async function getTradingSettings(env: Env): Promise<TradingSettings> {
  if (!env.CONFIG) return defaults;
  try {
    const saved = await env.CONFIG.get(SETTINGS_KEY, 'json') as Partial<TradingSettings> | null;
    return { ...defaults, ...(saved ?? {}) };
  } catch {
    return defaults;
  }
}