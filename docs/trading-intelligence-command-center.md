# MOERAND Trading Intelligence Command Center

## Status

- Runtime mode: `PAPER_TRADING` / Webull Sandbox
- Strategy-driven live execution: disabled
- Observation service: read-only
- Automatic live submission: disabled
- Live kill switch: enabled
- Primary Worker entrypoint: `worker/src/smart-money-observation-entry.js`

This document describes the integrated trading-intelligence dashboard and the safety boundaries that remain authoritative. Analytical quality, portfolio capacity, and execution permission are intentionally separate concepts.

## 1. Safety invariants

Every analytical output must preserve:

```text
observationOnly=true
executionAllowed=false
automaticSubmissionAllowed=false
liveExecutionAllowed=false
```

A high score, completed Institutional Flow pipeline, healthy portfolio, or high execution-quality score never grants order permission.

The final configuration also preserves:

- `MOE_LIVE_MODE_UNLOCKED=false`
- `MOE_LIVE_EXECUTION_IMPLEMENTED=false`
- `WEBULL_LIVE_TRADING=false`
- `WEBULL_LIVE_ORDER_SUBMISSION=false`
- `WEBULL_LIVE_AUTOMATION_ARMED=false`
- `WEBULL_LIVE_KILL_SWITCH=true`

## 2. Decision pipeline

The mandatory analytical sequence is:

```text
Stop Run -> Absorption -> Imbalance -> Structure Confirmation -> Risk Engine
```

Official weights are fixed:

| Stage | Weight |
|---|---:|
| Stop Run | 20% |
| Absorption | 20% |
| Imbalance | 20% |
| Structure Confirmation | 20% |
| Risk Engine | 20% |

A later stage cannot override an earlier failed mandatory stage.

## 3. Circular gauges

The dashboard registry contains:

1. Higher-Timeframe Bias
2. Market Regime
3. Relative Volume
4. Liquidity Sweep
5. Stop Run
6. Smart Money
7. SMT Divergence
8. Absorption
9. Market Imbalance
10. Market Structure
11. Risk Quality
12. Setup Confidence
13. Data Quality
14. Execution Quality

Optional unavailable gauges are shown honestly and do not become mandatory blockers. Required unavailable data remains a blocker.

## 4. Session-normalized RVOL

The preferred RVOL method compares the current completed candle with the same New York exchange-time minute across previous sessions.

- Time zone: `America/New_York`
- DST-safe through `Intl.DateTimeFormat`
- Current exchange date is excluded from the baseline
- Minimum same-slot history: 3 sessions
- Maximum baseline history: 20 sessions
- Baseline statistic: arithmetic mean

When same-slot history is insufficient, the engine falls back to the completed-candle lookback and marks the fallback explicitly.

## 5. SMT Divergence

SMT compares the primary symbol with a configured correlated symbol.

Default configuration:

```text
SMT_DIVERGENCE_ENABLED=true
SMT_DEFAULT_COMPARISON_SYMBOL=SPY
SMT_FALLBACK_COMPARISON_SYMBOL=QQQ
SMT_MINIMUM_BARS=30
SMT_CORRELATION_LOOKBACK=60
SMT_MINIMUM_CORRELATION=0.45
```

SMT remains supporting evidence and cannot independently authorize a trade.

## 6. Execution Quality

Execution Quality is a pre-execution diagnostic, not an execution permission engine.

It evaluates available telemetry such as:

- normalized market-data quality
- completed-bar delay
- spread
- quote freshness when available
- trade-report delay when available
- classified order-flow share
- order-flow classification confidence
- estimated slippage proxy
- broker connectivity when available

The engine reports both:

- `score`: quality of the telemetry that exists
- `coveragePercent`: how much of the desired telemetry exists

Missing quote, broker, or trade-report telemetry is never invented. A high quality score can coexist with `BLOCKED` because paper/observation safety locks remain active.

## 7. Portfolio and Capital Risk

The Portfolio Risk panel reads:

- trades
- active reservations
- lifecycle reconciliation
- Webull Sandbox account snapshot when available
- stored capital-policy metrics as a fallback

It reports:

- cash and settled cash
- day and overnight buying power
- net liquidation
- deployed and reserved capital
- realized daily P&L
- remaining daily loss capacity
- gross exposure
- open risk and open-risk percentage
- symbol concentration
- sector exposure proxy
- protection and margin-exit status

Correlation exposure is not fabricated. Until a validated correlation matrix exists, sector exposure is labeled as a proxy.

Final conservative limits:

```text
MOE_MAX_OPEN_POSITIONS=4
MOE_MAX_DAILY_TRADES=8
MOE_MAX_PORTFOLIO_RISK_PERCENT=2
MOE_MAX_OPEN_RISK_PERCENT=2
MOE_MAX_DAILY_LOSS_PERCENT=2
MOE_MAX_SYMBOL_CONCENTRATION_PERCENT=35
MOE_MAX_SECTOR_EXPOSURE_PERCENT=50
MOE_MAX_CORRELATED_POSITIONS=2
MOE_MAX_SECTOR_POSITIONS=2
MOE_PORTFOLIO_ACCOUNT_STALE_SECONDS=300
AUTO_SCANNER_MAX_SUBMISSIONS_PER_RUN=1
```

The scanner still evaluates up to 40 symbols. Reducing order capacity does not reduce the observation universe.

## 8. Conflict Summary

The Command Center combines:

- gauge statuses
- mandatory analytical blockers
- execution-quality market blockers
- observation safety locks
- portfolio blockers
- active-position risk and protection

It reports:

- strongest support
- strongest conflict
- mandatory and optional conflict counts
- primary non-readiness reason
- conflict categories

Possible states:

```text
ALIGNED
CONFLICTING
BLOCKED
INSUFFICIENT_EVIDENCE
UNAVAILABLE
```

`ALIGNED` still means observation-only; it does not grant execution permission.

## 9. Activity Feed

The feed records state changes rather than repeating every scanner cycle. Event fingerprints are based on event type, symbol, and condition.

Examples:

- Institutional Flow pipeline confirmed
- SMT divergence confirmed
- session RVOL elevated
- pipeline stage rejected
- execution quality degraded
- portfolio risk gate blocked
- daily loss limit near
- position risk changed
- position protection incomplete
- target reached

Events are classified as `CRITICAL`, `WARNING`, `POSITIVE`, or `INFO`.

## 10. Read-only endpoints

| Endpoint | Purpose |
|---|---|
| `GET /api/scanner/status` | Scanner and observation status |
| `GET /api/trading-intelligence/active-position` | Active-position progress and protection |
| `GET /api/trading-intelligence/portfolio-risk` | Portfolio and capital-risk snapshot |
| `GET /api/trading-intelligence/command-center` | Conflict Summary and Activity Feed |
| `GET /api/trading-intelligence/command-center?symbol=AAPL` | Command Center for a selected scanner result |

These endpoints do not submit, modify, or cancel orders.

## 11. Dashboard behavior and accessibility

The production overlays provide:

- responsive layouts for desktop, tablet, and mobile breakpoints
- keyboard-focusable gauge and opportunity buttons
- accessible gauge labels
- an `aria-live` gauge detail region
- reduced-motion handling for gauge animation and scrolling
- escaped dynamic HTML content
- idempotent overlay injection
- no-cache reads for live dashboard diagnostics

## 12. Validation

The Worker Safety workflow runs isolated tests for:

- order reservations
- liquidity and Smart Money engines
- market-data quality
- session-normalized RVOL
- Institutional Flow stages
- order-flow replay
- circular gauge contracts
- active-position intelligence
- SMT Divergence
- Execution Quality
- Portfolio Risk
- Portfolio Risk overlay
- Conflict Summary and Activity Feed
- Command Center overlay
- final safety configuration
- complete Worker test suite

## 13. Known limits before any future live authorization

The following are still required before live execution can be considered:

- approved live broker certification
- production broker heartbeat and connectivity telemetry
- real quote/trade streaming coverage
- validated slippage and fill-quality measurements
- correlation matrix for portfolio exposure
- multi-session threshold calibration
- published-browser visual review on the deployed Worker
- explicit human approval and a separate live-enablement change

No current analytical result should be interpreted as live-trading authorization.
