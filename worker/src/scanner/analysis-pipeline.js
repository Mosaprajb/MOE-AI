const REQUIRED_ANALYSES = Object.freeze(['smartMoney', 'liquiditySweep', 'orderFlow', 'gammaGex', 'smt', 'rvol', 'portfolioConstraints']);

function clamp(value, minimum = 0, maximum = 100) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(maximum, Math.max(minimum, number)) : 0;
}

function normalizeResult(name, result) {
  if (!result || typeof result !== 'object') return Object.freeze({ name, available: false, score: 0, direction: 'NEUTRAL', blockers: [`${name} unavailable`], reasons: [] });
  const blockers = Array.isArray(result.blockers) ? result.blockers.map(String) : [];
  const reasons = Array.isArray(result.reasons) ? result.reasons.map(String) : [];
  const direction = ['LONG', 'SHORT', 'NEUTRAL'].includes(String(result.direction || '').toUpperCase()) ? String(result.direction).toUpperCase() : 'NEUTRAL';
  return Object.freeze({ name, available: result.available !== false, score: clamp(result.score), direction, blockers, reasons, raw: result });
}

export function createAnalysisPipeline({ analyzers = {}, weights = {}, minimumScore = 65, longOnly = true } = {}) {
  const normalizedWeights = Object.fromEntries(REQUIRED_ANALYSES.map((name) => [name, Math.max(0, Number(weights[name] ?? 1))]));

  return Object.freeze({
    async analyze(snapshot, context = {}) {
      if (!snapshot || typeof snapshot !== 'object' || !snapshot.symbol) throw new Error('A normalized market snapshot is required.');
      const results = {};
      for (const name of REQUIRED_ANALYSES) {
        const analyzer = analyzers[name];
        try {
          results[name] = normalizeResult(name, typeof analyzer === 'function' ? await analyzer(snapshot, context) : null);
        } catch (error) {
          results[name] = normalizeResult(name, { available: false, blockers: [`${name} failed: ${error instanceof Error ? error.message : 'unknown error'}`] });
        }
      }

      const available = REQUIRED_ANALYSES.filter((name) => results[name].available);
      const totalWeight = available.reduce((sum, name) => sum + normalizedWeights[name], 0);
      const score = totalWeight > 0
        ? available.reduce((sum, name) => sum + results[name].score * normalizedWeights[name], 0) / totalWeight
        : 0;
      const mandatoryBlockers = REQUIRED_ANALYSES.flatMap((name) => results[name].blockers.map((blocker) => `${name}: ${blocker}`));
      const longSupport = available.filter((name) => results[name].direction === 'LONG').length;
      const shortSupport = available.filter((name) => results[name].direction === 'SHORT').length;
      const direction = longSupport > shortSupport ? 'LONG' : shortSupport > longSupport ? 'SHORT' : 'NEUTRAL';
      if (longOnly && direction === 'SHORT') mandatoryBlockers.push('directionPolicy: short entries are disabled');
      if (direction === 'NEUTRAL') mandatoryBlockers.push('consensus: no directional majority');
      if (score < Number(minimumScore)) mandatoryBlockers.push(`score: ${score.toFixed(2)} is below ${Number(minimumScore).toFixed(2)}`);

      const accepted = mandatoryBlockers.length === 0;
      return Object.freeze({
        symbol: snapshot.symbol,
        score: Number(score.toFixed(2)),
        direction,
        accepted,
        executionEnabled: false,
        observationOnly: true,
        coverage: Number((available.length / REQUIRED_ANALYSES.length).toFixed(4)),
        blockers: Object.freeze(mandatoryBlockers),
        reasons: Object.freeze(REQUIRED_ANALYSES.flatMap((name) => results[name].reasons.map((reason) => `${name}: ${reason}`))),
        analyses: Object.freeze(results),
        evaluatedAt: new Date().toISOString(),
      });
    },
  });
}

export { REQUIRED_ANALYSES };
export {
  ANALYSIS_PIPELINE_SCHEMA,
  ANALYSIS_PIPELINE_VERSION,
  ANALYZER_CATALOG,
  createAnalysisPipelineV2,
} from './analysis-pipeline-v2.js';
