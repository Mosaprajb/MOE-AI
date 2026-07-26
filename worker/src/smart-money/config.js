export const SMART_MONEY_STRATEGY_NAME = 'Quantitative Smart Money Engine';
export const SMART_MONEY_STRATEGY_VERSION = 'SMART_MONEY_1.0.0-alpha.1';

const TIMEFRAME_MAP = Object.freeze({
  '1m': '15m',
  '5m': '1h',
  '15m': '4h',
  '4h': '1d',
  '1d': '1w',
});

function number(value, fallback) {
  if (value == null || value === '') return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback) {
  return Math.floor(number(value, fallback));
}

function boolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    output[key] = value && typeof value === 'object' && !Array.isArray(value)
      && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])
      ? merge(base[key], value)
      : value;
  }
  return output;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function assertRange(name, value, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
}

function assertInteger(name, value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

export function defaultSmartMoneyConfig(env = {}) {
  return {
    strategy: {
      name: SMART_MONEY_STRATEGY_NAME,
      version: SMART_MONEY_STRATEGY_VERSION,
      mode: 'PAPER_TRADING',
      executionAllowed: false,
      automaticSubmissionAllowed: false,
      liveExecutionAllowed: false,
      observationOnly: true,
    },
    timeframes: { ...TIMEFRAME_MAP },
    structure: {
      pivotLeftBars: integer(env.MOE_SM_PIVOT_LEFT_BARS, 3),
      pivotRightBars: integer(env.MOE_SM_PIVOT_RIGHT_BARS, 3),
      externalWindowBars: integer(env.MOE_SM_EXTERNAL_WINDOW_BARS, 30),
      minimumSwingProminenceAtr: number(env.MOE_SM_MIN_SWING_PROMINENCE_ATR, 0.25),
      minimumBosPenetrationAtr: number(env.MOE_SM_MIN_BOS_PENETRATION_ATR, 0.08),
      minimumBosPenetrationTicks: integer(env.MOE_SM_MIN_BOS_PENETRATION_TICKS, 2),
      minimumBreakBodyAtr: number(env.MOE_SM_MIN_BREAK_BODY_ATR, 0.35),
      minimumDirectionalCloseLocation: number(env.MOE_SM_MIN_DIRECTIONAL_CLOSE_LOCATION, 0.65),
      minimumBreakRelativeVolume: number(env.MOE_SM_MIN_BREAK_RVOL, 0.9),
      allowRangeExpansionWithoutRvol: boolean(env.MOE_SM_ALLOW_RANGE_EXPANSION_WITHOUT_RVOL, true),
    },
    displacement: {
      minimumModerateScore: number(env.MOE_SM_MIN_MODERATE_DISPLACEMENT_SCORE, 50),
      minimumStrongScore: number(env.MOE_SM_MIN_STRONG_DISPLACEMENT_SCORE, 68),
      minimumExceptionalScore: number(env.MOE_SM_MIN_EXCEPTIONAL_DISPLACEMENT_SCORE, 85),
      abnormalRangeAtr: number(env.MOE_SM_ABNORMAL_RANGE_ATR, 4),
      minimumBodyAtr: number(env.MOE_SM_MIN_DISPLACEMENT_BODY_ATR, 0.35),
      minimumBodyToRange: number(env.MOE_SM_MIN_BODY_RANGE_RATIO, 0.55),
    },
    fvg: {
      minimumSizeAtr: number(env.MOE_SM_MIN_FVG_SIZE_ATR, 0.08),
      minimumSizeTicks: integer(env.MOE_SM_MIN_FVG_SIZE_TICKS, 2),
      minimumDisplacementScore: number(env.MOE_SM_MIN_FVG_DISPLACEMENT_SCORE, 55),
      maximumAgeBars: integer(env.MOE_SM_FVG_MAX_AGE_BARS, 80),
      fullMitigationPercent: number(env.MOE_SM_FVG_FULL_MITIGATION_PERCENT, 0.98),
      inversionCloseBufferAtr: number(env.MOE_SM_FVG_INVERSION_BUFFER_ATR, 0.03),
    },
    dealingRange: {
      equilibriumTolerance: number(env.MOE_SM_EQUILIBRIUM_TOLERANCE, 0.08),
      minimumRangeAtr: number(env.MOE_SM_MIN_DEALING_RANGE_ATR, 1.5),
    },
    scoring: {
      thresholds: {
        exceptional: 90,
        highQuality: 82,
        valid: 74,
        watchlist: 65,
      },
      weights: {
        context: 15,
        liquidity: 15,
        structure: 15,
        displacement: 15,
        entryZone: 15,
        risk: 15,
        execution: 10,
      },
    },
  };
}

export function validateSmartMoneyConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Smart Money configuration is required');
  if (config.strategy.mode !== 'PAPER_TRADING') throw new Error('Smart Money engine must remain in PAPER_TRADING mode');
  if (config.strategy.executionAllowed !== false || config.strategy.automaticSubmissionAllowed !== false
    || config.strategy.liveExecutionAllowed !== false || config.strategy.observationOnly !== true) {
    throw new Error('Smart Money execution safety locks must remain enabled');
  }
  for (const [execution, context] of Object.entries(TIMEFRAME_MAP)) {
    if (config.timeframes[execution] !== context) throw new Error(`timeframes.${execution} must map to ${context}`);
  }
  assertInteger('structure.pivotLeftBars', config.structure.pivotLeftBars, 1, 50);
  assertInteger('structure.pivotRightBars', config.structure.pivotRightBars, 1, 50);
  assertInteger('structure.externalWindowBars', config.structure.externalWindowBars, 5, 1000);
  assertRange('structure.minimumSwingProminenceAtr', config.structure.minimumSwingProminenceAtr, 0, 10);
  assertRange('structure.minimumBosPenetrationAtr', config.structure.minimumBosPenetrationAtr, 0, 10);
  assertInteger('structure.minimumBosPenetrationTicks', config.structure.minimumBosPenetrationTicks, 1, 100);
  assertRange('structure.minimumBreakBodyAtr', config.structure.minimumBreakBodyAtr, 0, 10);
  assertRange('structure.minimumDirectionalCloseLocation', config.structure.minimumDirectionalCloseLocation, 0.5, 1);
  assertRange('structure.minimumBreakRelativeVolume', config.structure.minimumBreakRelativeVolume, 0, 100);
  assertRange('displacement.minimumModerateScore', config.displacement.minimumModerateScore, 0, 100);
  assertRange('displacement.minimumStrongScore', config.displacement.minimumStrongScore, 0, 100);
  assertRange('displacement.minimumExceptionalScore', config.displacement.minimumExceptionalScore, 0, 100);
  if (!(config.displacement.minimumModerateScore < config.displacement.minimumStrongScore
    && config.displacement.minimumStrongScore < config.displacement.minimumExceptionalScore)) {
    throw new Error('Displacement thresholds must increase from moderate to exceptional');
  }
  assertRange('fvg.minimumSizeAtr', config.fvg.minimumSizeAtr, 0, 10);
  assertInteger('fvg.minimumSizeTicks', config.fvg.minimumSizeTicks, 1, 100);
  assertRange('fvg.minimumDisplacementScore', config.fvg.minimumDisplacementScore, 0, 100);
  assertInteger('fvg.maximumAgeBars', config.fvg.maximumAgeBars, 1, 10000);
  assertRange('fvg.fullMitigationPercent', config.fvg.fullMitigationPercent, 0.5, 1);
  assertRange('dealingRange.equilibriumTolerance', config.dealingRange.equilibriumTolerance, 0, 0.49);
  assertRange('dealingRange.minimumRangeAtr', config.dealingRange.minimumRangeAtr, 0.1, 100);
  const weightTotal = Object.values(config.scoring.weights).reduce((sum, value) => sum + Number(value), 0);
  if (weightTotal !== 100) throw new Error(`Smart Money scoring weights must total 100, received ${weightTotal}`);
  return deepFreeze(config);
}

export function createSmartMoneyConfig(override = {}, env = {}) {
  return validateSmartMoneyConfig(merge(defaultSmartMoneyConfig(env), override));
}
