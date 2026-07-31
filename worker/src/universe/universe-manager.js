import { clamp, normalizeSymbol } from './providers/provider-utils.js';

export const UNIVERSE_SOURCES = Object.freeze([
  'sp500',
  'nasdaq100',
  'russell2000',
  'topVolume',
  'topRelativeVolume',
  'topGainers',
  'topLosers',
  'highOptionsVolume',
  'highGammaExposure',
  'earningsToday',
  'watchlists',
]);

export const DEFAULT_SOURCE_WEIGHTS = Object.freeze({
  sp500: 12,
  nasdaq100: 14,
  russell2000: 8,
  topVolume: 16,
  topRelativeVolume: 20,
  topGainers: 15,
  topLosers: 10,
  highOptionsVolume: 18,
  highGammaExposure: 20,
  earningsToday: 10,
  watchlists: 22,
});

function positiveInteger(value, fallback, minimum = 1, maximum = 10_000) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? Math.min(maximum, Math.max(minimum, parsed)) : fallback;
}

function providerMap(providers) {
  if (Array.isArray(providers)) {
    return Object.fromEntries(providers.filter(Boolean).map((provider) => [provider.source, provider]));
  }
  return providers && typeof providers === 'object' ? { ...providers } : {};
}

function contributionFor(row, sourceWeight, sourceLimit) {
  const rankQuality = sourceLimit > 1 ? 1 - ((Math.max(1, row.rank) - 1) / sourceLimit) : 1;
  const scoreQuality = clamp(row.score) / 100;
  return sourceWeight + (rankQuality * sourceWeight * 0.5) + (scoreQuality * sourceWeight * 0.5);
}

export function createUniverseManager({
  providers = {},
  sourceWeights = {},
  minimumPriority = 1,
  maxSymbols = 500,
  perSourceLimit = 250,
  excludedSymbols = [],
} = {}) {
  const configuredProviders = providerMap(providers);
  const weights = Object.freeze({ ...DEFAULT_SOURCE_WEIGHTS, ...sourceWeights });
  const minimum = clamp(minimumPriority);
  const maximum = positiveInteger(maxSymbols, 500, 1, 10_000);
  const sourceMaximum = positiveInteger(perSourceLimit, 250, 1, 5_000);
  const excluded = new Set((Array.isArray(excludedSymbols) ? excludedSymbols : []).map(normalizeSymbol).filter(Boolean));

  return Object.freeze({
    async build(context = {}) {
      const records = new Map();
      const failures = [];
      const sourceCounts = {};

      await Promise.all(UNIVERSE_SOURCES.map(async (source) => {
        const provider = configuredProviders[source];
        if (!provider || typeof provider.load !== 'function') {
          sourceCounts[source] = 0;
          return;
        }

        try {
          const loaded = await provider.load({ ...context, source });
          const rows = (Array.isArray(loaded) ? loaded : []).slice(0, sourceMaximum);
          sourceCounts[source] = rows.length;

          for (let index = 0; index < rows.length; index += 1) {
            const row = rows[index];
            const symbol = normalizeSymbol(typeof row === 'string' ? row : row?.symbol);
            if (!symbol || excluded.has(symbol)) continue;

            const existing = records.get(symbol) || {
              symbol,
              rawPriority: 0,
              sources: new Set(),
              sourceScores: {},
              metadata: {},
            };
            const normalizedRow = typeof row === 'string'
              ? { symbol, rank: index + 1, score: 0, metadata: {} }
              : row;
            const sourceWeight = Math.max(0, Number(weights[source]) || 0);
            const contribution = contributionFor(normalizedRow, sourceWeight, Math.max(1, rows.length));

            existing.rawPriority += contribution;
            existing.sources.add(source);
            existing.sourceScores[source] = Number(contribution.toFixed(4));
            if (normalizedRow.metadata && typeof normalizedRow.metadata === 'object') {
              existing.metadata = { ...existing.metadata, [source]: { ...normalizedRow.metadata } };
            }
            records.set(symbol, existing);
          }
        } catch (error) {
          sourceCounts[source] = 0;
          failures.push(Object.freeze({
            source,
            message: error instanceof Error ? error.message : 'Unknown universe provider failure.',
          }));
        }
      }));

      const highestRawPriority = Math.max(1, ...[...records.values()].map((record) => record.rawPriority));
      const symbols = [...records.values()]
        .map((record) => Object.freeze({
          symbol: record.symbol,
          priority: Number(clamp((record.rawPriority / highestRawPriority) * 100).toFixed(2)),
          sources: Object.freeze([...record.sources].sort()),
          sourceScores: Object.freeze({ ...record.sourceScores }),
          metadata: Object.freeze({ ...record.metadata }),
        }))
        .filter((record) => record.priority >= minimum)
        .sort((left, right) => right.priority - left.priority || right.sources.length - left.sources.length || left.symbol.localeCompare(right.symbol))
        .slice(0, maximum)
        .map((record, index) => Object.freeze({ ...record, rank: index + 1 }));

      return Object.freeze({
        symbols: Object.freeze(symbols),
        sourceCounts: Object.freeze({ ...sourceCounts }),
        failures: Object.freeze(failures),
        generatedAt: new Date().toISOString(),
      });
    },
  });
}
