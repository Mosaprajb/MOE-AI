import { eventBus } from './event-bus.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function finiteMetric(value, fallback = 0) {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function scoreSummary(summary = {}, weights = {}) {
  const totalTrades = Math.max(0, number(summary.totalTrades));
  if (!totalTrades) return Number.NEGATIVE_INFINITY;

  const winRate = clamp(number(summary.winRate), 0, 1);
  const profitFactor = clamp(finiteMetric(summary.profitFactor, 0), 0, 5);
  const expectancy = number(summary.expectancy);
  const averageR = number(summary.averageR);
  const maxDrawdown = Math.max(0, number(summary.maxDrawdown));
  const netProfit = number(summary.netProfit);
  const sampleConfidence = clamp(totalTrades / Math.max(1, number(weights.targetTrades, 30)), 0, 1);

  const rawScore =
    winRate * number(weights.winRate, 25) +
    profitFactor * number(weights.profitFactor, 15) +
    expectancy * number(weights.expectancy, 2) +
    averageR * number(weights.averageR, 15) +
    netProfit * number(weights.netProfit, 0.01) -
    maxDrawdown * number(weights.maxDrawdown, 0.02);

  return rawScore * (0.5 + sampleConfidence * 0.5);
}

function normalizeCandidate(candidate = {}, index = 0) {
  return {
    id: candidate.id || `candidate-${index + 1}`,
    parameters: clone(candidate.parameters || candidate.params || {}),
    report: clone(candidate.report || {}),
    metadata: clone(candidate.metadata || {}),
  };
}

export class StrategyOptimizationEngine {
  constructor({
    minTrades = 10,
    maxDrawdown = Infinity,
    weights = {},
    maxHistory = 100,
  } = {}) {
    this.minTrades = Math.max(1, Math.floor(number(minTrades, 10)));
    this.maxDrawdown = Number.isFinite(Number(maxDrawdown)) ? Math.max(0, Number(maxDrawdown)) : Infinity;
    this.weights = { ...weights };
    this.maxHistory = Math.max(1, Math.floor(number(maxHistory, 100)));
    this.history = [];
    this.lastResult = null;
    this.unsubscribers = [];
  }

  evaluateCandidate(candidate = {}, index = 0) {
    const normalized = normalizeCandidate(candidate, index);
    const summary = normalized.report?.summary || normalized.report || {};
    const totalTrades = Math.max(0, number(summary.totalTrades));
    const drawdown = Math.max(0, number(summary.maxDrawdown));
    const eligible = totalTrades >= this.minTrades && drawdown <= this.maxDrawdown;

    return {
      ...normalized,
      summary: clone(summary),
      eligible,
      rejectionReason: totalTrades < this.minTrades
        ? 'INSUFFICIENT_TRADES'
        : drawdown > this.maxDrawdown
          ? 'MAX_DRAWDOWN_EXCEEDED'
          : null,
      score: eligible ? scoreSummary(summary, this.weights) : Number.NEGATIVE_INFINITY,
    };
  }

  optimize(candidates = [], context = {}) {
    const evaluated = candidates.map((candidate, index) => this.evaluateCandidate(candidate, index));
    const ranked = evaluated
      .slice()
      .sort((a, b) => b.score - a.score)
      .map((candidate, index) => ({ ...candidate, rank: index + 1 }));

    const winner = ranked.find((candidate) => candidate.eligible) || null;
    const result = {
      generatedAt: Date.now(),
      context: clone(context),
      constraints: {
        minTrades: this.minTrades,
        maxDrawdown: this.maxDrawdown,
      },
      winner: winner ? clone(winner) : null,
      ranked: ranked.map(clone),
      rejected: ranked.filter((candidate) => !candidate.eligible).map(clone),
    };

    this.lastResult = result;
    this.history.unshift(clone(result));
    if (this.history.length > this.maxHistory) this.history.length = this.maxHistory;
    return clone(result);
  }

  async optimizeAndPublish(candidates = [], context = {}) {
    const result = this.optimize(candidates, context);
    await eventBus.emit('optimization:completed', clone(result));
    if (result.winner) {
      await eventBus.emit('optimization:winner-selected', clone(result.winner));
    }
    return result;
  }

  getSnapshot() {
    return {
      lastResult: clone(this.lastResult),
      history: this.history.map(clone),
    };
  }

  clear() {
    this.lastResult = null;
    this.history = [];
  }

  start() {
    if (this.unsubscribers.length) return this;
    this.unsubscribers.push(
      eventBus.on('optimization:requested', (payload = {}) =>
        this.optimizeAndPublish(payload.candidates || [], payload.context || {})),
    );
    return this;
  }

  stop() {
    this.unsubscribers.splice(0).forEach((unsubscribe) => unsubscribe());
  }
}

export function initializeStrategyOptimization(options = {}) {
  return new StrategyOptimizationEngine(options).start();
}

export { scoreSummary };
