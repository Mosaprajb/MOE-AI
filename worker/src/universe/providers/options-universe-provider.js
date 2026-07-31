import { createUniverseProvider } from './provider-utils.js';

export function createOptionsUniverseProvider({ source, load } = {}) {
  return createUniverseProvider({ source, load });
}
