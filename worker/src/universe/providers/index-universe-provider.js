import { createUniverseProvider } from './provider-utils.js';

export function createIndexUniverseProvider({ source, symbols = [], load } = {}) {
  const loader = typeof load === 'function' ? load : async () => symbols;
  return createUniverseProvider({ source, load: loader });
}
