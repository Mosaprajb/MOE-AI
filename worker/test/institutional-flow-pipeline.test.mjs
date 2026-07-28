import test from 'node:test';
import assert from 'node:assert/strict';

const { createInstitutionalFlowConfig, INSTITUTIONAL_FLOW_STAGE_ORDER } = await import('../src/institutional-flow/config.js');
const { evaluateStopRunStage } = await import('../src/institutional-flow/stop-run.js');
const { evaluateAbsorptionStage } = await import('../src/institutional-flow/absorption.js');
const { evaluateImbalanceStage } = await import('../src/institutional-flow/imbalance.js');
const { evaluateStructureConfirmationStage } = await import('../src/institutional-flow/structure-confirmation.js');
const { evaluateInstitutionalRiskStage } = await import('../src/institutional-flow/risk-engine.js');

const config = createInstitutionalFlowConfig({
  stopRun: { minimumScore: 60, minimumLevelQuality: 60, minimumRejectionScore: 50 },
  absorption: { minimumTrueOrderFlowScore: 60, minimumProxyScore: 60, minimumRelativeVolume: 1 },
  imbalance: { minimumScore: 50, minimumDisplacementScore: 50 },
  structure: { minimumQualityScore: 60, requirePostEventConfirmation: false },
  risk: { minimumRewardRisk: 2, maximumStopAtr: 3 },
});

function liquidityCandidate() {
  return {
    tradeDecision: 'PAPER_CANDIDATE',
    liquiditySweepScore: 84,
    sweepClassification: 'CONFIRMED_REVERSAL_SWEEP',
    liquiditySweep: {
      sweepId: 'sweep-1', direction: 'LONG', reclaimed: true, detectedAt: 1000,
      rejectionScore: 78, acceptanceScore: 22, penetrationAtr: 0.45,
      extremePrice: 99.5, reclaimCandles: 0, wickToBodyRatio: 3, closeLocation: 0.85,
    },
    liquidityPool: {
      poolId: 'pool-1', type: 'EQUAL_LOWS', referencePrice: 100,
      zoneLower: 99.95, zoneUpper: 100.02, importanceScore: 82,
    },
  };
}

function snapshot() {
  return {
    latest: { open: 100.1, high: 100.5, low: 99.45, close: 100.4 },
    atr: 0.7,
    tickSize: 0.01,
    relativeVolume: 2.1,
    spreadPercent: 0.04,
  };
}

function smartMoneyResult() {
  return {
    reason: 'SMART_MONEY_FOUNDATION_OBSERVATION_ONLY',
    details: {
      fairValueGaps: {
        active: [{
          gapId: 'gap-1', direction: 'BULLISH', lower: 100.05, upper: 100.2,
          midpoint: 100.125, fillPercent: 0.1, mitigationCount: 0, state: 'ACTIVE',
          invalidationLevel: 100.05, displacementScore: 82, displacementId: 'disp-1',
          sizeAtr: 0.35, structuralOriginId: 'structure-1',
        }],
      },
      structure: {
        currentBias: 'BULLISH',
        events: [{
          eventId: 'structure-1', eventType: 'MARKET_STRUCTURE_SHIFT', direction: 'BULLISH',
          scope: 'EXTERNAL', level: 100.1, close: 100.4, confirmedAt: 2000,
          qualityScore: 86, evidence: ['CANDLE_CLOSE_BEYOND_CONFIRMED_SWING'],
        }],
      },
      riskEvaluation: {
        observationAccepted: true, direction: 'BULLISH', entry: 100.12, stop: 99.48,
        target: 101.55, riskPerShare: 0.64, rewardPerShare: 1.43,
        rewardRisk: 2.234, stopAtr: 0.914, failedConditions: [],
      },
      positionSizing: { analyticalOnly: true, quantity: 100, executionAllowed: false },
    },
  };
}

test('locks the required institutional stage order and safety invariants', () => {
  assert.deepEqual(INSTITUTIONAL_FLOW_STAGE_ORDER, ['STOP_RUN', 'ABSORPTION', 'IMBALANCE', 'STRUCTURE_CONFIRMATION', 'RISK_ENGINE']);
  assert.equal(config.strategy.mode, 'PAPER_TRADING');
  assert.equal(config.strategy.executionAllowed, false);
  assert.throws(() => createInstitutionalFlowConfig({ strategy: { liveExecutionAllowed: true } }), /safety locks/i);
});

test('blocks every later stage when stop run is not confirmed', () => {
  const stopRun = evaluateStopRunStage({ liquiditySweepResult: { tradeDecision: 'NO_TRADE' }, config });
  const absorption = evaluateAbsorptionStage({ stopRun, snapshot: snapshot(), config });
  const imbalance = evaluateImbalanceStage({ absorption, smartMoneyResult: smartMoneyResult(), config });
  const structure = evaluateStructureConfirmationStage({ imbalance, smartMoneyResult: smartMoneyResult(), config });
  const risk = evaluateInstitutionalRiskStage({ structureConfirmation: structure, smartMoneyResult: smartMoneyResult(), snapshot: snapshot(), config });
  assert.equal(stopRun.passed, false);
  assert.equal(absorption.reason, 'BLOCKED_BY_STOP_RUN_STAGE');
  assert.equal(imbalance.reason, 'BLOCKED_BY_ABSORPTION_STAGE');
  assert.equal(structure.reason, 'BLOCKED_BY_IMBALANCE_STAGE');
  assert.equal(risk.reason, 'BLOCKED_BY_STRUCTURE_CONFIRMATION_STAGE');
});

test('classifies true order-flow absorption without mixing it with proxy mode', () => {
  const stopRun = evaluateStopRunStage({ liquiditySweepResult: liquidityCandidate(), config });
  const absorption = evaluateAbsorptionStage({
    stopRun,
    snapshot: snapshot(),
    orderFlow: {
      aggressiveBuyVolume: 120000,
      aggressiveSellVolume: 420000,
      delta: -300000,
      repeatedAttempts: 4,
      priceProgress: 0.12,
      classificationConfidence: 0.93,
    },
    config,
  });
  assert.equal(stopRun.passed, true);
  assert.equal(absorption.passed, true);
  assert.equal(absorption.absorptionMode, 'TRUE_ORDER_FLOW_ABSORPTION');
  assert.equal(absorption.classification, 'CONFIRMED_ABSORPTION');
  assert.equal(absorption.executionAllowed, false);
});

test('uses explicit proxy absorption when only OHLCV context exists', () => {
  const stopRun = evaluateStopRunStage({ liquiditySweepResult: liquidityCandidate(), config });
  const absorption = evaluateAbsorptionStage({ stopRun, snapshot: snapshot(), config });
  assert.equal(absorption.absorptionMode, 'PROXY_ABSORPTION');
  assert.equal(absorption.passed, true);
  assert.notEqual(absorption.classification, 'CONFIRMED_ABSORPTION');
});

test('passes imbalance then structure then risk in strict order without enabling execution', () => {
  const stopRun = evaluateStopRunStage({ liquiditySweepResult: liquidityCandidate(), config });
  const absorption = evaluateAbsorptionStage({ stopRun, snapshot: snapshot(), config });
  const imbalance = evaluateImbalanceStage({ absorption, smartMoneyResult: smartMoneyResult(), config });
  const structure = evaluateStructureConfirmationStage({ imbalance, smartMoneyResult: smartMoneyResult(), config });
  const risk = evaluateInstitutionalRiskStage({ structureConfirmation: structure, smartMoneyResult: smartMoneyResult(), snapshot: snapshot(), config });
  assert.equal(imbalance.passed, true);
  assert.equal(imbalance.category, 'PRICE_IMBALANCE');
  assert.equal(structure.passed, true);
  assert.equal(structure.event.eventType, 'MARKET_STRUCTURE_SHIFT');
  assert.equal(risk.passed, true);
  assert.equal(risk.observationAccepted, true);
  assert.equal(risk.executionAllowed, false);
  assert.equal(risk.automaticSubmissionAllowed, false);
  assert.equal(risk.liveExecutionAllowed, false);
});

test('risk rejects a valid structure when reward-to-risk is inefficient', () => {
  const result = smartMoneyResult();
  result.details.riskEvaluation.rewardRisk = 1.2;
  result.details.riskEvaluation.observationAccepted = false;
  result.details.riskEvaluation.failedConditions = ['REWARD_RISK_BELOW_MINIMUM'];
  const risk = evaluateInstitutionalRiskStage({
    structureConfirmation: { passed: true, direction: 'BULLISH' },
    smartMoneyResult: result,
    snapshot: snapshot(),
    config,
  });
  assert.equal(risk.passed, false);
  assert.ok(risk.failedConditions.includes('REWARD_RISK_BELOW_PIPELINE_MINIMUM'));
});
