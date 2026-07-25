const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function scoreOpportunity(context = {}) {
  const breakdown = {
    timeframe: context.htfAligned === true ? 25 : 0,
    trend: clamp(Math.round(Math.abs(number(context.trendScore)) * 20), 0, 20),
    volume: clamp(Math.round(number(context.relativeVolume, 1) * 10), 0, 15),
    liquidity: clamp(Math.round(number(context.liquidityScore, 50) * 0.2), 0, 20),
    signal: clamp(Math.round(number(context.signalScore, 50) * 0.2), 0, 20),
  };

  let score = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const reasons = [];

  if (context.newsBlocked === true) {
    score -= 40;
    reasons.push('Blocked by news filter');
  }
  if (context.signalExpired === true) {
    score -= 30;
    reasons.push('Signal expired');
  }
  if (context.duplicateSignal === true) {
    score -= 20;
    reasons.push('Duplicate signal');
  }

  score = clamp(score, 0, 100);
  return {
    score,
    grade: score >= 90 ? 'A+' : score >= 80 ? 'A' : score >= 70 ? 'B' : score >= 60 ? 'C' : 'REJECT',
    breakdown,
    reasons,
  };
}
