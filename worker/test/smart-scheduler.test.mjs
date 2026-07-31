import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  buildSmartScannerMinutePlan,
  createSmartScannerScheduler,
  resolveSmartScannerPhase,
} from '../src/scanner/smart-scheduler.js';
import {
  createAutoScannerDisabledEnv,
  createCapturedExecutionContext,
  smartSchedulerEnabled,
} from '../src/scanner/smart-scheduler-runtime.js';

const PRE_MARKET = Date.parse('2026-07-30T08:00:00.000Z');
const MARKET_OPEN = Date.parse('2026-07-30T13:30:00.000Z');
const LUNCH = Date.parse('2026-07-30T15:30:00.000Z');
const POWER_HOUR = Date.parse('2026-07-30T19:00:00.000Z');
const AFTER_HOURS = Date.parse('2026-07-30T20:00:00.000Z');
const AFTER_HOURS_ODD_MINUTE = Date.parse('2026-07-30T20:01:00.000Z');
const CLOSED = Date.parse('2026-07-31T00:00:00.000Z');

function schedulerEnv() {
  return {
    SMART_SCANNER_SCHEDULER_ENABLED: 'true',
    SMART_SCANNER_PREMARKET_INTERVAL_SECONDS: '60',
    SMART_SCANNER_OPEN_INTERVAL_SECONDS: '20',
    SMART_SCANNER_LUNCH_INTERVAL_SECONDS: '60',
    SMART_SCANNER_POWER_HOUR_INTERVAL_SECONDS: '20',
    SMART_SCANNER_AFTER_HOURS_INTERVAL_SECONDS: '120',
  };
}

test('Smart Scheduler maps New York market phases at exact boundaries', () => {
  assert.equal(resolveSmartScannerPhase(PRE_MARKET).key, 'PRE_MARKET');
  assert.equal(resolveSmartScannerPhase(MARKET_OPEN).key, 'MARKET_OPEN');
  assert.equal(resolveSmartScannerPhase(LUNCH).key, 'LUNCH');
  assert.equal(resolveSmartScannerPhase(POWER_HOUR).key, 'POWER_HOUR');
  assert.equal(resolveSmartScannerPhase(AFTER_HOURS).key, 'AFTER_HOURS');
  assert.equal(resolveSmartScannerPhase(CLOSED).key, 'CLOSED');
});

test('Smart Scheduler creates 60s, 20s, 60s, 20s, and 120s cadence plans', () => {
  const env = schedulerEnv();
  const preMarket = buildSmartScannerMinutePlan(PRE_MARKET, env);
  const marketOpen = buildSmartScannerMinutePlan(MARKET_OPEN, env);
  const lunch = buildSmartScannerMinutePlan(LUNCH, env);
  const powerHour = buildSmartScannerMinutePlan(POWER_HOUR, env);
  const afterHours = buildSmartScannerMinutePlan(AFTER_HOURS, env);
  const afterHoursOddMinute = buildSmartScannerMinutePlan(AFTER_HOURS_ODD_MINUTE, env);

  assert.equal(preMarket.cadenceMs, 60_000);
  assert.deepEqual(preMarket.ticks.map((tick) => tick.offsetMs), [0]);
  assert.equal(marketOpen.cadenceMs, 20_000);
  assert.deepEqual(marketOpen.ticks.map((tick) => tick.offsetMs), [0, 20_000, 40_000]);
  assert.equal(lunch.cadenceMs, 60_000);
  assert.deepEqual(lunch.ticks.map((tick) => tick.offsetMs), [0]);
  assert.equal(powerHour.cadenceMs, 20_000);
  assert.deepEqual(powerHour.ticks.map((tick) => tick.offsetMs), [0, 20_000, 40_000]);
  assert.equal(afterHours.cadenceMs, 120_000);
  assert.deepEqual(afterHours.ticks.map((tick) => tick.offsetMs), [0]);
  assert.equal(afterHoursOddMinute.ticks.length, 0);
});

test('Smart Scheduler runs three open-session scans twenty seconds apart without changing execution authority', async () => {
  let clock = 0;
  const calls = [];
  const scheduler = createSmartScannerScheduler({
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    scanRunner: async (_env, scheduledTime, context) => {
      calls.push({ clock, scheduledTime, scheduler: context.smartScheduler });
      return { observationOnly: true, executionEnabled: false };
    },
  });

  const result = await scheduler.runMinute(schedulerEnv(), MARKET_OPEN);
  assert.equal(result.ok, true);
  assert.equal(result.phase, 'MARKET_OPEN');
  assert.equal(result.ticksCompleted, 3);
  assert.deepEqual(calls.map((item) => item.clock), [0, 20_000, 40_000]);
  assert.equal(calls.every((item) => item.scheduler.executionAuthorityChanged === false), true);
  assert.equal(result.executionAuthorityChanged, false);
});

test('Smart Scheduler blocks overlapping cron windows', async () => {
  let releaseFirst;
  let clock = 0;
  let calls = 0;
  const firstGate = new Promise((resolve) => { releaseFirst = resolve; });
  const scheduler = createSmartScannerScheduler({
    now: () => clock,
    sleep: async (milliseconds) => { clock += milliseconds; },
    scanRunner: async () => {
      calls += 1;
      if (calls === 1) await firstGate;
      return { ok: true };
    },
  });

  const first = scheduler.runMinute(schedulerEnv(), MARKET_OPEN);
  await Promise.resolve();
  const overlap = await scheduler.runMinute(schedulerEnv(), MARKET_OPEN);
  assert.equal(overlap.skipped, 'SMART_SCHEDULER_OVERLAP');
  assert.equal(overlap.executionAuthorityChanged, false);
  releaseFirst();
  const completed = await first;
  assert.equal(completed.ticksCompleted, 3);
});

test('runtime masking disables only the delegated legacy scanner and captures its waitUntil work', async () => {
  const original = { AUTO_SCANNER_ENABLED: 'true', VALUE: 'kept', SMART_SCANNER_SCHEDULER_ENABLED: 'true' };
  const delegated = createAutoScannerDisabledEnv(original);
  assert.equal(delegated.AUTO_SCANNER_ENABLED, 'false');
  assert.equal(delegated.VALUE, 'kept');
  assert.equal(original.AUTO_SCANNER_ENABLED, 'true');
  assert.equal(smartSchedulerEnabled(original), true);

  let completed = false;
  const captured = createCapturedExecutionContext();
  captured.context.waitUntil(Promise.resolve().then(() => { completed = true; }));
  const outcomes = await captured.waitForAll();
  assert.equal(completed, true);
  assert.equal(outcomes.length, 1);
  assert.equal(outcomes[0].status, 'fulfilled');
});

test('Wrangler routes minute cron events through the Smart Scheduler entrypoint with requested defaults', () => {
  const config = JSON.parse(readFileSync(new URL('../../wrangler.jsonc', import.meta.url), 'utf8'));
  assert.equal(config.main, 'worker/src/smart-scheduler-entry.js');
  assert.deepEqual(config.triggers.crons, ['* * * * *']);
  assert.equal(config.vars.SMART_SCANNER_SCHEDULER_ENABLED, 'true');
  assert.equal(config.vars.SMART_SCANNER_PREMARKET_INTERVAL_SECONDS, '60');
  assert.equal(config.vars.SMART_SCANNER_OPEN_INTERVAL_SECONDS, '20');
  assert.equal(config.vars.SMART_SCANNER_LUNCH_INTERVAL_SECONDS, '60');
  assert.equal(config.vars.SMART_SCANNER_POWER_HOUR_INTERVAL_SECONDS, '20');
  assert.equal(config.vars.SMART_SCANNER_AFTER_HOURS_INTERVAL_SECONDS, '120');
  assert.equal(config.vars.WEBULL_LIVE_TRADING, 'false');
  assert.equal(config.vars.WEBULL_LIVE_ORDER_SUBMISSION, 'false');
});
