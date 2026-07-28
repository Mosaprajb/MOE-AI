import { buildPushHTTPRequest } from '@pushforge/builder';

const SUBSCRIPTIONS_KEY = 'subscriptions';
const MAX_SUBSCRIPTIONS = 20;
const TEST_COOLDOWN_MS = 20_000;
const CURRENT_DASHBOARD_PATH = '/';
const NOTIFICATION_ICON_PATH = '/icon-192.svg';

export function validPushSubscription(subscription) {
  return Boolean(subscription)
    && typeof subscription.endpoint === 'string'
    && subscription.endpoint.startsWith('https://')
    && typeof subscription.keys?.p256dh === 'string'
    && typeof subscription.keys?.auth === 'string';
}

async function endpointId(endpoint) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(endpoint || '')));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function validSessionNotificationRecord(record) {
  return record?.enabled === true
    && record?.sessionAlertsEnabled === true
    && validPushSubscription(record.subscription);
}

export function validTradeNotificationRecord(record) {
  return record?.enabled === true
    && record?.tradeAlertsEnabled === true
    && validPushSubscription(record.subscription);
}

function publicStatus(record, type = 'session') {
  const sessionEnabled = record?.sessionAlertsEnabled === true;
  const tradeEnabled = record?.tradeAlertsEnabled === true;
  const enabled = type === 'trade' ? tradeEnabled : sessionEnabled;
  return {
    registered: Boolean(record),
    enabled,
    sessionAlertsEnabled: sessionEnabled,
    tradeAlertsEnabled: tradeEnabled,
    anyAlertsEnabled: sessionEnabled || tradeEnabled,
    updatedAt: type === 'trade'
      ? record?.tradeAlertsUpdatedAt || record?.updatedAt || null
      : record?.sessionAlertsUpdatedAt || record?.updatedAt || null,
    lastTestAt: type === 'trade'
      ? record?.lastTradeAlertTestAt || null
      : record?.lastSessionAlertTestAt || null,
    notificationOnly: record?.notificationOnly === true,
  };
}

async function registerPreference(storage, payload = {}, type = 'session') {
  const subscription = payload.subscription;
  if (!validPushSubscription(subscription)) throw new Error('Invalid push subscription');

  const id = await endpointId(subscription.endpoint);
  const subscriptions = (await storage.get(SUBSCRIPTIONS_KEY)) || {};
  if (!subscriptions[id] && Object.keys(subscriptions).length >= MAX_SUBSCRIPTIONS) {
    throw new Error('Subscription limit reached');
  }

  const previous = subscriptions[id] || {};
  const hasScannerConfiguration = Array.isArray(previous.symbols)
    && previous.symbols.length > 0
    && Number.isFinite(Number(previous.timeframe));
  const now = Date.now();
  const sessionAlertsEnabled = type === 'session' ? true : previous.sessionAlertsEnabled === true;
  const tradeAlertsEnabled = type === 'trade' ? true : previous.tradeAlertsEnabled === true;

  subscriptions[id] = {
    ...previous,
    id,
    subscription,
    enabled: true,
    sessionAlertsEnabled,
    tradeAlertsEnabled,
    ...(type === 'session' ? { sessionAlertsUpdatedAt: now } : { tradeAlertsUpdatedAt: now }),
    notificationOnly: !hasScannerConfiguration,
    updatedAt: now,
  };
  await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
  return { id, ...publicStatus(subscriptions[id], type) };
}

async function unregisterPreference(storage, endpoint, type = 'session') {
  const id = await endpointId(endpoint);
  const subscriptions = (await storage.get(SUBSCRIPTIONS_KEY)) || {};
  const record = subscriptions[id];
  if (!record) return { removed: false, registered: false, enabled: false, anyAlertsEnabled: false };

  const now = Date.now();
  if (type === 'trade') {
    record.tradeAlertsEnabled = false;
    record.tradeAlertsUpdatedAt = now;
  } else {
    record.sessionAlertsEnabled = false;
    record.sessionAlertsUpdatedAt = now;
  }
  record.updatedAt = now;
  subscriptions[id] = record;
  await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
  return { removed: true, ...publicStatus(record, type) };
}

async function getPreferenceStatus(storage, endpoint, type = 'session') {
  if (!endpoint) return {
    registered: false,
    enabled: false,
    sessionAlertsEnabled: false,
    tradeAlertsEnabled: false,
    anyAlertsEnabled: false,
  };
  const id = await endpointId(endpoint);
  const subscriptions = (await storage.get(SUBSCRIPTIONS_KEY)) || {};
  return publicStatus(subscriptions[id], type);
}

async function sendPush(record, payload, env) {
  if (!env.VAPID_PRIVATE_JWK) throw new Error('VAPID private key is not configured');
  const { endpoint, headers, body } = await buildPushHTTPRequest({
    privateJWK: JSON.parse(env.VAPID_PRIVATE_JWK),
    subscription: record.subscription,
    message: {
      payload,
      adminContact: env.VAPID_SUBJECT,
      options: { ttl: 3600, urgency: 'high' },
    },
  });
  return fetch(endpoint, { method: 'POST', headers, body });
}

async function testPreference(storage, endpoint, env = {}, type = 'session') {
  const id = await endpointId(endpoint);
  const subscriptions = (await storage.get(SUBSCRIPTIONS_KEY)) || {};
  const record = subscriptions[id];
  const valid = type === 'trade' ? validTradeNotificationRecord(record) : validSessionNotificationRecord(record);
  if (!valid) throw new Error(type === 'trade'
    ? 'Trade notifications are not enabled for this device'
    : 'Session notifications are not enabled for this device');

  const now = Date.now();
  const lastTestAt = Number(type === 'trade' ? record.lastTradeAlertTestAt || 0 : record.lastSessionAlertTestAt || 0);
  if (lastTestAt > 0 && now - lastTestAt < TEST_COOLDOWN_MS) {
    throw new Error('Please wait before sending another test notification');
  }

  const tradeTest = type === 'trade';
  const response = await sendPush(record, {
    title: tradeTest ? 'MOERAND · تنبيهات الصفقات مفعّلة' : 'MOERAND · تنبيهات الجلسات مفعّلة',
    body: tradeTest
      ? 'سيصلك تنبيه بعد تأكيد فتح الصفقة أو إغلاقها، مع أسعار الدخول والخروج والربح أو الخسارة.'
      : 'سيصلك تنبيه عند افتتاح وانتهاء جلسات الأوفرنايت، ما قبل السوق، السوق العادي، وما بعد السوق.',
    icon: NOTIFICATION_ICON_PATH,
    badge: NOTIFICATION_ICON_PATH,
    tag: `moerand-${tradeTest ? 'trade' : 'session'}-test-${id.slice(0, 12)}`,
    renotify: true,
    timestamp: now,
    data: { url: CURRENT_DASHBOARD_PATH, kind: tradeTest ? 'TRADE_ALERT_TEST' : 'SESSION_ALERT_TEST' },
  }, env);

  if (response.status === 404 || response.status === 410) {
    delete subscriptions[id];
    await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
    throw new Error('The push subscription expired. Enable notifications again.');
  }
  if (!response.ok) throw new Error(`Push service returned ${response.status}`);

  if (tradeTest) record.lastTradeAlertTestAt = now;
  else record.lastSessionAlertTestAt = now;
  await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
  return { sent: true, status: response.status, ...publicStatus(record, type) };
}

export function registerSessionNotification(storage, payload = {}) {
  return registerPreference(storage, payload, 'session');
}

export function unregisterSessionNotification(storage, endpoint) {
  return unregisterPreference(storage, endpoint, 'session');
}

export function getSessionNotificationStatus(storage, endpoint) {
  return getPreferenceStatus(storage, endpoint, 'session');
}

export function testSessionNotification(storage, endpoint, env = {}) {
  return testPreference(storage, endpoint, env, 'session');
}

export function registerTradeNotification(storage, payload = {}) {
  return registerPreference(storage, payload, 'trade');
}

export function unregisterTradeNotification(storage, endpoint) {
  return unregisterPreference(storage, endpoint, 'trade');
}

export function getTradeNotificationStatus(storage, endpoint) {
  return getPreferenceStatus(storage, endpoint, 'trade');
}

export function testTradeNotification(storage, endpoint, env = {}) {
  return testPreference(storage, endpoint, env, 'trade');
}
