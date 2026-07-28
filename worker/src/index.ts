// MOE-AI Cloudflare Worker — Main Entry
// Hono-based Worker serving all MOE-AI API routes
import { Hono } from 'hono';
import type { Env } from './lib/types';
import { corsMiddleware } from './lib/cors';
import { health } from './routes/health';
import { webhook } from './routes/webhook';
import { trading } from './routes/trading';

const app = new Hono<{ Bindings: Env }>();

// ── Global CORS ────────────────────────────────────────────────────────────
app.use('*', corsMiddleware);

// ── Health ─────────────────────────────────────────────────────────────────
app.route('/api/health',         health);
app.route('/api/system/health',  health);

// ── TradingView webhooks & decisions ───────────────────────────────────────
app.route('/api/tradingview',    webhook);

// ── Trading (account, positions, orders, trades) ───────────────────────────
app.route('/api/trading',        trading);

// ── Root ───────────────────────────────────────────────────────────────────
app.get('/', (c) => c.json({
  service:  'MOE-AI Worker',
  version:  c.env.WORKER_VERSION,
  strategy: c.env.STRATEGY_VERSION,
  status:   'running',
  routes: [
    'GET  /api/health',
    'GET  /api/system/health',
    'POST /api/tradingview/webhook',
    'GET  /api/tradingview/decisions',
    'GET  /api/trading/sandbox/dashboard',
    'GET  /api/trading/live/dashboard',
    'GET  /api/trading/live/readiness',
    'POST /api/trading/orders',
    'GET  /api/trading/trades',
    'GET  /api/trading/kill-switch',
    'POST /api/trading/kill-switch',
  ],
}));

// ── 404 ───────────────────────────────────────────────────────────────────
app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));

// ── Error handler ─────────────────────────────────────────────────────────
app.onError((err, c) => {
  console.error('[MOE Worker Error]', err);
  return c.json({ error: err.message ?? 'Internal error' }, 500);
});

export default app;
