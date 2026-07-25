import { eventBus } from './event-bus.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function normalizeSymbols(symbols = []) {
  return [...new Set(symbols.map((symbol) => String(symbol || '').trim().toUpperCase()).filter(Boolean))];
}

function opportunityScore(opportunity = {}) {
  const confidence = number(opportunity.confidence);
  const riskReward = number(opportunity.riskReward);
  const liquidityScore = number(opportunity.liquidityScore, opportunity.liquidity === 'high' ? 1 : 0.5);
  const freshness = opportunity.expiresAt
    ? Math.max(0, Math.min(1, (number(opportunity.expiresAt) - Date.now()) / (60 * 60 * 1000)))
    : 0.5;

  return confidence * 0.5 + Math.min(riskReward / 5, 1) * 0.3 + liquidityScore * 0.15 + freshness * 0.05;
}

export class MultiSymbolScanner {
  constructor({
    symbols = [],
    marketData,
    evaluator,
    concurrency = 5,
    maxOpportunities = 10,
    minimumScore = 0,
  } = {}) {
    this.symbols = normalizeSymbols(symbols);
    this.marketData = marketData;
    this.evaluator = evaluator;
    this.concurrency = Math.max(1, Math.floor(number(concurrency, 5)));
    this.maxOpportunities = Math.max(1, Math.floor(number(maxOpportunities, 10)));
    this.minimumScore = number(minimumScore);
    this.lastScan = null;
    this.scanning = false;
  }

  setSymbols(symbols = []) {
    this.symbols = normalizeSymbols(symbols);
    return [...this.symbols];
  }

  addSymbols(symbols = []) {
    return this.setSymbols([...this.symbols, ...symbols]);
  }

  removeSymbols(symbols = []) {
    const removed = new Set(normalizeSymbols(symbols));
    return this.setSymbols(this.symbols.filter((symbol) => !removed.has(symbol)));
  }

  async evaluateSymbol(symbol, context = {}) {
    try {
      if (!this.marketData?.getSnapshot) {
        throw new Error('MARKET_DATA_NOT_CONFIGURED');
      }
      if (!this.evaluator) {
        throw new Error('SCANNER_EVALUATOR_NOT_CONFIGURED');
      }

      const snapshot = await this.marketData.getSnapshot(symbol, context);
      const result = typeof this.evaluator === 'function'
        ? await this.evaluator({ symbol, snapshot, context })
        : await this.evaluator.evaluate({ symbol, snapshot, context });

      const opportunities = (Array.isArray(result) ? result : [result])
        .filter(Boolean)
        .map((opportunity) => ({
          ...clone(opportunity),
          symbol,
          scannerScore: opportunityScore(opportunity),
          scannedAt: Date.now(),
        }))
        .filter((opportunity) => opportunity.accepted !== false)
        .filter((opportunity) => opportunity.scannerScore >= this.minimumScore);

      return { symbol, success: true, opportunities };
    } catch (error) {
      return {
        symbol,
        success: false,
        opportunities: [],
        error: error?.message || String(error),
      };
    }
  }

  async scan({ symbols = this.symbols, context = {} } = {}) {
    if (this.scanning) return { scanned: false, reason: 'SCAN_ALREADY_RUNNING', previous: clone(this.lastScan) };

    const universe = normalizeSymbols(symbols);
    if (!universe.length) return { scanned: false, reason: 'EMPTY_SYMBOL_UNIVERSE' };

    this.scanning = true;
    const startedAt = Date.now();
    await eventBus.emit('scanner:started', { symbols: universe, startedAt });

    try {
      const results = [];
      let cursor = 0;
      const workers = Array.from({ length: Math.min(this.concurrency, universe.length) }, async () => {
        while (cursor < universe.length) {
          const index = cursor;
          cursor += 1;
          const result = await this.evaluateSymbol(universe[index], context);
          results[index] = result;
          await eventBus.emit('scanner:symbol-completed', clone(result));
        }
      });

      await Promise.all(workers);

      const opportunities = results
        .flatMap((result) => result?.opportunities || [])
        .sort((a, b) => b.scannerScore - a.scannerScore)
        .slice(0, this.maxOpportunities);

      const completedAt = Date.now();
      this.lastScan = {
        scanned: true,
        startedAt,
        completedAt,
        durationMs: completedAt - startedAt,
        symbolCount: universe.length,
        successCount: results.filter((result) => result?.success).length,
        failureCount: results.filter((result) => !result?.success).length,
        opportunities,
        results,
      };

      await eventBus.emit('scanner:completed', clone(this.lastScan));
      for (const opportunity of opportunities) {
        await eventBus.emit('scanner:opportunity-ranked', clone(opportunity));
      }

      return clone(this.lastScan);
    } finally {
      this.scanning = false;
    }
  }

  getSnapshot() {
    return {
      symbols: [...this.symbols],
      scanning: this.scanning,
      lastScan: clone(this.lastScan),
    };
  }
}

export function initializeMultiSymbolScanner(options = {}) {
  return new MultiSymbolScanner(options);
}

export { opportunityScore };
