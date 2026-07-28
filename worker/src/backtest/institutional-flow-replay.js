import { evaluateInstitutionalFlowPipeline } from '../institutional-flow/engine.js';
import { buildOrderFlowSnapshot } from '../order-flow/snapshot.js';
import { createOrderFlowConfig } from '../order-flow/config.js';

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) freeze(child);
  return value;
}

function barTimestamp(bar) {
  const value = Number(bar.timestamp ?? bar.t);
  if (Number.isFinite(value)) return value;
  return new Date(bar.timestamp ?? bar.t).getTime();
}

function closedBar(bar) {
  return {
    t: barTimestamp(bar),
    o: Number(bar.open ?? bar.o),
    h: Number(bar.high ?? bar.h),
    l: Number(bar.low ?? bar.l),
    c: Number(bar.close ?? bar.c),
    v: Number(bar.volume ?? bar.v ?? 0),
    complete: true,
    session: bar.session || 'REGULAR',
  };
}

function sliceEvents(events, start, end) {
  return (events || []).filter((event) => {
    const timestamp = Number.isFinite(Number(event.timestamp ?? event.t))
      ? Number(event.timestamp ?? event.t)
      : new Date(event.timestamp ?? event.t).getTime();
    return timestamp >= start && timestamp <= end;
  });
}

function resolveOutcome(candidate, futureBars) {
  if (!candidate) return { outcome: 'NO_CANDIDATE', exitPrice: null, exitIndex: null, rewardRiskRealized: 0 };
  const direction = candidate.direction;
  const stop = Number(candidate.stopLoss);
  const target = Number(candidate.takeProfit);
  const entry = Number(candidate.entry);
  if (![stop, target, entry].every(Number.isFinite)) return { outcome: 'INVALID_PLAN', exitPrice: null, exitIndex: null, rewardRiskRealized: 0 };
  const risk = Math.abs(entry - stop);
  for (let index = 0; index < futureBars.length; index += 1) {
    const bar = futureBars[index];
    const high = Number(bar.high ?? bar.h);
    const low = Number(bar.low ?? bar.l);
    const stopHit = direction === 'LONG' ? low <= stop : high >= stop;
    const targetHit = direction === 'LONG' ? high >= target : low <= target;
    if (stopHit && targetHit) return { outcome: 'AMBIGUOUS_SAME_BAR', exitPrice: stop, exitIndex: index, rewardRiskRealized: -1 };
    if (stopHit) return { outcome: 'STOPPED', exitPrice: stop, exitIndex: index, rewardRiskRealized: -1 };
    if (targetHit) return { outcome: 'TARGET_REACHED', exitPrice: target, exitIndex: index, rewardRiskRealized: risk > 0 ? Math.abs(target - entry) / risk : 0 };
  }
  const last = futureBars.at(-1);
  if (!last) return { outcome: 'NO_FUTURE_BARS', exitPrice: null, exitIndex: null, rewardRiskRealized: 0 };
  const exitPrice = Number(last.close ?? last.c);
  const pnl = direction === 'LONG' ? exitPrice - entry : entry - exitPrice;
  return { outcome: 'TIME_EXIT', exitPrice, exitIndex: futureBars.length - 1, rewardRiskRealized: risk > 0 ? pnl / risk : 0 };
}

export async function replayInstitutionalFlow({
  symbol,
  bars = [],
  trades = [],
  quotes = [],
  timeframe = '5m',
  tickSize = 0.01,
  evaluator = evaluateInstitutionalFlowPipeline,
  orderFlowConfig = null,
} = {}) {
  const config = orderFlowConfig || createOrderFlowConfig();
  const normalizedBars = bars.map(closedBar).filter((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
  if (normalizedBars.length < config.replay.minimumBars) throw new Error('Insufficient bars for institutional-flow replay');
  const startIndex = Math.max(config.replay.minimumBars - 1, normalizedBars.length - config.replay.maximumLookbackBars);
  const events = [];
  let lastCandidateIndex = -Infinity;

  for (let index = startIndex; index < normalizedBars.length - 1; index += 1) {
    if (index - lastCandidateIndex < config.replay.candidateCooldownBars) continue;
    const visibleBars = normalizedBars.slice(0, index + 1);
    const evaluationTime = visibleBars.at(-1).t + 1;
    const orderFlowStartIndex = Math.max(0, index - config.replay.orderFlowWindowBars + 1);
    const orderFlowStart = normalizedBars[orderFlowStartIndex].t;
    const visibleTrades = sliceEvents(trades, orderFlowStart, evaluationTime);
    const visibleQuotes = sliceEvents(quotes, orderFlowStart, evaluationTime);
    const orderFlow = visibleTrades.length
      ? buildOrderFlowSnapshot({
        trades: visibleTrades,
        quotes: visibleQuotes,
        now: evaluationTime,
        tickSize,
        startPrice: normalizedBars[orderFlowStartIndex].o,
        endPrice: visibleBars.at(-1).c,
        config,
      })
      : null;
    const result = await evaluator({ symbol, bars: visibleBars, timeframe, now: evaluationTime, tickSize, orderFlow });
    if (!result.pipelinePassed || !result.candidate) continue;
    const futureBars = normalizedBars.slice(index + 1, index + 1 + config.replay.maximumHoldingBars);
    const outcome = resolveOutcome(result.candidate, futureBars);
    events.push(freeze({
      symbol,
      signalIndex: index,
      signalTime: visibleBars.at(-1).t,
      pipelineScore: result.pipelineScore,
      direction: result.direction,
      dataMode: result.dataMode,
      candidate: result.candidate,
      outcome,
      executionAllowed: false,
    }));
    lastCandidateIndex = index;
  }

  const wins = events.filter((event) => event.outcome.outcome === 'TARGET_REACHED').length;
  const losses = events.filter((event) => event.outcome.outcome === 'STOPPED').length;
  const ambiguous = events.filter((event) => event.outcome.outcome === 'AMBIGUOUS_SAME_BAR').length;
  const totalRealizedR = events.reduce((sum, event) => sum + Number(event.outcome.rewardRiskRealized || 0), 0);

  return freeze({
    symbol,
    timeframe,
    barsEvaluated: normalizedBars.length,
    candidateCount: events.length,
    wins,
    losses,
    ambiguous,
    winRate: wins + losses > 0 ? wins / (wins + losses) : 0,
    totalRealizedR,
    averageRealizedR: events.length ? totalRealizedR / events.length : 0,
    events,
    replayOnly: true,
    observationOnly: true,
    mode: 'PAPER_TRADING',
    executionAllowed: false,
    automaticSubmissionAllowed: false,
    liveExecutionAllowed: false,
  });
}
