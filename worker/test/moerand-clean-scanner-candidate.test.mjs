import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createMoerandCleanCandidate,
  moerandCleanScannerEnabled,
  moerandCleanSettingsFromEnv,
} from '../src/scanner/moerand-clean-candidate.js';

const start = Date.parse('2026-08-03T13:30:00.000Z');
const bars = [
  { t: start, o: 99, h: 101, l: 99, c: 100, v: 100 },
  { t: start + 300_000, o: 100, h: 100, l: 96, c: 97, v: 100 },
  { t: start + 600_000, o: 97, h: 103, l: 97, c: 102, v: 100 },
];

const env = {
  MOE_ACTIVE_STRATEGY: 'MOERAND_CLEAN_INTERNAL',
  MOERAND_CLEAN_KEY_VALUE: '1',
  MOERAND_CLEAN_ATR_PERIOD: '1',
  MOERAND_CLEAN_USE_HEIKIN_ASHI: 'false',
  MOERAND_CLEAN_TIMEFRAME_MINUTES: '5',
  MOERAND_CLEAN_SESSION_WINDOW: '0930-1600',
  MOERAND_CLEAN_SESSION_TIMEZONE: 'America/New_York',
  MOE_AI_MIN_RISK_REWARD: '2',
};

test('Clean scanner mode is explicit and its settings use the selected 1-15 minute timeframe', () => {
  assert.equal(moerandCleanScannerEnabled(env), true);
  assert.equal(moerandCleanScannerEnabled({ MOE_ACTIVE_STRATEGY: 'FUSION_V2' }), false);
  const settings = moerandCleanSettingsFromEnv(env, 15);
  assert.equal(settings.timeframeMinutes, 15);
  assert.equal(settings.keyValue, 1);
  assert.equal(settings.atrPeriod, 1);
});

test('scanner candidate appears only after the UT Bot BUY candle has closed', () => {
  const profile = { primaryMinutes: 5, higherMinutes: 60 };
  const beforeClose = createMoerandCleanCandidate({
    symbol: 'AAPL',
    bars,
    now: bars[2].t + 300_000 - 1,
    profile,
    env,
  });
  assert.equal(beforeClose, null);

  const candidate = createMoerandCleanCandidate({
    symbol: 'AAPL',
    bars,
    now: bars[2].t + 300_000,
    profile,
    env,
  });
  assert.equal(candidate.symbol, 'AAPL');
  assert.equal(candidate.sourceStrategy, 'MOERAND_CLEAN_INTERNAL');
  assert.equal(candidate.signalTiming, 'CANDLE_CLOSE_ONLY');
  assert.equal(candidate.entry, 102);
  assert.ok(candidate.stopLoss < candidate.entry);
  assert.ok(candidate.takeProfit > candidate.entry);
});
