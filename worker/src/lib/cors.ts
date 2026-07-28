// MOE-AI CORS middleware — allows the frontend origins
import type { Context, Next } from 'hono';
import type { Env } from './types';

const DEFAULT_ORIGINS = new Set([
  'https://moerand-alerts.mosaprajb.workers.dev',
  'https://moe-ai.replit.app',
  'http://localhost:3000',
  'http://localhost:20883',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:20883',
]);

export function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = new Set([
    ...DEFAULT_ORIGINS,
    ...(env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean),
  ]);

  const allowOrigin = origin && allowed.has(origin) ? origin : '*';

  return {
    'Access-Control-Allow-Origin':  allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, X-Request-ID, X-Idempotency-Key',
    'Access-Control-Max-Age':       '86400',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function corsMiddleware(c: Context<{ Bindings: Env }>, next: Next): Promise<Response | void> {
  const origin = c.req.header('Origin') ?? null;
  const headers = corsHeaders(origin, c.env);

  if (c.req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers });
  }

  await next();

  // Attach CORS headers to every response
  Object.entries(headers).forEach(([k, v]) => c.res.headers.set(k, v));
}
