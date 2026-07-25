function normalizeSymbol(symbol) {
  return String(symbol || '').trim().toUpperCase();
}

export class FeatureStore {
  constructor() {
    this.snapshots = new Map();
  }

  key(symbol, timeframe) {
    return `${normalizeSymbol(symbol)}:${String(timeframe || '').trim()}`;
  }

  set(snapshot) {
    if (!snapshot || !snapshot.symbol || !snapshot.timeframe) {
      throw new Error('Feature snapshot requires symbol and timeframe');
    }

    const normalized = {
      symbol: normalizeSymbol(snapshot.symbol),
      timeframe: String(snapshot.timeframe),
      timestamp: Number(snapshot.timestamp || Date.now()),
      values: { ...(snapshot.values || {}) },
    };

    this.snapshots.set(this.key(normalized.symbol, normalized.timeframe), normalized);
    return this.get(normalized.symbol, normalized.timeframe);
  }

  get(symbol, timeframe) {
    const snapshot = this.snapshots.get(this.key(symbol, timeframe));
    return snapshot ? { ...snapshot, values: { ...snapshot.values } } : null;
  }

  merge(symbol, timeframe, values, timestamp = Date.now()) {
    const current = this.get(symbol, timeframe);
    return this.set({
      symbol,
      timeframe,
      timestamp,
      values: { ...(current?.values || {}), ...(values || {}) },
    });
  }

  delete(symbol, timeframe) {
    return this.snapshots.delete(this.key(symbol, timeframe));
  }

  clear() {
    this.snapshots.clear();
  }
}

export const featureStore = new FeatureStore();
