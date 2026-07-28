import { eventBus } from './event-bus.js';

const DEFAULT_SESSIONS = [
  { id: 'premarket', start: '04:00', end: '09:30' },
  { id: 'regular', start: '09:30', end: '16:00' },
  { id: 'afterhours', start: '16:00', end: '20:00' },
];

function minutesFromTime(value) {
  const [hours, minutes] = String(value || '00:00').split(':').map(Number);
  return Math.max(0, Math.min(1439, (Number.isFinite(hours) ? hours : 0) * 60 + (Number.isFinite(minutes) ? minutes : 0)));
}

function minuteOfDay(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    minute: Number(values.hour) * 60 + Number(values.minute),
    weekday: values.weekday,
  };
}

export class MarketSessionEngine {
  constructor({ timeZone = 'America/New_York', sessions = DEFAULT_SESSIONS, weekdays = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'] } = {}) {
    this.timeZone = timeZone;
    this.weekdays = new Set(weekdays);
    this.sessions = sessions.map((session) => ({
      ...session,
      startMinute: minutesFromTime(session.start),
      endMinute: minutesFromTime(session.end),
    }));
    this.lastSession = null;
  }

  getSession(timestamp = Date.now()) {
    const date = timestamp instanceof Date ? timestamp : new Date(timestamp);
    const { minute, weekday } = minuteOfDay(date, this.timeZone);
    if (!this.weekdays.has(weekday)) {
      return { id: 'closed', isOpen: false, weekday, minute, timeZone: this.timeZone };
    }

    const active = this.sessions.find((session) => minute >= session.startMinute && minute < session.endMinute);
    if (!active) return { id: 'closed', isOpen: false, weekday, minute, timeZone: this.timeZone };

    return {
      id: active.id,
      isOpen: true,
      weekday,
      minute,
      timeZone: this.timeZone,
      start: active.start,
      end: active.end,
    };
  }

  isTradable(timestamp = Date.now(), allowedSessions = ['regular']) {
    const session = this.getSession(timestamp);
    return session.isOpen && allowedSessions.includes(session.id);
  }

  async publish(timestamp = Date.now()) {
    const session = this.getSession(timestamp);
    if (session.id !== this.lastSession) {
      const previous = this.lastSession;
      this.lastSession = session.id;
      await eventBus.emit('market:session-changed', { previous, current: session, timestamp: Date.now() });
    }
    return session;
  }
}

export function createMarketSessionEngine(options = {}) {
  return new MarketSessionEngine(options);
}
