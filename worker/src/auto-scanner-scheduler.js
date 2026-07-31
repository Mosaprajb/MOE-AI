import { runAutoScanner } from './auto-scanner.js';
import { createSmartScannerScheduler } from './scanner/smart-scheduler.js';

const scheduler = createSmartScannerScheduler({
  scanRunner: async (env, scheduledTime) => runAutoScanner(env, scheduledTime),
});

export function runSmartAutoScannerMinute(env = {}, scheduledTime = Date.now(), context = {}) {
  return scheduler.runMinute(env, scheduledTime, context);
}

export function smartAutoScannerPlan(env = {}, scheduledTime = Date.now(), context = {}) {
  return scheduler.plan(scheduledTime, env, context);
}

export function smartAutoScannerRunning() {
  return scheduler.isRunning();
}
