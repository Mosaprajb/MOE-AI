// Sandbox historical-only MOERAND scalp strategy.
//
// The scalp variant reuses the audited Heikin Ashi ATR implementation with independently
// configurable sensitivity. It never imports a broker and its output remains observation-only.

import { runMoerandHeikinStrategy } from './moerand-heikin-strategy.js';

export const MOERAND_SCALP_STRATEGY_ID = 'MOERAND_SCALP_INTERNAL';

function text(value, fallback) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function runMoerandScalpStrategy({
  symbol,
  bars,
  previousState = {},
  env = {},
  simulatedAt = Date.now(),
} = {}) {
  const result = runMoerandHeikinStrategy({
    symbol,
    bars,
    previousState,
    simulatedAt,
    env: {
      ...env,
      MOERAND_SIMULATION_ATR_PERIOD: text(env.MOERAND_SCALP_SIMULATION_ATR_PERIOD, '5'),
      MOERAND_SIMULATION_KEY_VALUE: text(env.MOERAND_SCALP_SIMULATION_KEY_VALUE, '0.6'),
      MOERAND_SIMULATION_MIN_REENTRY_BARS: text(env.MOERAND_SCALP_SIMULATION_MIN_REENTRY_BARS, '0'),
      MOERAND_SIMULATION_REQUIRE_BULLISH_CONFIRMATION: text(
        env.MOERAND_SCALP_SIMULATION_REQUIRE_BULLISH_CONFIRMATION,
        'true',
      ),
    },
  });

  const opportunity = result.opportunity
    ? {
      ...result.opportunity,
      id: `SIM-MOERAND-SCALP-${symbol}-${bars.at(-1)?.t || simulatedAt}`,
      confidence: {
        ...(typeof result.opportunity.confidence === 'object' ? result.opportunity.confidence : {}),
        value: typeof result.opportunity.confidence === 'object'
          ? result.opportunity.confidence.value
          : result.opportunity.confidence,
        source: MOERAND_SCALP_STRATEGY_ID,
      },
      reasons: ['MOERAND_SCALP_HEIKIN_ASHI_ATR', ...(result.opportunity.reasons || [])],
      metadata: {
        ...(result.opportunity.metadata || {}),
        setupFamily: 'MOERAND_SCALP_HEIKIN_ASHI',
        sourceStrategy: MOERAND_SCALP_STRATEGY_ID,
        scalp: true,
        simulation: true,
        historicalExecutionApproximation: 'FIVE_MINUTE_OHLC',
      },
    }
    : null;

  const closeInstruction = result.closeInstruction
    ? {
      ...result.closeInstruction,
      strategy: MOERAND_SCALP_STRATEGY_ID,
      reason: `SCALP_${result.closeInstruction.reason}`,
    }
    : null;

  return {
    ...result,
    strategy: MOERAND_SCALP_STRATEGY_ID,
    opportunity,
    closeInstruction,
    diagnostics: {
      ...(result.diagnostics || {}),
      strategy: MOERAND_SCALP_STRATEGY_ID,
      scalp: true,
    },
  };
}
