import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');
const monitorSource = readFileSync(join(root, 'worker/src/mobile-scanner-monitor.js'), 'utf8');
const visibleUiSource = readFileSync(join(root, 'worker/src/mobile-scanner-visible-ui.js'), 'utf8');
const entrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-account-balances-entry.js'), 'utf8');

test('mobile scanner monitor is wired into the deployed Sandbox entry', () => {
  assert.match(entrySource, /from '\.\/mobile-scanner-monitor\.js'/);
  assert.match(entrySource, /from '\.\/mobile-scanner-visible-ui\.js'/);
  assert.match(entrySource, /pathname === MOBILE_SCANNER_MONITOR_PATH/);
  assert.match(entrySource, /handleMobileScannerMonitor\(request, env\)/);
  assert.match(entrySource, /enhanceMobileScannerVisibleUi\(repaired, request\)/);
  assert.match(entrySource, /repairVisibleScannerDomInsertion\(enhanced, request\)/);
});

test('visible scanner runtime repairs nested DOM insertion before the page is returned', () => {
  assert.match(entrySource, /stack\?card\.insertBefore\(panel,stack\):chips\.insertAdjacentElement\('afterend',panel\);/);
  assert.match(entrySource, /chips\.insertAdjacentElement\('afterend',panel\);/);
  assert.match(entrySource, /body\.insertAdjacentElement\('afterbegin',holder\.firstElementChild\);/);
  assert.match(entrySource, /list\.insertAdjacentElement\('beforebegin',tools\);/);
  assert.match(entrySource, /x-moe-mobile-scanner-dom-fix/);
  assert.match(entrySource, /moe-mobile-scanner-dom-insertion-fixed/);
});

test('visible mobile scanner UI exposes live quote, protected prices, readiness, refresh, and clear controls', () => {
  for (const token of [
    'moe-mobile-scanner-visible-ui',
    'data-moe-monitor-location',
    "monitorMarkup('main')",
    "monitorMarkup('scanner')",
    'Selected symbol live monitor',
    'data-moe-monitor-refresh',
    'data-moe-monitor-field',
    'Target / exit',
    'Stop loss',
    'moeActivityRefreshVisible',
    'moeActivityClearVisible',
    'Clear old',
    'Old activity cleared from this screen',
    'No executable setup yet',
  ]) {
    assert.equal(visibleUiSource.includes(token), true, `missing visible mobile scanner UI token: ${token}`);
  }

  for (const field of ['price', 'entry', 'exit', 'stop', 'stage', 'percent', 'fill']) {
    assert.equal(visibleUiSource.includes(`data-moe-monitor-field="${field}"`), true, `missing monitor field: ${field}`);
  }

  assert.match(visibleUiSource, /setInterval\(function\(\)\{if\(!document\.hidden\)refreshMonitor\(false\);\},3000\)/);
  assert.match(visibleUiSource, /fill\.style\.width=percent\+'%'/);
  assert.equal(visibleUiSource.includes("percent>=90?'var(--green)':percent>=60?'var(--amber)':'var(--red)'"), true);
  assert.match(visibleUiSource, /#chips \[data-rm\]/);
  assert.match(visibleUiSource, /MutationObserver/);
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
  assert.equal(visibleUiSource.includes('placeWebullSandboxOrder'), false);
  assert.equal(visibleUiSource.includes('placeWebullLiveOrder'), false);
});
