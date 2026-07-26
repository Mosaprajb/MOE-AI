export const SESSION_KEYS = Object.freeze(['PREMARKET', 'CORE', 'AFTER_HOURS', 'OVERNIGHT']);

export const SESSION_DEFINITIONS = Object.freeze({
  OVERNIGHT: Object.freeze({
    key: 'OVERNIGHT',
    webullSession: 'NIGHT',
    label: 'OVERNIGHT',
    labelAr: 'الأوفرنايت',
    hours: '8:00 PM–4:00 AM ET',
  }),
  PREMARKET: Object.freeze({
    key: 'PREMARKET',
    webullSession: 'ALL',
    label: 'PRE-MARKET',
    labelAr: 'ما قبل السوق',
    hours: '4:00 AM–9:30 AM ET',
  }),
  CORE: Object.freeze({
    key: 'CORE',
    webullSession: 'CORE',
    label: 'REGULAR',
    labelAr: 'السوق العادي',
    hours: '9:30 AM–4:00 PM ET',
  }),
  AFTER_HOURS: Object.freeze({
    key: 'AFTER_HOURS',
    webullSession: 'ALL',
    label: 'AFTER-HOURS',
    labelAr: 'ما بعد السوق',
    hours: '4:00 PM–8:00 PM ET',
  }),
  CLOSED: Object.freeze({
    key: 'CLOSED',
    webullSession: null,
    label: 'CLOSED',
    labelAr: 'السوق مغلق',
    hours: null,
  }),
});

const WEEKDAYS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
const OVERNIGHT_START = 20 * 60;
const PREMARKET_START = 4 * 60;
const CORE_START = 9 * 60 + 30;
const CORE_END = 16 * 60;
const AFTER_HOURS_END = 20 * 60;

export function nySessionParts(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    ...values,
    minutes: Number(values.hour) * 60 + Number(values.minute),
    localDate: `${values.year}-${values.month}-${values.day}`,
    localTime: `${values.hour}:${values.minute}`,
  };
}

function sessionSnapshot(key, parts) {
  const definition = SESSION_DEFINITIONS[key] || SESSION_DEFINITIONS.CLOSED;
  return {
    ...definition,
    open: key !== 'CLOSED',
    weekday: parts.weekday,
    localDate: parts.localDate,
    localTime: parts.localTime,
    minuteOfDay: parts.minutes,
  };
}

export function currentTradingSession(date = new Date()) {
  const parts = nySessionParts(date);
  const { weekday, minutes } = parts;
  const weekdayDay = WEEKDAYS.includes(weekday);
  const overnightOpen = (weekday === 'Sun' && minutes >= OVERNIGHT_START)
    || (['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday) && (minutes < PREMARKET_START || minutes >= OVERNIGHT_START))
    || (weekday === 'Fri' && minutes < PREMARKET_START);

  if (overnightOpen) return sessionSnapshot('OVERNIGHT', parts);
  if (!weekdayDay) return sessionSnapshot('CLOSED', parts);
  if (minutes >= PREMARKET_START && minutes < CORE_START) return sessionSnapshot('PREMARKET', parts);
  if (minutes >= CORE_START && minutes < CORE_END) return sessionSnapshot('CORE', parts);
  if (minutes >= CORE_END && minutes < AFTER_HOURS_END) return sessionSnapshot('AFTER_HOURS', parts);
  return sessionSnapshot('CLOSED', parts);
}

export function sessionAllowed(policy, session) {
  return Boolean(session?.open)
    && Array.isArray(policy?.allowedSessions)
    && policy.allowedSessions.includes(session.key);
}

function normalizedDeclaredValue(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s_-]+/g, '');
}

function allowedSessionKeysForDeclaredValue(value) {
  const normalized = normalizedDeclaredValue(value);
  if (!normalized) return null;
  if (['NIGHT', 'OVERNIGHT'].includes(normalized)) return ['OVERNIGHT'];
  if (['CORE', 'REGULAR', 'RTH', 'REGULARHOURS'].includes(normalized)) return ['CORE'];
  if (['PREMARKET', 'PRE', 'PREMARKETHOURS'].includes(normalized)) return ['PREMARKET'];
  if (['AFTERHOURS', 'POSTMARKET', 'POST', 'POSTMARKETHOURS'].includes(normalized)) return ['AFTER_HOURS'];
  if (['EXTENDED', 'EXTENDEDHOURS'].includes(normalized)) return ['PREMARKET', 'AFTER_HOURS'];
  if (['ALL', 'ALLSESSIONS', 'DAY'].includes(normalized)) return ['PREMARKET', 'CORE', 'AFTER_HOURS'];
  if (normalized === 'CLOSED') return ['CLOSED'];
  return [];
}

export function validateDeclaredSignalSession(payload = {}, currentSession) {
  const fields = ['marketSession', 'tradingSession', 'webullSession', 'session'];
  const declared = fields
    .map((field) => ({ field, value: payload?.[field] }))
    .find((item) => String(item.value || '').trim());

  if (!declared) {
    return { provided: false, recognized: true, matches: true, field: null, value: null };
  }

  const allowedKeys = allowedSessionKeysForDeclaredValue(declared.value);
  if (!allowedKeys?.length) {
    return {
      provided: true,
      recognized: false,
      matches: false,
      field: declared.field,
      value: String(declared.value),
      expected: currentSession?.key || 'CLOSED',
      reason: 'UNSUPPORTED_DECLARED_SESSION',
    };
  }

  const matches = allowedKeys.includes(currentSession?.key || 'CLOSED');
  return {
    provided: true,
    recognized: true,
    matches,
    field: declared.field,
    value: String(declared.value),
    expected: currentSession?.key || 'CLOSED',
    allowedKeys,
    reason: matches ? null : 'DECLARED_SESSION_MISMATCH',
  };
}

export function authoritativeSignalPayload(payload = {}, currentSession, date = new Date()) {
  return {
    ...payload,
    session: currentSession?.webullSession || null,
    webullSession: currentSession?.webullSession || null,
    marketSession: currentSession?.key || 'CLOSED',
    serverSession: {
      key: currentSession?.key || 'CLOSED',
      label: currentSession?.label || 'CLOSED',
      localDate: currentSession?.localDate || nySessionParts(date).localDate,
      localTime: currentSession?.localTime || nySessionParts(date).localTime,
      validatedAt: new Date(date).toISOString(),
      source: 'MOERAND_SERVER',
    },
  };
}

function transitionEvent(session, kind, date) {
  const parts = nySessionParts(date);
  return {
    id: `${session.key}:${kind}:${parts.localDate}:${parts.localTime}`,
    kind,
    sessionKey: session.key,
    session: { ...session },
    occurredAt: new Date(date).toISOString(),
    localDate: parts.localDate,
    localTime: parts.localTime,
  };
}

export function sessionTransitionEvents(previousSession, currentSession, date = new Date()) {
  const previousKey = previousSession?.key || 'CLOSED';
  const currentKey = currentSession?.key || 'CLOSED';
  if (previousKey === currentKey) return [];

  const events = [];
  if (previousSession?.open && previousKey !== 'CLOSED') {
    events.push(transitionEvent(previousSession, 'CLOSE', date));
  }
  if (currentSession?.open && currentKey !== 'CLOSED') {
    events.push(transitionEvent(currentSession, 'OPEN', date));
  }
  return events;
}
