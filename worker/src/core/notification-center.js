import { eventBus } from './event-bus.js';

const DEFAULT_EVENT_MAP = {
  'opportunity:created': { type: 'opportunity_created', severity: 'info', title: 'New opportunity' },
  'opportunity:replaced': { type: 'opportunity_replaced', severity: 'info', title: 'Opportunity replaced' },
  'execution:approval-required': { type: 'approval_required', severity: 'warning', title: 'Execution approval required' },
  'execution:submitted': { type: 'order_submitted', severity: 'info', title: 'Order submitted' },
  'execution:cancelled': { type: 'order_cancelled', severity: 'warning', title: 'Order cancelled' },
  'execution:expired': { type: 'order_expired', severity: 'warning', title: 'Opportunity expired' },
  'execution:rejected-by-risk': { type: 'risk_rejected', severity: 'error', title: 'Trade rejected by risk manager' },
  'risk:limit-reached': { type: 'risk_limit', severity: 'error', title: 'Risk limit reached' },
  'trade:opened': { type: 'trade_opened', severity: 'success', title: 'Trade opened' },
  'trade:closed': { type: 'trade_closed', severity: 'success', title: 'Trade closed' },
  'backtest:completed': { type: 'backtest_completed', severity: 'info', title: 'Backtest completed' },
};

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function messageFor(eventName, payload = {}) {
  const symbol = String(payload.symbol || payload.order?.symbol || '').toUpperCase();
  if (eventName === 'trade:closed') {
    const reason = payload.exitReason || 'UNKNOWN';
    return `${symbol || 'Trade'} closed: ${reason}, P/L ${number(payload.pnl).toFixed(2)}`;
  }
  if (eventName === 'trade:opened') {
    return `${symbol || 'Trade'} opened at ${number(payload.entryPrice).toFixed(4)}`;
  }
  if (eventName === 'execution:rejected-by-risk' || eventName === 'risk:limit-reached') {
    return `${symbol || 'Trade'} rejected: ${payload.reason || payload.riskDecision?.reason || 'RISK_LIMIT'}`;
  }
  if (eventName === 'execution:submitted') {
    return `${symbol || 'Order'} submitted to broker`;
  }
  if (eventName === 'opportunity:created') {
    return `${symbol || 'New'} ${payload.direction || ''} opportunity created`.trim();
  }
  if (eventName === 'opportunity:replaced') {
    return `${symbol || 'Existing'} opportunity replaced by a better setup`;
  }
  return symbol ? `${symbol}: ${eventName}` : eventName;
}

export class NotificationCenter {
  constructor({ maxItems = 250, eventMap = DEFAULT_EVENT_MAP } = {}) {
    this.maxItems = Math.max(1, Math.floor(number(maxItems, 250)));
    this.eventMap = { ...DEFAULT_EVENT_MAP, ...(eventMap || {}) };
    this.notifications = [];
    this.sequence = 0;
    this.unsubscribers = [];
  }

  createNotification(eventName, payload = {}) {
    const config = this.eventMap[eventName] || {
      type: eventName.replace(/[:]/g, '_'),
      severity: 'info',
      title: eventName,
    };

    return {
      id: `notification-${Date.now()}-${this.sequence += 1}`,
      event: eventName,
      type: config.type,
      severity: config.severity,
      title: config.title,
      message: messageFor(eventName, payload),
      symbol: payload.symbol || payload.order?.symbol || null,
      timestamp: payload.timestamp || payload.closedAt || payload.openedAt || Date.now(),
      read: false,
      payload: clone(payload),
    };
  }

  async capture(eventName, payload = {}) {
    const notification = this.createNotification(eventName, payload);
    this.notifications.unshift(notification);
    if (this.notifications.length > this.maxItems) {
      this.notifications.length = this.maxItems;
    }
    await eventBus.emit('notification:created', clone(notification));
    return notification;
  }

  list({ unreadOnly = false, severity = null, type = null, limit = 50 } = {}) {
    const max = Math.max(1, Math.floor(number(limit, 50)));
    return this.notifications
      .filter((item) => !unreadOnly || !item.read)
      .filter((item) => !severity || item.severity === severity)
      .filter((item) => !type || item.type === type)
      .slice(0, max)
      .map(clone);
  }

  markRead(id) {
    const item = this.notifications.find((notification) => notification.id === id);
    if (!item) return null;
    item.read = true;
    return clone(item);
  }

  markAllRead() {
    this.notifications.forEach((item) => {
      item.read = true;
    });
    return this.getSnapshot();
  }

  clear() {
    this.notifications = [];
  }

  getSnapshot() {
    const unread = this.notifications.filter((item) => !item.read).length;
    return {
      total: this.notifications.length,
      unread,
      latest: this.list({ limit: 25 }),
    };
  }

  start() {
    if (this.unsubscribers.length) return this;
    for (const eventName of Object.keys(this.eventMap)) {
      this.unsubscribers.push(eventBus.on(eventName, (payload) => this.capture(eventName, payload)));
    }
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}

export function initializeNotificationCenter(options = {}) {
  return new NotificationCenter(options).start();
}
