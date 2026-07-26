# Quantitative Smart Money Engine Architecture

## Status

- Strategy: `Quantitative Smart Money Engine`
- Version: `SMART_MONEY_1.0.0-alpha.1`
- Mode: `PAPER_TRADING`
- Live execution: disabled
- Automatic broker submission: disabled
- Current milestone: architecture and quantitative foundation

## 1. Objective

Build a non-repainting, explainable, event-driven Smart Money analysis layer for liquid U.S. stocks and ETFs. The system does not claim to identify actual institutional orders. It measures price, volume, liquidity, structure, displacement, imbalance, execution quality, and risk behavior that may be consistent with informed participation.

The default result is `NO_TRADE`. A setup can advance only when every mandatory module supplies valid, chronologically available evidence.

## 2. Existing Components Reused

The Smart Money engine composes existing MOE-AI modules rather than duplicating them:

- `liquidity-sweep/normalization.js`: completed-candle normalization, sessions, ATR, realized volatility, RVOL, delay, missing-bar, spread, and tick validation.
- `liquidity-sweep/liquidity-map.js`: adaptive buy-side and sell-side liquidity pools.
- `liquidity-sweep/sweep-detector.js`: ATR/tick-aware liquidity penetration and reclaim events.
- `liquidity-sweep/classifier.js`: sweep versus breakout classification.
- `capital-policy.js`, `order-reservation.js`, and trading-mode locks remain authoritative for any future execution path.

The new `smart-money` package owns structure, displacement, imbalance, dealing-range, confluence, and Smart Money lifecycle semantics.

## 3. Module Diagram

```text
Market bars / quotes / event state
              |
              v
+-----------------------------+
| A. Market Data Layer        |  existing normalization
+-----------------------------+
              |
              +--------------------------+
              |                          |
              v                          v
+-----------------------------+  +-----------------------------+
| B. Multi-Timeframe Context  |  | D. Liquidity Engine         |
| HTF structure / range       |  | pools / sweeps / breakouts  |
+-----------------------------+  +-----------------------------+
              |                          |
              v                          v
+-----------------------------+  +-----------------------------+
| C. Market Structure Engine  |  | E. Imbalance Engine         |
| swings / BOS / CHOCH / MSS  |  | FVG / IFVG / BPR lifecycle  |
+-----------------------------+  +-----------------------------+
              |                          |
              +-------------+------------+
                            v
                +-----------------------------+
                | F. Order-Block Engine       |
                | OB / breaker / mitigation   |
                +-----------------------------+
                            |
                            v
                +-----------------------------+
                | G. Setup-Confluence Engine  |
                +-----------------------------+
                            |
                v                           v
+-----------------------------+  +-----------------------------+
| H. Risk / Position Sizing   |  | I. Opportunity Ranking      |
+-----------------------------+  +-----------------------------+
              |                          |
              +-------------+------------+
                            v
                +-----------------------------+
                | J. State / Lifecycle        |
                +-----------------------------+
                            |
                            v
                +-----------------------------+
                | K. Alert / Execution API    |
                | paper-only until authorized |
                +-----------------------------+
```

## 4. Data Flow

1. Accept raw bars and optional quote/event metadata.
2. Reject incomplete, delayed, duplicated, malformed, illiquid, or wide-spread data.
3. Normalize the configured execution/context timeframe pair:
   - `1m -> 15m`
   - `5m -> 1h`
   - `15m -> 4h`
   - `4h -> 1d`
   - `1d -> 1w`
4. Confirm pivots only after the configured right-side candles have closed.
5. Build internal/external swings and dealing ranges.
6. Detect close-confirmed BOS, CHOCH, and MSS candidates.
7. Quantify directional displacement.
8. Detect and track FVG/IFVG/BPR states.
9. Reuse the liquidity engine for pools, sweeps, and breakout blocking.
10. In later milestones, validate order blocks, breakers, and mitigation zones.
11. Combine mandatory and optional evidence into setup families.
12. Build a realistic risk plan from structural invalidation and actual liquidity targets.
13. Rank across symbols and keep only the strongest active setup per symbol by default.
14. Emit structured paper alerts only after lifecycle and duplicate checks.

## 5. Objective Quantitative Definitions

### 5.1 Confirmed Swing

A pivot at index `i` is confirmed only at `i + rightBars`.

Swing high requirements:

- `high[i]` is above all configured left-side highs.
- `high[i]` is at or above all configured right-side highs.
- Prominence is at least the configured ATR fraction for a trade-significant swing.

Swing low uses the inverse rules.

Stored fields include price, source index, pivot timestamp, confirmation timestamp, type, internal/external scope, ATR prominence, reactions, protected state, liquidity state, and invalidation state.

### 5.2 External Versus Internal Structure

A swing is external when it is the highest high or lowest low inside the configured external-structure window around its pivot. Other confirmed pivots are internal.

External structure controls dealing ranges and major liquidity. Internal structure is used for entry timing and MSS/CHOCH confirmation.

### 5.3 Break of Structure

A wick alone never creates BOS.

A valid break requires:

- Candle close beyond a confirmed structural boundary.
- Penetration >= `max(ATR * minimumBosPenetrationAtr, tickSize * minimumBosPenetrationTicks)`.
- Body >= configured ATR multiple.
- Directional close location >= configured threshold.
- Range expansion or relative-volume confirmation.
- No use of candles before they are completed.

Event classification:

- Same-direction break of established bias: `BREAK_OF_STRUCTURE`.
- First meaningful opposite internal break: `CHANGE_OF_CHARACTER`.
- Strong opposite external break: `MARKET_STRUCTURE_SHIFT`.

### 5.4 Displacement

A 0-100 displacement score is built from:

- Body / ATR.
- Range / ATR.
- Body / candle range.
- Directional close location.
- Relative volume.
- Consecutive directional closes.
- Limited overlap with the previous candle.

Classifications:

- `NONE`
- `WEAK`
- `MODERATE`
- `STRONG`
- `EXCEPTIONAL`
- `ABNORMAL_NEWS_DRIVEN`

Abnormal range expansion is never an automatic entry trigger.

### 5.5 Fair Value Gap

Bullish FVG at candles `(i-2, i-1, i)`:

- `low[i] > high[i-2]`.
- Gap size >= `max(ATR * minimumSizeAtr, tickSize * minimumSizeTicks)`.
- Middle candle has bullish displacement score above the configured minimum.

Bearish FVG is the inverse.

Tracked states:

- `NEW`
- `ACTIVE`
- `PARTIALLY_MITIGATED`
- `FULLY_MITIGATED`
- `INVERTED`
- `INVALIDATED`
- `EXPIRED`

Fill percentage is calculated only from candles after creation. A decisive close through the opposite boundary is required before inversion can be considered.

### 5.6 Balanced Price Range

A BPR is an overlap between active opposing imbalances. It is contextual and not a standalone entry trigger. Entries in the center of the BPR are rejected unless a separate setup family explicitly permits them.

### 5.7 Dealing Range and Premium/Discount

The active dealing range uses confirmed external structural boundaries.

- Midpoint: `(rangeHigh + rangeLow) / 2`.
- Long preference: discount/lower-value area.
- Short preference: premium/higher-value area.
- Premium/discount is a location filter, never an independent signal.

### 5.8 Order Block

A block is not merely the last opposite candle. Later milestones must require:

- Valid structural origin.
- Strong displacement.
- Confirmed BOS/MSS.
- Imbalance creation or expansion.
- Limited mitigation.
- Precise invalidation.
- Realistic path to target.

### 5.9 Inducement

Inducement remains supporting context unless it has measurable visibility, position before primary liquidity, actual sweep, trapped-participant failure, and displacement toward a higher-quality zone.

## 6. Concepts Not Reliably Measurable From OHLCV Alone

The following cannot be asserted as facts without order-book, transaction-level, news, or broker data:

- Actual institutional order ownership.
- Bank or market-maker intent.
- Hidden liquidity and full queue position.
- Exact stop inventory.
- Reliable short availability.
- Guaranteed fill quality during halts or gaps.
- Complete news causality.
- Real-time earnings/macro risk without an event feed.

These are represented as `UNKNOWN`, contextual inputs, or hard safety blocks when required data is missing.

## 7. Package Structure

```text
worker/src/smart-money/
  config.js                 central validated configuration
  contracts.js              normalized event/data contracts
  state-machine.js          strict setup lifecycle
  market-structure.js       swings, bias, BOS, CHOCH, MSS
  displacement.js           displacement metrics and classification
  fair-value-gap.js         FVG lifecycle
  dealing-range.js          external range and premium/discount
  engine.js                 observation-only foundation orchestrator

Future milestones:
  imbalance.js              IFVG and BPR composition
  order-block.js            order blocks and mitigation
  breaker-block.js          breaker lifecycle
  confluence.js             setup-family validation
  risk.js                   position sizing and portfolio authorization
  ranking.js                cross-symbol opportunity ranking
  alerts.js                 structured paper alerts
  backtest.js               event-driven simulator
```

## 8. Core Contracts

The foundation defines normalized contracts for:

- `SwingPoint`
- `StructuralEvent`
- `DisplacementEvent`
- `FairValueGap`
- `DealingRange`
- `SmartMoneySetupState`
- `NoTradeDecision`

Later milestones add order blocks, breakers, entry zones, risk plans, alerts, and broker requests without changing the existing foundation fields silently.

## 9. State Machine

```text
CONTEXT_DETECTED
  -> LIQUIDITY_IDENTIFIED
  -> LIQUIDITY_EVENT_DETECTED
  -> STRUCTURE_CONFIRMING
  -> DISPLACEMENT_CONFIRMED
  -> ENTRY_ZONE_CREATED
  -> VALIDATING
  -> CONFIRMED
  -> ARMED
  -> WAITING_FOR_ENTRY
  -> ENTRY_TRIGGERED
  -> ORDER_SUBMITTED
  -> PARTIALLY_FILLED
  -> FILLED
  -> MANAGING_POSITION
  -> PARTIAL_TARGET_REACHED
  -> COMPLETED
```

Terminal alternatives are `STOPPED`, `CANCELLED`, `INVALIDATED`, `EXPIRED`, and `EXECUTION_ERROR`. Terminal states cannot reactivate. A new thesis requires a new deterministic setup ID.

## 10. Initial Invalidation Codes

- `MARKET_DATA_REJECTED`
- `DELAYED_DATA`
- `MISSING_CANDLES`
- `WIDE_SPREAD`
- `INSUFFICIENT_HISTORY`
- `NO_CONFIRMED_STRUCTURE`
- `WICK_ONLY_FALSE_BREAK`
- `WEAK_STRUCTURE_BREAK`
- `PROTECTED_STRUCTURE_FAILED`
- `SWEEP_EXTREME_BROKEN`
- `CONFIRMED_OPPOSITE_BREAKOUT`
- `WEAK_DISPLACEMENT`
- `ABNORMAL_NEWS_DISPLACEMENT`
- `NO_VALID_FVG`
- `FVG_FULLY_MITIGATED`
- `FVG_INVALIDATED`
- `NO_VALID_ENTRY_ZONE`
- `ENTRY_ZONE_MISSED`
- `TARGET_REACHED_BEFORE_ENTRY`
- `STOP_TOO_WIDE`
- `REWARD_TO_RISK_TOO_LOW`
- `EVENT_RISK_BLOCKED`
- `HALTED_SYMBOL`
- `DUPLICATE_SETUP`
- `SETUP_EXPIRED`
- `PORTFOLIO_RISK_BLOCKED`
- `SMART_MONEY_FOUNDATION_OBSERVATION_ONLY`

## 11. Scoring Model

The production score follows the requested 100-point allocation:

- Higher-timeframe context: 15
- Liquidity: 15
- Structure: 15
- Displacement: 15
- Entry zone: 15
- Target/risk: 15
- Execution: 10

Classification thresholds are configurable:

- 90-100: exceptional
- 82-89: high quality
- 74-81: valid
- 65-73: watchlist only
- Below 65: reject

No score can override a failed mandatory condition.

## 12. Storage and Audit Strategy

Each event uses a deterministic ID derived from strategy version, symbol, timeframe, direction, source event, timestamp, and normalized prices. State transitions append immutable audit records containing timestamp, module, event type, reason, and safe metadata. Credentials are never logged.

Recommended persistence:

- Durable Object or transactional store for active setup state and idempotency locks.
- Append-only event history for audits and backtests.
- Cache for unchanged market snapshots and scanner fan-out.

## 13. Testing Strategy

Foundation tests cover:

- Confirmed pivots and confirmation delay.
- Bullish/bearish BOS.
- Wick-only false breaks.
- CHOCH/MSS transition logic.
- Strong/weak/abnormal displacement.
- Valid/tiny/mitigated/inverted FVGs.
- Dealing-range premium/discount classification.
- State-machine terminal protections.
- Paper-only configuration locks.
- Observation-only engine output.

Later test phases add order blocks, breakers, setup families, risk, duplicate alerts, event risk, backtesting, partial fills, and broker failures.

## 14. First Production Milestone

The first production milestone is an observation-only quantitative foundation that:

1. Reuses the existing safe market-data layer.
2. Confirms non-repainting internal/external swings.
3. Detects close-confirmed structural events.
4. Scores displacement.
5. Detects and tracks FVG lifecycle.
6. Builds the active dealing range and premium/discount location.
7. Produces deterministic diagnostics.
8. Always returns `NO_TRADE` with `SMART_MONEY_FOUNDATION_OBSERVATION_ONLY` until liquidity, order-block, confluence, risk, ranking, and paper-alert authorization are integrated and tested.

This milestone does not place, preview, reserve, or submit any broker order.
