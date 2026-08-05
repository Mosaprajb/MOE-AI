import type { TradingMode } from './types';
import type { MobileEnv } from './mobile-env';

const RECEPTION_KEY = 'mobile:tradingview-reception';

export interface MobileReceptionState {
  enabled: boolean;
  accountType: 'DEMO' | 'LIVE';
  updatedAt: string;
}

export async function getMobileReceptionState(env: MobileEnv): Promise<MobileReceptionState> {
  const fallback: MobileReceptionState = {
    enabled: true,
    accountType: 'DEMO',
    updatedAt: new Date(0).toISOString(),
  };
  if (!env.CONFIG) return fallback;
  try {
    const saved = await env.CONFIG.get(RECEPTION_KEY, 'json') as Partial<MobileReceptionState> | null;
    if (!saved) return fallback;
    return {
      enabled: saved.enabled !== false,
      accountType: saved.accountType === 'LIVE' ? 'LIVE' : 'DEMO',
      updatedAt: typeof saved.updatedAt === 'string' ? saved.updatedAt : fallback.updatedAt,
    };
  } catch {
    return fallback;
  }
}

export async function setMobileReceptionState(
  env: MobileEnv,
  enabled: boolean,
  accountType: 'DEMO' | 'LIVE',
): Promise<MobileReceptionState> {
  if (!env.CONFIG) throw new Error('CONFIG KV is required to update reception state');
  const state: MobileReceptionState = {
    enabled,
    accountType,
    updatedAt: new Date().toISOString(),
  };
  await env.CONFIG.put(RECEPTION_KEY, JSON.stringify(state));
  return state;
}

export function mobileAccountTypeForMode(mode: TradingMode): 'DEMO' | 'LIVE' {
  return mode === 'LIVE' ? 'LIVE' : 'DEMO';
}

async function runSchemaStatement(env: MobileEnv, sql: string): Promise<void> {
  if (!env.DB) return;
  await env.DB.prepare(sql).run();
}

export async function ensureMobileAuditSchema(env: MobileEnv): Promise<void> {
  if (!env.DB) return;
  await runSchemaStatement(env, `
    CREATE TABLE IF NOT EXISTS mobile_audit (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      symbol TEXT,
      account_type TEXT,
      reason TEXT,
      error TEXT,
      request_id TEXT,
      created_at TEXT NOT NULL
    )
  `);
  await runSchemaStatement(env, `
    CREATE INDEX IF NOT EXISTS idx_mobile_audit_created
      ON mobile_audit(created_at DESC)
  `);
  await runSchemaStatement(env, `
    CREATE TABLE IF NOT EXISTS mobile_login_attempts (
      fingerprint TEXT PRIMARY KEY,
      failures INTEGER NOT NULL DEFAULT 0,
      window_started_at INTEGER NOT NULL,
      locked_until INTEGER,
      updated_at INTEGER NOT NULL
    )
  `);
}

export async function writeMobileAudit(
  env: MobileEnv,
  event: {
    type: string;
    symbol?: string;
    accountType?: string;
    reason?: string;
    error?: string;
    requestId?: string;
  },
): Promise<void> {
  if (!env.DB) return;
  await ensureMobileAuditSchema(env);
  await env.DB.prepare(`
    INSERT INTO mobile_audit (
      id, type, symbol, account_type, reason, error, request_id, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    crypto.randomUUID(),
    event.type,
    event.symbol ?? null,
    event.accountType ?? null,
    event.reason ?? null,
    event.error ?? null,
    event.requestId ?? null,
    new Date().toISOString(),
  ).run();
}
