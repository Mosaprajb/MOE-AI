export class EventBus {
  constructor() {
    this.handlers = new Map();
  }

  on(event, handler) {
    const listeners = this.handlers.get(event) || new Set();
    listeners.add(handler);
    this.handlers.set(event, listeners);
    return () => this.off(event, handler);
  }

  off(event, handler) {
    const listeners = this.handlers.get(event);
    if (!listeners) return;
    listeners.delete(handler);
    if (listeners.size === 0) this.handlers.delete(event);
  }

  async emit(event, payload) {
    const listeners = [...(this.handlers.get(event) || [])];
    const results = await Promise.allSettled(listeners.map((handler) => handler(payload)));
    const failures = results.filter((result) => result.status === 'rejected');
    if (failures.length) {
      const error = new Error(`${failures.length} handler(s) failed for ${event}`);
      error.causes = failures.map((failure) => failure.reason);
      throw error;
    }
  }

  clear(event) {
    if (event) this.handlers.delete(event);
    else this.handlers.clear();
  }
}

export const eventBus = new EventBus();
