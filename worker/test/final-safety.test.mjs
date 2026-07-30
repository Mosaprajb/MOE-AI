import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(directory, '..', '..');
const raw = readFileSync(join(repositoryRoot, 'wrangler.jsonc'), 'utf8');
const config = JSON.parse(raw);
const vars = config.vars || {};

function numeric(name) {
  const value = Number(vars[name]);
  assert.ok(Number.isFinite(value), `${name} must be numeric`);
  return value;
}

test('protected live adapter is implemented but every activation switch remains hard-disabled', () => {
  assert.equal(vars.MOE_LIVE_EXECUTION_IMPLEMENTED, 'false');
  assert.equal(vars.MOE_LIVE_MODE_UNLOCKED, 'false');
  assert.equal(vars.WEBULL_LIVE_TRADING, 'false');
  assert.equal(vars.WEBULL_LIVE_ORDER_SUBMISSION, 'false');
  assert.equal(vars.WEBULL_LIVE_AUTOMATION_ARMED, 'false');
  assert.equal(vars.WEBULL_LIVE_KILL_SWITCH, 'true');
  assert.equal(vars.WEBULL_BOOTSTRAP_ENABLED, 'false');
  assert.equal(vars.MOE_DIRECTION_POLICY, 'LONG_ONLY');
  assert.equal(vars.MOE_ALLOW_SHORT_ENTRIES, 'false');
  assert.equal(vars.WEBULL_PROTECTED_ORDERS, 'true');
});

test('paper automation uses conservative portfolio and submission limits', () => {
  assert.ok(numeric('MOE_MAX_OPEN_POSITIONS') <= 4);
  assert.ok(numeric('MOE_MAX_DAILY_TRADES') <= 8);
  assert.ok(numeric('MOE_MAX_PORTFOLIO_RISK_PERCENT') <= 2);
  assert.ok(numeric('MOE_MAX_OPEN_RISK_PERCENT') <= 2);
  assert.ok(numeric('MOE_MAX_DAILY_LOSS_PERCENT') <= 2);
  assert.ok(numeric('AUTO_SCANNER_MAX_SUBMISSIONS_PER_RUN') <= 1);
  assert.ok(numeric('WEBULL_MAX_QUANTITY') <= 1);
  assert.ok(numeric('WEBULL_MAX_NOTIONAL') <= 1000);
});

test('observation universe remains broad while execution capacity stays narrow', () => {
  assert.equal(vars.SMART_MONEY_OBSERVATION_ENABLED, 'true');
  assert.ok(numeric('SMART_MONEY_OBSERVATION_LIMIT') >= 40);
  assert.ok(numeric('SMART_MONEY_OBSERVATION_TOP_RESULTS') >= 10);
  assert.equal(vars.SMT_DIVERGENCE_ENABLED, 'true');
  assert.equal(vars.SMART_MONEY_OBSERVATION_TIMEFRAME, '5m');
  assert.ok(numeric('AUTO_SCANNER_MAX_SUBMISSIONS_PER_RUN') < numeric('SMART_MONEY_OBSERVATION_LIMIT'));
});

test('portfolio telemetry freshness and concentration controls are explicit', () => {
  assert.ok(numeric('MOE_PORTFOLIO_ACCOUNT_STALE_SECONDS') <= 300);
  assert.ok(numeric('MOE_MAX_SYMBOL_CONCENTRATION_PERCENT') <= 35);
  assert.ok(numeric('MOE_MAX_SECTOR_EXPOSURE_PERCENT') <= 50);
  assert.ok(numeric('MOE_MAX_CORRELATED_POSITIONS') <= 2);
  assert.ok(numeric('MOE_MAX_SECTOR_POSITIONS') <= 2);
});