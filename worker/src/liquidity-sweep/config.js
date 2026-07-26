export const LIQUIDITY_SWEEP_STRATEGY_NAME = 'Institutional Liquidity Sweep';
export const LIQUIDITY_SWEEP_STRATEGY_VERSION = 'LIQUIDITY_SWEEP_1.0.0-alpha.1';

const EXECUTION_TO_CONTEXT = Object.freeze({
  '1m': '15m',
  '5m': '1h',
  '15m': '4h',
  '4h': '1d',
  '1d': '1w',
});

function finite(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function integer(value, fallback) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : fallback;
}

function enabled(value, fallback = false) {
  if (value == null || value === '') return fallback;
  return String(value).trim().toLowerCase() === 'true';
}

function list(value, fallback = []) {
  if (Array.isArray(value)) return value.map(String).map((item) => item.trim()).filter(Boolean);
  if (value == null || value === '') return [...fallback];
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const item of Object.values(value)) deepFreeze(item);
  return value;
}

function merge(base, override) {
  if (!override || typeof override !== 'object' || Array.isArray(override)) return base;
  const output = { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && base[key] && typeof base[key] === 'object' && !Array.isArray(base[key])) {
      output[key] = merge(base[key], value);
    } else {
      output[key] = value;
    }
  }
  return output;
}

function assertFiniteRange(name, value, minimum, maximum) {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be between ${minimum} and ${maximum}`);
  }
}

function assertPositive(name, value) {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be greater than zero`);
}

function assertInteger(name, value, minimum, maximum) {
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}`);
  }
}

function assertTimeframeMap(map) {
  for (const [execution, context] of Object.entries(EXECUTION_TO_CONTEXT)) {
    if (map[execution] !== context) throw new Error(`timeframes.${execution} must map to ${context}`);
  }
}

export function defaultLiquiditySweepConfig(env = {}) {
  return {
    strategy: {
      name: LIQUIDITY_SWEEP_STRATEGY_NAME,
      version: LIQUIDITY_SWEEP_STRATEGY_VERSION,
      mode: 'PAPER_TRADING',
      executionAllowed: false,
      automaticSandboxSubmission: false,
      liveExecutionAllowed: false,
    },
    timeframes: { ...EXECUTION_TO_CONTEXT },
    dataQuality: {
      atrPeriod: integer(env.MOE_LIQ_ATR_PERIOD, 14),
      volumeLookback: integer(env.MOE_LIQ_VOLUME_LOOKBACK, 20),
      realizedVolatilityLookback: integer(env.MOE_LIQ_REALIZED_VOL_LOOKBACK, 20),
      maximumDelaySeconds: integer(env.MOE_LIQ_MAX_DATA_DELAY_SECONDS, 120),
      maximumMissingBars: integer(env.MOE_LIQ_MAX_MISSING_BARS, 1),
      minimumBars: integer(env.MOE_LIQ_MINIMUM_BARS, 80),
      rejectZeroVolume: enabled(env.MOE_LIQ_REJECT_ZERO_VOLUME, true),
    },
    liquidityPools: {
      minimumImportanceScore: finite(env.MOE_LIQ_MIN_POOL_IMPORTANCE, 60),
      zoneToleranceAtr: finite(env.MOE_LIQ_ZONE_TOLERANCE_ATR, 0.12),
      zoneToleranceTicks: integer(env.MOE_LIQ_ZONE_TOLERANCE_TICKS, 2),
      minimumTouches: integer(env.MOE_LIQ_MIN_TOUCHES, 2),
      maximumTouchesBeforeConsumption: integer(env.MOE_LIQ_MAX_TOUCHES_BEFORE_CONSUMPTION, 6),
      maximumAgeBars: integer(env.MOE_LIQ_POOL_MAX_AGE_BARS, 500),
      mergeSameSideOnly: true,
      supportedTypes: list(env.MOE_LIQ_SUPPORTED_POOL_TYPES, [
        'SWING_HIGH', 'SWING_LOW', 'EQUAL_HIGHS', 'EQUAL_LOWS',
        'PREVIOUS_DAY_HIGH', 'PREVIOUS_DAY_LOW', 'PREVIOUS_WEEK_HIGH', 'PREVIOUS_WEEK_LOW',
        'PREMARKET_HIGH', 'PREMARKET_LOW', 'AFTER_HOURS_HIGH', 'AFTER_HOURS_LOW',
        'SESSION_HIGH', 'SESSION_LOW', 'OPENING_RANGE_HIGH', 'OPENING_RANGE_LOW',
        'GAP_UPPER', 'GAP_LOWER', 'CONSOLIDATION_HIGH', 'CONSOLIDATION_LOW',
        'HIGH_VOLUME_RANGE_HIGH', 'HIGH_VOLUME_RANGE_LOW', 'VWAP_DEVIATION_HIGH', 'VWAP_DEVIATION_LOW',
      ]),
    },
    sweep: {
      minimumPenetrationAtr: finite(env.MOE_LIQ_MIN_PENETRATION_ATR, 0.05),
      maximumPenetrationAtr: finite(env.MOE_LIQ_MAX_PENETRATION_ATR, 0.55),
      minimumPenetrationTicks: integer(env.MOE_LIQ_MIN_PENETRATION_TICKS, 1),
      maximumReclaimCandles: integer(env.MOE_LIQ_MAX_RECLAIM_CANDLES, 3),
      maximumCandlesOutside: integer(env.MOE_LIQ_MAX_CANDLES_OUTSIDE, 3),
      minimumWickToBodyRatio: finite(env.MOE_LIQ_MIN_WICK_BODY_RATIO, 1.25),
      minimumCloseLocation: finite(env.MOE_LIQ_MIN_CLOSE_LOCATION, 0.6),
      minimumRelativeVolume: finite(env.MOE_LIQ_MIN_SWEEP_RVOL, 0.9),
    },
    classification: {
      confirmedSweepRejectionMinimum: finite(env.MOE_LIQ_CONFIRMED_SWEEP_REJECTION_MIN, 70),
      confirmedSweepAcceptanceMaximum: finite(env.MOE_LIQ_CONFIRMED_SWEEP_ACCEPTANCE_MAX, 40),
      probableSweepRejectionMinimum: finite(env.MOE_LIQ_PROBABLE_SWEEP_REJECTION_MIN, 58),
      confirmedBreakoutAcceptanceMinimum: finite(env.MOE_LIQ_CONFIRMED_BREAKOUT_ACCEPTANCE_MIN, 70),
      probableBreakoutAcceptanceMinimum: finite(env.MOE_LIQ_PROBABLE_BREAKOUT_ACCEPTANCE_MIN, 58),
      minimumScoreLead: finite(env.MOE_LIQ_CLASSIFICATION_MIN_LEAD, 15),
      ambiguityMargin: finite(env.MOE_LIQ_CLASSIFICATION_AMBIGUITY_MARGIN, 10),
    },
    confirmation: {
      minimumScore: finite(env.MOE_LIQ_MIN_CONFIRMATION_SCORE, 65),
      minimumDisplacementAtr: finite(env.MOE_LIQ_MIN_DISPLACEMENT_ATR, 0.35),
      retestMaximumBars: integer(env.MOE_LIQ_RETEST_MAX_BARS, 5),
      maximumEntryExtensionAtr: finite(env.MOE_LIQ_MAX_ENTRY_EXTENSION_ATR, 0.65),
      requireStructureShift: enabled(env.MOE_LIQ_REQUIRE_STRUCTURE_SHIFT, false),
      requireRetest: enabled(env.MOE_LIQ_REQUIRE_RETEST, false),
    },
    risk: {
      minimumRewardToRisk: finite(env.MOE_LIQ_MIN_RISK_REWARD, 2),
      maximumStopAtr: finite(env.MOE_LIQ_MAX_STOP_ATR, 1.5),
      stopBufferAtr: finite(env.MOE_LIQ_STOP_BUFFER_ATR, 0.12),
      stopBufferTicks: integer(env.MOE_LIQ_STOP_BUFFER_TICKS, 2),
      maximumSpreadPercent: finite(env.MOE_LIQ_MAX_SPREAD_PERCENT, 0.5),
      maximumSetupAgeBars: integer(env.MOE_LIQ_MAX_SETUP_AGE_BARS, 12),
      cooldownBars: integer(env.MOE_LIQ_COOLDOWN_BARS, 10),
      countertrendRiskMultiplier: finite(env.MOE_LIQ_COUNTERTREND_RISK_MULTIPLIER, 0.5),
    },
    scoring: {
      minimumAutomaticScore: finite(env.MOE_LIQ_MIN_AUTOMATIC_SCORE, 80),
      minimumValidScore: finite(env.MOE_LIQ_MIN_VALID_SCORE, 70),
      watchlistScore: finite(env.MOE_LIQ_WATCHLIST_SCORE, 60),
      countertrendMinimumScore: finite(env.MOE_LIQ_COUNTERTREND_MIN_SCORE, 88),
      replacementMargin: finite(env.MOE_LIQ_REPLACEMENT_MARGIN, 8),
      weights: {
        liquidity: 20,
        sweep: 20,
        confirmation: 20,
        context: 15,
        risk: 15,
        execution: 10,
      },
    },
    sessions: {
      openingVolatilityMinutes: integer(env.MOE_LIQ_OPENING_VOLATILITY_MINUTES, 15),
      middayStartEt: String(env.MOE_LIQ_MIDDAY_START_ET || '11:30'),
      middayEndEt: String(env.MOE_LIQ_MIDDAY_END_ET || '13:30'),
      powerHourStartEt: String(env.MOE_LIQ_POWER_HOUR_START_ET || '15:00'),
      premarketRiskMultiplier: finite(env.MOE_LIQ_PREMARKET_RISK_MULTIPLIER, 0.5),
      extendedHoursRiskMultiplier: finite(env.MOE_LIQ_EXTENDED_RISK_MULTIPLIER, 0.5),
      openingScorePenalty: finite(env.MOE_LIQ_OPENING_SCORE_PENALTY, 8),
      middayScorePenalty: finite(env.MOE_LIQ_MIDDAY_SCORE_PENALTY, 5),
    },
    eventRisk: {
      blockEarnings: enabled(env.MOE_LIQ_BLOCK_EARNINGS, true),
      blockScheduledMacroEvents: enabled(env.MOE_LIQ_BLOCK_MACRO_EVENTS, true),
      blockHaltedSymbols: true,
      blockDelayedNewsState: true,
      eventBufferMinutes: integer(env.MOE_LIQ_EVENT_BUFFER_MINUTES, 30),
    },
    duplicateProtection: {
      deterministicSetupIds: true,
      oneActiveSetupPerSymbol: true,
      multiSetupMode: false,
    },
  };
}

export function validateLiquiditySweepConfig(config) {
  if (!config || typeof config !== 'object') throw new Error('Liquidity sweep configuration is required');
  if (config.strategy.mode !== 'PAPER_TRADING') throw new Error('Liquidity sweep strategy must remain in PAPER_TRADING mode during this milestone');
  if (config.strategy.executionAllowed !== false || config.strategy.liveExecutionAllowed !== false) {
    throw new Error('Liquidity sweep execution must remain disabled during the architecture milestone');
  }
  if (config.strategy.automaticSandboxSubmission !== false) {
    throw new Error('Automatic Sandbox submission must remain disabled until validation is complete');
  }

  assertTimeframeMap(config.timeframes);
  assertInteger('dataQuality.atrPeriod', config.dataQuality.atrPeriod, 2, 500);
  assertInteger('dataQuality.volumeLookback', config.dataQuality.volumeLookback, 2, 1000);
  assertInteger('dataQuality.minimumBars', config.dataQuality.minimumBars, 20, 10000);
  assertInteger('dataQuality.maximumDelaySeconds', config.dataQuality.maximumDelaySeconds, 1, 86400);
  assertFiniteRange('liquidityPools.minimumImportanceScore', config.liquidityPools.minimumImportanceScore, 0, 100);
  assertPositive('liquidityPools.zoneToleranceAtr', config.liquidityPools.zoneToleranceAtr);
  assertInteger('liquidityPools.zoneToleranceTicks', config.liquidityPools.zoneToleranceTicks, 1, 100);
  assertInteger('liquidityPools.minimumTouches', config.liquidityPools.minimumTouches, 1, 20);
  assertInteger('liquidityPools.maximumTouchesBeforeConsumption', config.liquidityPools.maximumTouchesBeforeConsumption, config.liquidityPools.minimumTouches, 100);

  assertPositive('sweep.minimumPenetrationAtr', config.sweep.minimumPenetrationAtr);
  assertPositive('sweep.maximumPenetrationAtr', config.sweep.maximumPenetrationAtr);
  if (config.sweep.minimumPenetrationAtr >= config.sweep.maximumPenetrationAtr) {
    throw new Error('sweep.minimumPenetrationAtr must be below sweep.maximumPenetrationAtr');
  }
  assertInteger('sweep.maximumReclaimCandles', config.sweep.maximumReclaimCandles, 1, 20);
  assertInteger('sweep.maximumCandlesOutside', config.sweep.maximumCandlesOutside, 1, 20);
  assertPositive('sweep.minimumWickToBodyRatio', config.sweep.minimumWickToBodyRatio);
  assertFiniteRange('sweep.minimumCloseLocation', config.sweep.minimumCloseLocation, 0, 1);

  for (const [key, value] of Object.entries(config.classification)) {
    assertFiniteRange(`classification.${key}`, value, 0, 100);
  }
  if (config.classification.probableSweepRejectionMinimum >= config.classification.confirmedSweepRejectionMinimum) {
    throw new Error('Probable sweep threshold must be below confirmed sweep threshold');
  }
  if (config.classification.probableBreakoutAcceptanceMinimum >= config.classification.confirmedBreakoutAcceptanceMinimum) {
    throw new Error('Probable breakout threshold must be below confirmed breakout threshold');
  }

  assertFiniteRange('confirmation.minimumScore', config.confirmation.minimumScore, 0, 100);
  assertPositive('confirmation.minimumDisplacementAtr', config.confirmation.minimumDisplacementAtr);
  assertPositive('confirmation.maximumEntryExtensionAtr', config.confirmation.maximumEntryExtensionAtr);
  assertPositive('risk.minimumRewardToRisk', config.risk.minimumRewardToRisk);
  assertPositive('risk.maximumStopAtr', config.risk.maximumStopAtr);
  assertFiniteRange('risk.maximumSpreadPercent', config.risk.maximumSpreadPercent, 0, 10);
  assertFiniteRange('risk.countertrendRiskMultiplier', config.risk.countertrendRiskMultiplier, 0.05, 1);

  const weights = config.scoring.weights;
  const weightTotal = Object.values(weights).reduce((sum, value) => sum + Number(value), 0);
  if (weightTotal !== 100) throw new Error(`scoring.weights must total 100, received ${weightTotal}`);
  assertFiniteRange('scoring.minimumAutomaticScore', config.scoring.minimumAutomaticScore, 0, 100);
  assertFiniteRange('scoring.minimumValidScore', config.scoring.minimumValidScore, 0, 100);
  assertFiniteRange('scoring.watchlistScore', config.scoring.watchlistScore, 0, 100);
  if (!(config.scoring.watchlistScore < config.scoring.minimumValidScore && config.scoring.minimumValidScore <= config.scoring.minimumAutomaticScore)) {
    throw new Error('Scoring thresholds must satisfy watchlist < valid <= automatic');
  }
  if (config.scoring.countertrendMinimumScore < config.scoring.minimumAutomaticScore) {
    throw new Error('Countertrend minimum score must not be below automatic score');
  }

  assertFiniteRange('sessions.premarketRiskMultiplier', config.sessions.premarketRiskMultiplier, 0.05, 1);
  assertFiniteRange('sessions.extendedHoursRiskMultiplier', config.sessions.extendedHoursRiskMultiplier, 0.05, 1);
  assertInteger('eventRisk.eventBufferMinutes', config.eventRisk.eventBufferMinutes, 0, 1440);
  return config;
}

export function createLiquiditySweepConfig(env = {}, overrides = {}) {
  const merged = merge(defaultLiquiditySweepConfig(env), overrides);
  return deepFreeze(validateLiquiditySweepConfig(merged));
}
