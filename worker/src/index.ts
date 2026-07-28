// MOE-AI Cloudflare Worker — TradingView → Webull Bridge
import { Hono } from 'hono';
import type { Env } from './lib/types';
import { corsMiddleware } from './lib/cors';
import { health }  from './routes/health';
import { webhook } from './routes/webhook';
import { trading } from './routes/trading';

const app = new Hono<{ Bindings: Env }>();

// ── CORS ───────────────────────────────────────────────────────────────────────
app.use('*', corsMiddleware);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.route('/api/health',         health);
app.route('/api/system/health',  health);
app.route('/api/tradingview',    webhook);
app.route('/api/trading',        trading);

// ── Root info ──────────────────────────────────────────────────────────────────
app.get('/', (c) => c.json({
  service: 'MOE-AI Worker',
  version: c.env.WORKER_VERSION,
  status:  'running',
  webhook: 'POST /api/tradingview/webhook',
  docs: [
    'GET  /api/health',
    'POST /api/tradingview/webhook',
    'GET  /api/tradingview/decisions',
    'GET  /api/trading/sandbox/dashboard',
    'GET  /api/trading/live/dashboard',
    'GET  /api/trading/mode',
    'POST /api/trading/mode',
    'GET  /api/trading/kill-switch',
    'POST /api/trading/kill-switch',
    'GET  /api/trading/live/readiness',
    'POST /api/trading/orders',
    'GET  /api/trading/trades',
  ],
}));

app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));
app.onError((err, c) => {
  console.error('[MOE Worker Error]', err);
  return c.json({ error: err.message ?? 'Internal error' }, 500);
});

export default app;
