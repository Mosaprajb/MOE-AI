const SYMBOL_PATTERN = /^[A-Z][A-Z0-9.-]{0,14}$/;

export function normalizeSymbol(value) {
  const symbol = String(value || '').trim().toUpperCase();
  return SYMBOL_PATTERN.test(symbol) ? symbol : null;
}

export function clamp(value, minimum = 0, maximum = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : minimum;
}

export function normalizeUniverseRows(rows) {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const normalized = [];

  for (let index = 0; index < sourceRows.length; index += 1) {
    const row = sourceRows[index];
    const symbol = normalizeSymbol(typeof row === 'string' ? row : row?.symbol);
    if (!symbol) continue;

    normalized.push(Object.freeze({
      symbol,
      rank: Math.max(1, Math.floor(Number(row?.rank) || index + 1)),
      score: clamp(row?.score ?? row?.priority ?? 0),
      metadata: row && typeof row === 'object' && row.metadata && typeof row.metadata === 'object'
        ? Object.freeze({ ...row.metadata })
        : Object.freeze({}),
    }));
  }

  return Object.freeze(normalized);
}

export function createUniverseProvider({ source, load }) {
  const normalizedSource = String(source || '').trim();
  if (!normalizedSource) throw new Error('Universe provider source is required.');
  if (typeof load !== 'function') throw new Error(`Universe provider ${normalizedSource} requires a load(context) function.`);

  return Object.freeze({
    source: normalizedSource,
    async load(context = {}) {
      return normalizeUniverseRows(await load(context));
    },
  });
}
