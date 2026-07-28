import { eventBus } from './event-bus.js';

const DEFAULT_EVENTS = [
  'opportunity:created',
  'opportunity:replaced',
  'execution:approval-required',
  'execution:submitted',
  'execution:cancelled',
  'execution:expired',
  'execution:rejected-by-risk',
  'risk:limit-reached',
  'trade:opened',
  'trade:closed',
  'portfolio:updated',
  'notification:created',
  'backtest:completed',
];

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export class RealtimeStreamService {
  constructor({ events = DEFAULT_EVENTS, historyLimit = 500, heartbeatMs = 25000 } = {}) {
    this.events = [...new Set(events || DEFAULT_EVENTS)];
    this.historyLimit = Math.max(1, Math.floor(number(historyLimit, 500)));
    this.heartbeatMs = Math.max(5000, Math.floor(number(heartbeatMs, 25000)));
    this.clients = new Map();
    this.history = [];
    this.sequence = 0;
    this.unsubscribers = [];
  }

  createEnvelope(event, payload = {}) {
    return {
      id: `stream-${Date.now()}-${this.sequence += 1}`,
      event,
      timestamp: payload?.timestamp || Date.now(),
      payload: clone(payload),
    };
  }

  publish(event, payload = {}) {
    const envelope = this.createEnvelope(event, payload);
    this.history.unshift(envelope);
    if (this.history.length > this.historyLimit) this.history.length = this.historyLimit;

    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.send(clone(envelope));
      } catch (error) {
        this.removeClient(clientId, error);
      }
    }

    return clone(envelope);
  }

  addClient({ id, send, close = null, metadata = null } = {}) {
    if (typeof send !== 'function') throw new Error('RealtimeStreamService client requires a send function');
    const clientId = id || `client-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    this.clients.set(clientId, {
      id: clientId,
      send,
      close: typeof close === 'function' ? close : null,
      metadata: clone(metadata),
      connectedAt: Date.now(),
      lastHeartbeatAt: Date.now(),
    });

    send({
      id: `stream-connected-${clientId}`,
      event: 'stream:connected',
      timestamp: Date.now(),
      payload: {
        clientId,
        activeClients: this.clients.size,
      },
    });

    return clientId;
  }

  removeClient(clientId, reason = null) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    this.clients.delete(clientId);

    try {
      client.close?.(reason);
    } catch {
      // Ignore transport shutdown errors.
    }

    return true;
  }

  heartbeat() {
    const timestamp = Date.now();
    for (const [clientId, client] of this.clients.entries()) {
      try {
        client.send({
          id: `heartbeat-${timestamp}-${clientId}`,
          event: 'stream:heartbeat',
          timestamp,
          payload: { clientId },
        });
        client.lastHeartbeatAt = timestamp;
      } catch (error) {
        this.removeClient(clientId, error);
      }
    }
  }

  listHistory({ event = null, limit = 100 } = {}) {
    const max = Math.max(1, Math.floor(number(limit, 100)));
    return this.history
      .filter((item) => !event || item.event === event)
      .slice(0, max)
      .map(clone);
  }

  getSnapshot() {
    return {
      activeClients: this.clients.size,
      subscribedEvents: [...this.events],
      historySize: this.history.length,
      latest: this.listHistory({ limit: 25 }),
    };
  }

  start() {
    if (this.unsubscribers.length) return this;

    for (const eventName of this.events) {
      this.unsubscribers.push(eventBus.on(eventName, (payload) => this.publish(eventName, payload)));
    }

    this.heartbeatTimer = setInterval(() => this.heartbeat(), this.heartbeatMs);
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    this.heartbeatTimer = null;

    for (const clientId of [...this.clients.keys()]) {
      this.removeClient(clientId, 'STREAM_STOPPED');
    }
  }
}

export function initializeRealtimeStreamService(options = {}) {
  return new RealtimeStreamService(options).start();
}
