import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

const wranglerUrl = new URL('../../wrangler.jsonc', import.meta.url);
const schedulerUrl = new URL('../src/smart-scheduler-entry.js', import.meta.url);
const controllerUrl = new URL('../src/trading-mode-control-v2-entry.js', import.meta.url);
const dashboardBridgeUrl = new URL('../src/trading-dashboard-entry.js', import.meta.url);
const tradingModeUrl = new URL('../src/trading-mode-entry.js', import.meta.url);

function source(url) {
  return readFileSync(url, 'utf8').replace(/\r\n?/g, '\n');
}

test('Cloudflare production entry chain resolves through the dashboard compatibility entry', () => {
  const wrangler = source(wranglerUrl);
  const scheduler = source(schedulerUrl);
  const controller = source(controllerUrl);
  const bridge = source(dashboardBridgeUrl);

  assert.match(wrangler, /"main"\s*:\s*"worker\/src\/smart-scheduler-entry\.js"/);
  assert.match(scheduler, /from '\.\/trading-mode-control-v2-entry\.js'/);
  assert.match(controller, /from '\.\/trading-dashboard-entry\.js'/);
  assert.equal(existsSync(dashboardBridgeUrl), true);
  assert.equal(existsSync(tradingModeUrl), true);
  assert.match(bridge, /export \{ AlertCoordinator \} from '\.\/trading-mode-entry\.js'/);
  assert.match(bridge, /export \{ default \} from '\.\/trading-mode-entry\.js'/);
});
