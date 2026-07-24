const DEFAULT_CORRELATION_GROUPS = {
  SEMICONDUCTORS: ['NVDA', 'AMD', 'AVGO', 'INTC', 'MU', 'ARM', 'SMH', 'SOXL'],
  MEGA_CAP_TECH: ['AAPL', 'MSFT', 'META', 'GOOGL', 'GOOG', 'AMZN', 'QQQ', 'TQQQ'],
  EV: ['TSLA', 'RIVN', 'LCID'],
  FINANCIALS: ['JPM', 'BAC', 'WFC', 'GS', 'MS', 'XLF'],
  ENERGY: ['XOM', 'CVX', 'COP', 'OXY', 'XLE'],
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizeSymbol(value) {
  return String(value || '').trim().toUpperCase();
}

function groupFor(symbol, groups = DEFAULT_CORRELATION_GROUPS) {
  const normalized = normalizeSymbol(symbol);
  return Object.entries(groups).find(([, symbols]) => symbols.includes(normalized))?.[0] || null;
}

export function evaluatePortfolioRisk({ signal, plan, portfolio = {}, env = {} }) {
  const positions = Array.isArray(portfolio.openPositions) ? portfolio.openPositions : [];
  const pendingOrders = Array.isArray(portfolio.pendingOrders) ? portfolio.pendingOrders : [];
  const reasons = [];

  const maxOpenPositions = Math.max(1, Math.floor(number(env.MOE_MAX_OPEN_POSITIONS, 4)));
  const maxPortfolioRiskPercent = number(env.MOE_MAX_PORTFOLIO_RISK_PERCENT, 3);
  const maxCorrelatedPositions = Math.max(1, Math.floor(number(env.MOE_MAX_CORRELATED_POSITIONS, 1)));
  const maxDailyTrades = Math.max(1, Math.floor(number(env.MOE_MAX_DAILY_TRADES, 4)));
  const dailyTrades = Math.max(0, Math.floor(number(portfolio.dailyTrades, 0)));
  const accountEquity = number(portfolio.accountEquity, 0);

  if (positions.length >= maxOpenPositions) reasons.push('Maximum open positions reached');
  if (dailyTrades >= maxDailyTrades) reasons.push('Maximum daily trades reached');

  const duplicate = [...positions, ...pendingOrders].some((item) => normalizeSymbol(item.symbol) === signal.symbol);
  if (duplicate) reasons.push('Symbol already has an open position or pending order');

  const currentRiskDollars = positions.reduce((sum, item) => {
    if (Number.isFinite(Number(item.riskDollars))) return sum + Number(item.riskDollars);
    if (Number.isFinite(Number(item.riskPercent)) && accountEquity > 0) {
      return sum + accountEquity * (Number(item.riskPercent) / 100);
    }
    return sum;
  }, 0);

  const proposedRiskDollars = number(plan?.sizing?.estimatedRisk, 0);
  const totalRiskDollars = currentRiskDollars + proposedRiskDollars;
  const totalRiskPercent = accountEquity > 0 ? (totalRiskDollars / accountEquity) * 100 : null;

  if (totalRiskPercent != null && totalRiskPercent > maxPortfolioRiskPercent) {
    reasons.push(`Portfolio risk ${totalRiskPercent.toFixed(2)}% exceeds ${maxPortfolioRiskPercent}%`);
  }

  const signalGroup = groupFor(signal.symbol);
  const correlatedPositions = signalGroup
    ? positions.filter((item) => groupFor(item.symbol) === signalGroup)
    : [];

  if (signalGroup && correlatedPositions.length >= maxCorrelatedPositions) {
    reasons.push(`Correlation limit reached for ${signalGroup}`);
  }

  const sector = String(portfolio.signalSector || '').trim().toUpperCase();
  const maxSectorPositions = Math.max(1, Math.floor(number(env.MOE_MAX_SECTOR_POSITIONS, 2)));
  if (sector) {
    const sectorCount = positions.filter((item) => String(item.sector || '').trim().toUpperCase() === sector).length;
    if (sectorCount >= maxSectorPositions) reasons.push(`Sector exposure limit reached for ${sector}`);
  }

  return {
    accepted: reasons.length === 0,
    reasons,
    metrics: {
      openPositions: positions.length,
      maxOpenPositions,
      dailyTrades,
      maxDailyTrades,
      currentRiskDollars: Number(currentRiskDollars.toFixed(2)),
      proposedRiskDollars: Number(proposedRiskDollars.toFixed(2)),
      totalRiskDollars: Number(totalRiskDollars.toFixed(2)),
      totalRiskPercent: totalRiskPercent == null ? null : Number(totalRiskPercent.toFixed(2)),
      maxPortfolioRiskPercent,
      correlationGroup: signalGroup,
      correlatedPositions: correlatedPositions.map((item) => normalizeSymbol(item.symbol)),
      maxCorrelatedPositions,
    },
  };
}

export { DEFAULT_CORRELATION_GROUPS };
