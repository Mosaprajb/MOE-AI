import { buildPushHTTPRequest } from '@pushforge/builder';
import { validSessionNotificationRecord } from './session-notification-service.js';
import { currentTradingSession, sessionAllowed, sessionTransitionEvents } from './trading-session-service.js';

const STATE_KEY = 'trading-session-alerts:v1';
const HISTORY_LIMIT = 80;

function enabled(env = {}) {
  return String(env.MOE_SESSION_ALERTS_ENABLED || 'true').toLowerCase() === 'true';
}

async function sendPush(record, event, allowed, env) {
  const definition = event.session || {};
  const opening = event.kind === 'OPEN';
  const title = opening
    ? `MOERAND · افتتاح ${definition.labelAr || definition.label}`
    : `MOERAND · انتهاء ${definition.labelAr || definition.label}`;
  const policyText = allowed
    ? 'التداول مسموح وفق سياسة الجلسات عند تحقق شروط الصفقة.'
    : 'هذه الجلسة غير مفعلة للتداول في السياسة الحالية.';
  const body = opening
    ? `بدأت جلسة ${definition.labelAr || definition.label} (${definition.hours || ''}). ${policyText}`
    : `انتهت جلسة ${definition.labelAr || definition.label}. سيتم الانتقال إلى الجلسة التالية وفق توقيت نيويورك.`;

  const { endpoint, headers, body: encryptedBody } = await buildPushHTTPRequest({
    privateJWK: JSON.parse(env.VAPID_PRIVATE_JWK),
    subscription: record.subscription,
    message: {
      payload: {
        title,
        body,
        icon: `${env.APP_URL || '/'}icon-192.svg`,
        badge: `${env.APP_URL || '/'}icon-192.svg`,
        tag: `moerand-session-${event.sessionKey}-${event.kind}-${event.localDate}`,
        renotify: true,
        timestamp: Date.parse(event.occurredAt),
        data: {
          url: env.APP_URL || '/alerts',
          kind: `SESSION_${event.kind}`,
          session: event.sessionKey,
          allowed,
        },
      },
      adminContact: env.VAPID_SUBJECT,
      options: { ttl: 3600, urgency: 'high' },
    },
  });

  return fetch(endpoint, { method: 'POST', headers, body: encryptedBody });
}

export async function processSessionAlerts(storage, payload = {}, env = {}) {
  if (!enabled(env)) return { enabled: false, events: [] };

  const observedAtMs = Date.parse(payload.observedAt || '') || Date.now();
  const observedAt = new Date(observedAtMs);
  const currentSession = payload.currentSession || currentTradingSession(observedAt);
  const policy = payload.policy || { allowedSessions: [] };
  const previousState = (await storage.get(STATE_KEY)) || {};
  const previousSession = previousState.lastSession || currentTradingSession(new Date(observedAtMs - 60_000));
  const transitions = sessionTransitionEvents(previousSession, currentSession, observedAt);

  const baseState = {
    version: 1,
    lastSession: currentSession,
    lastObservedAt: observedAt.toISOString(),
    processed: previousState.processed || {},
    history: Array.isArray(previousState.history) ? previousState.history.slice(0, HISTORY_LIMIT) : [],
  };

  if (!transitions.length) {
    await storage.put(STATE_KEY, baseState);
    return { enabled: true, events: [] };
  }

  if (!env.VAPID_PRIVATE_JWK) {
    await storage.put(STATE_KEY, {
      ...baseState,
      history: [{
        at: observedAt.toISOString(),
        status: 'SKIPPED',
        reason: 'VAPID_PRIVATE_JWK_MISSING',
        transitions: transitions.map((event) => ({ kind: event.kind, sessionKey: event.sessionKey })),
      }, ...baseState.history].slice(0, HISTORY_LIMIT),
    });
    return { enabled: true, events: [], skipped: 'VAPID_PRIVATE_JWK_MISSING' };
  }

  const subscriptions = (await storage.get('subscriptions')) || {};
  const recipients = Object.values(subscriptions).filter(validSessionNotificationRecord);
  const summaries = [];
  const processed = { ...baseState.processed };

  for (const event of transitions) {
    if (processed[event.id]) continue;
    const allowed = sessionAllowed(policy, event.session);
    let delivered = 0;
    let failed = 0;

    const results = await Promise.allSettled(recipients.map(async (record) => {
      const response = await sendPush(record, event, allowed, env);
      if (response.status === 404 || response.status === 410) {
        delete subscriptions[record.id];
        return false;
      }
      if (!response.ok) throw new Error(`Push service returned ${response.status}`);
      return true;
    }));

    results.forEach((result) => {
      if (result.status === 'fulfilled' && result.value === true) delivered += 1;
      else if (result.status === 'rejected') failed += 1;
    });

    processed[event.id] = observedAt.toISOString();
    summaries.push({
      id: event.id,
      kind: event.kind,
      sessionKey: event.sessionKey,
      allowed,
      recipients: recipients.length,
      delivered,
      failed,
      occurredAt: event.occurredAt,
    });
  }

  const processedEntries = Object.entries(processed)
    .sort((a, b) => Date.parse(b[1]) - Date.parse(a[1]))
    .slice(0, 120);
  const latestState = {
    ...baseState,
    processed: Object.fromEntries(processedEntries),
    history: [[...summaries].reverse(), ...baseState.history].flat().slice(0, HISTORY_LIMIT),
  };
  await storage.put({ [STATE_KEY]: latestState, subscriptions });

  return { enabled: true, events: summaries };
}

export async function getSessionAlertStatus(storage) {
  const state = (await storage.get(STATE_KEY)) || {};
  return {
    enabled: true,
    lastSession: state.lastSession || null,
    lastObservedAt: state.lastObservedAt || null,
    history: Array.isArray(state.history) ? state.history.slice(0, 40) : [],
  };
}
