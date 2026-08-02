// Sandbox-only strategy registry.
//
// Per-strategy limits are an additional entry-frequency layer. They never replace or relax
// portfolio-wide risk controls such as maximum open positions, daily loss, portfolio heat,
// symbol/sector concentration, or the Sandbox pilot submission ceiling.

export const STRATEGY_REGISTRY_SCHEMA = 'MOE.StrategyRegistry';
export const STRATEGY_REGISTRY_VERSION = '1.1.0';

export const STRATEGY_IDS = Object.freeze({
  FUSION_V2: 'FUSION_V2',
  MOERAND_SIMPLE_INTERNAL: 'MOERAND_SIMPLE_INTERNAL',
  MOERAND_SCALP_INTERNAL: 'MOERAND_SCALP_INTERNAL',
  MOERAND_CLEAN_INTERNAL: 'MOERAND_CLEAN_INTERNAL',
});

const DEFINITIONS = Object.freeze({
  [STRATEGY_IDS.FUSION_V2]: Object.freeze({
    id: STRATEGY_IDS.FUSION_V2,
    label: 'Fusion V2',
    shortLabel: 'Fusion',
    sourceType: 'INTERNAL_PIPELINE',
    badgeColor: 'BLUE',
    defaultMaxDailyTrades: 1,
    defaultMaxConcurrentPositions: 1,
    maxDailyTradesEnv: 'MOE_STRATEGY_FUSION_V2_MAX_DAILY_TRADES',
    maxConcurrentPositionsEnv: 'MOE_STRATEGY_FUSION_V2_MAX_CONCURRENT_POSITIONS',
    settings: Object.freeze({}),
    aliases: Object.freeze([
      'FUSION',
      'MOE_FUSION_V2',
      'MOE_CORE',
      'AUTO_SCANNER',
      'ANALYSIS_PIPELINE_V2',
      'BREAKOUT',
      'GENERAL',
    ]),
  }),
  [STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL]: Object.freeze({
    id: STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL,
    label: 'MOERAND Simple',
    shortLabel: 'Simple',
    sourceType: 'INTERNAL_PIPELINE',
    badgeColor: 'ORANGE',
    defaultMaxDailyTrades: 2,
    defaultMaxConcurrentPositions: 1,
    maxDailyTradesEnv: 'MOE_STRATEGY_MOERAND_SIMPLE_INTERNAL_MAX_DAILY_TRADES',
    maxConcurrentPositionsEnv: 'MOE_STRATEGY_MOERAND_SIMPLE_INTERNAL_MAX_CONCURRENT_POSITIONS',
    settings: Object.freeze({}),
    aliases: Object.freeze([
      'MOERAND_SIMPLE',
      'MOERAND',
      'UT_BOT_ATR',
      'UT_BOT_ATR_HEIKIN_ASHI',
      'HEIKIN_ASHI_ATR',
    ]),
  }),
  [STRATEGY_IDS.MOERAND_SCALP_INTERNAL]: Object.freeze({
    id: STRATEGY_IDS.MOERAND_SCALP_INTERNAL,
    label: 'MOERAND Scalp',
    shortLabel: 'Scalp',
    sourceType: 'INTERNAL_PIPELINE',
    badgeColor: 'ORANGE',
    defaultMaxDailyTrades: 20,
    defaultMaxConcurrentPositions: 1,
    maxDailyTradesEnv: 'MOE_STRATEGY_MOERAND_SCALP_INTERNAL_MAX_DAILY_TRADES',
    maxConcurrentPositionsEnv: 'MOE_STRATEGY_MOERAND_SCALP_INTERNAL_MAX_CONCURRENT_POSITIONS',
    settings: Object.freeze({}),
    aliases: Object.freeze([
      'MOERAND_SCALP',
      'SCALP',
      'SCALPING',
      'MOERAND_HIGH_FREQUENCY',
    ]),
  }),
  [STRATEGY_IDS.MOERAND_CLEAN_INTERNAL]: Object.freeze({
    id: STRATEGY_IDS.MOERAND_CLEAN_INTERNAL,
    label: 'MOERAND Clean',
    shortLabel: 'Clean',
    sourceType: 'INTERNAL_PIPELINE',
    badgeColor: 'PURPLE',
    defaultMaxDailyTrades: 2,
    defaultMaxConcurrentPositions: 1,
    maxDailyTradesEnv: 'MOE_STRATEGY_MOERAND_CLEAN_INTERNAL_MAX_DAILY_TRADES',
    maxConcurrentPositionsEnv: 'MOE_STRATEGY_MOERAND_CLEAN_INTERNAL_MAX_CONCURRENT_POSITIONS',
    settings: Object.freeze({
      trendLen: Object.freeze({ env: 'MOERAND_CLEAN_TREND_LEN', type: 'integer', defaultValue: 50, minimum: 2, maximum: 500 }),
      breakoutLen: Object.freeze({ env: 'MOERAND_CLEAN_BREAKOUT_LEN', type: 'integer', defaultValue: 20, minimum: 2, maximum: 500 }),
      minRvol: Object.freeze({ env: 'MOERAND_CLEAN_MIN_RVOL', type: 'number', defaultValue: 1.2, minimum: 0, maximum: 100 }),
      rvolPeriod: Object.freeze({ env: 'MOERAND_CLEAN_RVOL_PERIOD', type: 'integer', defaultValue: 20, minimum: 2, maximum: 500 }),
      atrPeriod: Object.freeze({ env: 'MOERAND_CLEAN_ATR_PERIOD', type: 'integer', defaultValue: 2, minimum: 1, maximum: 500 }),
      atrMult: Object.freeze({ env: 'MOERAND_CLEAN_ATR_MULT', type: 'number', defaultValue: 1, minimum: 0.01, maximum: 100 }),
      enableBreakeven: Object.freeze({ env: 'MOERAND_CLEAN_ENABLE_BREAKEVEN', type: 'boolean', defaultValue: true }),
      sessionWindow: Object.freeze({ env: 'MOERAND_CLEAN_SESSION_WINDOW', type: 'text', defaultValue: '0930-1600' }),
      sessionTimezone: Object.freeze({ env: 'MOERAND_CLEAN_SESSION_TIMEZONE', type: 'text', defaultValue: 'America/New_York' }),
      timeframeMinutes: Object.freeze({ env: 'MOERAND_CLEAN_TIMEFRAME_MINUTES', type: 'integer', defaultValue: 5, minimum: 1, maximum: 240 }),
    }),
    aliases: Object.freeze([
      'MOERAND_CLEAN',
      'CLEAN',
      'CLEAN_BREAKOUT',
      'MOERAND_BREAKOUT_RVOL',
    ]),
  }),
});

const ALIAS_INDEX = new Map();
for (const definition of Object.values(DEFINITIONS)) {
  ALIAS_INDEX.set(definition.id, definition.id);
  for (const alias of definition.aliases) ALIAS_INDEX.set(alias, definition.id);
}

function text(value, fallback = '') {
  const normalized = String(value ?? fallback).trim();
  return normalized || fallback;
}

function boundedInteger(value, fallback, minimum = 1, maximum = 10_000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function boundedNumber(value, fallback, minimum = 0, maximum = 10_000) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function boolean(value, fallback = false) {
  if (value == null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return fallback;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function resolveSetting(setting, env = {}) {
  const raw = env[setting.env];
  if (setting.type === 'integer') {
    return boundedInteger(raw, setting.defaultValue, setting.minimum, setting.maximum);
  }
  if (setting.type === 'number') {
    return boundedNumber(raw, setting.defaultValue, setting.minimum, setting.maximum);
  }
  if (setting.type === 'boolean') return boolean(raw, setting.defaultValue);
  return text(raw, setting.defaultValue);
}

function resolvedSettings(definition, env = {}) {
  return Object.freeze(Object.fromEntries(Object.entries(definition.settings || {}).map(([key, setting]) => [
    key,
    resolveSetting(setting, env),
  ])));
}

export function normalizeStrategyToken(value) {
  return text(value)
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function resolveStrategyId(value, fallback = STRATEGY_IDS.FUSION_V2) {
  const token = normalizeStrategyToken(value);
  if (!token) return fallback;
  if (ALIAS_INDEX.has(token)) return ALIAS_INDEX.get(token);
  if (token.includes('CLEAN')) return STRATEGY_IDS.MOERAND_CLEAN_INTERNAL;
  if (token.includes('SCALP')) return STRATEGY_IDS.MOERAND_SCALP_INTERNAL;
  if (token.includes('MOERAND') || token.includes('UT_BOT') || token.includes('HEIKIN')) {
    return STRATEGY_IDS.MOERAND_SIMPLE_INTERNAL;
  }
  if (token.includes('FUSION') || token.includes('MOE_CORE') || token.includes('AUTO_SCANNER')) {
    return STRATEGY_IDS.FUSION_V2;
  }
  return fallback;
}

export function strategyIdFromRecord(record = {}, fallback = STRATEGY_IDS.FUSION_V2) {
  const opportunity = record?.opportunity && typeof record.opportunity === 'object'
    ? record.opportunity
    : record;
  const metadata = opportunity?.metadata && typeof opportunity.metadata === 'object'
    ? opportunity.metadata
    : {};
  const candidates = [
    record?.strategyId,
    record?.sourceStrategy,
    opportunity?.strategyId,
    opportunity?.sourceStrategy,
    metadata.strategyId,
    metadata.sourceStrategy,
    metadata.strategy,
    metadata.engine,
    metadata.source,
    metadata.setupFamily,
    record?.family,
  ];
  for (const candidate of candidates) {
    if (text(candidate)) return resolveStrategyId(candidate, fallback);
  }
  return fallback;
}

function resolveDefinition(definition, env = {}) {
  const settings = resolvedSettings(definition, env);
  return deepFreeze({
    schema: STRATEGY_REGISTRY_SCHEMA,
    schemaVersion: STRATEGY_REGISTRY_VERSION,
    id: definition.id,
    label: definition.label,
    shortLabel: definition.shortLabel,
    sourceType: definition.sourceType,
    badgeColor: definition.badgeColor,
    enabled: true,
    longOnly: true,
    spotEquitiesOnly: true,
    independentPipeline: true,
    fusionInteraction: 'NONE',
    maxDailyTrades: boundedInteger(
      env[definition.maxDailyTradesEnv],
      definition.defaultMaxDailyTrades,
      1,
      10_000,
    ),
    maxConcurrentPositions: boundedInteger(
      env[definition.maxConcurrentPositionsEnv],
      definition.defaultMaxConcurrentPositions,
      1,
      100,
    ),
    settings,
    configuration: Object.freeze({
      maxDailyTradesEnv: definition.maxDailyTradesEnv,
      maxConcurrentPositionsEnv: definition.maxConcurrentPositionsEnv,
      defaultMaxDailyTrades: definition.defaultMaxDailyTrades,
      defaultMaxConcurrentPositions: definition.defaultMaxConcurrentPositions,
      settings: Object.freeze(Object.fromEntries(Object.entries(definition.settings || {}).map(([key, setting]) => [
        key,
        Object.freeze({ ...setting }),
      ]))),
    }),
  });
}

export function strategyRegistry(env = {}) {
  return deepFreeze({
    schema: STRATEGY_REGISTRY_SCHEMA,
    schemaVersion: STRATEGY_REGISTRY_VERSION,
    longOnly: true,
    spotEquitiesOnly: true,
    strategies: Object.values(DEFINITIONS).map((definition) => resolveDefinition(definition, env)),
  });
}

export function getStrategyDefinition(strategyId, env = {}) {
  const resolved = resolveStrategyId(strategyId);
  const definition = DEFINITIONS[resolved] || DEFINITIONS[STRATEGY_IDS.FUSION_V2];
  return resolveDefinition(definition, env);
}
