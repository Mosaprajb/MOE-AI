import { buildTradePlan } from '../trade-engine.js';
import { eventBus } from './event-bus.js';

export class DecisionPipeline {
  constructor() {
    this.stages = [];
  }

  use(name, handler) {
    if (typeof handler !== 'function') throw new Error('Decision stage handler must be a function');
    this.stages.push({ name: String(name || `stage-${this.stages.length + 1}`), handler });
    return this;
  }

  async run(signal, context = {}, env = {}) {
    let state = {
      signal: { ...(signal || {}) },
      context: { ...(context || {}) },
      env,
      trace: [],
      tradePlan: null,
    };

    await eventBus.emit('decision:started', {
      symbol: state.signal.symbol,
      timestamp: Date.now(),
    });

    for (const stage of this.stages) {
      const startedAt = Date.now();
      const next = await stage.handler(state);
      if (next) state = next;
      state.trace.push({ name: stage.name, durationMs: Date.now() - startedAt });
    }

    state.tradePlan = buildTradePlan(state.signal, state.context, env);

    await eventBus.emit('decision:completed', {
      symbol: state.signal.symbol,
      accepted: state.tradePlan.evaluation.accepted,
      score: state.tradePlan.evaluation.score,
      riskReward: state.tradePlan.evaluation.riskReward,
      trace: state.trace,
      timestamp: Date.now(),
    });

    return state;
  }
}

export const decisionPipeline = new DecisionPipeline();
