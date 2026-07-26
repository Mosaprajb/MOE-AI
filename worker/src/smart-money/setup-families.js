export const SMART_MONEY_SETUP_FAMILIES = Object.freeze([
  'LIQUIDITY_SWEEP_REVERSAL',
  'STRUCTURE_ORDER_BLOCK_REPRICING',
  'BREAKER_RETEST',
  'FVG_REPRICING',
  'TREND_CONTINUATION_REPRICING',
  'UNCLASSIFIED',
]);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

export function classifySmartMoneySetupFamily({ confluence, structure, liquidityEvent = null } = {}) {
  const zoneType = confluence?.entryZone?.type || null;
  const eventType = structure?.latestEvent?.eventType || null;
  let family = 'UNCLASSIFIED';
  const evidence = [];

  if (liquidityEvent?.confirmed && ['CHANGE_OF_CHARACTER', 'MARKET_STRUCTURE_SHIFT'].includes(eventType)) {
    family = 'LIQUIDITY_SWEEP_REVERSAL';
    evidence.push('CONFIRMED_LIQUIDITY_EVENT', `STRUCTURE_${eventType}`);
  } else if (zoneType === 'BREAKER_BLOCK') {
    family = 'BREAKER_RETEST';
    evidence.push('ACTIVE_BREAKER_BLOCK', 'RETEST_REJECTION_CONFIRMED');
  } else if (zoneType === 'ORDER_BLOCK') {
    family = eventType === 'BREAK_OF_STRUCTURE'
      ? 'TREND_CONTINUATION_REPRICING'
      : 'STRUCTURE_ORDER_BLOCK_REPRICING';
    evidence.push('ACTIVE_ORDER_BLOCK', `STRUCTURE_${eventType || 'UNKNOWN'}`);
  } else if (zoneType === 'FAIR_VALUE_GAP') {
    family = 'FVG_REPRICING';
    evidence.push('ACTIVE_FAIR_VALUE_GAP');
  }

  return freeze({
    family,
    direction: confluence?.direction || null,
    evidence,
    classified: family !== 'UNCLASSIFIED',
    executionAllowed: false,
    mode: 'PAPER_TRADING',
  });
}
