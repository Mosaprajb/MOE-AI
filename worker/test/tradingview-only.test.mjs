import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  migrateTradingViewSettingsV2,
  normalizeTradingViewSettingsV2,
  TRADING_MODES,
  TRADINGVIEW_SETTINGS_VERSION,
} from '../src/tradingview-only-settings-v2.js';
import {
  marketPhaseAt,
  tradingViewMarketClock,
} from '../src/tradingview-only-market-clock.js';

const source = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const deployedEntry = source('sandbox-mobile-market-screener-resilient-entry.js');
const finalEntry = source('tradingview-only-final-entry.js');
const webhookQueue = source('tradingview-only-webhook-queue.js');
const safetyRuntime = source('tradingview-only-runtime-safety.js');
const finalRuntime = source('tradingview-only-runtime-final.js');
const dashboard = source('tradingview-only-dashboard.js');
const finalDashboard = source('tradingview-only-dashboard-final.js');
const config = JSON.parse(readFileSync(new URL('../../wrangler.sandbox.jsonc', import.meta.url), 'utf8'));

test('whole-trade settings default to cash long-only and whole shares', () => {
  const settings = normalizeTradingViewSettingsV2({
    accountType: 'DEMO',
    positionSizeDollars: 2000,
    takeProfitDollars: 300,
    stopLossDollars: 100,
    maxDailyLossDollars: 250,
    maxOpenPositions: 3,
    maxBuyingPowerPercent: 25,
    tradingMode: TRADING_MODES.CASH,
    session: 'ALL',
    autoFlattenTimeLocal: '18:55',
    autoFlattenTimezone: 'America/Chicago',
  });
  assert.equal(settings.settingsVersion, TRADINGVIEW_SETTINGS_VERSION);
  assert.equal(settings.configured, true);
  assert.equal(settings.wholeTradeTargets, true);
  assert.equal(settings.wholeSharesOnly, true);
  assert.equal(settings.cashOnly, true);
  assert.equal(settings.marginLongEnabled, false);
  assert.equal(settings.longOnly, true);
  assert.equal(settings.noOvernightHolding, true);
  assert.equal(settings.takeProfitDollars, 300);
  assert.equal(settings.stopLossDollars, 100);
});

test('margin long mode accepts only the buying-power percentage guardrail', () => {
  const settings = normalizeTradingViewSettingsV2({
    accountType: 'DEMO',
    positionSizeDollars: 2000,
    takeProfitDollars: 300,
    stopLossDollars: 100,
    maxDailyLossDollars: 250,
    maxOpenPositions: 2,
    maxBuyingPowerPercent: 20,
    tradingMode: TRADING_MODES.MARGIN,
    session: 'CORE',
  });
  assert.equal(settings.marginLongEnabled, true);
  assert.equal(settings.cashOnly, false);
  assert.equal(settings.maxBuyingPowerPercent, 20);
  assert.throws(() => normalizeTradingViewSettingsV2({
    ...settings,
    allowShort: true,
  }), /forbidden/i);
  assert.throws(() => normalizeTradingViewSettingsV2({
    ...settings,
    leveragePercent: 20,
  }), /forbidden/i);
  assert.throws(() => normalizeTradingViewSettingsV2({
    ...settings,
    session: 'NIGHT',
  }), /overnight entries are disabled/i);
});

test('old per-share settings require explicit resave under whole-trade schema', () => {
  const migrated = migrateTradingViewSettingsV2({
    accountType: 'DEMO',
    positionSizeDollars: 100,
    takeProfitDollars: 0.25,
    stopLossDollars: 0.10,
  });
  assert.equal(migrated.configured, false);
  assert.equal(migrated.migrationRequired, true);
  assert.equal(migrated.settingsVersion, 2);
});

test('market clock identifies session type and countdown boundaries', () => {
  assert.equal(marketPhaseAt('2026-08-04T12:00:00Z'), 'PRE_MARKET');
  assert.equal(marketPhaseAt('2026-08-04T14:00:00Z'), 'REGULAR');
  assert.equal(marketPhaseAt('2026-08-04T21:00:00Z'), 'AFTER_HOURS');
  assert.equal(marketPhaseAt('2026-08-05T01:00:00Z'), 'OVERNIGHT');
  const clock = tradingViewMarketClock('2026-08-04T21:00:00Z', {
    session: 'ALL',
    autoFlattenTimeLocal: '18:55',
    autoFlattenTimezone: 'America/Chicago',
  });
  assert.equal(clock.phase, 'AFTER_HOURS');
  assert.equal(clock.entryAllowed, true);
  assert.ok(clock.remainingSeconds > 0);
  assert.equal(clock.noOvernightHolding, true);
});

test('deployed Sandbox remains TradingView-only and scanner execution stays disabled', () => {
  assert.equal(config.vars.MOE_TRADINGVIEW_ONLY, 'true');
  assert.equal(config.vars.AUTO_SCANNER_ENABLED, 'false');
  assert.equal(config.vars.SMART_SCANNER_SCHEDULER_ENABLED, 'false');
  assert.equal(config.vars.MOE_TRADINGVIEW_LIVE_ENABLED, 'false');
  assert.match(deployedEntry, /tradingview-only-cloudflare-entry\.js/);
});

test('whole-trade execution derives per-share exits from total dollars', () => {
  assert.match(safetyRuntime, /Math\.floor\(amount \/ priceValue\)/);
  assert.match(safetyRuntime, /normalized\.takeProfitDollars \/ quantity/);
  assert.match(safetyRuntime, /normalized\.stopLossDollars \/ quantity/);
  assert.match(safetyRuntime, /takeProfitTotalDollars/);
  assert.match(safetyRuntime, /stopLossTotalDollars/);
  assert.match(safetyRuntime, /Buying-power percentage cap would be exceeded/);
  assert.match(safetyRuntime, /CASH_PLUS_MARGIN_LONG|TRADING_MODES\.MARGIN/);
  assert.equal(safetyRuntime.includes("side: 'SHORT'"), false);
});

test('auto-flatten uses alarms without re-enabling scanner execution', () => {
  assert.match(finalEntry, /scheduleNextTradingViewAutoFlatten/);
  assert.match(finalEntry, /async alarm\(\)/);
  assert.match(finalEntry, /runAutoFlatten/);
  assert.match(finalEntry, /AUTO_FLATTEN/);
  assert.match(finalEntry, /scannerExecutionEnabled: false|TRADINGVIEW/);
  assert.match(finalRuntime, /autoFlatten \? 'AUTO_FLATTEN'|AUTO_FLATTEN_EXIT_RETRIED/);
  assert.match(finalRuntime, /marketPhaseAt/);
});

test('webhook remains isolated by ticker and idempotent', () => {
  assert.match(finalEntry, /permanent: true/);
  assert.match(webhookQueue, /DURABLE_OBJECT_TICKER_QUEUE/);
  assert.match(webhookQueue, /ctx\.waitUntil\(task\)/);
  assert.match(webhookQueue, /positionCoordinator\(env, alert\.symbol\)\.processAlert/);
});

test('interface shows session countdown and account connection lights', () => {
  assert.match(finalDashboard, /connectionDot\.online/);
  assert.match(finalDashboard, /moeConnectionPulse/);
  assert.match(finalDashboard, /connectionDot\.offline/);
  assert.match(finalDashboard, /Connected/);
  assert.match(finalDashboard, /Disconnected/);
  assert.match(finalDashboard, /marketSession/);
  assert.match(finalDashboard, /marketCountdown/);
  assert.match(finalDashboard, /Session remaining/);
  assert.match(finalDashboard, /Order session/);
});

test('settings drafts survive background polling until explicit save', () => {
  assert.match(finalDashboard, /var drafts=Object\.create\(null\)/);
  assert.match(finalDashboard, /var dirty=new Set\(\)/);
  assert.match(finalDashboard, /installDraftAwareFetch/);
  assert.match(finalDashboard, /stopImmediatePropagation/);
  assert.match(finalDashboard, /saveV2Settings/);
  assert.match(finalDashboard, /Take profit total \$/);
  assert.match(finalDashboard, /Stop loss total \$/);
});

test('embedded dashboard enhancement is valid browser JavaScript', async () => {
  const moduleUrl = new URL('../src/tradingview-only-dashboard-final.js', import.meta.url);
  const { tradingViewDashboardHtml } = await import(`${moduleUrl.href}?browser-script-test=${Date.now()}`);
  const html = tradingViewDashboardHtml();
  const match = html.match(/<script id="moe-tradingview-final-ui">([\s\S]*?)<\/script>/);
  assert.ok(match, 'enhancement script must be emitted with a valid HTML id');
  assert.doesNotThrow(() => new Function(match[1]));
  assert.equal(html.includes('id=\\"moe-tradingview-final-ui\\"'), false);
});

test('scanner stays research-only and strategies stay hidden', () => {
  assert.match(dashboard, /Execution source: TradingView webhooks only/);
  assert.match(dashboard, /Scanner · research only/);
  assert.match(dashboard, /This page cannot open, modify, or close trades/);
  assert.equal(dashboard.includes('data-view="strategies"'), false);
});
