const MARKET_SYMBOLS = ['SPY', 'QQQ', 'IWM'];

const SECTOR_ETFS = {
  TECHNOLOGY: 'XLK',
  FINANCIALS: 'XLF',
  ENERGY: 'XLE',
  INDUSTRIALS: 'XLI',
  HEALTHCARE: 'XLV',
  CONSUMER_DISCRETIONARY: 'XLY',
  CONSUMER_STAPLES: 'XLP',
  UTILITIES: 'XLU',
  SEMICONDUCTORS: 'SMH',
};

const SYMBOL_GROUPS = {
  TECHNOLOGY: ['AAPL','MSFT','META','GOOGL','GOOG','AMZN','CRM','ORCL','NOW','ADBE','INTU','SNOW','DDOG','MDB','NET','CRWD','PANW','ZS','OKTA','TEAM','WDAY','HUBS','DOCU','TWLO','PATH'],
  SEMICONDUCTORS: ['NVDA','AMD','AVGO','MU','ARM','INTC','QCOM','TSM','ASML','SMCI','MRVL','ON','TXN','ADI','NXPI','MCHP','KLAC','LRCX','AMAT'],
  FINANCIALS: ['JPM','BAC','WFC','C','GS','MS','SCHW','AXP','V','MA','PYPL','COIN','HOOD','SOFI','AFRM','UPST','NU','IBKR'],
  ENERGY: ['XOM','CVX','COP','OXY','SLB','HAL','MPC','VLO','PSX','KMI','WMB','EQT','FANG','DVN','BKR','OKE','LNG'],
  INDUSTRIALS: ['CAT','DE','GE','HON','RTX','LMT','BA','NOC','GD','UPS','FDX','UNP','CSX','NSC','EMR','ETN','PH','ROK','MMM','URI'],
  HEALTHCARE: ['UNH','LLY','NVO','JNJ','ABBV','MRK','PFE','BMY','AMGN','GILD','VRTX','REGN','ISRG','TMO','DHR','MDT','ABT','CVS','HUM'],
  CONSUMER_DISCRETIONARY: ['TSLA','WMT','COST','TGT','HD','LOW','BABA','JD','PDD','SHOP','ETSY','MELI','NKE','SBUX','MCD','CMG','YUM','CAVA','UBER','LYFT','DASH','ABNB','BKNG','EXPE'],
  CONSUMER_STAPLES: ['KO','PEP','MNST','CELH','KDP','PM','MO','CL','PG','EL','KMB','GIS','KHC','MDLZ','HSY','STZ','TAP'],
  UTILITIES: ['NEE','DUK','SO','AEP','EXC','SRE','D','XEL','PCG','CEG','VST','NRG','ETR','ED','PEG'],
};

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function ema(values, length) {
  if (!Array.isArray(values) || values.length < length) return null;
  const alpha = 2 / (length + 1);
  let output = values[0];
  for (let index = 1; index < values.length; index += 1) output = values[index] * alpha + output * (1 - alpha);
  return output;
}

function instrumentStrength(bars = []) {
  const complete = bars.slice(-120);
  if (complete.length < 55) return { ready: false, score: 50, trend: 'UNKNOWN' };
  const closes = complete.map((bar) => number(bar.c)).filter((value) => value > 0);
  if (closes.length < 55) return { ready: false, score: 50, trend: 'UNKNOWN' };
  const latest = closes.at(-1);
  const fast = ema(closes, 9);
  const slow = ema(closes, 20);
  const trend = ema(closes, 50);
  const change5 = closes.length > 5 ? (latest / closes.at(-6) - 1) * 100 : 0;
  const change20 = closes.length > 20 ? (latest / closes.at(-21) - 1) * 100 : 0;
  let score = 50;
  if (latest >= fast) score += 10; else score -= 10;
  if (fast >= slow) score += 12; else score -= 12;
  if (slow >= trend) score += 13; else score -= 13;
  score += Math.max(-10, Math.min(10, Math.round(change5 * 8)));
  score += Math.max(-5, Math.min(5, Math.round(change20 * 2)));
  score = Math.max(0, Math.min(100, score));
  return {
    ready: true,
    score,
    trend: score >= 65 ? 'BULLISH' : score <= 38 ? 'BEARISH' : 'NEUTRAL',
    change5: Number(change5.toFixed(2)),
    change20: Number(change20.toFixed(2)),
  };
}

export function sectorForSymbol(symbol) {
  const normalized = String(symbol || '').toUpperCase();
  return Object.entries(SYMBOL_GROUPS).find(([, symbols]) => symbols.includes(normalized))?.[0] || 'OTHER';
}

export function buildMarketIntelligence(histories = new Map()) {
  const indexes = Object.fromEntries(MARKET_SYMBOLS.map((symbol) => [symbol, instrumentStrength(histories.get(symbol) || [])]));
  const readyIndexes = Object.values(indexes).filter((item) => item.ready);
  const marketScore = readyIndexes.length
    ? Math.round(readyIndexes.reduce((sum, item) => sum + item.score, 0) / readyIndexes.length)
    : 50;
  const regime = marketScore >= 65 ? 'BULLISH' : marketScore <= 38 ? 'BEARISH' : 'NEUTRAL';
  const sectors = {};
  for (const [sector, etf] of Object.entries(SECTOR_ETFS)) sectors[sector] = { etf, ...instrumentStrength(histories.get(etf) || []) };
  return {
    version: '2.0.0',
    marketScore,
    regime,
    indexes,
    sectors,
    longEntriesAllowed: regime !== 'BEARISH',
    generatedAt: new Date().toISOString(),
  };
}

export function enrichCandidateWithMarket(candidate = {}, intelligence = {}) {
  const sector = sectorForSymbol(candidate.symbol);
  const sectorState = intelligence.sectors?.[sector] || { score: 50, trend: 'UNKNOWN' };
  return {
    ...candidate,
    sector,
    marketScore: number(intelligence.marketScore, 50),
    marketRegime: intelligence.regime || 'UNKNOWN',
    sectorScore: number(sectorState.score, 50),
    sectorTrend: sectorState.trend || 'UNKNOWN',
  };
}

export { MARKET_SYMBOLS, SECTOR_ETFS };
