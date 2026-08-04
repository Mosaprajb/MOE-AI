import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  readHistoricalSimulationReport,
  startHistoricalSimulation,
  stopHistoricalSimulation,
  tickHistoricalSimulation,
} from '../src/simulation/simulation-engine.js';
import {
  SIMULATION_STRATEGIES,
  normalizeSimulationStrategies,
  runSimulationStrategies,
} from '../src/simulation/simulation-strategies.js';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');
const marketScreenerEntrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-market-screener-entry.js'), 'utf8');
const liveWatchlistEntrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-live-watchlist-entry.js'), 'utf8');
const cleanEntrySource = readFileSync(join(root, 'worker/src/sandbox-moerand-clean-utbot-entry.js'), 'utf8');
const mobileAccountEntrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-account-balances-entry.js'), 'utf8');
const mobileAccountImplementationSource = readFileSync(join(root, 'worker/src/sandbox-mobile-account-balances-implementation.js'), 'utf8');
const mobilePhoneEntrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-phone-fix-entry.js'), 'utf8');
const mobileFinalEntrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-final-entry.js'), 'utf8');
const mobileRuntimeEntrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-runtime-fix-entry.js'), 'utf8');
const mobileSettingsEntrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-settings-entry.js'), 'utf8');
const mobileUiFixEntrySource = readFileSync(join(root, 'worker/src/sandbox-mobile-ui-fix-entry.js'), 'utf8');
const scanModeEntrySource = readFileSync(join(root, 'worker/src/sandbox-scan-mode-entry.js'), 'utf8');
const entrySource = readFileSync(join(root, 'worker/src/sandbox-simulation-entry.js'), 'utf8');
const rpcEntrySource = readFileSync(join(root, 'worker/src/sandbox-simulation-rpc-entry.js'), 'utf8');
const engineSource = readFileSync(join(root, 'worker/src/simulation/simulation-engine.js'), 'utf8');
const strategySource = readFileSync(join(root, 'worker/src/simulation/simulation-strategies.js'), 'utf8');
const dashboardSource = readFileSync(join(root, 'worker/src/simulation/simulation-dashboard.js'), 'utf8');
const config = JSON.parse(readFileSync(join(root, 'wrangler.sandbox.jsonc'), 'utf8'));

function memoryStorage() {
  const values = new Map();
  return {
    async get(key) { return values.get(key); },
    async put(key, value) {
      if (key && typeof key === 'object' && !Array.isArray(key)) {
        for (const [itemKey, itemValue] of Object.entries(key)) values.set(itemKey, itemValue);
        return;
      }
      values.set(key, value);
    },
  };
}

function completedHistoricalBars() {
  const today = new Date();
  const session = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - 5, 14, 30));
  return Array.from({ length: 78 }, (_, index) => {
    const price = 100 + index * 0.12 + Math.sin(index / 3) * 0.2;
    return {
      t: new Date(session.getTime() + index * 300_000).toISOString(),
      o: price,
      h: price + 0.25,
      l: price - 0.2,
      c: price + 0.1,
      v: 10_000 + index * 100,
    };
  });
}

function localBars() {
  const start = Date.UTC(2026, 6, 30, 13, 30);
  return Array.from({ length: 80 }, (_, index) => {
    const close = 100 + index * 0.08 + Math.sin(index / 2) * 0.4;
    return {
      t: start + index * 300_000,
      o: close - 0.1,
      h: close + 0.25,
      l: close - 0.25,
      c: close,
      v: 5_000 + index * 100,
    };
  });
}

test('strategy selection is per-run, validated, and independently represented', async () => {
  const selected = normalizeSimulationStrategies([
    SIMULATION_STRATEGIES.FUSION_V2,
    SIMULATION_STRATEGIES.MOERAND_SIMPLE_INTERNAL,
  ]);
  assert.deepEqual(selected, ['FUSION_V2', 'MOERAND_SIMPLE_INTERNAL']);
  assert.throws(() => normalizeSimulationStrategies([]), /Select at least one/);

  const execution = await runSimulationStrategies({
    selectedStrategies: selected,
    symbol: 'SPY',
    bars: localBars(),
    strategyState: {},
    env: {
      AUTO_SCANNER_ENGINE_MIN_SCORE: '68',
      MOE_AI_MIN_SCORE_CORE: '68',
      MOE_AI_MIN_RISK_REWARD: '2',
    },
    simulatedAt: localBars().at(-1).t,
  });
  assert.deepEqual(execution.results.map((item) => item.strategy), selected);
  assert.ok(Object.hasOwn(execution.strategyState, 'FUSION_V2:SPY'));
  assert.ok(Object.hasOwn(execution.strategyState, 'MOERAND_SIMPLE_INTERNAL:SPY'));
});

test('historical replay fetches Alpaca only and produces permanently labelled simulation state/report', async () => {
  const storage = memoryStorage();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input) => {
    calls.push(String(input));
    return Response.json({ bars: completedHistoricalBars() }, { status: 200 });
  };

  try {
    const started = await startHistoricalSimulation(storage, {
      ALPACA_KEY_ID: 'test-alpaca-key',
      ALPACA_SECRET_KEY: 'test-alpaca-secret',
      MOE_SIMULATION_SYMBOLS: 'SPY,QQQ',
      AUTO_SCANNER_ENGINE_MIN_SCORE: '68',
      MOE_AI_MIN_SCORE_CORE: '68',
      MOE_AI_MIN_RISK_REWARD: '2',
    }, {
      strategies: ['MOERAND_SIMPLE_INTERNAL'],
      range: 'LAST_SESSION',
      speedMultiplier: 300,
    });

    assert.equal(started.active, true);
    assert.equal(started.mode, 'SIMULATION');
    assert.equal(started.notRealMarketData, true);
    assert.deepEqual(started.selectedStrategies, ['MOERAND_SIMPLE_INTERNAL']);
    assert.equal(started.speedMultiplier, 300);
    assert.equal(started.tickIntervalMs, 1000);
    assert.ok(calls.length >= 2);
    assert.ok(calls.every((url) => new URL(url).host === 'data.alpaca.markets'));
    assert.ok(calls.every((url) => !url.includes('webull')));

    const ticked = await tickHistoricalSimulation(storage, {});
    assert.equal(ticked.active, true);
    assert.equal(ticked.broker, 'LOCAL_SIMULATOR_NO_WEBULL');
    assert.equal(ticked.webullRequestsMade, 0);

    const stopped = await stopHistoricalSimulation(storage);
    assert.equal(stopped.active, false);
    assert.equal(stopped.status, 'STOPPED');
    assert.equal(stopped.mode, 'SANDBOX_DISARMED');

    const report = await readHistoricalSimulationReport(storage);
    assert.equal(report.mode, 'SIMULATION');
    assert.equal(report.simulation, true);
    assert.equal(report.notRealMarketData, true);
    assert.equal(report.historicalDataOnly, true);
    assert.equal(report.broker, 'LOCAL_SIMULATOR_NO_WEBULL');
    assert.equal(report.webullRequestsMade, 0);
    assert.deepEqual(report.selectedStrategies, ['MOERAND_SIMPLE_INTERNAL']);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('source safety prevents Webull access, live execution, and browser secret persistence', () => {
  assert.equal(engineSource.includes('webull-client'), false);
  assert.equal(engineSource.includes('webull-sandbox'), false);
  assert.equal(strategySource.includes('webull-client'), false);
  assert.equal(strategySource.includes('webull-sandbox'), false);
  assert.match(engineSource, /LOCAL_SIMULATOR_NO_WEBULL/);
  assert.match(entrySource, /REAL_SANDBOX_PILOT_MUST_BE_DISARMED/);
  assert.match(entrySource, /SIMULATION_MODE_ACTIVE/);
  assert.match(entrySource, /realSandboxScannerExecuted: false/);
  assert.match(entrySource, /WEBULL_LIVE_KILL_SWITCH/);
  assert.equal(entrySource.includes('WEBULL_LIVE_TRADING = true'), false);
  assert.equal(entrySource.includes('MOE_SANDBOX_PILOT_ENABLED = true'), false);
  assert.equal(dashboardSource.includes('localStorage'), false);
  assert.equal(dashboardSource.includes('sessionStorage'), false);
  assert.equal(dashboardSource.includes('MOE_WEBHOOK_SECRET'), false);
  assert.match(dashboardSource, /SIMULATION MODE — NOT REAL MARKET DATA/);
  assert.match(entrySource, /HttpOnly; Secure; SameSite=Strict/);
});

test('SimulationDriver RPC export inherits from the Cloudflare DurableObject base class', () => {
  assert.match(rpcEntrySource, /import \{ DurableObject \} from 'cloudflare:workers'/);
  assert.match(rpcEntrySource, /export class SimulationDriver extends DurableObject/);
  assert.match(rpcEntrySource, /super\(ctx, env\)/);
  assert.match(rpcEntrySource, /this\.#core = new SimulationDriverCore\(ctx, env\)/);
});

test('Sandbox configuration keeps Pilot disarmed and every Live gate locked', () => {
  assert.equal(config.main, 'worker/src/sandbox-mobile-market-screener-resilient-entry.js');
  assert.match(marketScreenerEntrySource, /from '\.\/sandbox-mobile-live-watchlist-entry\.js'/);
  assert.match(marketScreenerEntrySource, /liveTradingLocked: true/);
  assert.match(marketScreenerEntrySource, /liveFundsUsed: false/);
  assert.match(liveWatchlistEntrySource, /from '\.\/sandbox-moerand-clean-utbot-entry\.js'/);
  assert.match(liveWatchlistEntrySource, /liveTradingLocked: true/);
  assert.match(liveWatchlistEntrySource, /liveFundsUsed: false/);
  assert.match(cleanEntrySource, /from '\.\/sandbox-mobile-account-balances-entry\.js'/);
  assert.match(mobileAccountEntrySource, /from '\.\/sandbox-mobile-account-balances-implementation\.js'/);
  assert.match(mobileAccountImplementationSource, /from '\.\/sandbox-mobile-phone-fix-entry\.js'/);
  assert.match(mobileAccountImplementationSource, /WEBULL_LIVE_TRADING: 'false'/);
  assert.match(mobileAccountImplementationSource, /WEBULL_LIVE_ORDER_SUBMISSION: 'false'/);
  assert.match(mobileAccountImplementationSource, /WEBULL_LIVE_AUTOMATION_ARMED: 'false'/);
  assert.match(mobileAccountImplementationSource, /WEBULL_LIVE_KILL_SWITCH: 'true'/);
  assert.equal(mobileAccountImplementationSource.includes('placeWebullSandboxOrder'), false);
  assert.equal(marketScreenerEntrySource.includes('placeWebullSandboxOrder'), false);
  assert.match(mobilePhoneEntrySource, /from '\.\/sandbox-mobile-final-entry\.js'/);
  assert.match(mobileFinalEntrySource, /from '\.\/sandbox-mobile-runtime-fix-entry\.js'/);
  assert.match(mobileRuntimeEntrySource, /from '\.\/sandbox-mobile-settings-entry\.js'/);
  assert.match(mobileSettingsEntrySource, /from '\.\/sandbox-mobile-ui-fix-entry\.js'/);
  assert.match(mobileUiFixEntrySource, /from '\.\/sandbox-scan-mode-entry\.js'/);
  assert.match(scanModeEntrySource, /from '\.\/sandbox-simulation-rpc-entry\.js'/);
  assert.equal(config.vars.MOE_SIMULATION_ENABLED, 'true');
  assert.equal(config.vars.MOE_SANDBOX_PILOT_ENABLED, 'false');
  assert.equal(config.vars.MOE_LIVE_MODE_UNLOCKED, 'false');
  assert.equal(config.vars.MOE_LIVE_EXECUTION_IMPLEMENTED, 'false');
  assert.equal(config.vars.WEBULL_LIVE_TRADING, 'false');
  assert.equal(config.vars.WEBULL_LIVE_ORDER_SUBMISSION, 'false');
  assert.equal(config.vars.WEBULL_LIVE_AUTOMATION_ARMED, 'false');
  assert.equal(config.vars.WEBULL_LIVE_KILL_SWITCH, 'true');
  assert.equal(config.secrets.required.includes('MOE_SIMULATION_CONTROL_PIN'), false);
});
