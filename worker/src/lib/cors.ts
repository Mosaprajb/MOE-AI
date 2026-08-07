// MOE-AI CORS middleware — allows the frontend origins
import type { Context, Next } from 'hono';
import type { Env } from './types';

const DEFAULT_ORIGINS = new Set([
  'https://moerand-alerts.mosaprajb.workers.dev',
  'https://moe-ai.replit.app',
  'http://localhost:3000',
  'http://localhost:20883',
  'http://127.0.0.1',
  'http://127.0.0.1:3000',
  'http://127.0.0.1:20883',
]);

const DEFAULT_PATTERNS: RegExp[] = [
  /^https:\/\/.+\.replit\.dev$/,
  /^https:\/\/.+\.replit\.app$/,
  /^https:\/\/.+\.repl\.co$/,
];

function isAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;
  if (DEFAULT_ORIGINS.has(origin)) return true;
  if (DEFAULT_PATTERNS.some(pattern => pattern.test(origin))) return true;

  const envOrigins = (env.ALLOWED_ORIGINS ?? '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
  for (const allowedOrigin of envOrigins) {
    if (allowedOrigin === origin) return true;
    if (allowedOrigin.includes('*')) {
      const pattern: RegExp = new RegExp(
        `^${allowedOrigin.replace(/\./gu, '\\.').replace(/\*/gu, '[^.]+')}$`,
      );
      if (pattern.test(origin)) return true;
    }
  }
  return false;
}

export function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = isAllowed(origin, env);
  const allowOrigin = allowed && origin
    ? origin
    : 'https://moerand-alerts.mosaprajb.workers.dev';
  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': [
      'Content-Type',
      'Authorization',
      'X-Request-ID',
      'X-Idempotency-Key',
      'X-MOE-Live-Session',
    ].join(', '),
    'Access-Control-Expose-Headers': 'X-MOE-Live-Control',
    'Access-Control-Max-Age': '86400',
    'Access-Control-Allow-Credentials': 'true',
  };
}

export async function corsMiddleware(
  c: Context<{ Bindings: Env }>,
  next: Next,
): Promise<Response | void> {
  const origin = c.req.header('Origin') ?? null;
  const headers = corsHeaders(origin, c.env);
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  await next();
  Object.entries(headers).forEach(([name, value]) => c.res.headers.set(name, value));
}
