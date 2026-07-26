import test from 'node:test';
import assert from 'node:assert/strict';

const { createOrderFlowConfig } = await import('../src/order-flow/config.js');
const { normalizeOrderFlowData } = await import('../src/order-flow/normalization.js');
const { classifyAggressorSide } = await import('../src/order-flow/aggressor-classification.js');
const { buildVolumeAtPrice } = await import('../src/order-flow/volume-at-price.js');
const { buildOrderFlowSnapshot } = await import('../src/order-flow/snapshot.js');
const { replayInstitutionalFlow } = await import('../src/backtest/institutional-flow-replay.js');

const config = createOrderFlowConfig({
  validation: { maximumTradeReportDelayMs: 1000, minimumClassifiedVolumeShare: 0.5 },
  volumeAtPrice: { minimumVolumePerLevel: 10, imbalanceRatio: 2, minimumStackedLevels: 2 },
  replay: { minimumBars: 5, maximumLookbackBars: 20, orderFlowWindowBars: 2, candidateCooldownBars: 2, maximumHoldingBars: 3 },
});

function quote(t, bid, ask) {
  return { t, bp: bid, ap: ask, bs: 100, as: 100 };
}

function trade(t, price, size, extra = {}) {
  return { t, p: price, s: size, ...extra };
}

test('classifies aggressors with provider, quote, and uncertain modes without forcing ambiguity', () => {
  const now = 10_000;
  const normalized = normalizeOrderFlowData({
    trades: [
      trade(1000, 100.02, 10, { aggressorSide: 'BUY' }),
      trade(2000, 99.99, 20),
      trade(3000, 100.005, 15),
    ],
    quotes: [quote(1500, 99.99, 100.01), quote(2500, 100, 100.01)],
    now,
    tickSize: 0.01,
    config,
  });
  const classified = classifyAggressorSide({ normalized, config });
  assert.equal(classified.trades[0].classificationMethod, 'PROVIDER_FLAG');
  assert.equal(classified.trades[1].aggressorSide, 'SELL');
  assert.equal(classified.trades[1].classificationMethod, 'QUOTE_TEST');
  assert.ok(['BUY', 'SELL', 'UNCERTAIN'].includes(classified.trades[2].aggressorSide));
  assert.equal(classified.executionAllowed, false);
});

test('rejects delayed prints and crossed quotes before order-flow analysis', () => {
  const normalized = normalizeOrderFlowData({
    trades: [trade(1000, 100, 10, { receivedAt: 3000 })],
    quotes: [quote(1000, 100.05, 100.01)],
    now: 4000,
    config,
  });
  assert.equal(normalized.trades.length, 0);
  assert.ok(normalized.rejectedTrades[0].reasons.includes('DELAYED_TRADE_PRINT'));
  assert.equal(normalized.quotes.length, 0);
  assert.ok(normalized.rejectedQuotes[0].reasons.includes('CROSSED_OR_INVALID_QUOTE'));
});

test('builds stacked execution imbalance and a true order-flow snapshot', () => {
  const trades = [
    trade(1100, 100.00, 50, { aggressorSide: 'BUY' }),
    trade(1200, 100.00, 10, { aggressorSide: 'SELL' }),
    trade(1300, 100.01, 60, { aggressorSide: 'BUY' }),
    trade(1400, 100.01, 10, { aggressorSide: 'SELL' }),
  ];
  const normalized = normalizeOrderFlowData({ trades, quotes: [], now: 2000, config });
  const classified = classifyAggressorSide({ normalized, config });
  const profile = buildVolumeAtPrice({ classified, tickSize: 0.01, config });
  assert.equal(profile.bullishStackedLevels, 2);
  const snapshot = buildOrderFlowSnapshot({ trades, quotes: [], now: 2000, tickSize: 0.01, startPrice: 100, endPrice: 100.01, repeatedAttempts: 3, config });
  assert.equal(snapshot.dataMode, 'TRUE_ORDER_FLOW');
  assert.equal(snapshot.stackedLevels, 2);
  assert.equal(snapshot.aggressiveBuyVolume, 110);
  assert.equal(snapshot.executionAllowed, false);
});

test('historical replay exposes no future bars or trades to the evaluator', async () => {
  const bars = Array.from({ length: 9 }, (_, index) => ({
    t: 1000 + index * 1000,
    o: 100 + index * 0.1,
    h: 100.2 + index * 0.1,
    l: 99.8 + index * 0.1,
    c: 100.1 + index * 0.1,
    v: 1000,
  }));
  const trades = bars.map((bar, index) => trade(bar.t + 100, bar.c, 20, { aggressorSide: index % 2 ? 'BUY' : 'SELL' }));
  const seen = [];
  const evaluator = async ({ bars: visibleBars, now, orderFlow }) => {
    seen.push({ count: visibleBars.length, last: visibleBars.at(-1).t, now, orderFlow });
    const candidate = visibleBars.length === 5 ? {
      direction: 'LONG', entry: visibleBars.at(-1).c, stopLoss: visibleBars.at(-1).c - 0.5,
      takeProfit: visibleBars.at(-1).c + 0.3, rewardRisk: 0.6,
    } : null;
    return {
      pipelinePassed: Boolean(candidate), candidate, pipelineScore: candidate ? 80 : 0,
      direction: candidate?.direction || null, dataMode: orderFlow?.dataMode || 'INSUFFICIENT_DATA',
    };
  };
  const result = await replayInstitutionalFlow({ symbol: 'AAPL', bars, trades, quotes: [], timeframe: '5m', evaluator, orderFlowConfig: config });
  assert.ok(seen.length > 0);
  for (const call of seen) {
    assert.equal(call.now, call.last + 1);
    assert.ok(call.count <= bars.length - 1);
  }
  assert.equal(result.candidateCount, 1);
  assert.equal(result.events[0].signalIndex, 4);
  assert.equal(result.events[0].outcome.outcome, 'TARGET_REACHED');
  assert.equal(result.replayOnly, true);
  assert.equal(result.executionAllowed, false);
  assert.equal(result.liveExecutionAllowed, false);
});

test('order-flow safety locks cannot be disabled', () => {
  assert.throws(() => createOrderFlowConfig({ strategy: { executionAllowed: true } }), /safety locks/i);
});
