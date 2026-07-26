const DEFAULTS = Object.freeze({
  strategy: Object.freeze({
    version: '1.0.0-alpha.1',
    mode: 'PAPER_TRADING',
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  }),
  validation: Object.freeze({
    maximumQuoteAgeMs: 2_000,
    maximumTradeReportDelayMs: 3_000,
    maximumFutureSkewMs: 100,
    maximumSpreadPercent: 0.75,
    minimumTradeSize: 1,
    minimumPrice: 0.01,
    minimumClassifiedVolumeShare: 0.6,
  }),
  classification: Object.freeze({
    quoteToleranceTicks: 0.25,
    allowTickTestFallback: true,
    providerFlagConfidence: 0.98,
    quoteTestConfidence: 0.9,
    tickTestConfidence: 0.65,
  }),
  volumeAtPrice: Object.freeze({
    minimumVolumePerLevel: 100,
    imbalanceRatio: 3,
    minimumStackedLevels: 2,
    maximumLevels: 500,
  }),
  replay: Object.freeze({
    minimumBars: 80,
    maximumLookbackBars: 500,
    orderFlowWindowBars: 3,
    candidateCooldownBars: 12,
    maximumHoldingBars: 48,
  }),
});

function merge(base, override) {
  return Object.freeze({ ...base, ...(override || {}) });
}

function finiteRange(value, minimum, maximum, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
}

export function createOrderFlowConfig(overrides = {}) {
  const config = Object.freeze({
    strategy: merge(DEFAULTS.strategy, overrides.strategy),
    validation: merge(DEFAULTS.validation, overrides.validation),
    classification: merge(DEFAULTS.classification, overrides.classification),
    volumeAtPrice: merge(DEFAULTS.volumeAtPrice, overrides.volumeAtPrice),
    replay: merge(DEFAULTS.replay, overrides.replay),
  });

  if (config.strategy.mode !== 'PAPER_TRADING'
    || config.strategy.observationOnly !== true
    || config.strategy.executionAllowed !== false
    || config.strategy.automaticSubmissionAllowed !== false
    || config.strategy.liveExecutionAllowed !== false) {
    throw new Error('Order Flow safety locks cannot be disabled');
  }

  finiteRange(config.validation.maximumQuoteAgeMs, 0, 60_000, 'validation.maximumQuoteAgeMs');
  finiteRange(config.validation.maximumTradeReportDelayMs, 0, 300_000, 'validation.maximumTradeReportDelayMs');
  finiteRange(config.validation.maximumSpreadPercent, 0, 20, 'validation.maximumSpreadPercent');
  finiteRange(config.validation.minimumClassifiedVolumeShare, 0, 1, 'validation.minimumClassifiedVolumeShare');
  finiteRange(config.classification.quoteToleranceTicks, 0, 5, 'classification.quoteToleranceTicks');
  finiteRange(config.volumeAtPrice.imbalanceRatio, 1, 100, 'volumeAtPrice.imbalanceRatio');
  finiteRange(config.replay.minimumBars, 3, 10_000, 'replay.minimumBars');
  finiteRange(config.replay.maximumLookbackBars, config.replay.minimumBars, 50_000, 'replay.maximumLookbackBars');
  return config;
}
