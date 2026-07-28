import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateSessionRelativeVolume } from '../src/liquidity-sweep/normalization.js';
import { buildTradingIntelligenceSnapshot } from '../src/trading-intelligence/gauge-adapter.js';

const MINUTE = 60_000;

function candle(timestamp, volume, session = 'REGULAR') {
  return {
    timestamp,
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume,
    session,
    complete: true,
  };
}

function sameSlotHistory() {
  const slotUtcHour = 14;
  const slotUtcMinute = 15;
  const dates = ['2026-07-20', '2026-07-21', '2026-07-22', '2026-07-23'];
  const bars = [];
  for (let day = 0; day < dates.length; day += 1) {
    const base = Date.parse(`${dates[day]}T13:30:00.000Z`);
    for (let index = 0; index < 10; index += 1) {
      bars.push(candle(base + index * 5 * MINUTE, 1000 + day * 100 + index * 10));
    }
    bars.push(candle(Date.parse(`${dates[day]}T${String(slotUtcHour).padStart(2, '0')}:${String(slotUtcMinute).padStart(2, '0')}:00.000Z`), 1000 + day * 100));
  }
  bars.push(candle(Date.parse('2026-07-24T14:15:00.000Z'), 2600));
  return bars.sort((left, right) => left.timestamp - right.timestamp);
}

function sampleItem(dataQuality) {
  return {
    symbol: 'AAPL',
    timeframe: '5m',
    contextTimeframe: '1h',
    evaluatedAt: '2026-07-24T14:20:00.000Z',
    direction: 'BULLISH',
    pipelineScore: 70,
    pipelinePassed: false,
    failedStage: 'STRUCTURE_CONFIRMATION',
    reason: 'STRUCTURE_CONFIRMATION_STAGE_REJECTED',
    dataMode: 'PROXY_ABSORPTION',
    diagnostics: {
      smartMoneyScore: 70,
      liquiditySweepScore: 75,
      dataQuality,
    },
    stages: {
      STOP_RUN: { passed: true, status: 'PASSED', score: 75, direction: 'BULLISH', failedConditions: [] },
      ABSORPTION: { passed: true, status: 'PASSED', score: 72, direction: 'BULLISH', failedConditions: [] },
      IMBALANCE: { passed: true, status: 'PASSED', score: 70, direction: 'BULLISH', failedConditions: [] },
      STRUCTURE_CONFIRMATION: { passed: false, status: 'REJECTED', score: 40, direction: 'BULLISH', failedConditions: ['NO_CONFIRMED_STRUCTURE_EVENT'] },
      RISK_ENGINE: { passed: false, status: 'BLOCKED', score: 0, failedConditions: ['BLOCKED_BY_STRUCTURE_CONFIRMATION_STAGE'] },
    },
  };
}

test('calculates RVOL against the same exchange-time slot across prior sessions', () => {
  const result = calculateSessionRelativeVolume(sameSlotHistory(), { minimumSamples: 3, maximumSessions: 10 });
  assert.equal(result.available, true);
  assert.equal(result.method, 'SESSION_TIME_NORMALIZED');
  assert.equal(result.sampleCount, 4);
  assert.equal(result.session, 'REGULAR');
  assert.equal(result.slotMinutes, 10 * 60 + 15);
  assert.equal(result.baselineVolume, 1150);
  assert.equal(result.value, 2.2609);
  assert.equal(result.baselineDates.length, 4);
});

test('returns an explicit unavailable result when matching session history is insufficient', () => {
  const bars = [
    candle(Date.parse('2026-07-23T14:15:00.000Z'), 1000),
    candle(Date.parse('2026-07-24T14:15:00.000Z'), 1800),
  ];
  const result = calculateSessionRelativeVolume(bars, { minimumSamples: 3 });
  assert.equal(result.available, false);
  assert.equal(result.value, null);
  assert.equal(result.reason, 'INSUFFICIENT_SESSION_SLOT_HISTORY');
  assert.equal(result.sampleCount, 1);
});

test('RVOL gauge explains session normalization and fallback modes', () => {
  const sessionSnapshot = buildTradingIntelligenceSnapshot(sampleItem({
    accepted: true,
    score: 90,
    source: 'TEST',
    completedBars: 100,
    dataDelaySeconds: 5,
    relativeVolume: 2.25,
    relativeVolumeMethod: 'SESSION_TIME_NORMALIZED',
    relativeVolumeDetails: {
      available: true,
      fallbackUsed: false,
      sampleCount: 12,
      maximumSessions: 20,
      session: 'REGULAR',
      slotMinutes: 615,
      baselineVolume: 1000,
      latestVolume: 2250,
    },
  }));
  const sessionGauge = sessionSnapshot.gauges.find((gauge) => gauge.id === 'relative-volume');
  assert.equal(sessionGauge.status, 'CONFIRMED');
  assert.match(sessionGauge.summary, /Session-normalized RVOL/);
  assert.equal(sessionGauge.metadata.method, 'SESSION_TIME_NORMALIZED');
  assert.deepEqual(sessionGauge.confirmationReasons, ['SESSION_SLOT_BASELINE_AVAILABLE']);

  const fallbackSnapshot = buildTradingIntelligenceSnapshot(sampleItem({
    accepted: true,
    score: 80,
    source: 'TEST',
    completedBars: 30,
    dataDelaySeconds: 5,
    relativeVolume: 0.8,
    relativeVolumeMethod: 'RECENT_COMPLETED_CANDLE_LOOKBACK',
    relativeVolumeDetails: {
      available: false,
      fallbackUsed: true,
      fallbackReason: 'INSUFFICIENT_SESSION_SLOT_HISTORY',
      sampleCount: 1,
      requiredSamples: 3,
    },
  }));
  const fallbackGauge = fallbackSnapshot.gauges.find((gauge) => gauge.id === 'relative-volume');
  assert.equal(fallbackGauge.status, 'DEVELOPING');
  assert.match(fallbackGauge.summary, /fallback/);
  assert.ok(fallbackGauge.penalties.includes('INSUFFICIENT_SESSION_SLOT_HISTORY'));
  assert.equal(fallbackSnapshot.executionAllowed, false);
});
