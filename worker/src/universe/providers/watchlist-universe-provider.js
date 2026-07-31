import { createUniverseProvider } from './provider-utils.js';

export function createWatchlistUniverseProvider({ symbols = [], load } = {}) {
  const loader = typeof load === 'function'
    ? load
    : async (context = {}) => [...symbols, ...(Array.isArray(context.watchlist) ? context.watchlist : [])];
  return createUniverseProvider({ source: 'watchlists', load: loader });
}
