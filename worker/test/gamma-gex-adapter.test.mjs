import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GAMMA_GEX_ENGINE_ID,
  adaptGammaGexResult,
} from '../src/core/gamma-gex-adapter.js';

function observation(overrides = {}) {
  return {
    tradeDecision: 'SIGNAL',
    direction: 'BULLISH',
    gammaScore: 87,
    confidence: 83,
    symbol: 'SPY',
    regime: 'NEGATIVE_GAMMA',
    netGammaExposure: -2450000000,
    zeroGamma: 631.5,
    gammaFlip: 632,
    callWall: 640,
    putWall: 625,
    dealerPositioning: 'SHORT_GAMMA',
    dealerHedgingPressure: 'BUYING_PRESSURE',
    volatilityRegime: 'EXPANSION',
    pinRisk: { level: 635, score: 62 },
    squeezeRisk: { direction: 'UPSIDE', score: 74 },
    optionExpiry: '2026-07-31',
    sourceTimestamp: '2026-07-27T17:15:00.000Z',
    observedAt: '2026-07-27T17:15:01.000Z',
    evaluatedAt: '2026-07-27T17:15:02.000Z',
    dataQuality: { status: 'VALID', score: 92 },
    reasons: ['DEALER_HEDGING_SUPPORTS_UPSIDE'],
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
    mode: 'PAPER_TRADING',
    ...overrides,
  };
}

test('adapts bullish Gamma/GEX signal into accepted EngineResult', () => {
  const adapted = adaptGammaGexResult(observation(), { latencyMs: 8 });

  assert.equal(adapted.engineResult.engine, GAMMA_GEX_ENGINE_ID);
  assert.equal(adapted.engineResult.status, 'ACCEPTED');
  assert.equal(adapted.engineResult.latencyMs, 8);
  assert.equal(adapted.engineResult.signal.direction, 'LONG');
  assert.equal(adapted.engineResult.signal.score, 87);
  assert.equal(adapted.engineResult.signal.confidence.value, 83);
  assert.equal(adapted.engineResult.diagnostics.callWall, 640);
  assert.equal(adapted.engineResult.diagnostics.putWall, 625);
  assert.equal(adapted.engineResult.diagnostics.regime, 'NEGATIVE_GAMMA');
  assert.equal(adapted.opportunity, null);
});

test('normalizes bearish Gamma/GEX observations to SHORT', () => {
  const adapted = adaptGammaGexResult(observation({
    direction: 'BEARISH',
    gammaScore: 79,
    dealerHedgingPressure: 'SELLING_PRESSURE',
  }));

  assert.equal(adapted.engineResult.status, 'ACCEPTED');
  assert.equal(adapted.engineResult.signal.direction, 'SHORT');
  assert.equal(adapted.engineResult.signal.score, 79);
});

test('keeps balanced Gamma/GEX observations neutral without a signal', () => {
  const adapted = adaptGammaGexResult(observation({
    direction: 'BALANCED',
    gammaScore: 48,
  }));

  assert.equal(adapted.engineResult.status, 'NEUTRAL');
  assert.equal(adapted.engineResult.signal, null);
  assert.equal(adapted.opportunity, null);
});

test('maps ordinary NO_TRADE to neutral and rejected options data to rejected', () => {
  const neutral = adaptGammaGexResult({
    tradeDecision: 'NO_TRADE',
    direction: 'NEUTRAL',
    reason: 'NO_GAMMA_CONFIRMATION',
    executionAllowed: false,
    mode: 'PAPER_TRADING',
  });
  assert.equal(neutral.engineResult.status, 'NEUTRAL');
  assert.equal(neutral.engineResult.signal, null);

  const rejected = adaptGammaGexResult({
    tradeDecision: 'NO_TRADE',
    direction: 'NEUTRAL',
    reason: 'OPTIONS_DATA_REJECTED',
    diagnostics: { reasons: ['STALE_OPTIONS_CHAIN'] },
    executionAllowed: false,
    mode: 'PAPER_TRADING',
  });
  assert.equal(rejected.engineResult.status, 'REJECTED');
  assert.equal(rejected.engineResult.signal, null);
  assert.ok(rejected.engineResult.reasons.includes('STALE_OPTIONS_CHAIN'));
});

test('rejects execution-enabled and non-paper Gamma/GEX results', () => {
  assert.throws(
    () => adaptGammaGexResult(observation({ executionAllowed: true })),
    /rejects execution-enabled results/,
  );
  assert.throws(
    () => adaptGammaGexResult(observation({ automaticSubmissionAllowed: true })),
    /rejects execution-enabled results/,
  );
  assert.throws(
    () => adaptGammaGexResult(observation({ liveExecutionAllowed: true })),
    /rejects execution-enabled results/,
  );
  assert.throws(
    () => adaptGammaGexResult(observation({ mode: 'LIVE_TRADING' })),
    /PAPER_TRADING results only/,
  );
});

test('rejects unsupported Gamma/GEX decisions and directions', () => {
  assert.throws(
    () => adaptGammaGexResult(observation({ tradeDecision: 'ENTER_NOW' })),
    /Unsupported Gamma\/GEX tradeDecision/,
  );
  assert.throws(
    () => adaptGammaGexResult(observation({ direction: 'UP_ONLY' })),
    /Unsupported Gamma\/GEX direction/,
  );
});

test('clamps score and confidence into the Core Domain range', () => {
  const adapted = adaptGammaGexResult(observation({
    gammaScore: 140,
    confidence: -12,
  }));

  assert.equal(adapted.engineResult.signal.score, 100);
  assert.equal(adapted.engineResult.signal.confidence.value, 0);
});
