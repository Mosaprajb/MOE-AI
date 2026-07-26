import { buildPushHTTPRequest } from '@pushforge/builder';

const HISTORY_KEY = 'trade-notification-history:v1';
const EVENT_PREFIX = 'trade-notification-event:v1:';
const SUBSCRIPTIONS_KEY = 'subscriptions';
const MAX_HISTORY = 500;
const MAX_RETRIES = 2;

function text(value, fallback = '') {
  const output = String(value ?? fallback).trim();
  return output || fallback;
}

function number(value, fallback = null) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function language(value) {
  return String(value || '').toLowerCase() === 'en' ? 'en' : 'ar';
}

function modeFromTrade(trade = {}, fallback = 'demo') {
  const values = [
    trade.mode,
    trade.tradingMode,
    trade.environment,
    trade.executionEnvironment,
    trade.capitalSource,
    trade.accountRoute,
    trade.capitalPolicyMode,
    trade.decisionReplay?.execution?.mode,
  ].map((value) => text(value).toUpperCase()).join('|');
  if (values.includes('LIVE') || values.includes('PRODUCTION')) return 'live';
  if (values.includes('SANDBOX') || values.includes('DEMO') || values.includes('PAPER')) return 'demo';
  return fallback === 'live' ? 'live' : 'demo';
}

function eventPrice(trade = {}, type) {
  if (type === 'exit') {
    return number(trade.exitPrice ?? trade.averageExitPrice ?? trade.currentPrice ?? trade.lastPrice);
  }
  return number(trade.averageFillPrice ?? trade.entryPrice ?? trade.entry ?? trade.currentPrice ?? trade.lastPrice);
}

function isConfirmedEntry(trade = {}) {
  if (String(trade.status || '').toUpperCase() === 'CLOSED') return false;
  if (!(eventPrice(trade, 'entry') > 0)) return false;
  const entryStatus = text(trade.brokerEntryStatus).toUpperCase();
  const lifecycle = text(trade.lifecycleStatus).toUpperCase();
  return trade.brokerPositionSeen === true
    || number(trade.filledQuantity, 0) > 0
    || ['FILLED', 'PARTIALLY_FILLED', 'EXECUTED'].includes(entryStatus)
    || ['POSITION_OPEN', 'OPEN', 'ACTIVE', 'PROTECTED'].includes(lifecycle);
}

function isConfirmedExit(trade = {}) {
  return String(trade.status || '').toUpperCase() === 'CLOSED' && eventPrice(trade, 'exit') > 0;
}

function formatBody(symbol, price, type, locale) {
  const value = new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(price);
  if (locale === 'en') return type === 'entry' ? `Buy ${symbol} at ${value}` : `Exit ${symbol} at ${value}`;
  return type === 'entry' ? `شراء ${symbol} بسعر ${value}` : `خروج ${symbol} بسعر ${value}`;
}

async function endpointId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(endpoint || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function appTarget(env = {}) {
  const configured = text(env.APP_URL, '/alerts');
  try {
    const url = new URL(configured);
    url.pathname = url.pathname.replace(/\/$/, '') + '/alerts';
    return url.toString();
  } catch {
    return '/alerts';
  }
}

async function sendPush(subscription, payload, env = {}) {
  if (!env.VAPID_PRIVATE_JWK) throw new Error('VAPID_PRIVATE_JWK is not configured');
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK: JSON.parse(env.VAPID_PRIVATE_JWK),
    subscription,
    message: {
      payload,
      adminContact: env.VAPID_SUBJECT,
      options: { ttl: 3600, urgency: 'high' },
    },
  });
  return fetch(endpoint, { method: 'POST', headers, body });
}

function publicEvent(item = {}) {
  return {
    notificationId: item.notificationId,
    eventKey: item.eventKey,
    tradeId: item.tradeId,
    symbol: item.symbol,
    eventType: item.eventType,
    executionPrice: item.executionPrice,
    tradingMode: item.tradingMode,
    createdAt: item.createdAt,
    deliveryStatus: item.deliveryStatus,
    notificationLanguage: item.notificationLanguage,
    retryCount: item.retryCount || 0,
    targetDeviceCount: Array.isArray(item.deliveries) ? item.deliveries.length : 0,
    deliveredCount: Array.isArray(item.deliveries) ? item.deliveries.filter((delivery) => delivery.status === 'DELIVERED').length : 0,
    failedCount: Array.isArray(item.deliveries) ? item.deliveries.filter((delivery) => delivery.status === 'FAILED').length : 0,
    deliveries: Array.isArray(item.deliveries) ? item.deliveries.map((delivery) => ({
      targetDevice: delivery.targetDevice,
      status: delivery.status,
      statusCode: delivery.statusCode ?? null,
      language: delivery.language,
      attemptedAt: delivery.attemptedAt,
      error: delivery.error || null,
    })) : [],
  };
}

async function readSubscriptions(storage) {
  const value = await storage.get(SUBSCRIPTIONS_KEY);
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

async function writeHistory(storage, item) {
  const current = await storage.get(HISTORY_KEY);
  const history = Array.isArray(current) ? current : [];
  const next = [item, ...history.filter((entry) => entry?.eventKey !== item.eventKey)].slice(0, MAX_HISTORY);
  await storage.put({
    [HISTORY_KEY]: next,
    [`${EVENT_PREFIX}${item.eventKey}`]: item,
  });
  return item;
}

export async function registerNotificationSubscription(storage, payload = {}) {
  const subscription = payload.subscription;
  if (!subscription || typeof subscription.endpoint !== 'string' || !subscription.endpoint.startsWith('https://')) {
    throw new Error('Invalid push subscription');
  }
  if (!subscription.keys?.p256dh || !subscription.keys?.auth) throw new Error('Push subscription keys are missing');
  const id = await endpointId(subscription.endpoint);
  const subscriptions = await readSubscriptions(storage);
  const previous = subscriptions[id] || {};
  subscriptions[id] = {
    ...previous,
    id,
    subscription,
    enabled: true,
    language: language(payload.language),
    deviceType: text(payload.deviceType, 'browser').slice(0, 40),
    userAgent: text(payload.userAgent).slice(0, 180),
    registeredAt: previous.registeredAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
  return {
    id,
    enabled: true,
    language: subscriptions[id].language,
    deviceType: subscriptions[id].deviceType,
    registeredAt: subscriptions[id].registeredAt,
  };
}

export async function unregisterNotificationSubscription(storage, endpoint) {
  const id = await endpointId(endpoint);
  const subscriptions = await readSubscriptions(storage);
  const existed = Boolean(subscriptions[id]);
  delete subscriptions[id];
  await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
  return { removed: existed };
}

export async function notificationServiceStatus(storage, env = {}) {
  const subscriptions = await readSubscriptions(storage);
  const devices = Object.values(subscriptions).filter((item) => item?.enabled && item?.subscription?.endpoint);
  return {
    providerConfigured: Boolean(text(env.VAPID_PUBLIC_KEY) && text(env.VAPID_PRIVATE_JWK)),
    publicKeyConfigured: Boolean(text(env.VAPID_PUBLIC_KEY)),
    registeredDevices: devices.length,
    devices: devices.map((item) => ({
      id: item.id,
      deviceType: item.deviceType || 'browser',
      language: language(item.language),
      registeredAt: item.registeredAt || null,
      updatedAt: item.updatedAt || null,
    })),
  };
}

export async function listTradeNotifications(storage, options = {}) {
  const current = await storage.get(HISTORY_KEY);
  const history = Array.isArray(current) ? current : [];
  const mode = text(options.mode).toLowerCase();
  const eventType = text(options.eventType).toLowerCase();
  const status = text(options.status).toUpperCase();
  const limit = Math.max(1, Math.min(500, Number(options.limit) || 100));
  return history
    .filter((item) => !mode || item.tradingMode === mode)
    .filter((item) => !eventType || item.eventType === eventType)
    .filter((item) => !status || item.deliveryStatus === status)
    .slice(0, limit)
    .map(publicEvent);
}

export async function emitConfirmedTradeNotification(storage, trade = {}, eventType, env = {}, fallbackMode = 'demo') {
  const type = String(eventType || '').toLowerCase();
  if (!['entry', 'exit'].includes(type)) throw new Error('Notification event type must be entry or exit');
  if (type === 'entry' && !isConfirmedEntry(trade)) return { sent: false, skipped: 'ENTRY_NOT_CONFIRMED' };
  if (type === 'exit' && !isConfirmedExit(trade)) return { sent: false, skipped: 'EXIT_NOT_CONFIRMED' };

  const tradeId = text(trade.id || trade.tradeId || trade.signalId);
  const symbol = text(trade.symbol).toUpperCase();
  const price = eventPrice(trade, type);
  if (!tradeId || !symbol || !(price > 0)) return { sent: false, skipped: 'INCOMPLETE_TRADE_EVENT' };

  const eventKey = `${tradeId}:${type}`;
  const storageKey = `${EVENT_PREFIX}${eventKey}`;
  const previous = await storage.get(storageKey);
  if (previous && previous.deliveryStatus !== 'FAILED') {
    return { sent: false, duplicate: true, event: publicEvent(previous) };
  }
  const retryCount = previous ? Number(previous.retryCount || 0) + 1 : 0;
  if (retryCount > MAX_RETRIES) return { sent: false, duplicate: true, retryLimitReached: true, event: publicEvent(previous) };

  const subscriptions = await readSubscriptions(storage);
  const devices = Object.values(subscriptions).filter((item) => item?.enabled && item?.subscription?.endpoint);
  const tradingMode = modeFromTrade(trade, fallbackMode);
  const createdAt = new Date().toISOString();
  const notificationId = previous?.notificationId || crypto.randomUUID();
  const deliveries = [];

  for (const device of devices) {
    const locale = language(device.language);
    const attemptedAt = new Date().toISOString();
    const payload = {
      title: 'MOE-AI',
      body: formatBody(symbol, price, type, locale),
      tag: `moe-trade-${eventKey}`,
      renotify: false,
      timestamp: Date.now(),
      data: {
        url: appTarget(env),
        notificationId,
        tradeId,
        eventType: type,
        tradingMode,
      },
    };
    try {
      const response = await sendPush(device.subscription, payload, env);
      if (response.status === 404 || response.status === 410) {
        delete subscriptions[device.id];
        deliveries.push({ targetDevice: device.deviceType || 'browser', language: locale, status: 'FAILED', statusCode: response.status, attemptedAt, error: 'DEVICE_SUBSCRIPTION_EXPIRED' });
      } else if (!response.ok) {
        deliveries.push({ targetDevice: device.deviceType || 'browser', language: locale, status: 'FAILED', statusCode: response.status, attemptedAt, error: `PUSH_HTTP_${response.status}` });
      } else {
        deliveries.push({ targetDevice: device.deviceType || 'browser', language: locale, status: 'DELIVERED', statusCode: response.status, attemptedAt, error: null });
      }
    } catch (error) {
      deliveries.push({ targetDevice: device.deviceType || 'browser', language: locale, status: 'FAILED', statusCode: null, attemptedAt, error: error instanceof Error ? error.message : 'PUSH_DELIVERY_FAILED' });
    }
  }
  await storage.put(SUBSCRIPTIONS_KEY, subscriptions);

  const delivered = deliveries.filter((item) => item.status === 'DELIVERED').length;
  const failed = deliveries.filter((item) => item.status === 'FAILED').length;
  const deliveryStatus = devices.length === 0 ? 'NO_REGISTERED_DEVICE' : delivered === devices.length ? 'DELIVERED' : delivered > 0 ? 'PARTIAL' : 'FAILED';
  const item = {
    notificationId,
    eventKey,
    tradeId,
    symbol,
    eventType: type,
    executionPrice: price,
    tradingMode,
    createdAt,
    deliveryStatus,
    targetDevice: devices.length === 1 ? devices[0].deviceType || 'browser' : 'multiple',
    notificationLanguage: devices.length === 1 ? language(devices[0].language) : 'multiple',
    retryCount,
    deliveries,
  };
  await writeHistory(storage, item);
  return { sent: delivered > 0, delivered, failed, event: publicEvent(item) };
}

export async function sendTestNotification(storage, options = {}, env = {}) {
  const subscriptions = await readSubscriptions(storage);
  const devices = Object.values(subscriptions).filter((item) => item?.enabled && item?.subscription?.endpoint);
  const requestedLanguage = language(options.language);
  const deliveries = [];
  for (const device of devices) {
    const locale = language(device.language || requestedLanguage);
    const payload = {
      title: 'MOE-AI',
      body: locale === 'en' ? 'Notifications are working.' : 'تم تفعيل التنبيهات بنجاح.',
      tag: `moe-notification-test-${device.id}`,
      renotify: false,
      timestamp: Date.now(),
      data: { url: appTarget(env), test: true },
    };
    try {
      const response = await sendPush(device.subscription, payload, env);
      deliveries.push({ deviceType: device.deviceType || 'browser', delivered: response.ok, status: response.status });
    } catch (error) {
      deliveries.push({ deviceType: device.deviceType || 'browser', delivered: false, error: error instanceof Error ? error.message : 'PUSH_DELIVERY_FAILED' });
    }
  }
  return {
    sent: deliveries.some((item) => item.delivered),
    registeredDevices: devices.length,
    deliveries,
  };
}

export { isConfirmedEntry, isConfirmedExit, modeFromTrade };
