import worker, { AlertCoordinator as PageRouterCoordinator } from './page-router-entry.js';
import {
  emitConfirmedTradeNotification,
  listTradeNotifications,
  notificationServiceStatus,
  registerNotificationSubscription,
  sendTestNotification,
  unregisterNotificationSubscription,
} from './trade-notification-service.js';

const PATHS = {
  config: '/api/notifications/config',
  subscribe: '/api/notifications/subscribe',
  unsubscribe: '/api/notifications/unsubscribe',
  status: '/api/notifications/status',
  history: '/api/notifications/history',
  test: '/api/notifications/test',
};

function secureJson(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}

async function parseJson(request) {
  try {
    return await request.json();
  } catch {
    throw new Error('Invalid JSON payload');
  }
}

export class AlertCoordinator extends PageRouterCoordinator {
  async registerTradeNotificationSubscription(payload = {}) {
    return registerNotificationSubscription(this.ctx.storage, payload);
  }

  async unregisterTradeNotificationSubscription(endpoint = '') {
    return unregisterNotificationSubscription(this.ctx.storage, endpoint);
  }

  async tradeNotificationStatus() {
    return notificationServiceStatus(this.ctx.storage, this.env);
  }

  async tradeNotificationHistory(options = {}) {
    return listTradeNotifications(this.ctx.storage, options);
  }

  async testTradeNotification(options = {}) {
    return sendTestNotification(this.ctx.storage, options, this.env);
  }

  async syncConfirmedTradeNotifications() {
    const trades = await this.listAllTrades();
    const control = await this.getLiveControlState();
    const fallbackMode = control.liveTradingEnabled === true && control.killSwitch === false ? 'live' : 'demo';
    const results = [];

    for (const trade of trades) {
      const entry = await emitConfirmedTradeNotification(this.ctx.storage, trade, 'entry', this.env, fallbackMode);
      if (entry.sent || entry.duplicate || entry.retryLimitReached) {
        results.push({ tradeId: trade.id, eventType: 'entry', ...entry });
      }
      if (String(trade.status || '').toUpperCase() === 'CLOSED') {
        const exit = await emitConfirmedTradeNotification(this.ctx.storage, trade, 'exit', this.env, fallbackMode);
        if (exit.sent || exit.duplicate || exit.retryLimitReached) {
          results.push({ tradeId: trade.id, eventType: 'exit', ...exit });
        }
      }
    }

    return {
      checked: trades.length,
      events: results.length,
      results,
      syncedAt: new Date().toISOString(),
    };
  }
}

function coordinator(env) {
  return env.ALERT_COORDINATOR.getByName('global');
}

async function handleNotifications(request, env) {
  const url = new URL(request.url);
  const stub = coordinator(env);

  try {
    if (url.pathname === PATHS.config) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      return secureJson({
        ok: true,
        publicKey: String(env.VAPID_PUBLIC_KEY || ''),
        providerConfigured: Boolean(env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_JWK),
      });
    }

    if (url.pathname === PATHS.subscribe) {
      if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      const payload = await parseJson(request);
      return secureJson({ ok: true, device: await stub.registerTradeNotificationSubscription(payload) });
    }

    if (url.pathname === PATHS.unsubscribe) {
      if (request.method !== 'DELETE' && request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      const payload = await parseJson(request);
      return secureJson({ ok: true, ...(await stub.unregisterTradeNotificationSubscription(payload.endpoint)) });
    }

    if (url.pathname === PATHS.status) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      return secureJson({ ok: true, ...(await stub.tradeNotificationStatus()) });
    }

    if (url.pathname === PATHS.history) {
      if (request.method !== 'GET') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      const notifications = await stub.tradeNotificationHistory({
        mode: url.searchParams.get('mode') || '',
        eventType: url.searchParams.get('eventType') || '',
        status: url.searchParams.get('status') || '',
        limit: url.searchParams.get('limit') || 100,
      });
      return secureJson({ ok: true, count: notifications.length, notifications });
    }

    if (url.pathname === PATHS.test) {
      if (request.method !== 'POST') return secureJson({ ok: false, error: 'Method not allowed' }, 405);
      const status = await stub.tradeNotificationStatus();
      if (!status.providerConfigured) {
        return secureJson({ ok: false, sent: false, error: 'Notification service is not fully configured.' }, 503);
      }
      const payload = await parseJson(request);
      const result = await stub.testTradeNotification(payload);
      return secureJson({ ok: true, ...result }, result.sent ? 200 : 424);
    }

    return null;
  } catch (error) {
    return secureJson({
      ok: false,
      error: error instanceof Error ? error.message : 'Notification request failed',
    }, 400);
  }
}

export default {
  async fetch(request, env, ctx) {
    const path = new URL(request.url).pathname;
    if (Object.values(PATHS).includes(path)) {
      const response = await handleNotifications(request, env);
      if (response) return response;
    }
    return worker.fetch(request, env, ctx);
  },

  scheduled(controller, env, ctx) {
    const base = worker.scheduled(controller, env, ctx);
    const sync = coordinator(env).syncConfirmedTradeNotifications().then((result) => {
      console.log(JSON.stringify({ event: 'CONFIRMED_TRADE_NOTIFICATIONS_SYNCED', ...result }));
      return result;
    }).catch((error) => {
      console.error(JSON.stringify({
        event: 'CONFIRMED_TRADE_NOTIFICATION_SYNC_FAILED',
        error: error instanceof Error ? error.message : 'Unknown notification sync error',
        createdAt: new Date().toISOString(),
      }));
      return null;
    });
    if (ctx?.waitUntil) ctx.waitUntil(sync);
    return base;
  },
};
