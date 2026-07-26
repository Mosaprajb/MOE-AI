function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, value));
}

function round(value, digits = 6) {
  return Number(Number(value).toFixed(digits));
}

function blocked(reason) {
  return freeze({ stage: 'ABSORPTION', passed: false, status: 'BLOCKED', classification: 'INVALID', absorptionMode: 'INSUFFICIENT_DATA', reason, score: 0, failedConditions: [reason], executionAllowed: false });
}

export function evaluateAbsorptionStage({ stopRun, snapshot, orderFlow = null, config } = {}) {
  if (!stopRun?.passed) return blocked('BLOCKED_BY_STOP_RUN_STAGE');
  if (!snapshot?.latest) return blocked('ABSORPTION_MARKET_DATA_MISSING');

  const direction = stopRun.direction;
  const hasOrderFlow = Boolean(orderFlow && Number.isFinite(Number(orderFlow.aggressiveBuyVolume)) && Number.isFinite(Number(orderFlow.aggressiveSellVolume)));
  const latest = snapshot.latest;
  const atr = Math.max(Number(snapshot.atr || 0), Number.EPSILON);
  const range = Math.max(Number(latest.high) - Number(latest.low), Number.EPSILON);
  const body = Math.abs(Number(latest.close) - Number(latest.open));
  const wick = direction === 'BULLISH'
    ? Math.max(0, Math.min(Number(latest.open), Number(latest.close)) - Number(latest.low))
    : Math.max(0, Number(latest.high) - Math.max(Number(latest.open), Number(latest.close)));
  const wickToBody = wick / Math.max(body, Number(snapshot.tickSize || 0.01));
  const closeLocation = direction === 'BULLISH'
    ? (Number(latest.close) - Number(latest.low)) / range
    : (Number(latest.high) - Number(latest.close)) / range;
  const relativeVolume = Number(snapshot.relativeVolume || 0);
  const attempts = Math.max(1, Number(stopRun.stopLevel?.touchCount || stopRun.raid?.reclaimCandles === 0 ? 2 : 1));
  const penetrationEfficiency = Number(stopRun.penetrationAtr || 0) / Math.max(relativeVolume, 0.01);
  const failedConditions = [];
  let score = 0;
  let classification = 'AMBIGUOUS';
  let absorptionMode = 'PROXY_ABSORPTION';
  let confidence = 0;
  let orderFlowEvidence = null;

  if (hasOrderFlow) {
    absorptionMode = 'TRUE_ORDER_FLOW_ABSORPTION';
    const aggressiveBuy = Number(orderFlow.aggressiveBuyVolume || 0);
    const aggressiveSell = Number(orderFlow.aggressiveSellVolume || 0);
    const delta = Number(orderFlow.delta ?? aggressiveBuy - aggressiveSell);
    const pressure = direction === 'BULLISH' ? aggressiveSell : aggressiveBuy;
    const opposing = direction === 'BULLISH' ? aggressiveBuy : aggressiveSell;
    const total = Math.max(aggressiveBuy + aggressiveSell, 1);
    const pressureShare = pressure / total;
    const progress = Math.abs(Number(orderFlow.priceProgress ?? stopRun.penetrationAtr || 0));
    const efficiency = progress / Math.max(pressure / 1000, 0.001);
    const repeatedAttempts = Number(orderFlow.repeatedAttempts || attempts);
    confidence = clamp(Number(orderFlow.classificationConfidence ?? 0.8), 0, 1);
    score = clamp(Math.round(
      20
      + pressureShare * 25
      + Math.min(20, repeatedAttempts * 5)
      + Math.min(20, stopRun.rejectionScore * 0.2)
      + Math.min(15, Math.max(0, 1 - efficiency) * 15)
    ), 0, 100);
    if (confidence < config.absorption.minimumClassificationConfidence) failedConditions.push('ORDER_FLOW_CLASSIFICATION_CONFIDENCE_LOW');
    if (repeatedAttempts < config.absorption.minimumRepeatedAttempts) failedConditions.push('INSUFFICIENT_REPEATED_EXECUTION_ATTEMPTS');
    if (score < config.absorption.minimumTrueOrderFlowScore) failedConditions.push('TRUE_ABSORPTION_SCORE_BELOW_MINIMUM');
    classification = failedConditions.length ? 'AMBIGUOUS' : 'CONFIRMED_ABSORPTION';
    orderFlowEvidence = { aggressiveBuyVolume: aggressiveBuy, aggressiveSellVolume: aggressiveSell, delta, pressureShare: round(pressureShare), priceEfficiency: round(efficiency), repeatedAttempts };
  } else {
    score = clamp(Math.round(
      10
      + Math.min(25, wickToBody / Math.max(config.absorption.minimumWickToBodyRatio, 0.01) * 15)
      + Math.min(20, closeLocation * 20)
      + Math.min(20, relativeVolume / Math.max(config.absorption.minimumRelativeVolume, 0.01) * 12)
      + Math.min(15, stopRun.rejectionScore * 0.15)
      + Math.min(10, Math.max(0, config.absorption.maximumProxyEfficiency - penetrationEfficiency) * 8)
    ), 0, 100);
    confidence = clamp(score / 100 * 0.85, 0, 0.85);
    if (wickToBody < config.absorption.minimumWickToBodyRatio) failedConditions.push('PROXY_WICK_REJECTION_TOO_WEAK');
    if (closeLocation < config.absorption.minimumDirectionalCloseLocation) failedConditions.push('PROXY_CLOSE_LOCATION_TOO_WEAK');
    if (relativeVolume < config.absorption.minimumRelativeVolume) failedConditions.push('PROXY_RELATIVE_VOLUME_TOO_LOW');
    if (penetrationEfficiency > config.absorption.maximumProxyEfficiency) failedConditions.push('PRICE_PROGRESS_TOO_EFFICIENT_FOR_ABSORPTION');
    if (score < config.absorption.minimumProxyScore) failedConditions.push('PROXY_ABSORPTION_SCORE_BELOW_MINIMUM');
    if (relativeVolume < config.absorption.exhaustionRelativeVolume && wickToBody >= config.absorption.minimumWickToBodyRatio) classification = 'EXHAUSTION';
    else classification = failedConditions.length ? 'AMBIGUOUS' : 'PROBABLE_ABSORPTION';
  }

  return freeze({
    stage: 'ABSORPTION',
    passed: failedConditions.length === 0 && ['CONFIRMED_ABSORPTION', 'PROBABLE_ABSORPTION'].includes(classification),
    status: failedConditions.length === 0 ? 'PASSED' : 'REJECTED',
    classification,
    absorptionMode,
    direction,
    score,
    confidence: round(confidence),
    metrics: {
      relativeVolume: round(relativeVolume),
      wickToBodyRatio: round(wickToBody),
      closeLocation: round(closeLocation),
      penetrationEfficiency: round(penetrationEfficiency),
      atr: round(atr),
    },
    orderFlow: orderFlowEvidence,
    failedConditions,
    executionAllowed: false,
  });
}
