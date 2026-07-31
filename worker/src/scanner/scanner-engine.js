function positiveInteger(value, fallback, minimum = 1, maximum = 1000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeUniverse(items) {
  const entries = new Map();
  for (const item of Array.isArray(items) ? items : []) {
    const symbol = String(typeof item === 'string' ? item : item?.symbol || '').trim().toUpperCase();
    if (!symbol) continue;
    const entry = typeof item === 'string' ? { symbol, priority: 0 } : { ...item, symbol };
    const existing = entries.get(symbol);
    if (!existing || Number(entry.priority || 0) > Number(existing.priority || 0)) entries.set(symbol, entry);
  }
  return [...entries.values()];
}

function opportunityInputs(results) {
  return results.flatMap((result) => (Array.isArray(result.opportunities) ? result.opportunities : [])
    .filter(Boolean)
    .map((opportunity) => ({
      opportunity,
      fusion: result.fusion ?? null,
      universePriority: result.universePriority,
    })));
}

export function createScannerEngine({
  marketData,
  pipeline,
  universeManager,
  marketStateService,
  fusionEngine,
  opportunityManager,
  maxConcurrent = 4,
  resultLimit = 20,
} = {}) {
  if (!marketData || typeof marketData.getSnapshot !== 'function') throw new Error('Scanner engine requires a market-data layer.');
  if (!pipeline || typeof pipeline.analyze !== 'function') throw new Error('Scanner engine requires an analysis pipeline.');
  if (marketStateService && typeof marketStateService.getState !== 'function') {
    throw new Error('Scanner market-state service must expose getState(context).');
  }
  if (fusionEngine && typeof fusionEngine.fuse !== 'function') {
    throw new Error('Scanner fusion engine must expose fuse(source, context).');
  }
  if (opportunityManager && typeof opportunityManager.manage !== 'function') {
    throw new Error('Scanner opportunity manager must expose manage(opportunities, context).');
  }
  const concurrency = positiveInteger(maxConcurrent, 4, 1, 16);
  const limit = positiveInteger(resultLimit, 20, 1, 200);

  async function resolveMarketState(context) {
    if (context.marketState && typeof context.marketState === 'object') {
      return { marketState: context.marketState, marketStateError: null };
    }
    if (!marketStateService) return { marketState: null, marketStateError: null };
    try {
      const marketState = await marketStateService.getState(context.marketStateContext || {});
      return { marketState, marketStateError: null };
    } catch (error) {
      return {
        marketState: null,
        marketStateError: error instanceof Error ? error.message : 'Unknown market-state failure.',
      };
    }
  }

  async function scan(items, context = {}) {
    const universe = normalizeUniverse(items);
    const results = new Array(universe.length);
    const stateContext = await resolveMarketState(context);
    let cursor = 0;

    async function worker() {
      while (cursor < universe.length) {
        const index = cursor;
        cursor += 1;
        const entry = universe[index];
        const symbol = entry.symbol;
        const universePriority = Number(entry.priority || 0);
        try {
          const snapshot = await marketData.getSnapshot(symbol, context.marketDataOptions || {});
          const analyzed = await pipeline.analyze(snapshot, {
            ...context,
            symbol,
            universeEntry: entry,
            marketState: stateContext.marketState,
            marketStateError: stateContext.marketStateError,
          });
          const fusion = fusionEngine
            ? fusionEngine.fuse(analyzed, {
              ...context,
              symbol,
              universeEntry: entry,
              marketState: stateContext.marketState,
              marketStateError: stateContext.marketStateError,
            })
            : null;
          const normalized = fusion
            ? {
              ...analyzed,
              fusion,
              accepted: fusion.accepted === true,
              score: Number(fusion.score || 0),
              confidence: Number(fusion.confidence || 0),
              direction: fusion.direction || 'NEUTRAL',
              blockers: fusion.blockers || Object.freeze([]),
              reasons: fusion.reasons || Object.freeze([]),
            }
            : analyzed;
          results[index] = Object.freeze({ ...normalized, universePriority });
        } catch (error) {
          results[index] = Object.freeze({
            symbol,
            score: 0,
            direction: 'NEUTRAL',
            accepted: false,
            executionEnabled: false,
            observationOnly: true,
            universePriority,
            blockers: Object.freeze([`scanner: ${error instanceof Error ? error.message : 'unknown failure'}`]),
            reasons: Object.freeze([]),
            evaluatedAt: new Date().toISOString(),
          });
        }
      }
    }

    await Promise.all(Array.from({ length: Math.min(concurrency, universe.length || 1) }, () => worker()));
    const ranked = results
      .filter(Boolean)
      .sort((left, right) => Number(right.accepted) - Number(left.accepted)
        || right.score - left.score
        || right.universePriority - left.universePriority
        || left.symbol.localeCompare(right.symbol));
    const opportunitySelection = opportunityManager
      ? opportunityManager.manage(opportunityInputs(ranked), {
        ...context,
        topN: context.opportunityLimit,
      })
      : null;

    return Object.freeze({
      observationOnly: true,
      executionEnabled: false,
      scanned: universe.length,
      accepted: ranked.filter((result) => result.accepted).length,
      candidates: Object.freeze(ranked.slice(0, limit)),
      opportunities: opportunitySelection?.selected ?? Object.freeze([]),
      opportunitySelection,
      marketState: stateContext.marketState,
      marketStateError: stateContext.marketStateError,
      completedAt: new Date().toISOString(),
    });
  }

  return Object.freeze({
    scan,
    async scanUniverse(context = {}) {
      if (!universeManager || typeof universeManager.build !== 'function') {
        throw new Error('Scanner engine requires a universe manager for scanUniverse().');
      }
      const universe = await universeManager.build(context.universeContext || context);
      const result = await scan(universe.symbols, context);
      return Object.freeze({ ...result, universe });
    },
  });
}
