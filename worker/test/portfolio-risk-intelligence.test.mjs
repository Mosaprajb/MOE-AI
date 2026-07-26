import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPortfolioRiskIntelligence } from '../src/trading-intelligence/portfolio-risk.js';

const now = Date.parse('2026-07-26T15:00:00.000Z');

function accountSnapshot(overrides = {}) {
  return {
    fetchedAt: '2026-07-26T14:59:30.000Z',
    balance: {
      total_cash_balance: 25000,
      settled_cash: 24000,
      day_buying_power: 50000,
      overnight_buying_power: 25000,
      total_net_liquidation_value: 50000,
      maintenance_margin: 5000,
      margin_excess: 20000,
      open_margin_calls: [],
      ...overrides,
    },
    positions: [],
    readOnly: true,
  };
}

function openTrade(overrides = {}) {
  return {
    id: 'trade-1',
    symbol: 'AAPL',
    sector: 'TECHNOLOGY',
    direction: 'BUY',
    status: 'OPEN',
    entryPrice: 100,
    currentPrice: 102,
    stopLoss: 98,
    quantity: 100,
    filledQuantity: 100,
    risk: 200,
    unrealizedPnl: 200,
    protectionStatus: 'PROTECTED',
    lifecycleStatus: 'FILLED_PROTECTED',
    entryTime: '2026-07-26T14:00:00.000Z',
    ...overrides,
  };
}

function closedTrade(overrides = {}) {
  return {
    id: 'closed-1',
    symbol: 'MSFT',
    status: 'CLOSED',
    entryTime: '2026-07-26T13:00:00.000Z',
    exitTime: '2026-07-26T14:00:00.000Z',
    realizedPnl: -150,
    ...overrides,
  };
}

test('builds read-only portfolio metrics from account, trades, reservations, and lifecycle data', () => {
  const result = buildPortfolioRiskIntelligence({
    trades: [openTrade(), closedTrade()],
    reservations: [{ id: 'r1', symbol: 'NVDA', side: 'BUY', status: 'RESERVED', expiresAt: now + 60_000, notional: 1000, riskDollars: 50 }],
    lifecycleReport: { metrics: { protectedPositions: 1, unprotectedPositions: 0, attentionRequired: 0, marginExitWindow: 0, marginHardExitRequired: 0 } },
    accountSnapshot: accountSnapshot(),
    env: { MOE_MAX_DAILY_LOSS_DOLLARS: '500', MOE_MAX_OPEN_RISK_PERCENT: '2', MOE_MAX_SYMBOL_CONCENTRATION_PERCENT: '35' },
    now,
  });

  assert.equal(result.capitalData.source, 'WEBULL_SANDBOX_READ_ONLY');
  assert.equal(result.capital.dayBuyingPower, 50000);
  assert.equal(result.capital.deployedCapital, 10200);
  assert.equal(result.capital.reservedCapital, 1000);
  assert.equal(result.exposure.openRisk, 200);
  assert.equal(result.exposure.openRiskPercentEquity, 0.4);
  assert.equal(result.daily.realizedLoss, 150);
  assert.equal(result.daily.remainingLossCapacity, 350);
  assert.equal(result.protection.unprotectedPositions, 0);
  assert.equal(result.portfolioAcceptsNewRisk, true);
  assert.equal(result.newEntryPermission, false);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.automaticSubmissionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
});

test('blocks new portfolio risk when daily loss limit is reached', () => {
  const result = buildPortfolioRiskIntelligence({
    trades: [closedTrade({ realizedPnl: -600 })],
    accountSnapshot: accountSnapshot(),
    env: { MOE_MAX_DAILY_LOSS_DOLLARS: '500' },
    now,
  });
  assert.equal(result.status, 'CRITICAL');
  assert.ok(result.blockers.includes('DAILY_LOSS_LIMIT_REACHED'));
  assert.equal(result.portfolioAcceptsNewRisk, false);
});

test('blocks concentration and open-risk breaches independently', () => {
  const result = buildPortfolioRiskIntelligence({
    trades: [openTrade({ currentPrice: 200, quantity: 100, filledQuantity: 100, risk: 1500 })],
    accountSnapshot: accountSnapshot({ total_net_liquidation_value: 25000 }),
    env: { MOE_MAX_SYMBOL_CONCENTRATION_PERCENT: '50', MOE_MAX_OPEN_RISK_PERCENT: '2' },
    now,
  });
  assert.equal(result.exposure.symbolConcentrationPercent, 80);
  assert.equal(result.exposure.openRiskPercentEquity, 6);
  assert.ok(result.blockers.includes('SYMBOL_CONCENTRATION_LIMIT_EXCEEDED'));
  assert.ok(result.blockers.includes('OPEN_RISK_LIMIT_EXCEEDED'));
});

test('treats unprotected positions as a critical portfolio blocker', () => {
  const result = buildPortfolioRiskIntelligence({
    trades: [openTrade({ protectionStatus: 'UNPROTECTED', attentionRequired: true })],
    lifecycleReport: { metrics: { protectedPositions: 0, unprotectedPositions: 1, attentionRequired: 1, marginHardExitRequired: 0 } },
    accountSnapshot: accountSnapshot(),
    now,
  });
  assert.equal(result.status, 'CRITICAL');
  assert.ok(result.blockers.includes('UNPROTECTED_POSITION_EXISTS'));
  assert.ok(result.warnings.includes('LIFECYCLE_ATTENTION_REQUIRED'));
});

test('does not invent buying power or equity when capital data is unavailable', () => {
  const result = buildPortfolioRiskIntelligence({ trades: [], reservations: [], now });
  assert.equal(result.capitalData.source, 'UNAVAILABLE');
  assert.equal(result.capital.dayBuyingPower, null);
  assert.equal(result.capital.netLiquidation, null);
  assert.equal(result.exposure.openRiskPercentEquity, null);
  assert.ok(result.blockers.includes('CAPITAL_DATA_UNAVAILABLE'));
  assert.equal(result.portfolioAcceptsNewRisk, false);
});

test('uses stored capital-policy metrics as a truthful fallback', () => {
  const result = buildPortfolioRiskIntelligence({
    trades: [openTrade({
      capitalPolicy: {
        evaluatedAt: '2026-07-26T14:59:00.000Z',
        metrics: { cashBalance: 10000, settledCash: 9000, dayBuyingPower: 12000, overnightBuyingPower: 9000, netLiquidation: 15000 },
      },
    })],
    now,
  });
  assert.equal(result.capitalData.source, 'STORED_CAPITAL_POLICY');
  assert.equal(result.capital.dayBuyingPower, 12000);
  assert.equal(result.capital.netLiquidation, 15000);
});
