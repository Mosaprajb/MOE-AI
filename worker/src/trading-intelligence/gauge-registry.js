export const GAUGE_CATEGORIES = Object.freeze({
  CONTEXT: 'CONTEXT',
  LIQUIDITY: 'LIQUIDITY',
  SMART_MONEY: 'SMART_MONEY',
  ORDER_FLOW: 'ORDER_FLOW',
  CONFIRMATION: 'CONFIRMATION',
  RISK: 'RISK',
  EXECUTION: 'EXECUTION',
  SYSTEM: 'SYSTEM',
});

export const GAUGE_STATUSES = Object.freeze([
  'OFFLINE',
  'DISABLED',
  'UNAVAILABLE',
  'STALE',
  'IDLE',
  'SCANNING',
  'DETECTED',
  'VALIDATING',
  'DEVELOPING',
  'WAITING_FOR_CONFIRMATION',
  'CONFIRMED',
  'SUPPORTING_LONG',
  'SUPPORTING_SHORT',
  'CONFLICTING',
  'REJECTED',
  'BLOCKED',
  'INVALIDATED',
  'EXPIRED',
  'ERROR',
]);

export const GAUGE_DIRECTIONS = Object.freeze(['LONG', 'SHORT', 'NEUTRAL', 'NO_TRADE']);

export const TRADING_GAUGE_REGISTRY = Object.freeze([
  Object.freeze({ id: 'higher-timeframe-bias', label: 'Higher-Timeframe Bias', shortLabel: 'HTF Bias', category: GAUGE_CATEGORIES.CONTEXT, priority: 10, enabled: true, scored: true, mandatory: false, officialWeight: null }),
  Object.freeze({ id: 'market-regime', label: 'Market Regime', shortLabel: 'Regime', category: GAUGE_CATEGORIES.CONTEXT, priority: 20, enabled: true, scored: true, mandatory: false, officialWeight: null }),
  Object.freeze({ id: 'relative-volume', label: 'Relative Volume', shortLabel: 'RVOL', category: GAUGE_CATEGORIES.CONTEXT, priority: 30, enabled: true, scored: false, mandatory: false, officialWeight: null }),
  Object.freeze({ id: 'liquidity-sweep', label: 'Liquidity Sweep', shortLabel: 'Sweep', category: GAUGE_CATEGORIES.LIQUIDITY, priority: 40, enabled: true, scored: true, mandatory: true, officialWeight: null }),
  Object.freeze({ id: 'stop-run', label: 'Stop Run', shortLabel: 'Stop Run', category: GAUGE_CATEGORIES.LIQUIDITY, priority: 50, enabled: true, scored: true, mandatory: true, officialWeight: 0.2 }),
  Object.freeze({ id: 'smart-money', label: 'Smart Money', shortLabel: 'Smart Money', category: GAUGE_CATEGORIES.SMART_MONEY, priority: 60, enabled: true, scored: true, mandatory: false, officialWeight: null }),
  Object.freeze({ id: 'smt-divergence', label: 'SMT Divergence', shortLabel: 'SMT', category: GAUGE_CATEGORIES.SMART_MONEY, priority: 70, enabled: true, scored: false, mandatory: false, officialWeight: null }),
  Object.freeze({ id: 'absorption', label: 'Absorption', shortLabel: 'Absorption', category: GAUGE_CATEGORIES.ORDER_FLOW, priority: 80, enabled: true, scored: true, mandatory: true, officialWeight: 0.2 }),
  Object.freeze({ id: 'market-imbalance', label: 'Market Imbalance', shortLabel: 'Imbalance', category: GAUGE_CATEGORIES.ORDER_FLOW, priority: 90, enabled: true, scored: true, mandatory: true, officialWeight: 0.2 }),
  Object.freeze({ id: 'market-structure', label: 'Market Structure', shortLabel: 'Structure', category: GAUGE_CATEGORIES.CONFIRMATION, priority: 100, enabled: true, scored: true, mandatory: true, officialWeight: 0.2 }),
  Object.freeze({ id: 'risk-quality', label: 'Risk Quality', shortLabel: 'Risk', category: GAUGE_CATEGORIES.RISK, priority: 110, enabled: true, scored: true, mandatory: true, officialWeight: 0.2 }),
  Object.freeze({ id: 'setup-confidence', label: 'Setup Confidence', shortLabel: 'Confidence', category: GAUGE_CATEGORIES.CONFIRMATION, priority: 120, enabled: true, scored: true, mandatory: false, officialWeight: null }),
  Object.freeze({ id: 'data-quality', label: 'Data Quality', shortLabel: 'Data', category: GAUGE_CATEGORIES.SYSTEM, priority: 130, enabled: true, scored: true, mandatory: true, officialWeight: null }),
  Object.freeze({ id: 'execution-quality', label: 'Execution Quality', shortLabel: 'Execution', category: GAUGE_CATEGORIES.EXECUTION, priority: 140, enabled: true, scored: false, mandatory: true, officialWeight: null }),
]);

export function getGaugeDefinition(id) {
  return TRADING_GAUGE_REGISTRY.find((definition) => definition.id === id) || null;
}
