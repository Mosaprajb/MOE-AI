export function createMarketInternalsProvider({ name = 'market-internals', load } = {}) {
  const normalizedName = String(name || '').trim().toLowerCase();
  if (!normalizedName) throw new Error('Market-internals provider name is required.');
  if (typeof load !== 'function') throw new Error(`Market-internals provider ${normalizedName} requires a load(context) function.`);

  return Object.freeze({
    name: normalizedName,
    async fetchInternals(context = {}) {
      const result = await load(context);
      if (!result || typeof result !== 'object' || Array.isArray(result)) {
        throw new Error(`Market-internals provider ${normalizedName} returned an invalid payload.`);
      }
      return Object.freeze({ ...result, provider: String(result.provider || normalizedName) });
    },
  });
}
