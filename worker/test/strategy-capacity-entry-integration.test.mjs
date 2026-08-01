import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const directory = dirname(fileURLToPath(import.meta.url));
const root = join(directory, '..', '..');
const entry = readFileSync(join(root, 'worker/src/sandbox-simulation-entry.js'), 'utf8');
const control = readFileSync(join(root, 'worker/src/trading-control/opportunity-sandbox-control.js'), 'utf8');
const capacity = readFileSync(join(root, 'worker/src/strategy/strategy-capacity.js'), 'utf8');
const registry = readFileSync(join(root, 'worker/src/strategy/strategy-registry.js'), 'utf8');

// Source-level integration guards complement the behavioral tests and protect the deployed
// entry-chain wiring that is difficult to exercise without a Miniflare Durable Object runtime.
test('deployed Sandbox AlertCoordinator overrides reservation lifecycle with strategy capacity wrappers', () => {
  assert.match(entry, /reserveStrategyOrderSubmission/);
  assert.match(entry, /finalizeStrategyOrderReservation/);
  assert.match(entry, /releaseStrategyOrderReservation/);
  assert.match(entry, /async reserveOrderSubmission\(payload = \{\}\)/);
  assert.match(entry, /async finalizeOrderReservation\(id, patch = \{\}\)/);
  assert.match(entry, /async releaseOrderReservation\(id, reason = 'RELEASED'\)/);
});

test('Opportunity Manager selections are filtered before and after persisted snapshot merge', () => {
  assert.match(entry, /applyStrategyCapacityToSelection\(selection, capacity\)/);
  assert.match(entry, /super\.recordOpportunitySelection\(incoming\.selection\)/);
  assert.match(entry, /applyStrategyCapacityToSelection\(merged\?\.opportunitySelection \|\| \{\}, capacity\)/);
  assert.match(entry, /createLiveScannerSnapshot\(persisted\.selection/);
  assert.match(entry, /LIVE_SCANNER_STORAGE_KEY/);
});

test('Trading Control passes strategy identity into reservation and broker signal context', () => {
  assert.match(control, /strategyIdFromRecord/);
  assert.match(control, /strategyId,/);
  assert.match(control, /sourceStrategy: strategyId/);
  assert.match(control, /blockerLayer: 'PER_STRATEGY'/);
  assert.match(control, /STRATEGY_MAX_DAILY_TRADES_REACHED/);
  assert.match(control, /globalPortfolioRiskBypassed: false/);
});

test('strategy layer is explicitly additive and preserves authoritative global risk gates', () => {
  assert.match(capacity, /never changes the global portfolio risk ceilings/i);
  assert.match(capacity, /globalPortfolioGatesRemainAuthoritative: true/);
  assert.match(capacity, /perStrategyLimitsCanBypass: false/);
  assert.match(registry, /portfolio-wide risk controls/);
  assert.match(registry, /longOnly: true/);
  assert.match(registry, /spotEquitiesOnly: true/);
});
