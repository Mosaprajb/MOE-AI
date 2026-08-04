import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  normalizeTradingViewAlert,
  normalizeTradingViewSettings,
  tradingViewSignalId,
} from '../src/tradingview-only-runtime.js';

const config = JSON.parse(readFileSync(new URL('../../wrangler.sandbox.jsonc', import.meta.url), 'utf8'));
const deployedEntry = readFileSync(new URL('../src/sandbox-mobile-market-screener-resilient-entry.js', import.meta.url), 'utf8');
const cloudflareEntry = readFileSync(new URL('../src/tradingview-only-cloudflare-entry.js', import.meta.url), 'utf8');
const durableObject = readFileSync(new URL('../src/tradingview-only-durable-object.js', import.meta.url), 'utf8');
const finalEntry = readFileSync(new URL('../src/tradingview-only-final-entry.js', import.meta.url), 'utf8');
const webhookQueue = readFileSync(new URL('../src/tradingview-only-webhook-queue.js', import.meta.url), 'utf8');
const safetyRuntime = readFileSync(new URL('../src/tradingview-only-runtime-safety.js', import.meta.url), 'utf8');
const finalRuntime = readFileSync(new URL('../src/tradingview-only-runtime-final.js', import.meta.url), 'utf8');
const dashboard = readFileSync(new URL('../src/tradingview-only-dashboard.js', import.meta.url), 'utf8');
const finalDashboard = readFileSync(new URL('../src/tradingview-only-dashboard-final.js', import.meta.url), 'utf8');

test('TradingView settings accept fixed-dollar values and force spot long-only rules', () => {
  const settings = normalizeTradingViewSettings({
    accountType: 'DEMO',
    positionSizeDollars: 250,
    takeProfitDollars: 0.25,
    stopLossDollars: 0.10,
    maxDailyLossDollars: 50,
    maxOpenPositions: 3,
    trailingEnabled: true,
  });
  assert.equal(settings.configured, true);
  assert.equal(settings.positionSizeDollars, 250);
  assert.equal(settings.takeProfitDollars, 0.25);
  assert.equal(settings.stopLossDollars, 0.10);
  assert.equal(settings.maxDailyLossDollars, 50);
  assert.equal(settings.maxOpenPositions, 3);
  assert.equal(settings.spotOnly, true);
  assert.equal(settings.longOnly, true);
  assert.equal(settings.breakEvenTriggerDollars, 0.02);
  assert.equal(settings.trailRiseStepDollars, 0.05);
  assert.equal(settings.trailStopStepDollars, 0.01);
});

test('percentage, margin, leverage, short, and derivative fields are rejected', () => {
  for (const key of ['riskPercent', 'marginAmount', 'leverage', 'allowShort', 'derivativeMode']) {
    assert.throws(() => normalizeTradingViewSettings({
      accountType: 'DEMO',
      positionSizeDollars: 100,
      takeProfitDollars: 0.25,
      stopLossDollars: 0.10,
      maxDailyLossDollars: 25,
      maxOpenPositions: 1,
      [key]: 1,
    }), /forbidden/i);
  }
});

test('TradingView alert schema maps ticker and signal aliases without allowing shorts', () => {
  const buy = normalizeTradingViewAlert({
    ticker: 'aapl',
    signal: 'long',
    price: 190.15,
    indicator: 'MOERAND',
    timestamp: '2026-08-03T20:00:00Z',
  });
  assert.equal(buy.symbol, 'AAPL');
  assert.equal(buy.signal, 'BUY');
  assert.equal(buy.price, 190.15);
  const sell = normalizeTradingViewAlert({ symbol: 'MSFT', action: 'close', close: 420.12 });
  assert.equal(sell.signal, 'SELL');
  assert.throws(() => normalizeTradingViewAlert({ symbol: 'TSLA', signal: 'SHORT', price: 200 }), /BUY or SELL/);
});

test('signal fingerprint is deterministic and explicit alert ids win', async () => {
  const alert = normalizeTradingViewAlert({
    symbol: 'NVDA',
    signal: 'BUY',
    price: 125.34,
    indicator: 'UT BOT',
    timestamp: '2026-08-03T20:01:00Z',
  });
  assert.equal(await tradingViewSignalId(alert), await tradingViewSignalId(alert));
  assert.equal(await tradingViewSignalId({ ...alert, explicitId: 'tv-123' }), 'tv-123');
});

test('deployed Sandbox configuration is TradingView-only and Live remains locked', () => {
  assert.equal(config.triggers, undefined);
  assert.equal(config.vars.MOE_TRADINGVIEW_ONLY, 'true');
  assert.equal(config.vars.AUTO_SCANNER_ENABLED, 'false');
  assert.equal(config.vars.SMART_SCANNER_SCHEDULER_ENABLED, 'false');
  assert.equal(config.vars.WEBULL_AUTO_SUBMIT_SANDBOX, 'false');
  assert.equal(config.vars.WEBULL_AUTOMATION_ARMED, 'false');
  assert.equal(config.vars.MOE_TRADINGVIEW_LIVE_ENABLED, 'false');
  assert.equal(config.vars.WEBULL_LIVE_TRADING, 'false');
  assert.equal(config.vars.WEBULL_LIVE_ORDER_SUBMISSION, 'false');
  assert.equal(config.vars.WEBULL_LIVE_AUTOMATION_ARMED, 'false');
  assert.equal(config.vars.WEBULL_LIVE_KILL_SWITCH, 'true');
  assert.ok(config.durable_objects.bindings.some((item) => item.name === 'TRADINGVIEW_POSITION'));
  assert.equal(config.exports.TradingViewPositionCoordinator.storage, 'sqlite');
  assert.match(deployedEntry, /from '\.\/tradingview-only-cloudflare-entry\.js'/);
});

test('ticker state is exported as a real Cloudflare Durable Object', () => {
  assert.match(cloudflareEntry, /tradingview-only-durable-object\.js/);
  assert.match(durableObject, /import \{ DurableObject \} from 'cloudflare:workers'/);
  assert.match(durableObject, /extends DurableObject/);
  assert.match(durableObject, /this\.runtime = new TradingViewPositionRuntime\(ctx, env\)/);
  assert.match(durableObject, /processAlert\(alert, settings, globalRuntime\)/);
  assert.match(durableObject, /alarm\(\)/);
});

test('idempotency is permanent and legacy execution remains blocked', () => {
  assert.match(finalEntry, /claimTradingViewSignal/);
  assert.match(finalEntry, /permanent: true/);
  assert.equal(finalEntry.includes("storage.delete(`tradingview-only:dedupe:"), false);
  assert.match(finalEntry, /\/api\/tradingview\/webull-preview/);
  assert.match(finalEntry, /status: 410/);
});

test('webhook returns quickly and queues isolated per-ticker execution', () => {
  assert.match(finalEntry, /handleQueuedTradingViewWebhook/);
  assert.match(webhookQueue, /ctx\.waitUntil\(task\)/);
  assert.match(webhookQueue, /DURABLE_OBJECT_TICKER_QUEUE/);
  assert.match(webhookQueue, /positionCoordinator\(env, alert\.symbol\)\.processAlert/);
  assert.match(webhookQueue, /queued: true/);
  assert.match(webhookQueue, /}, 202\)/);
});

test('emergency exit covers broker inventory and retries rejected closes', () => {
  assert.match(finalEntry, /closeUntrackedBrokerPositions/);
  assert.match(finalEntry, /KILL_SWITCH_UNTRACKED_POSITION_EXIT_SUBMITTED/);
  assert.match(finalEntry, /orderType: 'MARKET'/);
  assert.match(finalRuntime, /KILL_SWITCH_EXIT_RETRIED/);
  assert.match(finalRuntime, /isTerminalFailureStatus/);
  assert.match(finalRuntime, /killRetryCount/);
});

test('position runtime fails safe during stop replacement and archives broker fill prices', () => {
  assert.match(safetyRuntime, /Maximum concurrent open positions reached at the broker/);
  assert.match(safetyRuntime, /TRAILING_STOP_REPLACEMENT_FAILED/);
  assert.match(safetyRuntime, /PROTECTION_FAILURE_MARKET_EXIT_SUBMITTED/);
  assert.match(safetyRuntime, /orderFillPrice/);
  assert.match(safetyRuntime, /isFilledStatus/);
});

test('main interface is alerts-first while scanner remains research-only', () => {
  assert.match(dashboard, /Execution source: TradingView webhooks only/);
  assert.match(dashboard, /Scanner · Research only/);
  assert.match(dashboard, /This page cannot open, modify, or close trades/);
  assert.equal(dashboard.includes('data-view="strategies"'), false);
  assert.equal(dashboard.includes('Strategies</button>'), false);
});

test('interface provides real-time trade notifications and sortable archive', () => {
  assert.match(finalDashboard, /TRADINGVIEW_POSITION_OPENED/);
  assert.match(finalDashboard, /TRAILING_STOP_RAISED/);
  assert.match(finalDashboard, /TRADINGVIEW_POSITION_CLOSED/);
  assert.match(finalDashboard, /archiveSort/);
  assert.match(finalDashboard, /Highest P\/L/);
  assert.match(finalDashboard, /MutationObserver/);
  assert.match(finalDashboard, /archiveObserver\.disconnect/);
});
