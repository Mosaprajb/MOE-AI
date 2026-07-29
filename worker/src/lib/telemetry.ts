import type { Env } from './types';

type Level = 'INFO' | 'WARN' | 'ERROR';

export type TelemetryEvent = {
  ts: string;
  traceId: string;
  level: Level;
  event: string;
  message: string;
  data?: Record<string, unknown>;
};

const TRACE_KEY = 'telemetry:recent';
const MAX_EVENTS = 250;

export function createTraceId(prefix = 'cron'): string {
  return `${prefix}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
}

export async function emitTelemetry(
  env: Env,
  traceId: string,
  event: string,
  message: string,
  data: Record<string, unknown> = {},
  level: Level = 'INFO',
): Promise<void> {
  const entry: TelemetryEvent = {
    ts: new Date().toISOString(),
    traceId,
    level,
    event,
    message,
    data,
  };

  const line = JSON.stringify(entry);
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);

  if (!env.CONFIG) return;
  try {
    const current = await env.CONFIG.get(TRACE_KEY, 'json') as TelemetryEvent[] | null;
    const next = [...(Array.isArray(current) ? current : []), entry].slice(-MAX_EVENTS);
    await env.CONFIG.put(TRACE_KEY, JSON.stringify(next));
  } catch (error) {
    console.error(JSON.stringify({
      ts: new Date().toISOString(),
      traceId,
      level: 'ERROR',
      event: 'TELEMETRY_PERSIST_FAILED',
      message: String(error),
    }));
  }
}

export async function getRecentTelemetry(env: Env, limit = 100): Promise<TelemetryEvent[]> {
  if (!env.CONFIG) return [];
  try {
    const rows = await env.CONFIG.get(TRACE_KEY, 'json') as TelemetryEvent[] | null;
    return (Array.isArray(rows) ? rows : []).slice(-Math.max(1, Math.min(limit, MAX_EVENTS))).reverse();
  } catch {
    return [];
  }
}
