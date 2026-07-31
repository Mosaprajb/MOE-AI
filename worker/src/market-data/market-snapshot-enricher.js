function loaderEntry(key, loader) {
  return typeof loader === 'function' ? { key, loader } : null;
}

export function mergeMarketSnapshotInput(raw = {}, enrichment = {}) {
  if (!enrichment || typeof enrichment !== 'object' || Array.isArray(enrichment)) return raw;
  return {
    ...raw,
    ...enrichment,
    quote: { ...(raw.quote || {}), ...(enrichment.quote || {}) },
    profile: { ...(raw.profile || raw.company || raw.fundamentals || {}), ...(enrichment.profile || enrichment.company || enrichment.fundamentals || {}) },
    company: { ...(raw.company || {}), ...(enrichment.company || {}) },
    fundamentals: { ...(raw.fundamentals || {}), ...(enrichment.fundamentals || {}) },
    technicals: { ...(raw.technicals || raw.indicators || {}), ...(enrichment.technicals || enrichment.indicators || {}) },
    options: { ...(raw.options || raw.optionsFlow || {}), ...(enrichment.options || enrichment.optionsFlow || {}) },
    sessionInfo: { ...(raw.sessionInfo || {}), ...(enrichment.sessionInfo || {}) },
    metadata: { ...(raw.metadata || {}), ...(enrichment.metadata || {}) },
    news: enrichment.news ?? raw.news ?? raw.headlines ?? [],
  };
}

export function createMarketSnapshotEnricher({
  name = 'market-snapshot-enricher',
  load,
  loadProfile,
  loadNews,
  loadOptions,
  loadSession,
  failOnError = false,
} = {}) {
  const normalizedName = String(name || '').trim().toLowerCase();
  if (!normalizedName) throw new Error('Market snapshot enricher name is required.');
  const loaders = [
    loaderEntry('profile', loadProfile),
    loaderEntry('news', loadNews),
    loaderEntry('options', loadOptions),
    loaderEntry('sessionInfo', loadSession),
  ].filter(Boolean);
  if (typeof load !== 'function' && !loaders.length) {
    throw new Error(`Market snapshot enricher ${normalizedName} requires at least one loader.`);
  }

  return Object.freeze({
    name: normalizedName,
    async enrichSnapshot(symbol, raw, options = {}) {
      const output = {};
      const errors = [];

      if (typeof load === 'function') {
        try {
          const result = await load(symbol, raw, options);
          if (result && typeof result === 'object' && !Array.isArray(result)) Object.assign(output, result);
          else if (result !== undefined && result !== null) throw new Error('load() returned an invalid enrichment payload.');
        } catch (error) {
          errors.push({ component: 'snapshot', message: error instanceof Error ? error.message : 'Unknown enrichment failure.' });
        }
      }

      const settled = await Promise.all(loaders.map(async ({ key, loader }) => {
        try {
          return { key, value: await loader(symbol, raw, options) };
        } catch (error) {
          return { key, error: error instanceof Error ? error.message : 'Unknown enrichment failure.' };
        }
      }));
      for (const item of settled) {
        if (item.error) errors.push({ component: item.key, message: item.error });
        else if (item.value !== undefined && item.value !== null) output[item.key] = item.value;
      }

      if (errors.length && failOnError) {
        const error = new Error(`Market snapshot enrichment failed for ${symbol}: ${errors.map((item) => `${item.component}: ${item.message}`).join(' | ')}`);
        error.details = Object.freeze(errors.map((item) => Object.freeze({ ...item })));
        throw error;
      }

      output.metadata = {
        ...(output.metadata || {}),
        enrichmentProvider: normalizedName,
        enrichmentErrors: Object.freeze(errors.map((item) => Object.freeze({ ...item }))),
      };
      return Object.freeze(output);
    },
  });
}
