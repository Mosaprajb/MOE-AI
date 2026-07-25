import { eventBus } from './event-bus.js';

function clone(value) {
  if (value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function now() {
  return Date.now();
}

const DEFAULT_EVENT_LIMIT = 200;

export class DashboardService {
  constructor({
    portfolioManager,
    paperTradingRuntime,
    eventLimit = DEFAULT_EVENT_LIMIT,
  } = {}) {
    this.portfolioManager = portfolioManager;
    this.paperTradingRuntime = paperTradingRuntime;
    this.eventLimit = Math.max(10, Number(eventLimit) || DEFAULT_EVENT_LIMIT);
    this.startedAt = null;
    this.latestOpportunity = null;
    this.latestPortfolio = null;
    this.latestBacktest = null;
    this.events = [];
    this.listeners = new Set();
    this.unsubscribers = [];
  }

  record(type, payload = null) {
    const entry = {
      id: `${now()}:${Math.random().toString(36).slice(2, 10)}`,
      type,
      timestamp: now(),
      payload: clone(payload),
    };
    this.events.push(entry);
    if (this.events.length > this.eventLimit) {
      this.events.splice(0, this.events.length - this.eventLimit);
    }
    this.listeners.forEach((listener) => {
      try {
        listener(clone(entry));
      } catch {
        // Dashboard consumers must not interrupt the trading runtime.
      }
    });
    return entry;
  }

  onEvent(listener) {
    if (typeof listener !== 'function') throw new TypeError('Dashboard listener must be a function');
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async getSnapshot() {
    const portfolio = this.portfolioManager?.getSnapshot
      ? this.portfolioManager.getSnapshot()
      : this.latestPortfolio;
    const paper = this.paperTradingRuntime?.getSnapshot
      ? await this.paperTradingRuntime.getSnapshot()
      : null;

    return {
      status: this.startedAt ? 'running' : 'stopped',
      startedAt: this.startedAt,
      timestamp: now(),
      portfolio: clone(portfolio),
      paperTrading: clone(paper),
      latestOpportunity: clone(this.latestOpportunity),
      latestBacktest: clone(this.latestBacktest),
      recentEvents: clone(this.events),
    };
  }

  getEvents({ after = 0, limit = 50, types = null } = {}) {
    const typeSet = Array.isArray(types) && types.length ? new Set(types) : null;
    return this.events
      .filter((entry) => entry.timestamp > Number(after || 0))
      .filter((entry) => !typeSet || typeSet.has(entry.type))
      .slice(-Math.max(1, Number(limit) || 50))
      .map((entry) => clone(entry));
  }

  bind(type, handler = null) {
    this.unsubscribers.push(eventBus.on(type, (payload) => {
      if (handler) handler(payload);
      this.record(type, payload);
    }));
  }

  start() {
    if (this.unsubscribers.length) return this;
    this.startedAt = now();

    this.bind('opportunity:created', (payload) => { this.latestOpportunity = clone(payload); });
    this.bind('opportunity:replaced', (payload) => { this.latestOpportunity = clone(payload); });
    this.bind('opportunity:expired');
    this.bind('execution:intent-created');
    this.bind('execution:approval-required');
    this.bind('execution:submitted');
    this.bind('execution:cancelled');
    this.bind('execution:expired');
    this.bind('execution:rejected-by-risk');
    this.bind('trade:opened');
    this.bind('trade:closed');
    this.bind('trade:rejected-by-risk');
    this.bind('risk:limit-reached');
    this.bind('portfolio:updated', (payload) => { this.latestPortfolio = clone(payload); });
    this.bind('backtest:completed', (payload) => { this.latestBacktest = clone(payload); });
    this.bind('paper:runtime-ready');

    this.record('dashboard:ready', { startedAt: this.startedAt });
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    this.startedAt = null;
    this.record('dashboard:stopped');
  }
}

export function initializeDashboardService(options = {}) {
  return new DashboardService(options).start();
}
