import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startVisualDashboardHarness } from './visual-dashboard-harness.mjs';

const scenarios = [
  { name: 'long-desktop', scenario: 'long', width: 1440, height: 1100 },
  { name: 'long-mobile', scenario: 'long', width: 390, height: 844 },
  { name: 'short-tablet', scenario: 'short', width: 820, height: 1180 },
  { name: 'short-mobile', scenario: 'short', width: 390, height: 844 },
  { name: 'missing-desktop', scenario: 'missing', width: 1280, height: 900 },
  { name: 'missing-mobile', scenario: 'missing', width: 390, height: 844 },
];

function chromeBinary() {
  const configured = String(process.env.CHROME_BIN || '').trim();
  const candidates = [configured, '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].filter(Boolean);
  const found = candidates.find(existsSync);
  if (!found) throw new Error(`Chrome executable was not found. Checked: ${candidates.join(', ')}`);
  return found;
}

function wait(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

async function freePort() {
  const server = createNetServer();
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePromise);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : null;
  await new Promise((resolvePromise) => server.close(resolvePromise));
  if (!port) throw new Error('Could not allocate a Chrome debugging port.');
  return port;
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = new Map();
    socket.addEventListener('message', (message) => {
      const payload = JSON.parse(typeof message.data === 'string' ? message.data : String(message.data));
      if (payload.id) {
        const deferred = this.pending.get(payload.id);
        if (!deferred) return;
        this.pending.delete(payload.id);
        if (payload.error) deferred.reject(new Error(payload.error.message || 'CDP command failed'));
        else deferred.resolve(payload.result || {});
        return;
      }
      for (const listener of this.listeners.get(payload.method) || []) listener(payload.params || {});
    });
    socket.addEventListener('close', () => {
      for (const deferred of this.pending.values()) deferred.reject(new Error('Chrome DevTools connection closed.'));
      this.pending.clear();
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolvePromise, reject) => {
      this.pending.set(id, { resolve: resolvePromise, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  on(method, listener) {
    const listeners = this.listeners.get(method) || [];
    listeners.push(listener);
    this.listeners.set(method, listeners);
  }
}

async function connectCdp(webSocketDebuggerUrl) {
  const socket = new WebSocket(webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out opening Chrome DevTools WebSocket.')), 10_000);
    socket.addEventListener('open', () => { clearTimeout(timeout); resolvePromise(); }, { once: true });
    socket.addEventListener('error', (event) => { clearTimeout(timeout); reject(event.error || new Error('Chrome DevTools WebSocket failed.')); }, { once: true });
  });
  return new CdpClient(socket);
}

async function evaluate(client, expression) {
  const result = await client.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || 'Browser evaluation failed');
  return result.result?.value;
}

async function waitForDashboard(client, timeoutMs = 15_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const ready = await evaluate(client, `Boolean(
      document.getElementById('smartMoneyObservationPanel') &&
      document.getElementById('activePositionIntelligence') &&
      document.getElementById('portfolioRiskPanel') &&
      document.getElementById('conflictActivityPanel')
    )`).catch(() => false);
    if (ready) return;
    await wait(100);
  }
  throw new Error('Dashboard panels did not render before timeout.');
}

async function waitForPageTarget(port, processHandle, stderr, timeoutMs = 15_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
    if (processHandle.exitCode != null) throw new Error(`Chrome exited before DevTools became available (${processHandle.exitCode}).\n${stderr()}`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/list`);
      if (response.ok) {
        const targets = await response.json();
        const page = targets.find((item) => item.type === 'page' && item.webSocketDebuggerUrl);
        if (page) return page;
      }
    } catch (error) {
      lastError = error;
    }
    await wait(100);
  }
  throw new Error(`Chrome DevTools page target was unavailable. ${lastError?.message || ''}\n${stderr()}`);
}

async function launchBrowser(binary, profileDir) {
  const port = await freePort();
  const processHandle = spawn(binary, [
    '--headless=new',
    '--disable-gpu',
    '--disable-dev-shm-usage',
    '--no-sandbox',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderrText = '';
  processHandle.stderr.on('data', (chunk) => { stderrText += chunk.toString(); });
  const stderr = () => stderrText;
  const page = await waitForPageTarget(port, processHandle, stderr);
  const pageClient = await connectCdp(page.webSocketDebuggerUrl);
  return { processHandle, pageClient, stderr };
}

async function runScenario(client, origin, outputDir, definition) {
  const consoleErrors = [];
  const runtimeErrors = [];
  client.on('Runtime.consoleAPICalled', (event) => {
    if (event.type === 'error') consoleErrors.push(event.args?.map((item) => item.value || item.description || '').join(' '));
  });
  client.on('Runtime.exceptionThrown', (event) => runtimeErrors.push(event.exceptionDetails?.text || 'Runtime exception'));
  await Promise.all([
    client.send('Page.enable'),
    client.send('Runtime.enable'),
    client.send('Log.enable'),
    client.send('Emulation.setDeviceMetricsOverride', {
      width: definition.width,
      height: definition.height,
      deviceScaleFactor: 1,
      mobile: definition.width <= 520,
      screenWidth: definition.width,
      screenHeight: definition.height,
    }),
    client.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] }),
  ]);

  const url = `${origin}/dashboard?scenario=${encodeURIComponent(definition.scenario)}`;
  await client.send('Page.navigate', { url });
  await waitForDashboard(client);
  await wait(500);

  const audit = await evaluate(client, `(() => {
    const root = document.documentElement;
    const panels = ['smartMoneyObservationPanel','activePositionIntelligence','portfolioRiskPanel','conflictActivityPanel'];
    const missing = panels.filter((id) => !document.getElementById(id));
    const viewportOverflow = root.scrollWidth - root.clientWidth;
    const offenders = [...document.querySelectorAll('body *')]
      .filter((node) => {
        const rect = node.getBoundingClientRect();
        return rect.right > root.clientWidth + 2 || rect.left < -2;
      })
      .slice(0, 20)
      .map((node) => ({ tag: node.tagName, id: node.id, className: String(node.className || '').slice(0,120), right: Math.round(node.getBoundingClientRect().right) }));
    const buttons = [...document.querySelectorAll('button[data-gauge-id],button[data-symbol]')];
    const inaccessible = buttons.filter((button) => !button.getAttribute('aria-label') && !String(button.textContent || '').trim()).length;
    const reducedMotion = getComputedStyle(document.querySelector('.ti-gauge') || document.body).transitionDuration;
    const locks = [...document.body.textContent.matchAll(/OBSERVATION ONLY|Execution BLOCKED|PAPER TRADING/g)].length;
    return { missing, viewportOverflow, offenders, inaccessible, reducedMotion, locks, panelCount: panels.length - missing.length, buttonCount: buttons.length };
  })()`);

  assert.deepEqual(audit.missing, [], `${definition.name}: expected all four production panels.`);
  assert.ok(audit.viewportOverflow <= 2, `${definition.name}: horizontal viewport overflow ${audit.viewportOverflow}px; ${JSON.stringify(audit.offenders)}`);
  assert.equal(audit.inaccessible, 0, `${definition.name}: interactive controls require accessible labels or text.`);
  assert.ok(audit.locks >= 2, `${definition.name}: observation-only safety labels were not visible.`);
  assert.equal(runtimeErrors.length, 0, `${definition.name}: runtime errors: ${runtimeErrors.join(' | ')}`);
  assert.equal(consoleErrors.length, 0, `${definition.name}: console errors: ${consoleErrors.join(' | ')}`);

  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true, fromSurface: true });
  const screenshotPath = join(outputDir, `${definition.name}.png`);
  await import('node:fs/promises').then(({ writeFile }) => writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64')));
  return { ...definition, url, screenshot: screenshotPath, audit };
}

async function main() {
  const binary = chromeBinary();
  const outputDir = resolve(process.env.VISUAL_QA_OUTPUT || 'artifacts/dashboard-visual-qa');
  mkdirSync(outputDir, { recursive: true });
  const profileDir = mkdtempSync(join(tmpdir(), 'moerand-chrome-'));
  const harness = await startVisualDashboardHarness();
  let browser;
  try {
    browser = await launchBrowser(binary, profileDir);
    const report = [];
    for (const definition of scenarios) report.push(await runScenario(browser.pageClient, harness.origin, outputDir, definition));
    const reportPath = join(outputDir, 'report.json');
    await import('node:fs/promises').then(({ writeFile }) => writeFile(reportPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), binary, report }, null, 2)}\n`));
    console.log(`Visual dashboard QA passed for ${report.length} viewport/scenario combinations.`);
    for (const item of report) console.log(`${item.name}: ${item.width}x${item.height}, overflow=${item.audit.viewportOverflow}px, buttons=${item.audit.buttonCount}`);
  } finally {
    await harness.close().catch(() => {});
    if (browser?.processHandle) browser.processHandle.kill('SIGTERM');
    rmSync(profileDir, { recursive: true, force: true });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
