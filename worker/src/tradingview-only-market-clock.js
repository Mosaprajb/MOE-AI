const MARKET_TIMEZONE = 'America/New_York';
const DEFAULT_USER_TIMEZONE = 'America/Chicago';
const PHASE_LABELS = Object.freeze({
  PRE_MARKET: 'Pre-market',
  REGULAR: 'Regular market',
  AFTER_HOURS: 'After-hours',
  OVERNIGHT: 'Overnight',
  CLOSED: 'Market closed',
});
const WEEKDAY_INDEX = Object.freeze({ Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 });

function finite(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function zonedParts(value, timeZone) {
  const date = value instanceof Date ? value : new Date(value);
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
  const entries = Object.fromEntries(
    formatter.formatToParts(date)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const hour = Number(entries.hour) === 24 ? 0 : Number(entries.hour);
  return {
    year: Number(entries.year),
    month: Number(entries.month),
    day: Number(entries.day),
    hour,
    minute: Number(entries.minute),
    second: Number(entries.second),
    weekday: WEEKDAY_INDEX[entries.weekday],
    timeZone,
  };
}

function zonedDateTimeToUtc(parts, timeZone) {
  const targetAsUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour || 0,
    parts.minute || 0,
    parts.second || 0,
  );
  let guess = targetAsUtc;
  for (let iteration = 0; iteration < 4; iteration += 1) {
    const actual = zonedParts(new Date(guess), timeZone);
    const actualAsUtc = Date.UTC(
      actual.year,
      actual.month - 1,
      actual.day,
      actual.hour,
      actual.minute,
      actual.second,
    );
    const delta = targetAsUtc - actualAsUtc;
    guess += delta;
    if (Math.abs(delta) < 1000) break;
  }
  return new Date(guess);
}

function addCalendarDays(parts, days) {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    weekday: date.getUTCDay(),
  };
}

function phaseForParts(parts) {
  const minutes = parts.hour * 60 + parts.minute;
  const weekday = parts.weekday;

  if (weekday === 6) return 'CLOSED';
  if (weekday === 0) return minutes >= 20 * 60 ? 'OVERNIGHT' : 'CLOSED';

  if (minutes < 4 * 60) return 'OVERNIGHT';
  if (minutes < 9 * 60 + 30) return 'PRE_MARKET';
  if (minutes < 16 * 60) return 'REGULAR';
  if (minutes < 20 * 60) return 'AFTER_HOURS';
  return weekday <= 4 ? 'OVERNIGHT' : 'CLOSED';
}

export function marketPhaseAt(value = Date.now()) {
  return phaseForParts(zonedParts(value, MARKET_TIMEZONE));
}

function nextMarketTransition(now) {
  const current = now instanceof Date ? now : new Date(now);
  const currentParts = zonedParts(current, MARKET_TIMEZONE);
  const candidates = [];
  const boundaries = [
    { hour: 4, minute: 0 },
    { hour: 9, minute: 30 },
    { hour: 16, minute: 0 },
    { hour: 20, minute: 0 },
  ];

  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const day = addCalendarDays(currentParts, dayOffset);
    for (const boundary of boundaries) {
      const candidate = zonedDateTimeToUtc({
        ...day,
        hour: boundary.hour,
        minute: boundary.minute,
        second: 0,
      }, MARKET_TIMEZONE);
      if (candidate.getTime() <= current.getTime()) continue;
      const before = marketPhaseAt(candidate.getTime() - 1000);
      const after = marketPhaseAt(candidate.getTime() + 1000);
      if (before !== after) candidates.push({ candidate, before, after });
    }
  }

  candidates.sort((left, right) => left.candidate - right.candidate);
  return candidates[0] || null;
}

function parseTime(value, fallback = '18:55') {
  const match = /^(\d{2}):(\d{2})$/.exec(String(value || fallback));
  if (!match) return parseTime(fallback, '18:55');
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

function localCutoffForDay(localDay, time, timeZone) {
  return zonedDateTimeToUtc({
    year: localDay.year,
    month: localDay.month,
    day: localDay.day,
    hour: time.hour,
    minute: time.minute,
    second: 0,
  }, timeZone);
}

function nextAutoFlattenAt(now, settings) {
  const timeZone = settings.autoFlattenTimezone || DEFAULT_USER_TIMEZONE;
  const time = parseTime(settings.autoFlattenTimeLocal);
  const local = zonedParts(now, timeZone);
  for (let dayOffset = 0; dayOffset <= 8; dayOffset += 1) {
    const day = addCalendarDays(local, dayOffset);
    if (day.weekday === 0 || day.weekday === 6) continue;
    const candidate = localCutoffForDay(day, time, timeZone);
    if (candidate.getTime() > now.getTime()) return candidate;
  }
  return null;
}

function todayAutoFlattenAt(now, settings) {
  const timeZone = settings.autoFlattenTimezone || DEFAULT_USER_TIMEZONE;
  const time = parseTime(settings.autoFlattenTimeLocal);
  const local = zonedParts(now, timeZone);
  return localCutoffForDay(local, time, timeZone);
}

function isoOrNull(value) {
  return value instanceof Date && Number.isFinite(value.getTime()) ? value.toISOString() : null;
}

export function tradingViewMarketClock(value = Date.now(), settings = {}) {
  const now = value instanceof Date ? value : new Date(value);
  const phase = marketPhaseAt(now);
  const transition = nextMarketTransition(now);
  const transitionAt = transition?.candidate || null;
  const todayFlatten = todayAutoFlattenAt(now, settings);
  const upcomingFlatten = nextAutoFlattenAt(now, settings);
  const pastCutoff = now.getTime() >= todayFlatten.getTime();
  const selectedSession = String(settings.session || 'ALL').toUpperCase();
  const phaseAllowsEntry = selectedSession === 'CORE'
    ? phase === 'REGULAR'
    : ['PRE_MARKET', 'REGULAR', 'AFTER_HOURS'].includes(phase);
  const entryAllowed = phaseAllowsEntry && !pastCutoff;
  const autoFlattenDue = pastCutoff || ['OVERNIGHT', 'CLOSED'].includes(phase);
  const transitionSeconds = transitionAt
    ? Math.max(0, Math.ceil((transitionAt.getTime() - now.getTime()) / 1000))
    : null;
  const entryBoundary = [transitionAt, todayFlatten]
    .filter((item) => item && item.getTime() > now.getTime())
    .sort((left, right) => left - right)[0] || null;

  return {
    generatedAt: now.toISOString(),
    marketTimezone: MARKET_TIMEZONE,
    userTimezone: settings.autoFlattenTimezone || DEFAULT_USER_TIMEZONE,
    phase,
    label: PHASE_LABELS[phase] || phase,
    brokerSession: phase === 'REGULAR' ? 'CORE'
      : phase === 'OVERNIGHT' ? 'NIGHT'
        : 'ALL',
    selectedSession,
    entryAllowed,
    entryBlockedReason: entryAllowed ? null
      : pastCutoff ? 'AUTO_FLATTEN_CUTOFF_REACHED'
        : phase === 'OVERNIGHT' ? 'OVERNIGHT_ENTRIES_DISABLED'
          : phase === 'CLOSED' ? 'MARKET_CLOSED'
            : 'SELECTED_SESSION_NOT_ACTIVE',
    nextTransitionAt: isoOrNull(transitionAt),
    nextTransitionPhase: transition?.after || null,
    nextTransitionLabel: transition?.after ? PHASE_LABELS[transition.after] : null,
    remainingSeconds: transitionSeconds,
    entryWindowEndsAt: isoOrNull(entryBoundary),
    entryWindowRemainingSeconds: entryBoundary
      ? Math.max(0, Math.ceil((entryBoundary.getTime() - now.getTime()) / 1000))
      : 0,
    autoFlattenTimeLocal: settings.autoFlattenTimeLocal || '18:55',
    autoFlattenAt: isoOrNull(upcomingFlatten),
    todayAutoFlattenAt: isoOrNull(todayFlatten),
    autoFlattenRemainingSeconds: upcomingFlatten
      ? Math.max(0, Math.ceil((upcomingFlatten.getTime() - now.getTime()) / 1000))
      : null,
    autoFlattenDue,
    noOvernightHolding: true,
    localDateKey: `${zonedParts(now, settings.autoFlattenTimezone || DEFAULT_USER_TIMEZONE).year}-${String(zonedParts(now, settings.autoFlattenTimezone || DEFAULT_USER_TIMEZONE).month).padStart(2, '0')}-${String(zonedParts(now, settings.autoFlattenTimezone || DEFAULT_USER_TIMEZONE).day).padStart(2, '0')}`,
    currentEpochMs: now.getTime(),
  };
}

export function formatCountdown(seconds) {
  const total = Math.max(0, Math.floor(finite(seconds, 0)));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}
