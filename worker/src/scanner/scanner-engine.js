function positiveInteger(value, fallback, minimum = 1, maximum = 1000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function normalizeUniverse(symbols) {
  return [...new Set((Array.isArray(symbols) ? symbols : []).map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
}

export function createScannerEngine({ marketData, pipeline, maxConcurrent = 4, resultLimit = 20 } = {}) {
  if (!marketData || typeof marketData.getSnapshot !== 'function') throw new Error('Scanner engine requires a market-data layer.');
  if (!pipeline || typeof pipeline.analyze !== 'function') throw new Error('Scanner engine requires an analysis pipeline.');
  const concurrency = positiveInteger(maxConcurrent, 4, 1, 16);
  const limit = positiveInteger(resultLimit, 20, 1, 200);

  return Object.freeze({
    async scan(symbols, context = {}) {
      const universe = normalizeUniverse(symbols);
      const results = new Array(universe.length);
      let cursor = 0;

      async function worker() {
        while (cursor < universe.length) {
          const index = cursor;
          cursor += 1;
          const symbol = universe[index];
          try {
            const snapshot = await marketData.getSnapshot(symbol, context.marketDataOptions || {});
            results[index] = await pipeline.analyze(snapshot, { ...context, symbol });
          } catch (error) {
            results[index] = Object.freeze({
              symbol,
              score: 0,
              direction: 'NEUTRAL',
              accepted: false,
              executionEnabled: false,
              observationOnly: true,
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
        .sort((left, right) => Number(right.accepted) - Number(left.accepted) || right.score - left.score || left.symbol.localeCompare(right.symbol));

      return Object.freeze({
        observationOnly: true,
        executionEnabled: false,
        scanned: universe.length,
        accepted: ranked.filter((result) => result.accepted).length,
        candidates: Object.freeze(ranked.slice(0, limit)),
        completedAt: new Date().toISOString(),
      });
    },
  });
}
