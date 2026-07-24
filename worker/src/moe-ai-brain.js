const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function sessionPenalty(window = {}) {
  if (window.session === 'NIGHT') return 12;
  if (window.label === 'EXTENDED') return 6;
  return 0;
}

function spreadScore(spreadPercent, window = {}) {
  if (!Number.isFinite(Number(spreadPercent))) return window.session === 'NIGHT' ? 2 : 5;
  const spread = Number(spreadPercent);
  const ceiling = window.session === 'NIGHT' ? 1.2 : window.label === 'EXTENDED' ? 0.8 : 0.5;
  return clamp(Math.round((1 - spread / ceiling) * 15), 0, 15);
}

function relativeVolumeScore(relativeVolume) {
  const rvol = number(relativeVolume, 0);
  return clamp(Math.round(rvol * 10), 0, 20);
}

function riskRewardScore(candidate = {}) {
  const entry = number(candidate.entry);
  const stop = number(candidate.stopLoss);
  const target = number(candidate.takeProfit);
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  const rr = risk > 0 ? reward / risk : 0;
  return { rr, score: clamp(Math.round(rr * 8), 0, 20) };
}

function volatilityScore(candidate = {}) {
  const entry = number(candidate.entry);
  const atr = number(candidate.atr);
  if (entry <= 0 || atr <= 0) return 5;
  const atrPercent = atr / entry * 100;
  if (atrPercent < 0.15) return 3;
  if (atrPercent <= 1.5) return 15;
  if (atrPercent <= 2.5) return 10;
  return 2;
}

export function evaluateBrainCandidate(candidate = {}, window = {}, env = {}) {
  const reasons = [];
  const rejectionReasons = [];
  const signalScore = clamp(number(candidate.score), 0, 100);
  const signalComponent = Math.round(signalScore * 0.35);
  const volumeComponent = relativeVolumeScore(candidate.relativeVolume);
  const { rr, score: rrComponent } = riskRewardScore(candidate);
  const spreadComponent = spreadScore(candidate.spreadPercent, window);
  const volatilityComponent = volatilityScore(candidate);
  const driftPenalty = clamp(Math.round(number(candidate.driftPercent) * 8), 0, 10);
  const afterHoursPenalty = sessionPenalty(window);

  let brainScore = signalComponent + volumeComponent + rrComponent + spreadComponent + volatilityComponent;
  brainScore = clamp(brainScore - driftPenalty - afterHoursPenalty, 0, 100);

  const minimumBrainScore = number(
    window.session === 'NIGHT'
      ? env.MOE_AI_MIN_SCORE_NIGHT
      : window.label === 'EXTENDED'
        ? env.MOE_AI_MIN_SCORE_EXTENDED
        : env.MOE_AI_MIN_SCORE_CORE,
    window.session === 'NIGHT' ? 82 : window.label === 'EXTENDED' ? 76 : 72,
  );

  const maximumSpread = number(
    window.session === 'NIGHT'
      ? env.MOE_AI_MAX_SPREAD_NIGHT_PERCENT
      : window.label === 'EXTENDED'
        ? env.MOE_AI_MAX_SPREAD_EXTENDED_PERCENT
        : env.MOE_AI_MAX_SPREAD_CORE_PERCENT,
    window.session === 'NIGHT' ? 1.2 : window.label === 'EXTENDED' ? 0.8 : 0.5,
  );

  if (signalScore >= 88) reasons.push('Strong MOERAND setup quality');
  if (number(candidate.relativeVolume) >= 1) reasons.push('Relative volume confirms participation');
  if (rr >= 2) reasons.push('Risk/reward is at least 2.0');
  if (spreadComponent >= 10) reasons.push('Spread quality is acceptable');
  if (volatilityComponent >= 10) reasons.push('Volatility is suitable for execution');

  if (brainScore < minimumBrainScore) rejectionReasons.push(`MOE AI score ${brainScore} is below ${minimumBrainScore}`);
  if (rr < number(env.MOE_AI_MIN_RISK_REWARD, 2)) rejectionReasons.push(`Risk/reward ${rr.toFixed(2)} is below minimum`);
  if (Number.isFinite(Number(candidate.spreadPercent)) && Number(candidate.spreadPercent) > maximumSpread) {
    rejectionReasons.push(`Spread ${Number(candidate.spreadPercent).toFixed(3)}% exceeds ${maximumSpread}%`);
  }
  if (number(candidate.entry) <= 0 || number(candidate.stopLoss) <= 0 || number(candidate.takeProfit) <= 0) {
    rejectionReasons.push('Invalid entry, stop, or target');
  }

  return {
    accepted: rejectionReasons.length === 0,
    brainScore,
    minimumBrainScore,
    riskReward: Number(rr.toFixed(2)),
    components: {
      signal: signalComponent,
      relativeVolume: volumeComponent,
      riskReward: rrComponent,
      spread: spreadComponent,
      volatility: volatilityComponent,
      driftPenalty,
      sessionPenalty: afterHoursPenalty,
    },
    reasons,
    rejectionReasons,
  };
}

export function rankBrainCandidates(candidates = [], window = {}, env = {}) {
  const evaluated = candidates.map((candidate) => ({
    ...candidate,
    brain: evaluateBrainCandidate(candidate, window, env),
  }));

  evaluated.sort((left, right) => {
    if (left.brain.accepted !== right.brain.accepted) return left.brain.accepted ? -1 : 1;
    return (right.brain.brainScore - left.brain.brainScore)
      || (number(right.score) - number(left.score))
      || (number(right.relativeVolume) - number(left.relativeVolume));
  });

  return {
    accepted: evaluated.filter((item) => item.brain.accepted),
    rejected: evaluated.filter((item) => !item.brain.accepted),
    all: evaluated,
  };
}

export const MOE_AI_BRAIN_VERSION = '1.0.0';
