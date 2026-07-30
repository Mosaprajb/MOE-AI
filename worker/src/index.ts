// MOE-AI Cloudflare Worker — TradingView → Webull Bridge
import { Hono } from 'hono';
import type { Env } from './lib/types';
import { corsMiddleware } from './lib/cors';
import { getRecentTelemetry } from './lib/telemetry';
import { health }  from './routes/health';
import { webhook } from './routes/webhook';
import { trading } from './routes/trading';
import { scanner } from './routes/scanner';
import { getTradingMode } from './lib/risk';

const app = new Hono<{ Bindings: Env }>();

// ── CORS ───────────────────────────────────────────────────────────────────────
app.use('*', corsMiddleware);

// ── Scanner execution safety ──────────────────────────────────────────────────
// The scanner may submit paper orders, but it is never allowed to initiate
// automated execution while the selected mode is LIVE.
app.use('/api/scanner/*', async (c, next) => {
  if (c.req.method === 'POST' && c.req.path === '/api/scanner/run') {
    const mode = await getTradingMode(c.env);
    if (mode === 'LIVE') {
      return c.json({
        ok: false,
        code: 'LIVE_SCANNER_EXECUTION_DISABLED',
        error: 'Automated scanner execution is restricted to SANDBOX mode.',
      }, 423);
    }
  }
  await next();
});

// ── Routes ─────────────────────────────────────────────────────────────────────
app.route('/api/health',         health);
app.route('/api/system/health',  health);
app.route('/api/tradingview',    webhook);
app.route('/api/trading',        trading);
app.route('/api/scanner',        scanner);

// Structured scanner/worker diagnostics retained in CONFIG KV.
app.get('/api/system/telemetry', async (c) => {
  const requested = Number(c.req.query('limit') ?? 100);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(requested, 250)) : 100;
  const events = await getRecentTelemetry(c.env, limit);
  return c.json({ data: events, count: events.length, fetchedAt: new Date().toISOString() });
});

// ── Root info ──────────────────────────────────────────────────────────────────
app.get('/', (c) => c.json({
  service: 'MOE-AI Worker',
  version: c.env.WORKER_VERSION,
  status:  'running',
  mode:    'TradingView Webhook Bridge + Sandbox Scanner',
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
    'POST /api/scanner/run',
    'GET  /api/scanner/quotes',
    'GET  /api/scanner/positions',
    'GET  /api/scanner/runs',
    'GET  /api/scanner/watchlist',
    'GET  /api/system/telemetry',
  ],
}));

app.notFound((c) => c.json({ error: 'Not found', path: c.req.path }, 404));
app.onError((err, c) => {
  console.error('[MOE Worker Error]', err);
  return c.json({ error: err.message ?? 'Internal error' }, 500);
});

export default app;
