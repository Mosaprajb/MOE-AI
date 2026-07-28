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

// Wildcard patterns: 'https://*.replit.dev' → matches any replit.dev subdomain
const DEFAULT_PATTERNS: RegExp[] = [
  /^https:\/\/[^.]+\.replit\.dev$/,
  /^https:\/\/[^.]+\.replit\.app$/,
];

function isAllowed(origin: string | null, env: Env): boolean {
  if (!origin) return false;

  // Exact match in defaults
  if (DEFAULT_ORIGINS.has(origin)) return true;

  // Wildcard pattern match in defaults
  if (DEFAULT_PATTERNS.some(p => p.test(origin))) return true;

  // Exact match in env ALLOWED_ORIGINS
  const envOrigins = (env.ALLOWED_ORIGINS ?? '').split(',').map(s => s.trim()).filter(Boolean);
  for (const o of envOrigins) {
    if (o === origin) return true;
    // Convert wrangler-style glob 'https://*.replit.dev' → regex
    if (o.includes('*')) {
      const pattern: RegExp = new RegExp('^' + o.replace(/\./g, '\\.').replace(/\*/g, '[^.]+') + '$');
      if (pattern.test(origin)) return true;
    }
  }

  return false;
}

export function corsHeaders(origin: string | null, env: Env): HeadersInit {
  const allowed = isAllowed(origin, env);
  const allowOrigin = allowed && origin ? origin : 'https://moerand-alerts.mosaprajb.workers.dev';

  return {
    'Access-Control-Allow-Origin':      allowOrigin,
    'Access-Control-Allow-Methods':     'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers':     'Content-Type, Authorization, X-Request-ID, X-Idempotency-Key',
    'Access-Control-Max-Age':           '86400',
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
