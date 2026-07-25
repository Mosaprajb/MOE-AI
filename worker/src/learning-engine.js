const LEARNING_VERSION = '2.0.0';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(number(value) * factor) / factor;
}

function text(value, fallback = 'UNKNOWN') {
  const output = String(value ?? '').trim();
  return output || fallback;
}

function groupBy(items, selector) {
  const groups = new Map();
  for (const item of items) {
    const key = selector(item);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function maximumLosingStreak(trades) {
  const ordered = [...trades].sort((left, right) => {
    const a = Date.parse(left.exitTime || left.closedAt || left.updatedAt || 0);
    const b = Date.parse(right.exitTime || right.closedAt || right.updatedAt || 0);
    return a - b;
  });
  let current = 0;
  let maximum = 0;
  for (const trade of ordered) {
    if (number(trade.realizedPnl) < 0) {
      current += 1;
      maximum = Math.max(maximum, current);
    } else if (number(trade.realizedPnl) > 0) {
      current = 0;
    }
  }
  return maximum;
}

function summarizeGroup(key, trades) {
  const wins = trades.filter((trade) => number(trade.realizedPnl) > 0);
  const losses = trades.filter((trade) => number(trade.realizedPnl) < 0);
  const breakeven = trades.filter((trade) => number(trade.realizedPnl) === 0);
  const netProfit = trades.reduce((sum, trade) => sum + number(trade.realizedPnl), 0);
  const grossProfit = wins.reduce((sum, trade) => sum + number(trade.realizedPnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + number(trade.realizedPnl), 0));
  const averageConfidence = trades.length
    ? trades.reduce((sum, trade) => sum + number(trade.decisionConfidence), 0) / trades.length
    : 0;
  const averageR = trades.length
    ? trades.reduce((sum, trade) => sum + number(trade.realizedR ?? trade.rMultiple), 0) / trades.length
    : 0;

  return {
    key,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    breakeven: breakeven.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100) : 0,
    netProfit: round(netProfit),
    grossProfit: round(grossProfit),
    grossLoss: round(grossLoss),
    expectancy: trades.length ? round(netProfit / trades.length) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    averageConfidence: round(averageConfidence),
    averageR: round(averageR),
    maximumLosingStreak: maximumLosingStreak(trades),
  };
}

function confidenceBand(value) {
  const confidence = number(value);
  if (confidence >= 90) return '90-100';
  if (confidence >= 80) return '80-89';
  if (confidence >= 70) return '70-79';
  if (confidence >= 60) return '60-69';
  return '<60';
}

function sessionName(trade) {
  return text(trade.tradingSession || trade.session || trade.marketSession, 'UNKNOWN');
}

function setupName(trade) {
  return text(trade.setup || trade.signalReason || trade.reason || trade.entryReason, 'UNKNOWN');
}

function componentScores(trade) {
  const replay = trade.decisionReplay || {};
  const source = replay.components || replay.componentScores || replay.breakdown || {};
  if (!source || typeof source !== 'object' || Array.isArray(source)) return [];

  return Object.entries(source).map(([name, value]) => ({
    name,
    score: number(typeof value === 'object' ? value.score ?? value.value : value),
  })).filter((item) => Number.isFinite(item.score));
}

function componentLearning(closedTrades) {
  const observations = new Map();

  for (const trade of closedTrades) {
    const won = number(trade.realizedPnl) > 0;
    for (const component of componentScores(trade)) {
      if (!observations.has(component.name)) observations.set(component.name, []);
      observations.get(component.name).push({ score: component.score, won });
    }
  }

  return [...observations.entries()].map(([name, rows]) => {
    const winning = rows.filter((row) => row.won);
    const losing = rows.filter((row) => !row.won);
    const averageWinningScore = winning.length ? winning.reduce((sum, row) => sum + row.score, 0) / winning.length : 0;
    const averageLosingScore = losing.length ? losing.reduce((sum, row) => sum + row.score, 0) / losing.length : 0;
    return {
      component: name,
      observations: rows.length,
      averageWinningScore: round(averageWinningScore),
      averageLosingScore: round(averageLosingScore),
      separation: round(averageWinningScore - averageLosingScore),
    };
  }).sort((a, b) => Math.abs(b.separation) - Math.abs(a.separation));
}

function safeRecommendation(id, title, reason, proposedChange, confidence, sampleSize, evidence = {}) {
  return {
    id,
    title,
    reason,
    proposedChange,
    confidence: round(confidence),
    sampleSize,
    evidence,
    autoApply: false,
    requiresApproval: true,
  };
}

function strongestPositive(groups, minimumSample) {
  return groups
    .filter((item) => item.trades >= minimumSample && item.expectancy > 0 && item.winRate >= 55)
    .sort((a, b) => (b.expectancy - a.expectancy) || (b.profitFactor ?? 999) - (a.profitFactor ?? 999))[0] || null;
}

function weakestNegative(groups, minimumSample) {
  return groups
    .filter((item) => item.trades >= minimumSample && item.expectancy < 0)
    .sort((a, b) => a.expectancy - b.expectancy)[0] || null;
}

function buildRecommendations({ byConfidence, byTimeframe, byMarketRegime, bySession, bySetup, components, minimumSample }) {
  const recommendations = [];
  const strongBand = strongestPositive(byConfidence, minimumSample);
  const strongSetup = strongestPositive(bySetup, minimumSample);
  const weakTimeframe = weakestNegative(byTimeframe, minimumSample);
  const weakRegime = weakestNegative(byMarketRegime, minimumSample);
  const weakSession = weakestNegative(bySession, minimumSample);

  if (strongBand) {
    recommendations.push(safeRecommendation(
      'PREFER_CONFIDENCE_BAND',
      `Prefer confidence band ${strongBand.key}`,
      `This band produced a ${strongBand.winRate}% win rate and ${strongBand.expectancy} USD expectancy per trade.`,
      { preferredConfidenceBand: strongBand.key },
      Math.min(95, 50 + strongBand.trades * 2),
      strongBand.trades,
      strongBand,
    ));
  }

  if (strongSetup) {
    recommendations.push(safeRecommendation(
      'PREFER_SETUP',
      `Prioritize ${strongSetup.key} setups`,
      `This setup produced a ${strongSetup.winRate}% win rate and ${strongSetup.expectancy} USD expectancy per trade.`,
      { setup: strongSetup.key, rankingBoost: 5 },
      Math.min(94, 50 + strongSetup.trades * 2),
      strongSetup.trades,
      strongSetup,
    ));
  }

  if (weakTimeframe) {
    recommendations.push(safeRecommendation(
      'REDUCE_TIMEFRAME_EXPOSURE',
      `Reduce exposure on ${weakTimeframe.key}`,
      `This timeframe has ${weakTimeframe.expectancy} USD expectancy and a ${weakTimeframe.winRate}% win rate.`,
      { timeframe: weakTimeframe.key, riskMultiplier: 0.75 },
      Math.min(90, 45 + weakTimeframe.trades * 2),
      weakTimeframe.trades,
      weakTimeframe,
    ));
  }

  if (weakRegime) {
    recommendations.push(safeRecommendation(
      'TIGHTEN_MARKET_REGIME',
      `Tighten rules in ${weakRegime.key} markets`,
      `Trades in this regime produced ${weakRegime.expectancy} USD expectancy.`,
      { marketRegime: weakRegime.key, minimumConfidenceAdjustment: 5 },
      Math.min(90, 45 + weakRegime.trades * 2),
      weakRegime.trades,
      weakRegime,
    ));
  }

  if (weakSession) {
    recommendations.push(safeRecommendation(
      'REDUCE_SESSION_EXPOSURE',
      `Reduce exposure during ${weakSession.key}`,
      `This session produced ${weakSession.expectancy} USD expectancy with a ${weakSession.winRate}% win rate.`,
      { tradingSession: weakSession.key, riskMultiplier: 0.65 },
      Math.min(90, 45 + weakSession.trades * 2),
      weakSession.trades,
      weakSession,
    ));
  }

  const strongestComponent = components.find((item) => item.observations >= minimumSample && item.separation >= 5);
  if (strongestComponent) {
    recommendations.push(safeRecommendation(
      'INCREASE_COMPONENT_WEIGHT',
      `Increase weight for ${strongestComponent.component}`,
      `Winning trades scored ${strongestComponent.separation} points higher than losing trades on this component.`,
      { component: strongestComponent.component, weightAdjustmentPercent: 10 },
      Math.min(92, 50 + strongestComponent.observations * 2),
      strongestComponent.observations,
      strongestComponent,
    ));
  }

  return recommendations.slice(0, 12);
}

function promotionGate(overall, options = {}) {
  const minimumTrades = Math.max(10, number(options.promotionMinimumTrades, 30));
  const minimumWinRate = number(options.promotionMinimumWinRate, 55);
  const minimumProfitFactor = number(options.promotionMinimumProfitFactor, 1.3);
  const minimumExpectancy = number(options.promotionMinimumExpectancy, 0.01);
  const maximumLosingStreak = Math.max(1, number(options.promotionMaximumLosingStreak, 4));
  const checks = [
    { id: 'SAMPLE_SIZE', label: 'Closed trade sample', passed: overall.trades >= minimumTrades, actual: overall.trades, required: minimumTrades },
    { id: 'WIN_RATE', label: 'Win rate', passed: overall.winRate >= minimumWinRate, actual: overall.winRate, required: minimumWinRate },
    { id: 'EXPECTANCY', label: 'Expectancy', passed: overall.expectancy >= minimumExpectancy, actual: overall.expectancy, required: minimumExpectancy },
    { id: 'PROFIT_FACTOR', label: 'Profit factor', passed: overall.profitFactor == null || overall.profitFactor >= minimumProfitFactor, actual: overall.profitFactor, required: minimumProfitFactor },
    { id: 'LOSING_STREAK', label: 'Maximum losing streak', passed: overall.maximumLosingStreak <= maximumLosingStreak, actual: overall.maximumLosingStreak, required: maximumLosingStreak },
  ];
  const blockers = checks.filter((item) => !item.passed).map((item) => item.id);
  return {
    status: blockers.length ? 'NOT_READY' : 'READY_FOR_SUPERVISED_LIVE_TEST',
    ready: blockers.length === 0,
    blockers,
    checks,
    policy: {
      minimumTrades,
      minimumWinRate,
      minimumProfitFactor,
      minimumExpectancy,
      maximumLosingStreak,
    },
  };
}

function dataQuality(closedTrades) {
  const required = ['timeframe', 'marketRegime', 'decisionGrade', 'decisionConfidence'];
  const missing = Object.fromEntries(required.map((field) => [
    field,
    closedTrades.filter((trade) => trade[field] == null || trade[field] === '').length,
  ]));
  const complete = closedTrades.filter((trade) => required.every((field) => trade[field] != null && trade[field] !== '')).length;
  return {
    total: closedTrades.length,
    complete,
    completenessPercent: closedTrades.length ? round((complete / closedTrades.length) * 100) : 0,
    missing,
  };
}

export function buildLearningReport(trades = [], options = {}) {
  const minimumSample = Math.max(3, number(options.minimumSample, 8));
  const closedTrades = (Array.isArray(trades) ? trades : []).filter((trade) => (
    trade.status === 'CLOSED' && Number.isFinite(Number(trade.realizedPnl))
  ));

  const groupSummary = (selector) => [...groupBy(closedTrades, selector).entries()]
    .map(([key, group]) => summarizeGroup(key, group))
    .sort((a, b) => b.expectancy - a.expectancy);

  const overall = summarizeGroup('ALL', closedTrades);
  const byConfidence = groupSummary((trade) => confidenceBand(trade.decisionConfidence));
  const byTimeframe = groupSummary((trade) => text(trade.timeframe));
  const byMarketRegime = groupSummary((trade) => text(trade.marketRegime));
  const byGrade = groupSummary((trade) => text(trade.decisionGrade));
  const bySession = groupSummary(sessionName);
  const bySetup = groupSummary(setupName);
  const bySector = groupSummary((trade) => text(trade.sector));
  const bySymbol = groupSummary((trade) => text(trade.symbol)).slice(0, 50);
  const components = componentLearning(closedTrades);

  const recommendations = buildRecommendations({
    byConfidence,
    byTimeframe,
    byMarketRegime,
    bySession,
    bySetup,
    components,
    minimumSample,
  });

  return {
    version: LEARNING_VERSION,
    generatedAt: new Date().toISOString(),
    status: closedTrades.length >= minimumSample ? 'LEARNING_ACTIVE' : 'COLLECTING_DATA',
    closedTradesAnalyzed: closedTrades.length,
    minimumSample,
    safety: {
      autoApplyEnabled: false,
      approvalRequired: true,
      liveTradingChangesAllowed: false,
    },
    promotionGate: promotionGate(overall, options),
    dataQuality: dataQuality(closedTrades),
    performance: {
      overall,
      byConfidence,
      byTimeframe,
      byMarketRegime,
      byGrade,
      bySession,
      bySetup,
      bySector,
      bySymbol,
      components,
    },
    recommendations,
  };
}

export { LEARNING_VERSION };
