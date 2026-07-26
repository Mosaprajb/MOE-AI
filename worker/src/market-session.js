const EXCHANGE_TIME_ZONE = 'America/New_York';
const WEEKDAYS = new Set(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
let cachedMinute = null;
let cachedStatus = null;

function parts(date) {
  const values = new Intl.DateTimeFormat('en-US', {
    timeZone: EXCHANGE_TIME_ZONE,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  return Object.fromEntries(values.map((item) => [item.type, item.value]));
}

function minuteOfDay(value) {
  return Number(value.hour) * 60 + Number(value.minute);
}

function sessionAt(date) {
  const value = parts(date);
  const weekday = value.weekday;
  const minutes = minuteOfDay(value);
  const isWeekday = WEEKDAYS.has(weekday);

  if (weekday === 'Sun' && minutes >= 20 * 60) {
    return { open: true, key: 'OVERNIGHT', label: 'OVERNIGHT', webullSession: 'NIGHT', dataFeed: 'boats', dataDelayMinutes: 15 };
  }
  if (['Mon', 'Tue', 'Wed', 'Thu'].includes(weekday) && (minutes < 4 * 60 || minutes >= 20 * 60)) {
    return { open: true, key: 'OVERNIGHT', label: 'OVERNIGHT', webullSession: 'NIGHT', dataFeed: 'boats', dataDelayMinutes: 15 };
  }
  if (weekday === 'Fri' && minutes < 4 * 60) {
    return { open: true, key: 'OVERNIGHT', label: 'OVERNIGHT', webullSession: 'NIGHT', dataFeed: 'boats', dataDelayMinutes: 15 };
  }
  if (isWeekday && minutes >= 4 * 60 && minutes < 9 * 60 + 30) {
    return { open: true, key: 'PRE_MARKET', label: 'PRE-MARKET', webullSession: 'ALL', dataFeed: 'iex', dataDelayMinutes: 0 };
  }
  if (isWeekday && minutes >= 9 * 60 + 30 && minutes < 16 * 60) {
    return { open: true, key: 'REGULAR', label: 'REGULAR', webullSession: 'CORE', dataFeed: 'iex', dataDelayMinutes: 0 };
  }
  if (isWeekday && minutes >= 16 * 60 && minutes < 20 * 60) {
    return { open: true, key: 'AFTER_HOURS', label: 'AFTER-HOURS', webullSession: 'ALL', dataFeed: 'iex', dataDelayMinutes: 0 };
  }
  return { open: false, key: 'CLOSED', label: 'CLOSED', webullSession: null, dataFeed: null, dataDelayMinutes: null };
}

function firstMinuteMatching(start, predicate, maximumMinutes = 8 * 24 * 60) {
  const floor = Math.floor(start.getTime() / 60_000) * 60_000;
  for (let offset = 1; offset <= maximumMinutes; offset += 1) {
    const candidate = new Date(floor + offset * 60_000);
    const session = sessionAt(candidate);
    if (predicate(session)) return { at: candidate, session };
  }
  return null;
}

export function marketSessionStatus(date = new Date()) {
  const minute = Math.floor(date.getTime() / 60_000);
  if (cachedMinute === minute && cachedStatus) return cachedStatus;

  const current = sessionAt(date);
  const transition = current.open
    ? firstMinuteMatching(date, (candidate) => candidate.key !== current.key)
    : firstMinuteMatching(date, (candidate) => candidate.open);
  const nextOpen = current.open
    ? firstMinuteMatching(transition?.at || date, (candidate) => candidate.open && candidate.key !== current.key)
    : transition;

  cachedMinute = minute;
  cachedStatus = {
    exchangeTimeZone: EXCHANGE_TIME_ZONE,
    generatedAt: date.toISOString(),
    open: current.open,
    currentSession: current,
    transitionAt: transition?.at?.toISOString() || null,
    transitionSession: transition?.session || null,
    nextOpenAt: nextOpen?.at?.toISOString() || null,
    nextSession: nextOpen?.session || null,
    scheduleType: 'CONFIGURED_US_EQUITY_24_5',
    holidayCalendarApplied: false,
  };
  return cachedStatus;
}
