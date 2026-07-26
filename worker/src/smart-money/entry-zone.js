function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function scoreCandidate(candidate, direction, currentPrice) {
  const base = Number(candidate.qualityScore ?? candidate.displacementScore ?? 0);
  const lower = Number(candidate.lower);
  const upper = Number(candidate.upper);
  const midpoint = Number(candidate.midpoint ?? ((lower + upper) / 2));
  const distance = Number.isFinite(currentPrice) && Number.isFinite(midpoint)
    ? Math.abs(currentPrice - midpoint) / Math.max(Math.abs(currentPrice), Number.EPSILON)
    : 1;
  const mitigationPenalty = Number(candidate.mitigationCount || 0) * 6;
  const statePenalty = candidate.state === 'PARTIALLY_MITIGATED' ? 8 : 0;
  const directionMatch = candidate.direction === direction ? 10 : -100;
  return base + directionMatch - mitigationPenalty - statePenalty - Math.min(20, distance * 100);
}

function normalize(type, item, rankScore) {
  return freeze({
    type,
    id: item.breakerId || item.blockId || item.fvgId,
    direction: item.direction,
    lower: Number(item.lower),
    upper: Number(item.upper),
    midpoint: Number(item.midpoint ?? ((item.lower + item.upper) / 2)),
    invalidationLevel: Number(item.invalidationLevel),
    qualityScore: Number(item.qualityScore ?? item.displacementScore ?? 0),
    state: item.state,
    rankScore: Number(rankScore.toFixed(2)),
    source: item,
  });
}

export function selectSmartMoneyEntryZone({ direction, currentPrice, orderBlocks = [], breakers = [], fairValueGaps = [] } = {}) {
  if (!['BULLISH', 'BEARISH'].includes(direction)) {
    return freeze({ selected: null, rejected: [], reason: 'NO_DIRECTION' });
  }

  const candidates = [];
  for (const item of breakers) {
    if (item.direction === direction && item.state === 'ACTIVE') candidates.push({ type: 'BREAKER_BLOCK', item, priority: 3 });
  }
  for (const item of orderBlocks) {
    if (item.direction === direction && ['ACTIVE', 'PARTIALLY_MITIGATED'].includes(item.state)) {
      candidates.push({ type: 'ORDER_BLOCK', item, priority: 2 });
    }
  }
  for (const item of fairValueGaps) {
    if (item.direction === direction && ['NEW', 'ACTIVE', 'PARTIALLY_MITIGATED'].includes(item.state)) {
      candidates.push({ type: 'FAIR_VALUE_GAP', item, priority: 1 });
    }
  }

  const ranked = candidates.map((candidate) => ({
    ...candidate,
    rankScore: scoreCandidate(candidate.item, direction, Number(currentPrice)) + candidate.priority * 4,
  })).sort((left, right) => right.rankScore - left.rankScore);

  if (!ranked.length) return freeze({ selected: null, rejected: [], reason: 'NO_ELIGIBLE_ENTRY_ZONE' });
  const selected = normalize(ranked[0].type, ranked[0].item, ranked[0].rankScore);
  const rejected = ranked.slice(1).map((candidate) => freeze({
    type: candidate.type,
    id: candidate.item.breakerId || candidate.item.blockId || candidate.item.fvgId,
    rankScore: Number(candidate.rankScore.toFixed(2)),
    reason: 'LOWER_RANK_THAN_SELECTED_ZONE',
  }));

  return freeze({ selected, rejected, reason: 'BEST_SINGLE_ZONE_SELECTED' });
}
