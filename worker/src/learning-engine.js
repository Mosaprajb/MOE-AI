const LEARNING_VERSION = '1.0.0';

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

function summarizeGroup(key, trades) {
  const wins = trades.filter((trade) => number(trade.realizedPnl) > 0);
  const losses = trades.filter((trade) => number(trade.realizedPnl) < 0);
  const netProfit = trades.reduce((sum, trade) => sum + number(trade.realizedPnl), 0);
  const grossProfit = wins.reduce((sum, trade) => sum + number(trade.realizedPnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + number(trade.realizedPnl), 0));
  const averageConfidence = trades.length
    ? trades.reduce((sum, trade) => sum + number(trade.decisionConfidence), 0) / trades.length
    : 0;

  return {
    key,
    trades: trades.length,
    wins: wins.length,
    losses: losses.length,
    winRate: trades.length ? round((wins.length / trades.length) * 100) : 0,
    netProfit: round(netProfit),
    expectancy: trades.length ? round(netProfit / trades.length) : 0,
    profitFactor: grossLoss > 0 ? round(grossProfit / grossLoss) : grossProfit > 0 ? null : 0,
    averageConfidence: round(averageConfidence),
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

function safeRecommendation(id, title, reason, proposedChange, confidence, sampleSize) {
  return {
    id,
    title,
    reason,
    proposedChange,
    confidence: round(confidence),
    sampleSize,
    autoApply: false,
    requiresApproval: true,
  };
}

function buildRecommendations({ byConfidence, byTimeframe, byMarketRegime, components, minimumSample }) {
  const recommendations = [];

  const strongBand = byConfidence
    .filter((item) => item.trades >= minimumSample && item.winRate >= 60 && item.expectancy > 0)
    .sort((a, b) => b.expectancy - a.expectancy)[0];

  if (strongBand) {
    recommendations.push(safeRecommendation(
      'PREFER_CONFIDENCE_BAND',
      `Prefer confidence band ${strongBand.key}`,
      `This band produced ${strongBand.winRate}% wins with $${strongBand.expectancy} expectancy per trade.`,
      { preferredConfidenceBand: strongBand.key },
      Math.min(95, 50 + strongBand.trades * 2),
      strongBand.trades,
    ));
  }

  const weakTimeframe = byTimeframe
    .filter((item) => item.trades >= minimumSample && item.expectancy < 0)
    .sort((a, b) => a.expectancy - b.expectancy)[0];

  if (weakTimeframe) {
    recommendations.push(safeRecommendation(
      'REDUCE_TIMEFRAME_EXPOSURE',
      `Reduce exposure on ${weakTimeframe.key}`,
      `This timeframe has $${weakTimeframe.expectancy} expectancy and ${weakTimeframe.winRate}% win rate.`,
      { timeframe: weakTimeframe.key, riskMultiplier: 0.75 },
      Math.min(90, 45 + weakTimeframe.trades * 2),
      weakTimeframe.trades,
    ));
  }

  const weakRegime = byMarketRegime
    .filter((item) => item.trades >= minimumSample && item.expectancy < 0)
    .sort((a, b) => a.expectancy - b.expectancy)[0];

  if (weakRegime) {
    recommendations.push(safeRecommendation(
      'TIGHTEN_MARKET_REGIME',
      `Tighten rules in ${weakRegime.key} regime`,
      `Trades in this regime produced $${weakRegime.expectancy} expectancy.`,
      { marketRegime: weakRegime.key, minimumConfidenceAdjustment: 5 },
      Math.min(90, 45 + weakRegime.trades * 2),
      weakRegime.trades,
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
    ));
  }

  return recommendations.slice(0, 10);
}

export function buildLearningReport(trades = [], options = {}) {
  const minimumSample = Math.max(3, number(options.minimumSample, 8));
  const closedTrades = (Array.isArray(trades) ? trades : []).filter((trade) => (
    trade.status === 'CLOSED' && Number.isFinite(Number(trade.realizedPnl))
  ));

  const byConfidence = [...groupBy(closedTrades, (trade) => confidenceBand(trade.decisionConfidence)).entries()]
    .map(([key, group]) => summarizeGroup(key, group));
  const byTimeframe = [...groupBy(closedTrades, (trade) => text(trade.timeframe)).entries()]
    .map(([key, group]) => summarizeGroup(key, group))
    .sort((a, b) => b.expectancy - a.expectancy);
  const byMarketRegime = [...groupBy(closedTrades, (trade) => text(trade.marketRegime)).entries()]
    .map(([key, group]) => summarizeGroup(key, group))
    .sort((a, b) => b.expectancy - a.expectancy);
  const byGrade = [...groupBy(closedTrades, (trade) => text(trade.decisionGrade)).entries()]
    .map(([key, group]) => summarizeGroup(key, group))
    .sort((a, b) => b.expectancy - a.expectancy);
  const components = componentLearning(closedTrades);

  const recommendations = buildRecommendations({
    byConfidence,
    byTimeframe,
    byMarketRegime,
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
    performance: {
      byConfidence,
      byTimeframe,
      byMarketRegime,
      byGrade,
      components,
    },
    recommendations,
  };
}

export { LEARNING_VERSION };
