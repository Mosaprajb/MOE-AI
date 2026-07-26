import { buildPushHTTPRequest } from '@pushforge/builder';

const SUBSCRIPTIONS_KEY = 'subscriptions';
const MAX_SUBSCRIPTIONS = 20;
const TEST_COOLDOWN_MS = 20_000;

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

function publicStatus(record) {
  return {
    registered: Boolean(record),
    enabled: record?.sessionAlertsEnabled === true,
    updatedAt: record?.sessionAlertsUpdatedAt || record?.updatedAt || null,
    lastTestAt: record?.lastSessionAlertTestAt || null,
    notificationOnly: record?.notificationOnly === true,
  };
}

export async function registerSessionNotification(storage, payload = {}) {
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
  subscriptions[id] = {
    ...previous,
    id,
    subscription,
    enabled: true,
    sessionAlertsEnabled: true,
    sessionAlertsUpdatedAt: now,
    notificationOnly: !hasScannerConfiguration,
    updatedAt: now,
  };
  await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
  return { id, ...publicStatus(subscriptions[id]) };
}

export async function unregisterSessionNotification(storage, endpoint) {
  const id = await endpointId(endpoint);
  const subscriptions = (await storage.get(SUBSCRIPTIONS_KEY)) || {};
  const record = subscriptions[id];
  if (!record) return { removed: false, registered: false, enabled: false };

  if (record.notificationOnly === true) {
    delete subscriptions[id];
  } else {
    record.sessionAlertsEnabled = false;
    record.sessionAlertsUpdatedAt = Date.now();
  }
  await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
  return { removed: true, registered: record.notificationOnly !== true, enabled: false };
}

export async function getSessionNotificationStatus(storage, endpoint) {
  if (!endpoint) return { registered: false, enabled: false };
  const id = await endpointId(endpoint);
  const subscriptions = (await storage.get(SUBSCRIPTIONS_KEY)) || {};
  return publicStatus(subscriptions[id]);
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

export async function testSessionNotification(storage, endpoint, env = {}) {
  const id = await endpointId(endpoint);
  const subscriptions = (await storage.get(SUBSCRIPTIONS_KEY)) || {};
  const record = subscriptions[id];
  if (!validSessionNotificationRecord(record)) throw new Error('Session notifications are not enabled for this device');

  const now = Date.now();
  const lastTestAt = Number(record.lastSessionAlertTestAt || 0);
  if (lastTestAt > 0 && now - lastTestAt < TEST_COOLDOWN_MS) {
    throw new Error('Please wait before sending another test notification');
  }

  const appUrl = env.MOE_NOTIFICATION_APP_URL || env.APP_URL || '/';
  const response = await sendPush(record, {
    title: 'MOERAND · تنبيهات الجلسات مفعّلة',
    body: 'سيصلك تنبيه عند افتتاح وانتهاء جلسات الأوفرنايت، ما قبل السوق، السوق العادي، وما بعد السوق.',
    icon: `${appUrl}icon-192.svg`,
    badge: `${appUrl}icon-192.svg`,
    tag: `moerand-session-test-${id.slice(0, 12)}`,
    renotify: true,
    timestamp: now,
    data: { url: appUrl, kind: 'SESSION_ALERT_TEST' },
  }, env);

  if (response.status === 404 || response.status === 410) {
    delete subscriptions[id];
    await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
    throw new Error('The push subscription expired. Enable notifications again.');
  }
  if (!response.ok) throw new Error(`Push service returned ${response.status}`);

  record.lastSessionAlertTestAt = now;
  await storage.put(SUBSCRIPTIONS_KEY, subscriptions);
  return { sent: true, status: response.status, ...publicStatus(record) };
}
