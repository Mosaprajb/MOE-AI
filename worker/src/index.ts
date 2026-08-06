// MOE-AI Cloudflare Worker - TradingView -> Webull Bridge
import { Hono } from 'hono';
import type { MobileEnv } from './lib/mobile-env';
import { corsMiddleware } from './lib/cors';
import { getRecentTelemetry } from './lib/telemetry';
import { health } from './routes/health';
import { webhook } from './routes/webhook';
import { trading } from './routes/trading';
import { scanner } from './routes/scanner';
import { getTradingMode } from './lib/risk';
import { getMobileReceptionState } from './lib/mobile-control';
import { broadcastMobilePush, getAPNsConfigurationStatus } from './lib/apns';
import { mobileApi, mobileTradingView } from './routes/mobile';

export {
  AlertCoordinator,
  SimulationDriver,
  TradingViewPositionCoordinator,
} from './lib/legacy-durable-objects';

const app = new Hono<{ Bindings: MobileEnv }>();

app.use('*', corsMiddleware);

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
  return undefined;
});

app.use('/api/tradingview/webhook', async (c, next) => {
  if (c.req.method === 'POST') {
    const reception = await getMobileReceptionState(c.env);
    if (!reception.enabled) {
      return c.json({
        ok: false,
        code: 'TRADINGVIEW_RECEPTION_DISABLED',
        error: 'TradingView alert reception is disabled by the mobile control session.',
      }, 423);
    }
  }

  await next();

  if (c.req.method === 'POST') {
    const apns = getAPNsConfigurationStatus(c.env);
    if (apns.enabled && apns.configured && c.env.DB) {
      try {
        const payload = await c.res.clone().json() as {
          accepted?: boolean;
          symbol?: string;
          side?: string;
          qty?: number;
          mode?: string;
          orderStatus?: string;
          reason?: string;
          error?: string;
        };
        const symbol = String(payload.symbol ?? '').toUpperCase();
        const accepted = payload.accepted === true;
        const side = String(payload.side ?? '').toUpperCase();
        const quantity = Number(payload.qty ?? 0);
        const mode = String(payload.mode ?? 'SANDBOX').toUpperCase();
        const notificationType = accepted
          ? side === 'BUY' ? 'POSITION_OPEN_SUBMITTED' : 'POSITION_CLOSE_SUBMITTED'
          : 'TRADINGVIEW_ORDER_REJECTED';
        const title = accepted
          ? `${side || 'ORDER'} ${symbol || 'trade'} submitted`
          : `${symbol || 'TradingView'} alert rejected`;
        const body = accepted
          ? `${quantity > 0 ? `${quantity} share${quantity === 1 ? '' : 's'} - ` : ''}${mode}${payload.orderStatus ? ` - ${payload.orderStatus}` : ''}`
          : String(payload.error ?? payload.reason ?? 'The Worker rejected the alert.').slice(0, 180);
        c.executionCtx.waitUntil(broadcastMobilePush(c.env, {
          type: notificationType,
          title,
          body,
          symbol: symbol || undefined,
          accountType: mode === 'LIVE' ? 'LIVE' : 'DEMO',
          deepLink: symbol ? `moeai://positions/${encodeURIComponent(symbol)}` : 'moeai://activity',
          collapseId: symbol ? `trade-${symbol}` : 'tradingview-event',
        }));
      } catch {
        // The webhook response was not JSON; do not interfere with trading.
      }
    }
  }

  return undefined;
});

app.route('/api/health', health);
app.route('/api/system/health', health);
app.route('/api/tradingview', mobileTradingView);
app.route('/api/tradingview', webhook);
app.route('/api/mobile', mobileApi);
app.route('/api/trading', trading);
app.route('/api/scanner', scanner);

app.get('/api/system/telemetry', async c => {
  const requested = Number(c.req.query('limit') ?? 100);
  const limit = Number.isFinite(requested) ? Math.max(1, Math.min(requested, 250)) : 100;
  const events = await getRecentTelemetry(c.env, limit);
  return c.json({ data: events, count: events.length, fetchedAt: new Date().toISOString() });
});

app.get('/', c => c.json({
  service: 'MOE-AI Worker',
  version: c.env.WORKER_VERSION,
  status: 'running',
  mode: 'TradingView Webhook Bridge + Sandbox Scanner + Native iOS API',
  webhook: 'POST /api/tradingview/webhook',
  docs: [
    'GET  /api/health',
    'POST /api/tradingview/session',
    'DELETE /api/tradingview/session',
    'GET  /api/tradingview/status',
    'POST /api/tradingview/refresh',
    'POST /api/tradingview/repair',
    'POST /api/tradingview/position/close',
    'POST /api/tradingview/reception',
    'POST /api/tradingview/kill-switch',
    'POST /api/mobile/push/register',
    'DELETE /api/mobile/push/register',
    'GET  /api/mobile/push/status',
    'POST /api/mobile/push/test',
    'GET  /api/mobile/market-screener',
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

app.notFound(c => c.json({ error: 'Not found', path: c.req.path }, 404));
app.onError((err, c) => {
  console.error('[MOE Worker Error]', err);
  return c.json({ error: err.message ?? 'Internal error' }, 500);
});

export default app;
