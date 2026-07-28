// MOE-AI Cloudflare Worker — TradingView → Webull Bridge
import { Hono } from 'hono';
import type { Env } from './lib/types';
import { corsMiddleware } from './lib/cors';
import { health }  from './routes/health';
import { webhook } from './routes/webhook';
import { trading } from './routes/trading';
import { scanner, runScanCycle } from './routes/scanner';

const app = new Hono<{ Bindings: Env }>();

// ── CORS ───────────────────────────────────────────────────────────────────────
app.use('*', corsMiddleware);

// ── Routes ─────────────────────────────────────────────────────────────────────
app.route('/api/health',         health);
app.route('/api/system/health',  health);
app.route('/api/tradingview',    webhook);
app.route('/api/trading',        trading);
app.route('/api/scanner',        scanner);

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

// ── Cloudflare Cron Trigger — runs every 5 minutes ────────────────────────────
export default {
  fetch: app.fetch.bind(app),
  async scheduled(_event: ScheduledEvent, env: Env, _ctx: ExecutionContext) {
    console.log('[Cron] Scanner cycle starting…');
    try {
      const result = await runScanCycle(env);
      console.log(`[Cron] Done — scanned:${result.scanned} candidates:${result.candidates.length} orders:${result.ordersPlaced} ms:${result.ms}`);
    } catch (e) {
      console.error('[Cron] Scanner error:', e);
    }
  },
};
