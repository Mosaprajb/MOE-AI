export const INSTITUTIONAL_FLOW_STAGE_ORDER = Object.freeze([
  'STOP_RUN',
  'ABSORPTION',
  'IMBALANCE',
  'STRUCTURE_CONFIRMATION',
  'RISK_ENGINE',
]);

const DEFAULT_CONFIG = Object.freeze({
  strategy: Object.freeze({
    name: 'MOERAND_INSTITUTIONAL_FLOW',
    version: '1.0.0-alpha.1',
    mode: 'PAPER_TRADING',
    observationOnly: true,
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  }),
  stopRun: Object.freeze({
    minimumScore: 70,
    minimumLevelQuality: 65,
    minimumRejectionScore: 55,
    maximumAcceptanceScore: 55,
    minimumPenetrationAtr: 0.05,
    maximumReversalPenetrationAtr: 2.5,
    requireReclaim: true,
  }),
  absorption: Object.freeze({
    minimumTrueOrderFlowScore: 68,
    minimumProxyScore: 74,
    minimumClassificationConfidence: 0.7,
    minimumRepeatedAttempts: 2,
    minimumRelativeVolume: 1.15,
    minimumWickToBodyRatio: 1.4,
    minimumDirectionalCloseLocation: 0.6,
    maximumProxyEfficiency: 1.25,
    exhaustionRelativeVolume: 0.8,
  }),
  imbalance: Object.freeze({
    minimumScore: 68,
    minimumDisplacementScore: 60,
    maximumFillPercent: 0.98,
    maximumMitigations: 2,
    requirePriceImbalance: true,
  }),
  structure: Object.freeze({
    minimumQualityScore: 65,
    requirePostEventConfirmation: true,
    acceptedEventTypes: Object.freeze([
      'BREAK_OF_STRUCTURE',
      'CHANGE_OF_CHARACTER',
      'MARKET_STRUCTURE_SHIFT',
    ]),
  }),
  risk: Object.freeze({
    minimumRewardRisk: 2,
    maximumStopAtr: 2.5,
    maximumSpreadPercent: 0.45,
  }),
});

function mergeSection(base, override) {
  return Object.freeze({ ...base, ...(override || {}) });
}

function finiteBetween(value, minimum, maximum, label) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}`);
  }
}

export function createInstitutionalFlowConfig(overrides = {}) {
  const config = Object.freeze({
    strategy: mergeSection(DEFAULT_CONFIG.strategy, overrides.strategy),
    stopRun: mergeSection(DEFAULT_CONFIG.stopRun, overrides.stopRun),
    absorption: mergeSection(DEFAULT_CONFIG.absorption, overrides.absorption),
    imbalance: mergeSection(DEFAULT_CONFIG.imbalance, overrides.imbalance),
    structure: Object.freeze({
      ...DEFAULT_CONFIG.structure,
      ...(overrides.structure || {}),
      acceptedEventTypes: Object.freeze([
        ...((overrides.structure?.acceptedEventTypes || DEFAULT_CONFIG.structure.acceptedEventTypes)),
      ]),
    }),
    risk: mergeSection(DEFAULT_CONFIG.risk, overrides.risk),
    stageOrder: INSTITUTIONAL_FLOW_STAGE_ORDER,
  });

  if (config.strategy.mode !== 'PAPER_TRADING'
    || config.strategy.observationOnly !== true
    || config.strategy.executionAllowed !== false
    || config.strategy.automaticSubmissionAllowed !== false
    || config.strategy.liveExecutionAllowed !== false) {
    throw new Error('Institutional Flow safety locks cannot be disabled');
  }

  finiteBetween(config.stopRun.minimumScore, 0, 100, 'stopRun.minimumScore');
  finiteBetween(config.stopRun.minimumLevelQuality, 0, 100, 'stopRun.minimumLevelQuality');
  finiteBetween(config.absorption.minimumTrueOrderFlowScore, 0, 100, 'absorption.minimumTrueOrderFlowScore');
  finiteBetween(config.absorption.minimumProxyScore, 0, 100, 'absorption.minimumProxyScore');
  finiteBetween(config.absorption.minimumClassificationConfidence, 0, 1, 'absorption.minimumClassificationConfidence');
  finiteBetween(config.imbalance.minimumScore, 0, 100, 'imbalance.minimumScore');
  finiteBetween(config.structure.minimumQualityScore, 0, 100, 'structure.minimumQualityScore');
  finiteBetween(config.risk.minimumRewardRisk, 0.1, 20, 'risk.minimumRewardRisk');
  finiteBetween(config.risk.maximumStopAtr, 0.1, 20, 'risk.maximumStopAtr');
  finiteBetween(config.risk.maximumSpreadPercent, 0, 10, 'risk.maximumSpreadPercent');
  return config;
}
