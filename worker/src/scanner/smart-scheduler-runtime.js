export function smartSchedulerEnabled(env = {}) {
  return String(env.SMART_SCANNER_SCHEDULER_ENABLED || '').trim().toLowerCase() === 'true';
}

export function createAutoScannerDisabledEnv(env = {}) {
  return new Proxy(env, {
    get(target, property, receiver) {
      if (property === 'AUTO_SCANNER_ENABLED') return 'false';
      return Reflect.get(target, property, receiver);
    },
    has(target, property) {
      if (property === 'AUTO_SCANNER_ENABLED') return true;
      return Reflect.has(target, property);
    },
  });
}

export function createCapturedExecutionContext(parentContext) {
  const tasks = [];
  const context = {
    waitUntil(promise) {
      tasks.push(Promise.resolve(promise));
    },
    passThroughOnException() {
      if (parentContext && typeof parentContext.passThroughOnException === 'function') {
        return parentContext.passThroughOnException();
      }
      return undefined;
    },
  };

  return Object.freeze({
    context,
    async waitForAll(returned) {
      const pending = [];
      if (returned && typeof returned.then === 'function') pending.push(Promise.resolve(returned));
      pending.push(...tasks);
      if (!pending.length) return [];
      return Promise.allSettled(pending);
    },
    taskCount: () => tasks.length,
  });
}
