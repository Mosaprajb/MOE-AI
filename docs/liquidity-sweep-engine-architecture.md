# MOERAND Institutional Liquidity Sweep Engine

## Status

Architecture and data-contract phase only.

- Strategy version: `LIQUIDITY_SWEEP_1.0.0-alpha.1`
- Default mode: `PAPER_TRADING`
- Live execution: disabled
- Broker submission integration: not part of this milestone
- Existing MOERAND safety gates, kill switch, capital policy, lifecycle reconciliation, and duplicate-order reservations remain authoritative

## Why this engine is needed

The current scanner promotes candidates after the legacy MOE engine emits `BUY NOW`, then uses a hard-coded liquidity score based on the market session. That does not prove that meaningful liquidity was swept, reclaimed, and confirmed. The new engine replaces that shortcut with an explainable sequence:

1. Normalize completed candles.
2. Determine session, volatility, and higher-timeframe context.
3. Map meaningful liquidity pools.
4. Detect penetration beyond a pool.
5. Score rejection and acceptance.
6. Classify sweep versus genuine breakout.
7. Require post-sweep confirmation.
8. Build a realistic entry, stop, and opposing-liquidity target.
9. Score the complete setup.
10. Return `NO_TRADE` whenever a mandatory requirement fails.

A wick through a level is never sufficient.

## Proposed file structure

```text
worker/src/liquidity-sweep/
  config.js                 Centralized validated configuration
  contracts.js              Normalized data contracts and enums
  state-machine.js          Explicit setup transitions
  normalization.js          Candle, timestamp, tick, ATR, RVOL, spread validation
  higher-timeframe.js       Directional context and range location
  liquidity-map.js          Pool detection, merging, ranking, and expiration
  sweep-detector.js         Penetration, reclaim, depth, duration, wick metrics
  classifier.js             Acceptance versus rejection and breakout classification
  confirmation.js           Displacement, internal shift, retest, imbalance
  trade-plan.js             Entry zone, stop buffer, realistic targets, position inputs
  scoring.js                0-100 score and explicit penalties
  engine.js                 Orchestration only; no broker calls
  explainability.js         Approved/rejected decision narrative
worker/test/liquidity-sweep/
  contracts.test.mjs
  state-machine.test.mjs
  classifier.test.mjs
  scoring.test.mjs
  fixtures/
    valid-sell-side-sweep.json
    valid-buy-side-sweep.json
    genuine-breakout.json
    ambiguous-penetration.json
```

This milestone initially creates the first four foundation files. Detection modules follow incrementally after the contracts are approved by tests.

## Dependency flow

```text
Market bars
  -> normalization
  -> higher-timeframe context
  -> liquidity map
  -> sweep detector
  -> acceptance/rejection classifier
  -> confirmation engine
  -> trade-plan engine
  -> opportunity scoring
  -> setup state machine
  -> MOE AI Brain ranking
  -> existing capital policy
  -> existing duplicate reservation
  -> Sandbox execution only
```

The liquidity engine must never call Webull directly.

## Existing-system integration

### Auto scanner

`worker/src/auto-scanner.js` will later call the liquidity engine after completed-bar validation and before `rankBrainCandidates`.

The current hard-coded session liquidity score must be removed only after the new engine passes its tests. The scanner candidate should carry:

- `liquiditySweep`
- `liquidityPool`
- `sweepClassification`
- `acceptanceScore`
- `rejectionScore`
- `confirmation`
- `tradePlan`
- `liquiditySweepScore`
- `setupId`
- `invalidationConditions`

### MOE AI Brain

The brain remains the portfolio-level ranker, but liquidity quality becomes measured evidence rather than a session constant. A confirmed breakout blocks reversal candidates before ranking.

### Trade engine

The existing trade engine remains responsible for final numerical validation and sizing. The liquidity engine supplies a proposed entry zone, stop, and realistic target derived from market structure.

### Execution safety

The existing capital policy, order-reservation guard, trading-mode controls, and kill switch remain mandatory. Liquidity approval cannot bypass them.

### Short setups

The architecture supports buy-side sweeps for short candidates. The current protected broker path is long-entry focused, so short setups must remain `executionAllowed: false` and paper/watchlist only until a separately tested short execution path exists.

## Normalized candle contract

Every candle uses only completed historical data:

```js
{
  timestamp: 0,
  open: 0,
  high: 0,
  low: 0,
  close: 0,
  volume: 0,
  session: 'REGULAR',
  complete: true,
  source: 'ALPACA_IEX'
}
```

Mandatory validation:

- finite timestamp and OHLCV
- `low <= min(open, close)`
- `high >= max(open, close)`
- `high >= low`
- non-negative volume
- strictly increasing timestamps
- completed candle only
- maximum configured data delay

## Liquidity-pool contract

```js
{
  poolId: 'deterministic-id',
  type: 'PREVIOUS_DAY_LOW',
  side: 'SELL_SIDE',
  zoneLower: 0,
  zoneUpper: 0,
  referencePrice: 0,
  createdAt: 0,
  lastTouchedAt: 0,
  touchCount: 0,
  originTimeframe: '5m',
  originSession: 'REGULAR',
  relativeVolume: 0,
  status: 'UNSWEPT',
  importanceScore: 0,
  swept: false,
  reclaimed: false,
  expiresAt: 0,
  evidence: [],
  penalties: []
}
```

Pool statuses:

- `UNSWEPT`
- `PARTIALLY_SWEPT`
- `FULLY_SWEPT`
- `RECLAIMED`
- `INVALIDATED`
- `EXPIRED`

## Sweep-event contract

```js
{
  sweepId: 'deterministic-id',
  poolId: 'pool-id',
  symbol: 'AAPL',
  direction: 'LONG',
  detectedAt: 0,
  extremePrice: 0,
  penetrationDistance: 0,
  penetrationAtr: 0,
  candlesOutside: 0,
  reclaimed: false,
  reclaimedAt: null,
  reclaimCandles: null,
  wickToBodyRatio: 0,
  closeLocation: 0,
  acceptanceScore: 0,
  rejectionScore: 0,
  classification: 'UNCONFIRMED_PENETRATION',
  confidence: 0,
  evidence: [],
  rejectionReasons: []
}
```

Classifications:

- `UNCONFIRMED_PENETRATION`
- `PROBABLE_LIQUIDITY_SWEEP`
- `CONFIRMED_LIQUIDITY_SWEEP`
- `FAILED_SWEEP`
- `PROBABLE_BREAKOUT`
- `CONFIRMED_BREAKOUT`
- `AMBIGUOUS_EVENT`
- `INVALID_EVENT`

## Setup contract

```js
{
  setupId: 'deterministic-id',
  strategyName: 'Institutional Liquidity Sweep',
  strategyVersion: 'LIQUIDITY_SWEEP_1.0.0-alpha.1',
  symbol: 'AAPL',
  executionTimeframe: '5m',
  contextTimeframe: '1h',
  direction: 'LONG',
  state: 'DETECTED',
  marketSession: 'REGULAR',
  marketRegime: 'BALANCED_RANGE',
  liquidityPool: {},
  sweep: {},
  confirmation: {},
  tradePlan: {},
  quality: {},
  invalidationConditions: [],
  createdAt: 0,
  updatedAt: 0,
  expiresAt: 0,
  executionAllowed: false,
  mode: 'PAPER_TRADING',
  auditTrail: []
}
```

## Deterministic setup ID

The setup ID is derived from:

```text
strategyVersion | symbol | executionTimeframe | direction | poolId | sweepTimestamp | roundedSweepExtreme
```

The resulting value is SHA-256 and truncated to a stable identifier. It feeds the existing order-reservation layer later, preventing TradingView, scanner, or retry duplication.

## State machine

Allowed states:

1. `DETECTED`
2. `VALIDATING`
3. `CONFIRMED`
4. `ARMED`
5. `WAITING_FOR_ENTRY`
6. `ENTRY_TRIGGERED`
7. `ORDER_SUBMITTED`
8. `PARTIALLY_FILLED`
9. `FILLED`
10. `MANAGING_POSITION`
11. `TARGET_PARTIALLY_REACHED`
12. `COMPLETED`
13. `STOPPED`
14. `CANCELLED`
15. `INVALIDATED`
16. `EXPIRED`
17. `EXECUTION_ERROR`

Terminal states cannot return to an active state. A new thesis requires a new setup ID.

## Sweep-versus-breakout classification

The classifier produces two independent 0-100 scores.

### Rejection score

Weighted inputs:

- reclaim speed: 20
- close back inside the pool/range: 20
- wick-to-body rejection: 15
- opposing displacement: 15
- failed continuation: 10
- retest rejection: 10
- reversal relative volume: 5
- movement toward opposing liquidity: 5

### Acceptance score

Weighted inputs:

- closes beyond the pool: 20
- body percentage beyond the pool: 15
- time outside the range: 10
- successful breakout retest: 20
- continuation volume: 10
- displacement in breakout direction: 10
- higher-timeframe alignment: 10
- distance maintained beyond the pool: 5

### Decision rules

- Confirmed sweep: rejection >= configured threshold, acceptance <= maximum, reclaim true, confirmation true.
- Probable sweep: rejection leads acceptance by configured margin but confirmation is incomplete.
- Confirmed breakout: acceptance >= configured threshold, no reclaim, continuation/retest evidence present.
- Ambiguous: score difference is below the ambiguity margin or evidence conflicts.
- No reversal trade is allowed for probable/confirmed breakout or ambiguous events.

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
- 80-89: high-quality paper candidate
- 70-79: valid paper candidate
- 60-69: watchlist only
- below 60: reject

Automatic Sandbox submission remains disabled for this strategy until detection, classification, scoring, and integration tests pass.

## Central configuration groups

- strategy identity and mode
- timeframe mapping
- data quality
- ATR and volatility
- liquidity zone merging
- pool importance
- sweep penetration and reclaim
- rejection and acceptance thresholds
- confirmation
- entry and stop
- target and reward-to-risk
- session adjustments
- event risk
- scoring and penalties
- state expiration and cooldown
- duplicate protection

Startup validation must reject unsafe or contradictory values.

## First implementation milestone

### Included

- centralized configuration and validation
- normalized enums and data contracts
- deterministic IDs
- setup state machine
- score/classification interfaces
- unit tests for contracts and transitions

### Excluded

- broker calls
- Live activation
- automatic Sandbox submission
- order-book logic
- news-provider integration
- final liquidity-pool detection
- final sweep detector
- short-order execution

## Risks and missing dependencies

1. Alpaca bar history currently provides candle data but not full order-book depth.
2. Earnings/news/halt protection needs a reliable event feed before automatic execution.
3. Holiday-aware exchange calendars are not yet applied everywhere.
4. Extended-hours relative volume needs comparable time-of-day historical baselines.
5. Current scanner is long-oriented; short execution must remain blocked.
6. Historical backtesting data must include extended sessions, gaps, splits, and delisted symbols where possible.

## Recommended development order

1. Contracts, config, IDs, and state-machine tests.
2. Candle normalization and data-quality tests.
3. Liquidity-pool mapping and importance tests.
4. Sweep detector and classifier tests.
5. Confirmation and trade-plan tests.
6. Scoring and explainability tests.
7. Scanner integration in observation-only mode.
8. Historical backtest and out-of-sample validation.
9. Sandbox paper execution behind explicit feature gates.

The correct output remains `NO_TRADE` whenever any mandatory component is missing or contradictory.
