import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');
const monitorSource = readFileSync(join(root, 'worker/src/mobile-scanner-monitor.js'), 'utf8');
const entrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-account-balances-entry.js'), 'utf8');

test('mobile scanner monitor is wired into the deployed Sandbox entry', () => {
  assert.match(entrySource, /from '\.\/mobile-scanner-monitor\.js'/);
  assert.match(entrySource, /pathname === MOBILE_SCANNER_MONITOR_PATH/);
  assert.match(entrySource, /handleMobileScannerMonitor\(request, env\)/);
  assert.match(entrySource, /enhanceMobileScannerMonitor\(repaired, request\)/);
});

test('mobile scanner monitor exposes refresh, clear, prices, live quote, and readiness controls', () => {
  for (const token of [
    'moeActivityRefresh',
    'moeActivityClear',
    'Clear old',
    'Old activity cleared from this screen',
    'moeScannerMonitor',
    'moeMonitorRefresh',
    'moeMonitorSymbol',
    'moeMonitorPrice',
    'moeMonitorEntry',
    'moeMonitorExit',
    'moeMonitorStop',
    'moeMonitorStage',
    'moeMonitorPercent',
    'moeMonitorFill',
    'Selected symbol live monitor',
    'Target / exit',
    'Stop loss',
    'Waiting for live quote',
  ]) {
    assert.equal(monitorSource.includes(token), true, `missing mobile scanner UI token: ${token}`);
  }

  assert.match(monitorSource, /enhancedLoadActivity\(true\)/);
  assert.match(monitorSource, /setInterval\(function\(\)\{syncSymbolOptions\(\);refreshMonitor\(false\);\},3000\)/);
  assert.match(monitorSource, /fill\.style\.width=percent\+'%'/);
  assert.equal(monitorSource.includes("percent>=90?'var(--green)':percent>=60?'var(--amber)':'var(--red)'"), true);
});

test('mobile scanner monitor reads Alpaca market data and returns an estimated protected plan', () => {
  assert.match(monitorSource, /data\.alpaca\.markets\/v2\/stocks\/bars/);
  assert.match(monitorSource, /snapshot\?feed=iex/);
  assert.match(monitorSource, /timeframe: '5Min'/);
  assert.match(monitorSource, /entryPrice/);
  assert.match(monitorSource, /exitPrice/);
  assert.match(monitorSource, /stopLossPrice/);
  assert.match(monitorSource, /riskPerShare/);
  assert.match(monitorSource, /rewardRisk/);
  assert.match(monitorSource, /driftPassed/);
  assert.match(monitorSource, /readiness: progress/);
  assert.match(monitorSource, /estimateOnly: true/);
});

test('mobile scanner monitor remains same-origin, read-only, and cannot unlock Live trading', () => {
  assert.match(monitorSource, /x-moe-mobile-client/);
  assert.match(monitorSource, /origin === new URL\(request\.url\)\.origin/);
  assert.match(monitorSource, /Mobile scanner access denied/);
  assert.equal(monitorSource.includes('placeWebullSandboxOrder'), false);
  assert.equal(monitorSource.includes('placeWebullLiveOrder'), false);
  assert.equal(monitorSource.includes("WEBULL_LIVE_TRADING: 'true'"), false);
  assert.equal(monitorSource.includes("WEBULL_LIVE_ORDER_SUBMISSION: 'true'"), false);
  assert.equal(monitorSource.includes("WEBULL_LIVE_AUTOMATION_ARMED: 'true'"), false);
});
