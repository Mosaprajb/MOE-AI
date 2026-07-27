import { buildPushHTTPRequest } from '@pushforge/builder';
import { validTradeNotificationRecord } from './session-notification-service.js';

const STATE_KEY = 'trade-alert-state:v1';
const SUBSCRIPTIONS_KEY = 'subscriptions';
const HISTORY_LIMIT = 100;
const PROCESSED_LIMIT = 500;
const DASHBOARD_PATH = '/#trades';
const ICON_PATH = '/icon-192.svg';

function enabled(env = {}) {
  return String(env.MOE_TRADE_ALERTS_ENABLED || 'true').toLowerCase() === 'true';
}

function number(value, fallback = null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function money(value) {
  const parsed = number(value);
  return parsed == null ? '—' : `$${parsed.toFixed(2)}`;
}

function signedMoney(value) {
  const parsed = number(value, 0);
  return `${parsed >= 0 ? '+' : '-'}$${Math.abs(parsed).toFixed(2)}`;
}

function signedPercent(value) {
  const parsed = number(value, 0);
  return `${parsed >= 0 ? '+' : ''}${parsed.toFixed(2)}%`;
}

function confirmedOpen(trade = {}) {
  const lifecycle = String(trade.lifecycleStatus || '').toUpperCase();
  return trade.status === 'OPEN'
    && (trade.brokerPositionSeen === true
      || lifecycle === 'FILLED_PROTECTED'
      || lifecycle === 'FILLED_REQUIRES_ATTENTION'
      || lifecycle === 'PARTIALLY_FILLED');
}

function eventId(trade, kind) {
  const timestamp = kind === 'OPEN'
    ? trade.entryTime || trade.lifecycleCheckedAt || trade.updatedAt
    : trade.exitTime || trade.lifecycleCheckedAt || trade.updatedAt;
  return `${trade.id || trade.signalId || trade.symbol}:${kind}:${timestamp || 'UNKNOWN'}`;
}

function transitionEvents(beforeTrades = [], afterTrades = []) {
  const beforeById = new Map();
  for (const trade of beforeTrades) {
    if (trade.id) beforeById.set(`id:${trade.id}`, trade);
    if (trade.signalId) beforeById.set(`signal:${trade.signalId}`, trade);
  }

  const events = [];
  for (const trade of afterTrades) {
    const previous = (trade.id && beforeById.get(`id:${trade.id}`))
      || (trade.signalId && beforeById.get(`signal:${trade.signalId}`))
      || null;
    if (confirmedOpen(trade) && !confirmedOpen(previous || {})) {
      events.push({ id: eventId(trade, 'OPEN'), kind: 'OPEN', trade });
    }
    if (trade.status === 'CLOSED' && previous?.status !== 'CLOSED') {
      events.push({ id: eventId(trade, 'CLOSE'), kind: 'CLOSE', trade });
    }
  }
  return events;
}

function notificationPayload(event, env = {}) {
  const trade = event.trade || {};
  const symbol = String(trade.symbol || 'UNKNOWN').toUpperCase();
  const quantity = number(trade.filledQuantity, 0) > 0 ? number(trade.filledQuantity, 0) : number(trade.quantity, 0);
  const environment = String(env.WEBULL_ENVIRONMENT || 'sandbox').toUpperCase();

  if (event.kind === 'OPEN') {
    const entry = number(trade.averageFillPrice, null) ?? number(trade.entryPrice, null);
    return {
      title: `MOERAND · تم فتح صفقة ${symbol}`,
      body: `الدخول ${money(entry)} · الكمية ${quantity} · وقف ${money(trade.stopLoss)} · هدف ${money(trade.takeProfit)} · ${environment}`,
      tag: `moerand-trade-open-${trade.id || trade.signalId || symbol}`,
      data: {
        url: DASHBOARD_PATH,
        kind: 'TRADE_OPEN_CONFIRMED',
        tradeId: trade.id || null,
        signalId: trade.signalId || null,
        symbol,
        entryPrice: entry,
        quantity,
      },
    };
  }

  const pnl = number(trade.realizedPnl, 0);
  const pnlPercent = number(trade.realizedPnlPercent, 0);
  const resultLabel = pnl > 0 ? 'ربح' : pnl < 0 ? 'خسارة' : 'تعادل';
  const reason = String(trade.exitReason || 'BROKER_CONFIRMED').replaceAll('_', ' ');
  return {
    title: `MOERAND · تم إغلاق صفقة ${symbol}`,
    body: `الخروج ${money(trade.exitPrice)} · ${resultLabel} ${signedMoney(pnl)} (${signedPercent(pnlPercent)}) · السبب ${reason}`,
    tag: `moerand-trade-close-${trade.id || trade.signalId || symbol}`,
    data: {
      url: DASHBOARD_PATH,
      kind: 'TRADE_CLOSE_CONFIRMED',
      tradeId: trade.id || null,
      signalId: trade.signalId || null,
      symbol,
      exitPrice: number(trade.exitPrice),
      realizedPnl: pnl,
      realizedPnlPercent: pnlPercent,
      exitReason: trade.exitReason || null,
    },
  };
}

async function sendPush(record, payload, env) {
  if (!env.VAPID_PRIVATE_JWK) throw new Error('VAPID private key is not configured');
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK: JSON.parse(env.VAPID_PRIVATE_JWK),
    subscription: record.subscription,
    message: {
      payload: {
        ...payload,
        icon: ICON_PATH,
        badge: ICON_PATH,
        renotify: true,
        timestamp: Date.now(),
      },
      adminContact: env.VAPID_SUBJECT,
      options: { ttl: 3600, urgency: 'high' },
    },
  });
  return fetch(endpoint, { method: 'POST', headers, body });
}

export async function processTradeLifecycleAlerts(storage, payload = {}, env = {}) {
  if (!enabled(env)) return { enabled: false, events: [] };

  const events = transitionEvents(payload.beforeTrades, payload.afterTrades);
  const state = (await storage.get(STATE_KEY)) || {};
  const processed = { ...(state.processed || {}) };
  const history = Array.isArray(state.history) ? state.history : [];
  if (!events.length) {
    return { enabled: true, events: [], recipients: 0 };
  }

  const subscriptions = (await storage.get(SUBSCRIPTIONS_KEY)) || {};
  const recipients = Object.values(subscriptions).filter(validTradeNotificationRecord);
  const summaries = [];

  for (const event of events) {
    if (processed[event.id]) continue;
    const pushPayload = notificationPayload(event, env);
    let delivered = 0;
    let failed = 0;

    const results = await Promise.allSettled(recipients.map(async (record) => {
      const response = await sendPush(record, pushPayload, env);
      if (response.status === 404 || response.status === 410) {
        delete subscriptions[record.id];
        return false;
      }
      if (!response.ok) throw new Error(`Push service returned ${response.status}`);
      return true;
    }));

    for (const result of results) {
      if (result.status === 'fulfilled' && result.value === true) delivered += 1;
      else if (result.status === 'rejected') failed += 1;
    }

    processed[event.id] = new Date().toISOString();
    summaries.push({
      id: event.id,
      kind: event.kind,
      tradeId: event.trade?.id || null,
      signalId: event.trade?.signalId || null,
      symbol: event.trade?.symbol || null,
      delivered,
      failed,
      recipients: recipients.length,
      entryPrice: event.kind === 'OPEN' ? number(event.trade?.averageFillPrice) ?? number(event.trade?.entryPrice) : null,
      exitPrice: event.kind === 'CLOSE' ? number(event.trade?.exitPrice) : null,
      realizedPnl: event.kind === 'CLOSE' ? number(event.trade?.realizedPnl) : null,
      realizedPnlPercent: event.kind === 'CLOSE' ? number(event.trade?.realizedPnlPercent) : null,
      createdAt: new Date().toISOString(),
    });
  }

  const latestProcessed = Object.fromEntries(Object.entries(processed)
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
    .slice(0, PROCESSED_LIMIT));
  const nextState = {
    version: 1,
    processed: latestProcessed,
    history: [...summaries.reverse(), ...history].slice(0, HISTORY_LIMIT),
    lastProcessedAt: new Date().toISOString(),
  };
  await storage.put({ [STATE_KEY]: nextState, [SUBSCRIPTIONS_KEY]: subscriptions });
  return { enabled: true, events: summaries, recipients: recipients.length };
}

export async function getTradeAlertStatus(storage) {
  const state = (await storage.get(STATE_KEY)) || {};
  return {
    enabled: true,
    lastProcessedAt: state.lastProcessedAt || null,
    history: Array.isArray(state.history) ? state.history.slice(0, 40) : [],
  };
}

export { transitionEvents };
