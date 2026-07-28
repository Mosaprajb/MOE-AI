import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProductionPortfolioRisk } from '../src/trading-intelligence/production-portfolio-risk.js';

const env = {
  MOE_MAX_OPEN_POSITIONS: '2',
  MOE_MAX_DAILY_TRADES: '4',
  MOE_MAX_DAILY_LOSS_PERCENT: '1',
  MOE_MAX_SYMBOL_CONCENTRATION_PERCENT: '35',
  MOE_MAX_SECTOR_EXPOSURE_PERCENT: '50',
  MOE_MAX_OPEN_RISK_PERCENT: '1',
  MOE_PORTFOLIO_ACCOUNT_STALE_SECONDS: '300',
  WEBULL_LIVE_API_BASE_URL: 'https://api.webull.com',
  WEBULL_LIVE_APP_KEY: 'key',
  WEBULL_LIVE_APP_SECRET: 'secret',
  WEBULL_LIVE_ACCESS_TOKEN: 'token',
};

const control = {
  liveTradingEnabled: true,
  effectiveLiveAutomationArmed: true,
  killSwitch: false,
};

const accountSnapshot = {
  accountId: '123456789',
  fetchedAt: new Date().toISOString(),
  balance: {
    total_cash_balance: '5000',
    day_buying_power: '9000',
    overnight_buying_power: '5000',
    total_net_liquidation_value: '10000',
  },
  positions: [
    {
      symbol: 'AAPL',
      position_quantity: '2',
      cost_price: '190',
      last_price: '195',
      market_value: '390',
      unrealized_profit_loss: '10',
    },
  ],
};

const openOrders = {
  orders: [
    { symbol: 'AAPL', side: 'SELL', combo_type: 'STOP_LOSS', order_type: 'STOP_LOSS', stop_price: '185' },
    { symbol: 'AAPL', side: 'SELL', combo_type: 'STOP_PROFIT', order_type: 'LIMIT', limit_price: '210' },
  ],
};

test('production risk uses broker positions and marks the production source', () => {
  const risk = buildProductionPortfolioRisk({ accountSnapshot, openOrders, control, env });
  assert.equal(risk.mode, 'LIVE');
  assert.equal(risk.accountEnvironment, 'PRODUCTION');
  assert.equal(risk.capitalData.source, 'WEBULL_PRODUCTION_READ_ONLY');
  assert.equal(risk.capitalData.accountIdMasked, '***6789');
  assert.equal(risk.exposure.openPositions, 1);
  assert.equal(risk.exposure.grossExposure, 390);
  assert.equal(risk.positions[0].symbol, 'AAPL');
  assert.equal(risk.positions[0].protectionStatus, 'PROTECTED');
  assert.equal(risk.positions[0].openRisk, 20);
});

test('sandbox trade history is not counted as live daily activity', () => {
  const risk = buildProductionPortfolioRisk({
    accountSnapshot,
    openOrders,
    control,
    env,
    trades: [{
      id: 'sandbox-old',
      symbol: 'TSLA',
      status: 'CLOSED',
      environment: 'sandbox',
      entryTime: new Date().toISOString(),
      exitTime: new Date().toISOString(),
      realizedPnl: -50,
    }],
  });
  assert.equal(risk.daily.entries, 0);
  assert.equal(risk.daily.closedTrades, 0);
  assert.equal(risk.daily.realizedPnl, 0);
});

test('production execution permission follows runtime and portfolio risk gates', () => {
  const risk = buildProductionPortfolioRisk({ accountSnapshot, openOrders, control, env });
  assert.equal(risk.executionAllowed, risk.portfolioAcceptsNewRisk);
  assert.equal(risk.automaticSubmissionAllowed, risk.portfolioAcceptsNewRisk);
  const locked = buildProductionPortfolioRisk({
    accountSnapshot,
    openOrders,
    control: { ...control, killSwitch: true, liveTradingEnabled: false },
    env,
  });
  assert.equal(locked.executionAllowed, false);
  assert.equal(locked.automaticSubmissionAllowed, false);
});
