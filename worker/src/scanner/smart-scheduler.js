const WEEKDAYS = Object.freeze(['Mon', 'Tue', 'Wed', 'Thu', 'Fri']);
const MINUTE_MS = 60_000;

export const SMART_SCANNER_PHASES = Object.freeze({
  PRE_MARKET: Object.freeze({
    key: 'PRE_MARKET',
    label: 'Pre-Market',
    startMinute: 4 * 60,
    endMinute: 9 * 60 + 30,
    cadenceMs: 60_000,
  }),
  MARKET_OPEN: Object.freeze({
    key: 'MARKET_OPEN',
    label: 'Market Open',
    startMinute: 9 * 60 + 30,
    endMinute: 11 * 60 + 30,
    cadenceMs: 20_000,
  }),
  LUNCH: Object.freeze({
    key: 'LUNCH',
    label: 'Lunch',
    startMinute: 11 * 60 + 30,
    endMinute: 15 * 60,
    cadenceMs: 60_000,
  }),
  POWER_HOUR: Object.freeze({
    key: 'POWER_HOUR',
    label: 'Power Hour',
    startMinute: 15 * 60,
    endMinute: 16 * 60,
    cadenceMs: 20_000,
  }),
  AFTER_HOURS: Object.freeze({
    key: 'AFTER_HOURS',
    label: 'After-Hours',
    startMinute: 16 * 60,
    endMinute: 20 * 60,
    cadenceMs: 120_000,
  }),
  CLOSED: Object.freeze({
    key: 'CLOSED',
    label: 'Closed',
    startMinute: null,
    endMinute: null,
    cadenceMs: null,
  }),
});

const PHASE_ORDER = Object.freeze([
  SMART_SCANNER_PHASES.PRE_MARKET,
  SMART_SCANNER_PHASES.MARKET_OPEN,
  SMART_SCANNER_PHASES.LUNCH,
  SMART_SCANNER_PHASES.POWER_HOUR,
  SMART_SCANNER_PHASES.AFTER_HOURS,
]);

const CADENCE_ENV = Object.freeze({
  PRE_MARKET: 'SMART_SCANNER_PREMARKET_INTERVAL_SECONDS',
  MARKET_OPEN: 'SMART_SCANNER_OPEN_INTERVAL_SECONDS',
  LUNCH: 'SMART_SCANNER_LUNCH_INTERVAL_SECONDS',
  POWER_HOUR: 'SMART_SCANNER_POWER_HOUR_INTERVAL_SECONDS',
  AFTER_HOURS: 'SMART_SCANNER_AFTER_HOURS_INTERVAL_SECONDS',
});

function positiveInteger(value, fallback, minimum, maximum) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function asDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(Number(value));
  if (!Number.isFinite(date.getTime())) throw new Error('Smart Scheduler requires a valid timestamp.');
  return date;
}

export function newYorkSchedulerParts(value = Date.now()) {
  const date = asDate(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const minuteOfDay = Number(values.hour) * 60 + Number(values.minute);
  return Object.freeze({
    weekday: values.weekday,
    localDate: `${values.year}-${values.month}-${values.day}`,
    localTime: `${values.hour}:${values.minute}:${values.second}`,
    minuteOfDay,
  });
}

function configuredCadenceMs(phase, env = {}) {
  const key = CADENCE_ENV[phase.key];
  if (!key) return phase.cadenceMs;
  const fallbackSeconds = Math.round(phase.cadenceMs / 1000);
  const seconds = positiveInteger(env[key], fallbackSeconds, 20, 300);
  return seconds * 1000;
}

export function resolveSmartScannerPhase(value = Date.now(), { isTradingDay } = {}) {
  const date = asDate(value);
  const parts = newYorkSchedulerParts(date);
  const weekday = WEEKDAYS.includes(parts.weekday);
  const calendarOpen = typeof isTradingDay === 'function'
    ? isTradingDay({ date, ...parts }) !== false
    : true;

  if (!weekday || !calendarOpen) {
    return Object.freeze({ ...SMART_SCANNER_PHASES.CLOSED, active: false, ...parts });
  }

  const phase = PHASE_ORDER.find((item) => parts.minuteOfDay >= item.startMinute && parts.minuteOfDay < item.endMinute)
    || SMART_SCANNER_PHASES.CLOSED;
  return Object.freeze({ ...phase, active: phase.key !== 'CLOSED', ...parts });
}

function minuteAlignedDue(phase, cadenceMs) {
  if (cadenceMs <= MINUTE_MS) return true;
  const cadenceMinutes = Math.max(1, Math.round(cadenceMs / MINUTE_MS));
  return phase.minuteOfDay % cadenceMinutes === 0;
}

export function buildSmartScannerMinutePlan(scheduledTime = Date.now(), env = {}, options = {}) {
  const timestamp = asDate(scheduledTime).getTime();
  const minuteStart = Math.floor(timestamp / MINUTE_MS) * MINUTE_MS;
  const phase = resolveSmartScannerPhase(minuteStart, options);
  if (!phase.active) {
    return Object.freeze({
      active: false,
      phase,
      cadenceMs: null,
      minuteStart,
      ticks: Object.freeze([]),
    });
  }

  const cadenceMs = configuredCadenceMs(phase, env);
  const offsets = [];
  if (minuteAlignedDue(phase, cadenceMs)) {
    if (cadenceMs >= MINUTE_MS) offsets.push(0);
    else for (let offset = 0; offset < MINUTE_MS; offset += cadenceMs) offsets.push(offset);
  }

  const ticks = offsets.map((offsetMs, index) => Object.freeze({
    sequence: index + 1,
    total: offsets.length,
    offsetMs,
    scheduledTime: minuteStart + offsetMs,
    scheduledAt: new Date(minuteStart + offsetMs).toISOString(),
    phase: phase.key,
    cadenceMs,
  }));

  return Object.freeze({
    active: true,
    phase,
    cadenceMs,
    minuteStart,
    ticks: Object.freeze(ticks),
  });
}

export function createSmartScannerScheduler({
  scanRunner,
  sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
  now = () => Date.now(),
} = {}) {
  if (typeof scanRunner !== 'function') throw new Error('Smart Scheduler requires a scanRunner(env, scheduledTime, context) function.');
  if (typeof sleep !== 'function') throw new Error('Smart Scheduler sleep must be a function.');
  if (typeof now !== 'function') throw new Error('Smart Scheduler now must be a function.');

  let inFlight = null;

  async function execute(env, scheduledTime, context) {
    const plan = buildSmartScannerMinutePlan(scheduledTime, env, context);
    const startedAtMs = now();
    if (!plan.active || !plan.ticks.length) {
      return Object.freeze({
        ok: true,
        skipped: plan.active ? 'CADENCE_NOT_DUE' : 'MARKET_PHASE_CLOSED',
        phase: plan.phase.key,
        cadenceMs: plan.cadenceMs,
        ticksPlanned: 0,
        ticksCompleted: 0,
        results: Object.freeze([]),
        startedAt: new Date(startedAtMs).toISOString(),
        completedAt: new Date(now()).toISOString(),
      });
    }

    const results = [];
    for (const tick of plan.ticks) {
      const targetMs = startedAtMs + tick.offsetMs;
      const waitMs = Math.max(0, targetMs - now());
      if (waitMs > 0) await sleep(waitMs);

      try {
        const result = await scanRunner(env, tick.scheduledTime, {
          ...context,
          smartScheduler: Object.freeze({
            phase: plan.phase.key,
            phaseLabel: plan.phase.label,
            cadenceMs: plan.cadenceMs,
            sequence: tick.sequence,
            total: tick.total,
            plannedAt: tick.scheduledAt,
            executionAuthorityChanged: false,
          }),
        });
        results.push(Object.freeze({
          ok: true,
          sequence: tick.sequence,
          plannedAt: tick.scheduledAt,
          completedAt: new Date(now()).toISOString(),
          result,
        }));
      } catch (error) {
        results.push(Object.freeze({
          ok: false,
          sequence: tick.sequence,
          plannedAt: tick.scheduledAt,
          completedAt: new Date(now()).toISOString(),
          error: error instanceof Error ? error.message : 'Unknown scheduled scanner failure.',
        }));
      }
    }

    return Object.freeze({
      ok: results.every((item) => item.ok),
      phase: plan.phase.key,
      phaseLabel: plan.phase.label,
      cadenceMs: plan.cadenceMs,
      ticksPlanned: plan.ticks.length,
      ticksCompleted: results.length,
      results: Object.freeze(results),
      executionAuthorityChanged: false,
      startedAt: new Date(startedAtMs).toISOString(),
      completedAt: new Date(now()).toISOString(),
    });
  }

  return Object.freeze({
    plan: (scheduledTime, env = {}, options = {}) => buildSmartScannerMinutePlan(scheduledTime, env, options),
    async runMinute(env = {}, scheduledTime = Date.now(), context = {}) {
      if (inFlight) {
        const phase = resolveSmartScannerPhase(scheduledTime, context);
        return Object.freeze({
          ok: true,
          skipped: 'SMART_SCHEDULER_OVERLAP',
          phase: phase.key,
          ticksPlanned: 0,
          ticksCompleted: 0,
          executionAuthorityChanged: false,
        });
      }
      const task = execute(env, scheduledTime, context);
      inFlight = task;
      try {
        return await task;
      } finally {
        if (inFlight === task) inFlight = null;
      }
    },
    isRunning: () => Boolean(inFlight),
  });
}
