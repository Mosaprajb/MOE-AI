import { createUniverseProvider } from './provider-utils.js';

export function createMarketMoversProvider({ source, load } = {}) {
  return createUniverseProvider({ source, load });
}
