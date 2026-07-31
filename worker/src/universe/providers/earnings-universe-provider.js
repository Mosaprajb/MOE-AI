import { createUniverseProvider } from './provider-utils.js';

export function createEarningsUniverseProvider({ load } = {}) {
  return createUniverseProvider({ source: 'earningsToday', load });
}
