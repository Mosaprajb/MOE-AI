import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  computeDesiredStop,
  minuteHighIsEligible,
  selectMarketableEntryPrice,
} from '../src/tradingview-only-runtime-reliable.js';
import { tradingViewMobileDashboardHtml } from '../src/tradingview-only-dashboard-mobile.js';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');

test('manual trailing follows +2 cents then +1 cent per additional +5 cents', () => {
  assert.deepEqual(computeDesiredStop(13.54, 13.55), null);
  assert.deepEqual(computeDesiredStop(13.54, 13.56), {
    triggerPrice: 13.56,
    steps: 0,
    desiredStop: 13.56,
  });
  assert.deepEqual(computeDesiredStop(13.54, 13.62), {
    triggerPrice: 13.56,
    steps: 1,
    desiredStop: 13.57,
  });
  assert.deepEqual(computeDesiredStop(13.54, 13.67), {
    triggerPrice: 13.56,
    steps: 2,
    desiredStop: 13.58,
  });
});

test('entry limit is refreshed to a marketable price without uncontrolled chasing', () => {
  assert.equal(selectMarketableEntryPrice(13.54, 13.55, 10), 13.56);
  assert.equal(selectMarketableEntryPrice(13.54, 13.54, 10), 13.55);
  assert.throws(
    () => selectMarketableEntryPrice(13.54, 13.70, 10),
    /price moved more than \$0\.10/i,
  );
});

test('minute high is used only when the position existed before the bar began', () => {
  assert.equal(minuteHighIsEligible('2026-08-04T16:00:00.000Z', '2026-08-04T16:01:00.000Z'), true);
  assert.equal(minuteHighIsEligible('2026-08-04T16:01:30.000Z', '2026-08-04T16:01:00.000Z'), false);
});

test('mobile dashboard script compiles and includes stable mobile controls', () => {
  const html = tradingViewMobileDashboardHtml();
  assert.match(html, /class="bottomnav"/);
  assert.match(html, /Refresh & repair protection/);
  assert.match(html, /api\/tradingview\/refresh/);
  assert.match(html, /api\/tradingview\/repair/);
  assert.match(html, /api\/tradingview\/position\/close/);
  assert.match(html, /data-view="positions"/);
  assert.match(html, /Alerts, orders and protection events/);
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  assert.ok(scripts.length > 0);
  scripts.forEach((script) => assert.doesNotThrow(() => new Function(script)));
});

test('Cloudflare entry uses the reliable runtime and native Safari login', () => {
  const durable = readFileSync(join(root, 'worker/src/tradingview-only-durable-object.js'), 'utf8');
  const cloudflare = readFileSync(join(root, 'worker/src/tradingview-only-cloudflare-entry.js'), 'utf8');
  const mobileEntry = readFileSync(join(root, 'worker/src/tradingview-only-mobile-entry.js'), 'utf8');
  const reliable = readFileSync(join(root, 'worker/src/tradingview-only-runtime-reliable.js'), 'utf8');
  assert.match(durable, /tradingview-only-runtime-reliable\.js/);
  assert.match(durable, /repairProtection/);
  assert.match(cloudflare, /tradingview-only-mobile-entry\.js/);
  assert.match(mobileEntry, /\/api\/tradingview\/refresh/);
  assert.match(mobileEntry, /\/api\/tradingview\/repair/);
  assert.match(mobileEntry, /moe-safari-login-patch/);
  assert.match(mobileEntry, /moeNativeLoginForm/);
  assert.match(mobileEntry, /form\.method = 'post'/);
  assert.match(mobileEntry, /form\.action = '\/mobile\/unlock'/);
  assert.match(mobileEntry, /NATIVE_LOGIN_PATH = '\/mobile\/unlock'/);
  assert.match(mobileEntry, /status: 303/);
  assert.match(mobileEntry, /ctx\.waitUntil\(task\)/);
  assert.match(mobileEntry, /SameSite=Lax/);
  assert.doesNotMatch(mobileEntry, /SameSite=Strict/);
  assert.doesNotMatch(mobileEntry, /fetch\('\/api\/tradingview\/session'/);
  assert.match(mobileEntry, /Opening dashboard/);
  assert.match(reliable, /fetchHighSince/);
  assert.match(reliable, /TRAILING_STOP_CATCHUP_EXIT_REQUIRED/);
});
