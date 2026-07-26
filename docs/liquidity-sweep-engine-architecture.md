# MOERAND Institutional Liquidity Sweep Engine

## Status

Core observation engine implemented and protected by tests.

- Strategy version: `LIQUIDITY_SWEEP_1.0.0-alpha.1`
- Default mode: `PAPER_TRADING`
- Live execution: disabled
- Automatic Sandbox submission: disabled
- Broker submission integration: intentionally excluded
- Existing MOERAND safety gates, kill switch, capital policy, lifecycle reconciliation, and duplicate-order reservations remain authoritative

## Implemented pipeline

1. Normalize completed candles and reject delayed, incomplete, missing, zero-volume, or excessively wide-spread data.
2. Determine session, ATR, relative volume, realized volatility, tick size, higher-timeframe bias, range location, and market regime.
3. Map, merge, rank, and expire meaningful buy-side and sell-side liquidity pools.
4. Detect meaningful penetration beyond a pool using ATR and tick-size adaptive limits.
5. Measure reclaim speed, wick rejection, close location, outside closes, penetration depth, and relative volume.
6. Independently score rejection and acceptance to classify a sweep versus a genuine breakout.
7. Require post-sweep displacement and failed continuation, with configurable structure-shift and retest requirements.
8. Build a realistic limit-entry zone, stop beyond the sweep extreme, and target at opposing liquidity or the configured minimum reward-to-risk.
9. Score liquidity, sweep, confirmation, context, risk, and execution quality on a 0-100 scale.
10. Produce an explainable paper-only setup or return `NO_TRADE` when a mandatory requirement fails.

A wick through a level is never sufficient.

## Implemented files

```text
worker/src/liquidity-sweep/
  config.js                 Centralized validated configuration
  contracts.js              Normalized data contracts and enums
  state-machine.js          Explicit setup transitions
  normalization.js          Candle, timestamp, tick, ATR, RVOL, spread validation
  higher-timeframe.js       Directional context, range location, and market regime
  liquidity-map.js          Pool detection, merging, ranking, and expiration
  sweep-detector.js         Penetration, reclaim, depth, duration, and wick metrics
  classifier.js             Acceptance versus rejection and breakout classification
  confirmation.js           Displacement, internal shift, retest, imbalance
  trade-plan.js             Entry zone, stop buffer, opposing-liquidity targets
  scoring.js                Weighted 0-100 quality score and explicit penalties
  explainability.js         Approved/rejected decision narrative and audit message
  engine.js                 Broker-independent orchestration

worker/test/
  liquidity-sweep-foundation.test.mjs
  liquidity-sweep-market-data.test.mjs
  liquidity-sweep-classifier.test.mjs
  liquidity-sweep-engine.test.mjs
```

## Dependency flow

```text
Market bars
  -> normalization
  -> higher-timeframe context
  -> liquidity map
  -> sweep detector
  -> post-sweep confirmation
  -> acceptance/rejection classifier
  -> trade-plan engine
  -> opportunity scoring
  -> explainability
  -> setup state machine
  -> observation result
```

The liquidity engine never calls Webull directly.

## Timeframe mapping

The mapping is fixed and startup validation rejects changes:

- `1m -> 15m`
- `5m -> 1h`
- `15m -> 4h`
- `4h -> 1d`
- `1d -> 1w`

## Safety invariants

- Every output remains `PAPER_TRADING`.
- `executionAllowed` is always `false`.
- `automaticSubmissionAllowed` is always `false`.
- Confirmed and probable breakouts block reversal candidates.
- Ambiguous events block reversal candidates.
- Missing confirmation returns `NO_TRADE`.
- Invalid risk/reward, excessive stop distance, excessive spread, delayed data, event risk, or contradictory inputs return `NO_TRADE` or a rejected observation.
- Short setups may be analyzed but cannot enter the protected long-only broker path.
- A liquidity decision cannot bypass capital policy, duplicate-order reservation, kill switch, or trading-mode locks.

## Liquidity-pool contract

Each pool contains a deterministic ID, type, side, adaptive price zone, origin timeframe/session, touches, relative volume, importance score, state, expiration, evidence, and penalties.

Pool statuses:

- `UNSWEPT`
- `PARTIALLY_SWEPT`
- `FULLY_SWEPT`
- `RECLAIMED`
- `INVALIDATED`
- `EXPIRED`

## Sweep classifications

- `UNCONFIRMED_PENETRATION`
- `PROBABLE_LIQUIDITY_SWEEP`
- `CONFIRMED_LIQUIDITY_SWEEP`
- `FAILED_SWEEP`
- `PROBABLE_BREAKOUT`
- `CONFIRMED_BREAKOUT`
- `AMBIGUOUS_EVENT`
- `INVALID_EVENT`

Only `CONFIRMED_LIQUIDITY_SWEEP` may proceed to trade planning.

## Confirmation requirements

The confirmation engine evaluates:

- displacement in the reversal direction
- displacement measured in ATR
- internal structural shift
- imbalance after displacement
- pool retest and retest rejection
- failure to continue beyond the sweep extreme
- movement away from swept liquidity
- reversal relative volume

Displacement and failed continuation are mandatory. Structure shift and retest can be made mandatory through validated configuration.

## Trade-plan rules

- Entry is derived from the reclaimed boundary and confirmed displacement, not the top of an extended candle.
- Entry extension is capped in ATR.
- Stop is placed beyond the sweep extreme with the larger of the ATR buffer or tick buffer.
- Stop distance is capped in ATR.
- The preferred target is the nearest meaningful opposing-liquidity pool.
- If opposing liquidity is absent or too close, the configured minimum reward-to-risk target is used.
- Spread and numerical validity are checked before approval.

## Opportunity score

```text
Liquidity quality     0-20
Sweep quality         0-20
Confirmation quality  0-20
Context quality       0-15
Risk quality          0-15
Execution quality     0-10
Total                  0-100
```

Initial actions:

- 90-100: exceptional paper candidate
- automatic threshold and above: high-quality paper candidate
- valid threshold and above: valid paper candidate
- watchlist threshold and above: watchlist only
- below watchlist threshold: reject

Countertrend setups require the stricter countertrend threshold and remain observation-only.

## Deterministic setup identity

The setup ID is derived from:

```text
strategyVersion | symbol | executionTimeframe | direction | poolId | sweepTimestamp | roundedSweepExtreme
```

The SHA-256-derived ID is stable across retries and is designed to feed the existing duplicate-order reservation layer after observation and historical validation are complete.

## Setup state machine

Approved paper observations transition:

```text
DETECTED -> VALIDATING -> CONFIRMED -> ARMED
```

Execution states remain unreachable from the liquidity engine because it has no broker dependency and no submission permission.

Terminal states cannot return to an active state. A new thesis requires a new setup ID.

## Scanner integration boundary

The engine is ready to be called by `worker/src/auto-scanner.js` after completed-bar validation and before `rankBrainCandidates` in observation-only mode. During that phase, scanner candidates should carry:

- `liquiditySweep`
- `liquidityPool`
- `sweepClassification`
- `acceptanceScore`
- `rejectionScore`
- `confirmation`
- `higherTimeframe`
- `tradePlan`
- `liquiditySweepScore`
- `setupId`
- `invalidationConditions`

The legacy hard-coded session liquidity score must not be removed until the new full test suite is green and observation data has been reviewed.

## Remaining controlled milestones

1. Green CI for all Worker safety and liquidity tests.
2. Auto-scanner integration in observation-only mode without changing candidate acceptance or order submission.
3. Historical backtest including extended sessions, gaps, splits, halts, and delisted symbols where available.
4. Out-of-sample and walk-forward validation.
5. Reliable earnings, macro-event, halt, and news-state feed.
6. Explicit feature gate for Sandbox paper submission after review.
7. Separately tested short-order execution path before any short submission.

The correct output remains `NO_TRADE` whenever any mandatory component is missing, contradictory, unsafe, or unconfirmed.
